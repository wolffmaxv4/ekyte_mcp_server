/**
 * Task fetching with reliable filtering.
 *
 * The /ctc-tasks endpoint honors workspaceId, situation, ctcTaskTypeId, phaseId
 * and executorId, but silently IGNORES date params (dueFrom/dueTo/createdFrom/
 * createdTo). It also returns at most ~2000 items. So date filters are applied
 * client-side here, and situation is re-checked client-side as a safety net.
 */

import { apiGet, companyV2Url } from "./ekyte-client.js";
import type { EkyteTask } from "../types.js";

const TASKS_FETCH_LIMIT = 2000;

export interface TaskFilters {
  workspace_id?: number;
  /** 10/20/30/40, or 0 for all statuses */
  status?: number;
  task_type_id?: number;
  phase_id?: number;
  executor_id?: string;
  created_from?: string;
  created_to?: string;
  due_from?: string;
  due_to?: string;
}

/** "2026-10-19T00:00:00" → "2026-10-19" */
export function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** Current due date of the task (falls back to the phase due date). */
export function taskDueDate(t: EkyteTask): string | null {
  return dateOnly(t.currentDueDate) ?? dateOnly(t.phaseDueDate);
}

/** Today's date (AAAA-MM-DD) in Brazil time, independent of the server timezone. */
export function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function inRange(date: string | null, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export interface FetchTasksResult {
  /** Items returned by the API before client-side filtering */
  fetched: number;
  /** True when the API probably capped the result (filter by workspace to be safe) */
  maybeCapped: boolean;
  tasks: EkyteTask[];
}

export async function fetchTasks(filters: TaskFilters): Promise<FetchTasksResult> {
  const queryParams: Record<string, unknown> = { limit: TASKS_FETCH_LIMIT };
  if (filters.workspace_id !== undefined) queryParams.workspaceId = filters.workspace_id;
  if (filters.status) queryParams.situation = filters.status;
  if (filters.task_type_id !== undefined) queryParams.ctcTaskTypeId = filters.task_type_id;
  if (filters.phase_id !== undefined) queryParams.phaseId = filters.phase_id;
  if (filters.executor_id !== undefined) queryParams.executorId = filters.executor_id;

  const data = await apiGet<EkyteTask[]>(companyV2Url("ctc-tasks"), queryParams);
  const all = Array.isArray(data) ? data : [];

  const tasks = all.filter((t) =>
    (!filters.status || t.situation === filters.status) &&
    inRange(taskDueDate(t), filters.due_from, filters.due_to) &&
    inRange(dateOnly(t.creationDate), filters.created_from, filters.created_to)
  );

  return { fetched: all.length, maybeCapped: all.length >= TASKS_FETCH_LIMIT, tasks };
}
