/**
 * Report tools for Ekyte MCP Server (read-only)
 *
 * Aggregate many tasks in a single call so the agent doesn't have to page
 * through hundreds of items per user.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, companyUrl, handleApiError } from "../services/ekyte-client.js";
import { fetchTasks, taskDueDate, todayInBrazil } from "../services/tasks.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat } from "../schemas/common.js";
import { DailyReportSchema, type DailyReportInput } from "../schemas/report.js";
import type { EkyteTask, EkyteUser } from "../types.js";

// ============ Helpers ============

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/** Escapes "|" so task titles don't break markdown tables. */
function cell(value: string): string {
  return value.replace(/\|/g, "\|");
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Meeting cards synced from Google Calendar — overdue ones are usually just never closed. */
function isCalendarCard(t: EkyteTask): boolean {
  return (t.ctcTaskType?.name ?? "").toUpperCase().includes("AGENDA GOOGLE") ||
    t.title.startsWith("🤖 Google Agenda");
}

function remainingMinutes(t: EkyteTask): number {
  return Math.max(0, (t.estimatedTime ?? 0) - (t.actualTime ?? 0));
}

interface PersonStats {
  executor_id: string;
  name: string;
  active_total: number;
  today_count: number;
  today_estimated_min: number;
  today_remaining_min: number;
  overdue_count: number;
  overdue_estimated_min: number;
  overdue_calendar_cards: number;
  oldest_overdue_days: number;
  overloaded: boolean;
}

interface WorkspaceDelay {
  workspace_id: number;
  workspace: string;
  overdue_count: number;
  overdue_calendar_cards: number;
  overdue_estimated_min: number;
  people: string[];
}

function taskRef(t: EkyteTask, date: string) {
  const due = taskDueDate(t);
  return {
    id: t.id,
    title: t.title,
    workspace: t.workspace?.name ?? "-",
    executor: t.executor?.userName ?? t.executorId ?? "-",
    due_date: due,
    days_late: due && due < date ? daysBetween(due, date) : 0,
    estimated_min: t.estimatedTime ?? 0,
    actual_min: t.actualTime ?? 0,
  };
}

// ============ Register Report Tools ============

export function registerReportTools(server: McpServer): void {

  // -------- Daily Report --------
  server.registerTool(
    "ekyte_daily_report",
    {
      title: "Relatório Diário de Tarefas do Ekyte",
      description: `Panorama diário das tarefas ATIVAS em UMA chamada: tarefas do dia e tempo alocado por pessoa, gargalos críticos e mapa de atrasos.

Retorna:
- Resumo: tarefas do dia, horas estimadas/restantes, atrasadas.
- Por pessoa: tarefas do dia, estimado, restante (estimado − real), atrasadas, total ativo, sobrecarga (restante > capacidade diária).
- Gargalos: pessoas sobrecarregadas, tarefas com tempo real estourando o estimado, atrasos mais antigos.
- Mapa de atrasos por workspace.
- Higiene: cards "🤖 Google Agenda" vencidos e não fechados (contados à parte para não inflar os atrasos reais).

Padrão: hoje (horário de Brasília), empresa inteira. Filtre por workspace_id ou executor_id se precisar.`,
      inputSchema: DailyReportSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DailyReportInput) => {
      try {
        const date = params.date ?? todayInBrazil();
        const capacityMin = params.daily_capacity_hours * 60;

        const [{ tasks: fetched, maybeCapped }, users] = await Promise.all([
          fetchTasks({ status: 10, workspace_id: params.workspace_id, executor_id: params.executor_id }),
          apiGet<EkyteUser[]>(companyUrl("users/editors/simple")).catch(() => [] as EkyteUser[]),
        ]);

        // The API's executor filter also matches tasks where the user is in another phase.
        const tasks = params.executor_id
          ? fetched.filter((t) => t.executorId === params.executor_id)
          : fetched;

        const userNames = new Map((Array.isArray(users) ? users : []).map((u) => [u.id, u.userName]));
        const people = new Map<string, PersonStats>();
        const workspaces = new Map<number, WorkspaceDelay & { peopleSet: Set<string> }>();
        const todayTasks: EkyteTask[] = [];
        const overdueTasks: EkyteTask[] = [];

        for (const t of tasks) {
          const executorId = t.executorId ?? "sem-responsavel";
          const name = t.executor?.userName ?? userNames.get(executorId) ?? "(sem responsável)";
          let p = people.get(executorId);
          if (!p) {
            p = {
              executor_id: executorId, name, active_total: 0,
              today_count: 0, today_estimated_min: 0, today_remaining_min: 0,
              overdue_count: 0, overdue_estimated_min: 0, overdue_calendar_cards: 0,
              oldest_overdue_days: 0, overloaded: false,
            };
            people.set(executorId, p);
          }
          p.active_total++;

          const due = taskDueDate(t);
          if (due === date) {
            todayTasks.push(t);
            p.today_count++;
            p.today_estimated_min += t.estimatedTime ?? 0;
            p.today_remaining_min += remainingMinutes(t);
          } else if (due && due < date) {
            const calendar = isCalendarCard(t);
            let w = workspaces.get(t.workspaceId);
            if (!w) {
              w = {
                workspace_id: t.workspaceId, workspace: t.workspace?.name ?? String(t.workspaceId),
                overdue_count: 0, overdue_calendar_cards: 0, overdue_estimated_min: 0,
                people: [], peopleSet: new Set(),
              };
              workspaces.set(t.workspaceId, w);
            }
            w.peopleSet.add(name);
            if (calendar) {
              p.overdue_calendar_cards++;
              w.overdue_calendar_cards++;
            } else {
              overdueTasks.push(t);
              p.overdue_count++;
              p.overdue_estimated_min += t.estimatedTime ?? 0;
              p.oldest_overdue_days = Math.max(p.oldest_overdue_days, daysBetween(due, date));
              w.overdue_count++;
              w.overdue_estimated_min += t.estimatedTime ?? 0;
            }
          }
        }

        for (const p of people.values()) p.overloaded = p.today_remaining_min > capacityMin;

        const personRows = [...people.values()]
          .filter((p) => p.today_count > 0 || p.overdue_count > 0 || p.overdue_calendar_cards > 0)
          .sort((a, b) =>
            b.today_remaining_min - a.today_remaining_min || b.overdue_estimated_min - a.overdue_estimated_min);

        const withoutTasksToday = params.workspace_id || params.executor_id
          ? []
          : [...userNames.entries()]
            .filter(([id]) => !(people.get(id)?.today_count))
            .map(([, n]) => n)
            .sort();

        const overloaded = personRows.filter((p) => p.overloaded);

        const overruns = tasks
          .filter((t) => {
            const est = t.estimatedTime ?? 0;
            const act = t.actualTime ?? 0;
            return est > 0 && act >= est * params.overrun_factor && act - est >= 60;
          })
          .sort((a, b) => ((b.actualTime - b.estimatedTime) - (a.actualTime - a.estimatedTime)))
          .slice(0, params.top_n)
          .map((t) => taskRef(t, date));

        const oldestOverdue = overdueTasks
          .map((t) => taskRef(t, date))
          .sort((a, b) => b.days_late - a.days_late || b.estimated_min - a.estimated_min)
          .slice(0, params.top_n);

        const delayMap: WorkspaceDelay[] = [...workspaces.values()]
          .map(({ peopleSet, ...w }) => ({ ...w, people: [...peopleSet].sort() }))
          .sort((a, b) => b.overdue_count - a.overdue_count || b.overdue_calendar_cards - a.overdue_calendar_cards);

        const sum = (rows: PersonStats[], key: keyof PersonStats) =>
          rows.reduce((acc, r) => acc + (r[key] as number), 0);
        const summary = {
          date,
          active_tasks: tasks.length,
          today_tasks: todayTasks.length,
          today_estimated_min: sum(personRows, "today_estimated_min"),
          today_remaining_min: sum(personRows, "today_remaining_min"),
          overdue_tasks: overdueTasks.length,
          overdue_estimated_min: sum(personRows, "overdue_estimated_min"),
          overdue_calendar_cards: sum(personRows, "overdue_calendar_cards"),
          overloaded_people: overloaded.length,
          daily_capacity_hours: params.daily_capacity_hours,
          maybe_capped: maybeCapped,
        };

        if (params.response_format === ResponseFormat.JSON) {
          const output = {
            summary,
            people: personRows,
            without_tasks_today: withoutTasksToday,
            bottlenecks: { overloaded_people: overloaded.map((p) => p.name), overruns, oldest_overdue: oldestOverdue },
            delay_map: delayMap,
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
        }

        const fm = formatMinutes;
        const lines = [
          `# Relatório diário Ekyte — ${date}`,
          "",
          `- **Tarefas do dia**: ${summary.today_tasks} (${fm(summary.today_estimated_min)} estimadas, ${fm(summary.today_remaining_min)} restantes)`,
          `- **Atrasadas**: ${summary.overdue_tasks} (${fm(summary.overdue_estimated_min)} estimadas) + ${summary.overdue_calendar_cards} cards de agenda vencidos não fechados`,
          `- **Sobrecarregados** (restante > ${params.daily_capacity_hours}h): ${overloaded.length ? overloaded.map((p) => `${p.name} (${fm(p.today_remaining_min)})`).join(", ") : "ninguém"}`,
          `- Tarefas ativas analisadas: ${summary.active_tasks}`,
          ...(maybeCapped ? ["", "⚠️ A API pode ter limitado o resultado (≥2000 tarefas). Rode por workspace_id para garantir cobertura total."] : []),
          "",
          "## Carga por pessoa",
          "",
          "| Pessoa | Hoje | Estimado | Restante | Atrasadas | Est. atrasado | Mais antigo | Agenda vencida | Ativas |",
          "|---|---|---|---|---|---|---|---|---|",
          ...personRows.map((p) =>
            `| ${p.overloaded ? "🔴 " : ""}${p.name} | ${p.today_count} | ${fm(p.today_estimated_min)} | ${fm(p.today_remaining_min)} | ${p.overdue_count} | ${fm(p.overdue_estimated_min)} | ${p.oldest_overdue_days ? `${p.oldest_overdue_days}d` : "-"} | ${p.overdue_calendar_cards || "-"} | ${p.active_total} |`),
          "",
          ...(withoutTasksToday.length ? [`**Sem tarefas para hoje**: ${withoutTasksToday.join(", ")}`, ""] : []),
          `## Estouros de estimativa (real ≥ ${params.overrun_factor}× estimado)`,
          "",
          ...(overruns.length
            ? ["| # | Tarefa | Workspace | Responsável | Estimado | Real | Entrega |", "|---|---|---|---|---|---|---|",
              ...overruns.map((o) => `| ${o.id} | ${cell(o.title)} | ${cell(o.workspace)} | ${o.executor} | ${fm(o.estimated_min)} | ${fm(o.actual_min)} | ${o.due_date ?? "-"} |`)]
            : ["Nenhum."]),
          "",
          "## Atrasos mais antigos",
          "",
          ...(oldestOverdue.length
            ? ["| # | Tarefa | Workspace | Responsável | Entrega | Dias | Estimado |", "|---|---|---|---|---|---|---|",
              ...oldestOverdue.map((o) => `| ${o.id} | ${cell(o.title)} | ${cell(o.workspace)} | ${o.executor} | ${o.due_date} | ${o.days_late} | ${fm(o.estimated_min)} |`)]
            : ["Nenhum."]),
          "",
          "## Mapa de atrasos por workspace",
          "",
          ...(delayMap.length
            ? ["| Workspace | Atrasadas | Estimado | Agenda vencida | Responsáveis |", "|---|---|---|---|---|",
              ...delayMap.map((w) => `| ${cell(w.workspace)} | ${w.overdue_count} | ${fm(w.overdue_estimated_min)} | ${w.overdue_calendar_cards || "-"} | ${w.people.join(", ")} |`)]
            : ["Nenhum atraso."]),
          "",
          "_Restante = estimado − tempo real apontado (mínimo 0). Cards \"🤖 Google Agenda\" vencidos ficam fora dos atrasos: normalmente são reuniões já realizadas que ninguém concluiu._",
        ];

        let text = lines.join("\n");
        if (text.length > CHARACTER_LIMIT) {
          text = text.substring(0, CHARACTER_LIMIT) +
            "\n\n⚠️ Relatório truncado. Reduza `top_n` ou filtre por workspace_id.";
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );
}
