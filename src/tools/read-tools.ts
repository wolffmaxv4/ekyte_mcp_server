/**
 * Read-only tools for Ekyte MCP Server
 *
 * These tools only fetch data and never modify anything in Ekyte.
 * All endpoints live under the internal API: /api/companies/{companyId}/...
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, companyUrl, companyV2Url, handleApiError } from "../services/ekyte-client.js";
import { fetchTasks } from "../services/tasks.js";
import { TASK_STATUS_LABELS, CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat } from "../schemas/common.js";
import {
  ListWorkspacesSchema,
  ListUsersSchema,
  ListTaskTypesSchema,
  ListTasksSchema,
  GetTaskSchema,
  ListPhasesSchema,
  ListTaskFlowPhasesSchema,
  type ListWorkspacesInput,
  type ListUsersInput,
  type ListTaskTypesInput,
  type ListTasksInput,
  type GetTaskInput,
  type ListPhasesInput,
  type ListTaskFlowPhasesInput,
} from "../schemas/task.js";
import type { EkyteWorkspace, EkyteUser, EkyteTaskType, EkyteTask } from "../types.js";
import {
  ListProjectsSchema,
  ListProjectTemplatesSchema,
  ListProjectTasksSchema,
  type ListProjectsInput,
  type ListProjectTemplatesInput,
  type ListProjectTasksInput,
} from "../schemas/project.js";

// ============ Helpers ============

const PAGE_SIZE = 50;
// Ekyte's /ctc-tasks endpoint returns ≤1200 items even with huge limits.
// Keep the value modest so the API doesn't churn on large limits.
const TASKS_FETCH_LIMIT = 2000;

function formatResponse(data: unknown, markdown: string, format: ResponseFormat) {
  if (format === ResponseFormat.JSON) {
    const json = JSON.stringify(data, null, 2);
    if (json.length <= CHARACTER_LIMIT) return json;
    // Too big. Preserve structure and cut the items array so the JSON stays valid.
    const d = data as { items?: unknown[] } & Record<string, unknown>;
    if (Array.isArray(d?.items) && d.items.length > 1) {
      const reduced: Record<string, unknown> = { ...d };
      let keep = Math.max(1, Math.floor(d.items.length / 2));
      while (keep > 0) {
        reduced.items = d.items.slice(0, keep);
        reduced.truncated = true;
        reduced.truncated_kept = keep;
        reduced.truncated_total_in_page = d.items.length;
        reduced.hint = "Resposta encurtada para caber no limite. Refine com `search` ou mais filtros.";
        const out = JSON.stringify(reduced, null, 2);
        if (out.length <= CHARACTER_LIMIT) return out;
        keep = Math.floor(keep / 2);
      }
    }
    const fallback = {
      error: "response_too_large",
      message: "JSON excede o limite de caracteres. Use `search` para filtrar ou avance a `page`.",
      hint: "Se já paginou, reduza o escopo filtrando por workspace/task_type/datas.",
    };
    return JSON.stringify(fallback, null, 2);
  }
  const textContent = markdown;
  if (textContent.length > CHARACTER_LIMIT) {
    return textContent.substring(0, CHARACTER_LIMIT) +
      "\n\n⚠️ Resposta truncada. Use o parâmetro `search` para filtrar por nome, ou avance a `page`.";
  }
  return textContent;
}

function paginate<T>(items: T[], page: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  return {
    slice,
    total,
    page: safePage,
    totalPages,
    hasMore: safePage < totalPages,
    nextPage: safePage < totalPages ? safePage + 1 : null,
  };
}

function matchSearch(haystack: string | undefined | null, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// ============ Register Read Tools ============

export function registerReadTools(server: McpServer): void {

  // -------- List Workspaces --------
  server.registerTool(
    "ekyte_list_workspaces",
    {
      title: "Listar Workspaces do Ekyte",
      description: `Lista workspaces (clientes/projetos) da empresa no Ekyte.

👉 PREFIRA usar o parâmetro "search" para achar um workspace pelo nome (ex: search="ferraz" acha "V4 Ferraz Piai"). É mais rápido que iterar páginas.

Use esta ferramenta ANTES de criar tasks ou apontar horas.
Retorna: id, nome, status (ativo/inativo).

Paginação client-side: 50 registros por página. Total típico: 600+ workspaces.`,
      inputSchema: ListWorkspacesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListWorkspacesInput) => {
      try {
        const data = await apiGet<EkyteWorkspace[]>(companyUrl("workspaces"));
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.active_only) filtered = filtered.filter((w) => w.active === 1);
        if (params.search) filtered = filtered.filter((w) => matchSearch(w.name, params.search!));

        if (filtered.length === 0) {
          const hint = params.search
            ? `Nenhum workspace encontrado para "${params.search}". Total na conta: ${all.length}.`
            : "Nenhum workspace encontrado.";
          return { content: [{ type: "text" as const, text: hint }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_in_account: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          search: params.search ?? null,
          active_only: params.active_only,
          items: slice.map((w) => ({
            id: w.id,
            name: w.name,
            active: w.active === 1,
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Workspaces do Ekyte",
          "",
          params.search ? `Filtro: "${params.search}"` : `Total na conta: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID | Nome | Ativo |",
          "|----|------|-------|",
          ...slice.map((w) => `| ${w.id} | ${w.name} | ${w.active === 1 ? "Sim" : "Não"} |`),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Users --------
  server.registerTool(
    "ekyte_list_users",
    {
      title: "Listar Usuários do Ekyte",
      description: `Lista usuários/membros da empresa no Ekyte.

👉 PREFIRA usar "search" (busca por nome OU email, case-insensitive) para achar alguém rapidamente. Ex: search="pietro".

Retorna: id (UUID), nome, email.

IMPORTANTE: O ID do usuário é um UUID (ex: "feff4a61-b0a3-483d-a384-172c4b301ee0"), não um número.

Paginação client-side: 50 por página.`,
      inputSchema: ListUsersSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListUsersInput) => {
      try {
        const data = await apiGet<EkyteUser[]>(companyUrl("users/editors/simple"));
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.search) {
          filtered = filtered.filter((u) =>
            matchSearch(u.userName, params.search!) || matchSearch(u.email, params.search!)
          );
        }

        if (filtered.length === 0) {
          const hint = params.search
            ? `Nenhum usuário encontrado para "${params.search}". Total: ${all.length}.`
            : "Nenhum usuário encontrado.";
          return { content: [{ type: "text" as const, text: hint }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_in_account: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          search: params.search ?? null,
          items: slice.map((u) => ({
            id: u.id,
            name: u.userName,
            email: u.email,
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Usuários do Ekyte",
          "",
          params.search ? `Filtro: "${params.search}"` : `Total na conta: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID (UUID) | Nome | Email |",
          "|-----------|------|-------|",
          ...slice.map((u) => `| ${u.id} | ${u.userName} | ${u.email} |`),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Task Types --------
  server.registerTool(
    "ekyte_list_task_types",
    {
      title: "Listar Tipos de Tarefa do Ekyte",
      description: `Lista todos os tipos de tarefa (templates) da empresa.

Use para descobrir o task_type_id antes de criar tarefas.
Retorna: id, nome, workflow_id (importante: cada task-type pertence a um workflow, e as phases vivem no workflow).

DICA: Depois de achar o task_type, use ekyte_list_phases com o workflow_id correspondente para descobrir as phases disponíveis.`,
      inputSchema: ListTaskTypesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListTaskTypesInput) => {
      try {
        const data = await apiGet<EkyteTaskType[]>(companyUrl("task-types"));
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.active_only) filtered = filtered.filter((t) => t.active === 1);
        if (params.search) filtered = filtered.filter((t) => matchSearch(t.name, params.search!));

        if (filtered.length === 0) {
          const hint = params.search
            ? `Nenhum tipo de tarefa encontrado para "${params.search}". Total: ${all.length}.`
            : "Nenhum tipo de tarefa encontrado.";
          return { content: [{ type: "text" as const, text: hint }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_in_account: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          search: params.search ?? null,
          active_only: params.active_only,
          items: slice.map((t) => ({
            id: t.id,
            name: t.name,
            active: t.active === 1,
            workflow_id: t.workflowId,
            group: t.ctcTaskTypeGroup?.name,
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Tipos de Tarefa do Ekyte",
          "",
          params.search ? `Filtro: "${params.search}"` : `Total na conta: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID | Nome | Ativo | Workflow ID | Grupo |",
          "|----|------|-------|-------------|-------|",
          ...slice.map((t) =>
            `| ${t.id} | ${t.name} | ${t.active === 1 ? "Sim" : "Não"} | ${t.workflowId} | ${t.ctcTaskTypeGroup?.name ?? "-"} |`
          ),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Workflow Phases --------
  server.registerTool(
    "ekyte_list_phases",
    {
      title: "Listar Fases (Phases) de um Workflow",
      description: `Lista as fases (phases) de um workflow do Ekyte.

Cada tipo de tarefa pertence a um workflow, e o workflow contém as fases possíveis para tarefas daquele tipo.

Use esta ferramenta ANTES de criar uma tarefa: descubra o workflow_id via ekyte_list_task_types, depois use este tool para achar o phase_id correto (normalmente a fase inicial).

Retorna: id, nome, sequencial, ativo.`,
      inputSchema: ListPhasesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListPhasesInput) => {
      try {
        const data = await apiGet<Record<string, unknown>>(
          companyUrl(`workflows/${params.workflow_id}`)
        );

        const phases = Array.isArray(data.phases) ? data.phases as Record<string, unknown>[] : [];
        if (phases.length === 0) {
          return { content: [{ type: "text" as const, text: `Nenhuma fase encontrada para workflow ${params.workflow_id}.` }] };
        }

        const output = {
          workflow_id: params.workflow_id,
          workflow_name: data.name ?? "-",
          count: phases.length,
          items: phases.map((p) => ({
            id: p.id,
            name: p.name,
            sequential: p.sequential,
            active: p.active === 1,
            hidden: p.hidden === 1,
          })),
        };

        const markdown = [
          `# Fases do Workflow #${params.workflow_id} — ${data.name ?? "-"}`,
          "",
          `${phases.length} fase(s) encontrada(s)`,
          "",
          "| ID | Seq | Nome | Ativa |",
          "|----|-----|------|-------|",
          ...phases.map((p) =>
            `| ${p.id} | ${p.sequential} | ${p.name} | ${p.active === 1 ? "Sim" : "Não"} |`
          ),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Tasks --------
  server.registerTool(
    "ekyte_list_tasks",
    {
      title: "Listar Tarefas do Ekyte",
      description: `Lista tarefas da empresa no Ekyte com filtros opcionais.

Filtros server-side: workspace_id, status, task_type_id, phase_id, executor_id.
Filtros client-side: datas (due_from/due_to/created_from/created_to — a API ignora datas), search (texto no título).
Status padrão: 10 (Ativas). Use status=0 para todas.

Para um panorama diário (tarefas do dia, carga por pessoa, atrasos), prefira ekyte_daily_report.

PAGINAÇÃO: a API do Ekyte não pagina este endpoint — o MCP faz paginação client-side (50 por página) após aplicar todos os filtros.

DICA: sempre filtre por workspace_id para reduzir o volume. Use ekyte_list_workspaces com search para achar o ID.

Retorna: id, título, status, responsável, datas, tempo estimado/real, workspace, tipo de tarefa.`,
      inputSchema: ListTasksSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListTasksInput) => {
      try {
        const { tasks: all } = await fetchTasks(params);

        const filtered = params.search
          ? all.filter((t) => matchSearch(t.title, params.search!))
          : all;

        if (filtered.length === 0) {
          const hint = params.search
            ? `Nenhuma tarefa encontrada para "${params.search}". Total com os demais filtros: ${all.length}.`
            : "Nenhuma tarefa encontrada com os filtros informados.";
          return { content: [{ type: "text" as const, text: hint }] };
        }

        const formatMinutes = (mins: number): string => {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        };

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_fetched: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          search: params.search ?? null,
          items: slice.map((t) => ({
            id: t.id,
            title: t.title,
            status: TASK_STATUS_LABELS[t.situation] ?? `Desconhecido (${t.situation})`,
            status_code: t.situation,
            workspace: t.workspace?.name ?? "-",
            workspace_id: t.workspaceId,
            task_type: t.ctcTaskType?.name ?? "-",
            task_type_id: t.ctcTaskTypeId,
            phase_id: t.phaseId,
            executor: t.executor?.userName ?? "-",
            executor_id: t.executorId,
            estimated_time: formatMinutes(t.estimatedTime ?? 0),
            actual_time: formatMinutes(t.actualTime ?? 0),
            phase_start_date: t.phaseStartDate?.split("T")[0] ?? "-",
            phase_due_date: t.phaseDueDate?.split("T")[0] ?? "-",
            current_due_date: t.currentDueDate?.split("T")[0] ?? "-",
            created_at: t.creationDate?.split("T")[0] ?? "-",
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Tarefas do Ekyte",
          "",
          params.search ? `Filtro título: "${params.search}"` : `Total carregado: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          ...slice.map((t) => [
            `## #${t.id} — ${t.title}`,
            `- **Status**: ${TASK_STATUS_LABELS[t.situation] ?? t.situation}`,
            `- **Workspace**: ${t.workspace?.name ?? "-"} (ID: ${t.workspaceId})`,
            `- **Tipo**: ${t.ctcTaskType?.name ?? "-"}`,
            `- **Responsável**: ${t.executor?.userName ?? "-"}`,
            `- **Tempo**: Estimado ${formatMinutes(t.estimatedTime ?? 0)} | Real ${formatMinutes(t.actualTime ?? 0)}`,
            `- **Entrega**: ${t.currentDueDate?.split("T")[0] ?? "-"}`,
            "",
          ]).flat(),
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Task Flow Phases (per-task phase flow with executors) --------
  server.registerTool(
    "ekyte_list_task_flow_phases",
    {
      title: "Listar Fases de uma Tarefa (com Executor por Fase)",
      description: `Lista TODAS as fases de uma tarefa específica, mostrando quem é o responsável (executor), datas e tempo estimado POR FASE.

Use ANTES de editar executor/datas/esforço de uma fase específica com ekyte_update_phase.

Diferença vs ekyte_list_phases:
- ekyte_list_phases: lista fases do WORKFLOW (template) — o que pode existir.
- ekyte_list_task_flow_phases: lista fases DESTA TAREFA — o que existe de fato, com quem.

Retorna para cada fase: phase_id, sequential, nome, executor (UUID + nome), effort, start/due date.`,
      inputSchema: ListTaskFlowPhasesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListTaskFlowPhasesInput) => {
      try {
        let phases: Record<string, unknown>[] = [];
        
        if (params.project_id) {
          // Project tasks don't have a /flow-phases endpoint. We must fetch the task and extract .flow
          const taskData = await apiGet<Record<string, unknown>>(
            companyV2Url(`projects/${params.project_id}/tasks/${params.task_id}`)
          );
          phases = Array.isArray(taskData?.flow) ? taskData.flow : [];
        } else {
          // Regular tasks
          const data = await apiGet<Record<string, unknown>[]>(
            companyV2Url(`ctc-tasks/${params.task_id}/flow-phases`)
          );
          phases = Array.isArray(data) ? data : [];
        }

        if (phases.length === 0) {
          return { content: [{ type: "text" as const, text: `Nenhuma fase encontrada para a tarefa #${params.task_id}.` }] };
        }

        const formatMinutes = (mins: number): string => {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        };

        const sorted = [...phases].sort((a, b) => (a.sequential as number) - (b.sequential as number));

        const output = {
          task_id: params.task_id,
          count: sorted.length,
          items: sorted.map((p) => {
            const phase = p.phase as Record<string, unknown> | undefined;
            const executor = p.executor as Record<string, unknown> | undefined;
            return {
              flow_id: p.id,
              phase_id: p.phaseId,
              phase_name: phase?.name ?? "-",
              sequential: p.sequential,
              executor_id: p.executorId,
              executor_name: executor?.userName ?? "-",
              effort_minutes: p.effort,
              actual_time_minutes: p.actualTime,
              phase_start_date: typeof p.phaseStartDate === "string" ? p.phaseStartDate.split("T")[0] : null,
              phase_due_date: typeof p.phaseDueDate === "string" ? p.phaseDueDate.split("T")[0] : null,
            };
          }),
        };

        const markdown = [
          `# Fases da Tarefa #${params.task_id}`,
          "",
          `${sorted.length} fase(s)`,
          "",
          "| Seq | Phase ID | Nome | Executor | Estimado | Realizado | Início | Entrega |",
          "|-----|----------|------|----------|----------|-----------|--------|---------|",
          ...sorted.map((p) => {
            const phase = p.phase as Record<string, unknown> | undefined;
            const executor = p.executor as Record<string, unknown> | undefined;
            return `| ${p.sequential} | ${p.phaseId} | ${phase?.name ?? "-"} | ${executor?.userName ?? "-"} | ${formatMinutes(p.effort as number ?? 0)} | ${formatMinutes(p.actualTime as number ?? 0)} | ${typeof p.phaseStartDate === "string" ? p.phaseStartDate.split("T")[0] : "-"} | ${typeof p.phaseDueDate === "string" ? p.phaseDueDate.split("T")[0] : "-"} |`;
          }),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- Get Single Task --------
  server.registerTool(
    "ekyte_get_task",
    {
      title: "Ver Detalhes de uma Tarefa",
      description: `Busca os detalhes completos de uma tarefa específica pelo ID.

Use ekyte_list_tasks primeiro para encontrar o ID.

Retorna: título, descrição, status, responsável, workspace, tipo, datas, tempos.`,
      inputSchema: GetTaskSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetTaskInput) => {
      try {
        const task = await apiGet<EkyteTask>(
          companyV2Url(`ctc-tasks/${params.task_id}`)
        );

        if (!task || !task.id) {
          return {
            content: [{
              type: "text" as const,
              text: `Tarefa com ID ${params.task_id} não encontrada.`,
            }],
          };
        }

        const formatMinutes = (mins: number): string => {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        };

        const output = {
          id: task.id,
          title: task.title,
          description: task.description,
          status: TASK_STATUS_LABELS[task.situation] ?? `Desconhecido (${task.situation})`,
          status_code: task.situation,
          workspace: task.workspace?.name,
          workspace_id: task.workspaceId,
          task_type: task.ctcTaskType?.name,
          task_type_id: task.ctcTaskTypeId,
          phase_id: task.phaseId,
          executor: task.executor?.userName,
          executor_id: task.executorId,
          estimated_time: formatMinutes(task.estimatedTime ?? 0),
          actual_time: formatMinutes(task.actualTime ?? 0),
          phase_start_date: task.phaseStartDate?.split("T")[0],
          phase_due_date: task.phaseDueDate?.split("T")[0],
          current_due_date: task.currentDueDate?.split("T")[0],
          created_at: task.creationDate?.split("T")[0],
          resolved_at: task.resolvedDate?.split("T")[0] ?? null,
          created_by: task.createBy?.userName,
          priority: task.priority,
        };

        const markdown = [
          `# Tarefa #${task.id} — ${task.title}`,
          "",
          task.description ? `> ${task.description.replace(/<[^>]+>/g, "")}` : "",
          "",
          `- **Status**: ${output.status}`,
          `- **Workspace**: ${output.workspace} (ID: ${output.workspace_id})`,
          `- **Tipo**: ${output.task_type} (ID: ${output.task_type_id})`,
          `- **Phase ID**: ${output.phase_id}`,
          `- **Responsável**: ${output.executor}`,
          `- **Criado por**: ${output.created_by ?? "-"}`,
          "",
          "### Datas",
          `- Início etapa: ${output.phase_start_date}`,
          `- Entrega etapa: ${output.phase_due_date}`,
          `- Entrega atual: ${output.current_due_date}`,
          `- Criação: ${output.created_at}`,
          output.resolved_at ? `- Conclusão: ${output.resolved_at}` : "",
          "",
          "### Tempo",
          `- Estimado: ${output.estimated_time}`,
          `- Real: ${output.actual_time}`,
        ].filter(Boolean).join("\n");

        return {
          content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );
  // -------- List Projects --------
  server.registerTool(
    "ekyte_list_projects",
    {
      title: "Listar Projetos do Ekyte",
      description: `Lista projetos da empresa no Ekyte.
Use is_planning=1 para buscar projetos que estão com tarefas planejadas mas não ativas ainda.
Você pode sobrescrever o endpoint caso a API utilize um caminho diferente de 'projects' (ex: 'ctc-projects').`,
      inputSchema: ListProjectsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListProjectsInput) => {
      try {
        const endpoint = params.endpoint_override || "projects";
        const queryParams: Record<string, unknown> = { limit: PAGE_SIZE * 2 };
        
        if (params.workspace_id !== undefined) queryParams.workspaceId = params.workspace_id;
        if (params.status !== undefined) queryParams.situation = params.status;
        if (params.is_planning !== undefined) queryParams.isPlanning = params.is_planning;

        const data = await apiGet<Record<string, unknown>[]>(companyV2Url(endpoint), queryParams);
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.search) {
          filtered = filtered.filter((p) => matchSearch(String(p.name || p.title || ""), params.search!));
        }

        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: "Nenhum projeto encontrado." }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_fetched: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          items: slice.map((p) => ({
            id: p.id,
            name: p.name || p.title || "-",
            situation: p.situation,
            is_planning: p.isPlanning,
            workspace_id: p.workspaceId,
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Projetos do Ekyte",
          "",
          `Total carregado: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID | Nome | Status | Planejado? | Workspace ID |",
          "|----|------|--------|------------|--------------|",
          ...output.items.map((p) => `| ${p.id} | ${p.name} | ${p.situation} | ${p.is_planning === 1 ? "Sim" : "Não"} | ${p.workspace_id || "-"} |`),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return { content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Project Templates --------
  server.registerTool(
    "ekyte_list_project_templates",
    {
      title: "Listar Modelos de Projetos",
      description: `Lista modelos (templates) de projetos disponíveis para criar novos projetos.`,
      inputSchema: ListProjectTemplatesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListProjectTemplatesInput) => {
      try {
        const endpoint = params.endpoint_override || "projects";
        const queryParams: Record<string, unknown> = { isModel: 1, limit: PAGE_SIZE * 2 };

        const data = await apiGet<Record<string, unknown>[]>(companyV2Url(endpoint), queryParams);
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.search) {
          filtered = filtered.filter((p) => matchSearch(String(p.name || p.title || ""), params.search!));
        }

        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: "Nenhum modelo de projeto encontrado." }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          total_fetched: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          items: slice.map((p) => ({
            id: p.id,
            name: p.name || p.title || "-",
            description: p.description || "-",
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          "# Modelos de Projetos do Ekyte",
          "",
          `Total carregado: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID | Nome | Descrição |",
          "|----|------|-----------|",
          ...output.items.map((p) => `| ${p.id} | ${p.name} | ${p.description} |`),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return { content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // -------- List Project Tasks --------
  server.registerTool(
    "ekyte_list_project_tasks",
    {
      title: "Listar Tarefas de um Projeto",
      description: `Lista as tarefas associadas a um projeto específico.
Excelente para verificar se existem "tarefas planejadas mas não ativas" dentro de um projeto.`,
      inputSchema: ListProjectTasksSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListProjectTasksInput) => {
      try {
        const queryParams: Record<string, unknown> = { limit: TASKS_FETCH_LIMIT };
        if (params.status !== undefined) queryParams.situation = params.status;

        const data = await apiGet<Record<string, unknown>[]>(companyV2Url(`projects/${params.project_id}/tasks`), queryParams);
        const all = Array.isArray(data) ? data : [];

        let filtered = all;
        if (params.search) {
          filtered = filtered.filter((t) => matchSearch(String(t.title || ""), params.search!));
        }

        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: `Nenhuma tarefa encontrada para o projeto #${params.project_id}.` }] };
        }

        const { slice, total, page, totalPages, hasMore, nextPage } = paginate(filtered, params.page);

        const output = {
          project_id: params.project_id,
          total_fetched: all.length,
          filtered_total: total,
          page,
          total_pages: totalPages,
          items: slice.map((t) => ({
            id: t.id,
            title: t.title || "-",
            situation: t.situation,
            taskSituation: t.taskSituation,
            executor_id: t.executorId || (t.executor as any)?.id || "-",
            executor_name: (t.executor as any)?.userName || "-",
            estimated_time: t.effort || 0,
          })),
          has_more: hasMore,
          next_page: nextPage,
        };

        const markdown = [
          `# Tarefas do Projeto #${params.project_id}`,
          "",
          `Total carregado: ${all.length}`,
          `Página ${page}/${totalPages} — ${slice.length} de ${total} resultado(s)`,
          "",
          "| ID | Título | Situação | Executor | Esforço (min) |",
          "|----|--------|----------|----------|---------------|",
          ...output.items.map((t) => `| ${t.id} | ${t.title} | ${t.situation} | ${t.executor_name} | ${t.estimated_time} |`),
          "",
          hasMore ? `➡️ Mais resultados na página ${nextPage}` : "✅ Fim dos resultados.",
        ].join("\n");

        return { content: [{ type: "text" as const, text: formatResponse(output, markdown, params.response_format) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );
}
