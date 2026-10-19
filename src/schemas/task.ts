/**
 * Zod schemas for task management (gestão de tarefas)
 */

import { z } from "zod";
import {
  DateSchema,
  WorkspaceIdSchema,
  TaskIdSchema,
  UserIdSchema,
  ResponseFormat,
  PaginationSchema,
} from "./common.js";

// ============ List Tasks ============

export const ListTasksSchema = z.object({
  search: z.string().trim().min(1).optional()
    .describe("Filtro de texto (case-insensitive) no título da tarefa. Ex: 'playbook'."),
  workspace_id: z.number().int().positive().optional()
    .describe("ID do workspace para filtrar. Use ekyte_list_workspaces para descobrir."),
  status: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(30), z.literal(40)])
    .default(10)
    .describe("Filtro por situação: 10=Ativas, 20=Pausadas, 30=Concluídas, 40=Canceladas, 0=Todas. Padrão: 10 (Ativas)"),
  task_type_id: z.number().int().positive().optional()
    .describe("ID do tipo de tarefa para filtrar. Use ekyte_list_task_types para descobrir."),
  phase_id: z.number().int().positive().optional()
    .describe("ID da etapa atual para filtrar."),
  executor_id: UserIdSchema.optional()
    .describe("UUID do responsável para filtrar. Use ekyte_list_users para descobrir."),
  created_from: DateSchema.optional()
    .describe("Filtrar tasks criadas a partir desta data (AAAA-MM-DD)"),
  created_to: DateSchema.optional()
    .describe("Filtrar tasks criadas até esta data (AAAA-MM-DD)"),
  due_from: DateSchema.optional()
    .describe("Filtrar por data de entrega (atual) a partir de (AAAA-MM-DD)"),
  due_to: DateSchema.optional()
    .describe("Filtrar por data de entrega (atual) até (AAAA-MM-DD). Ex: due_to=ontem + status=10 → tarefas atrasadas."),
  page: z.number().int().min(1).default(1)
    .describe("Página do resultado filtrado (paginação client-side, 50 por página)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListTasksInput = z.infer<typeof ListTasksSchema>;

// ============ Get Task ============

export const GetTaskSchema = z.object({
  task_id: TaskIdSchema,
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type GetTaskInput = z.infer<typeof GetTaskSchema>;

// ============ Phase Flow Item (used in multi-phase create) ============

export const TaskPhaseFlowItemSchema = z.object({
  phase_id: z.number().int().positive()
    .describe("ID da fase. Use ekyte_list_phases ou ekyte_list_task_flow_phases (em task existente)."),
  executor_id: UserIdSchema
    .describe("UUID do responsável POR ESTA FASE específica."),
  effort_minutes: z.number().int().min(1).max(9999).default(60)
    .describe("Tempo estimado para esta fase em minutos (padrão 60)."),
  phase_start_date: DateSchema.optional()
    .describe("Data de início desta fase (opcional, padrão: phase_start_date da tarefa)."),
  phase_due_date: DateSchema.optional()
    .describe("Data de entrega desta fase (opcional, padrão: phase_due_date da tarefa)."),
}).strict();

export type TaskPhaseFlowItem = z.infer<typeof TaskPhaseFlowItemSchema>;

// ============ Create Task ============

export const CreateTaskSchema = z.object({
  title: z.string()
    .min(1, "Título é obrigatório")
    .max(500, "Título deve ter no máximo 500 caracteres")
    .describe("Título da nova tarefa"),
  workspace_id: WorkspaceIdSchema,
  task_type_id: z.number()
    .int()
    .positive()
    .describe("ID do tipo de tarefa. Use ekyte_list_task_types para descobrir o ID."),
  executor_id: UserIdSchema.optional()
    .describe("UUID do responsável principal. Obrigatório se phases[] NÃO for fornecido. Se phases[] for fornecido, é ignorado."),
  phase_id: z.number()
    .int()
    .positive()
    .optional()
    .describe("ID da etapa/fase inicial. Obrigatório se phases[] NÃO for fornecido. Se phases[] for fornecido, é ignorado."),
  estimated_time_minutes: z.number()
    .int()
    .min(1, "Tempo estimado deve ser pelo menos 1 minuto")
    .max(9999, "Tempo estimado máximo é 9999 minutos")
    .default(60)
    .describe("Tempo estimado total em minutos (ex: 60 para 1 hora). Ignorado em multi-fase: soma dos esforços de phases[]."),
  phase_start_date: DateSchema
    .describe("Data de início padrão (AAAA-MM-DD). Cada fase pode sobrescrever em phases[]."),
  phase_due_date: DateSchema
    .describe("Data de entrega padrão (AAAA-MM-DD). Cada fase pode sobrescrever em phases[]."),
  description: z.string()
    .max(5000, "Descrição deve ter no máximo 5000 caracteres")
    .default("")
    .describe("Descrição detalhada da tarefa (opcional)"),
  priority: z.number().int().min(0).max(1000).optional()
    .describe("Prioridade (0-1000). Ex: 100=Baixa, 300=Média, 500=Alta. Opcional."),
  phases: z.array(TaskPhaseFlowItemSchema).min(1).optional()
    .describe("MULTI-FASE: lista de fases com executores distintos. Quando fornecido, executor_id/phase_id de cima são IGNORADOS — a tarefa começa na primeira fase da lista. Use para criar tarefas com pessoas diferentes em cada etapa do fluxo."),
}).strict();

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

// ============ List Workspaces ============

export const ListWorkspacesSchema = z.object({
  search: z.string().trim().min(1).optional()
    .describe("Filtro de texto (case-insensitive) no nome do workspace. Ex: 'ferraz' acha 'V4 Ferraz Piai'."),
  active_only: z.boolean().default(false)
    .describe("Se true, retorna só workspaces ativos (active=1)."),
  page: z.number().int().min(1).default(1)
    .describe("Página do resultado filtrado (paginação client-side, 50 por página)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListWorkspacesInput = z.infer<typeof ListWorkspacesSchema>;

// ============ List Users ============

export const ListUsersSchema = z.object({
  search: z.string().trim().min(1).optional()
    .describe("Filtro de texto (case-insensitive) por nome ou email."),
  page: z.number().int().min(1).default(1)
    .describe("Página do resultado filtrado (paginação client-side, 50 por página)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListUsersInput = z.infer<typeof ListUsersSchema>;

// ============ Update Task (PATCH) ============

export const UpdateTaskSchema = z.object({
  task_id: TaskIdSchema,
  project_id: z.number().int().positive().optional()
    .describe("ID do projeto (necessário APENAS se for uma tarefa de projeto). Tarefas avulsas não precisam disso."),
  title: z.string()
    .min(1).max(500)
    .optional()
    .describe("Novo título da tarefa (opcional)"),
  description: z.string()
    .max(5000)
    .optional()
    .describe("Nova descrição da tarefa em texto simples (será convertido para HTML). Opcional."),
  executor_id: UserIdSchema
    .optional()
    .describe("UUID do novo responsável da FASE ATUAL (opcional). Para trocar executor de uma fase específica não-atual, use ekyte_update_phase. Use ekyte_list_users para descobrir."),
  phase_id: z.number().int().positive()
    .optional()
    .describe("ID da nova fase ATIVA da tarefa (opcional). Use ekyte_list_task_flow_phases para ver as fases disponíveis."),
  phase_start_date: DateSchema
    .optional()
    .describe("Nova data de início da etapa atual (AAAA-MM-DD). Opcional."),
  phase_due_date: DateSchema
    .optional()
    .describe("Nova data de entrega da etapa atual (AAAA-MM-DD). Opcional."),
  priority_group: z.number().int().min(0).max(100)
    .optional()
    .describe("Grupo de prioridade (0-100). É o campo que a UI do Ekyte usa: 35=Baixa, 50=Média, 60=Alta, 90=Urgente. Opcional."),
  priority: z.number().int().min(0).max(1000)
    .optional()
    .describe("Prioridade numérica bruta (0-1000). Normalmente você quer priority_group em vez disso. Opcional."),
}).strict();

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ============ List Task Flow Phases ============

export const ListTaskFlowPhasesSchema = z.object({
  task_id: TaskIdSchema,
  project_id: z.number().int().positive().optional()
    .describe("ID do projeto (necessário se for uma tarefa de projeto). Tarefas avulsas não precisam."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListTaskFlowPhasesInput = z.infer<typeof ListTaskFlowPhasesSchema>;

// ============ Update Phase of a Task ============

export const UpdatePhaseSchema = z.object({
  task_id: TaskIdSchema,
  project_id: z.number().int().positive().optional()
    .describe("ID do projeto (necessário APENAS se for uma tarefa de projeto). Tarefas avulsas não precisam disso."),
  phase_id: z.number().int().positive()
    .describe("ID da fase a atualizar dentro desta tarefa. Use ekyte_list_task_flow_phases para ver as fases e seus IDs."),
  executor_id: UserIdSchema.optional()
    .describe("Novo responsável (UUID) para ESTA FASE específica. Opcional."),
  effort_minutes: z.number().int().min(1).max(9999).optional()
    .describe("Novo tempo estimado desta fase em minutos. Opcional."),
  phase_start_date: DateSchema.optional()
    .describe("Nova data de início desta fase (AAAA-MM-DD). Opcional."),
  phase_due_date: DateSchema.optional()
    .describe("Nova data de entrega desta fase (AAAA-MM-DD). Opcional."),
}).strict();

export type UpdatePhaseInput = z.infer<typeof UpdatePhaseSchema>;

// ============ Toggle (Add/Remove) Flow Phase of a Task ============

export const ToggleFlowPhaseSchema = z.object({
  task_id: TaskIdSchema,
  project_id: z.number().int().positive()
    .describe("ID do projeto. Obrigatório — esta operação só funciona para tarefas de projeto."),
  phase_id: z.number().int().positive()
    .describe("ID da fase (phaseId) a ativar ou desativar. Use ekyte_list_task_flow_phases para listar as fases e seus IDs."),
  active: z.number().int().min(0).max(1)
    .describe("1 = ATIVAR a fase (adicionar ao fluxo). 0 = DESATIVAR a fase (remover do fluxo)."),
  executor_id: UserIdSchema.optional()
    .describe("UUID do executor para esta fase. Opcional ao desativar, recomendado ao ativar."),
}).strict();

export type ToggleFlowPhaseInput = z.infer<typeof ToggleFlowPhaseSchema>;

// ============ Complete Task ============

export const CompleteTaskSchema = z.object({
  task_id: TaskIdSchema,
}).strict();

export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

// ============ Add Comment to Task ============

export const AddTaskCommentSchema = z.object({
  task_id: TaskIdSchema,
  comment: z.string()
    .min(1, "Comentário não pode ser vazio")
    .max(5000, "Comentário deve ter no máximo 5000 caracteres")
    .describe("Texto do comentário a ser adicionado na tarefa"),
}).strict();

export type AddTaskCommentInput = z.infer<typeof AddTaskCommentSchema>;

// ============ List Task Types ============

export const ListTaskTypesSchema = z.object({
  search: z.string().trim().min(1).optional()
    .describe("Filtro de texto (case-insensitive) no nome do tipo de tarefa. Ex: 'onboarding'."),
  active_only: z.boolean().default(false)
    .describe("Se true, retorna só tipos ativos (active=1)."),
  page: z.number().int().min(1).default(1)
    .describe("Página do resultado filtrado (paginação client-side, 50 por página)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListTaskTypesInput = z.infer<typeof ListTaskTypesSchema>;

// ============ List Workflow Phases ============

export const ListPhasesSchema = z.object({
  workflow_id: z.number()
    .int("workflow_id deve ser número inteiro")
    .positive("workflow_id deve ser positivo")
    .describe("ID do workflow. Obtenha via ekyte_list_task_types (campo workflow_id)."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type ListPhasesInput = z.infer<typeof ListPhasesSchema>;
