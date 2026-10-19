/**
 * Zod schemas for reports (relatórios)
 */

import { z } from "zod";
import { DateSchema, UserIdSchema, ResponseFormat } from "./common.js";

// ============ Daily Report ============

export const DailyReportSchema = z.object({
  date: DateSchema.optional()
    .describe("Data de referência (AAAA-MM-DD). Padrão: hoje no horário de Brasília."),
  workspace_id: z.number().int().positive().optional()
    .describe("Restringe o relatório a um workspace. Padrão: empresa inteira."),
  executor_id: UserIdSchema.optional()
    .describe("Restringe o relatório a um responsável (UUID)."),
  daily_capacity_hours: z.number().min(1).max(24).default(8)
    .describe("Capacidade diária por pessoa em horas. Acima disso a pessoa é marcada como sobrecarregada. Padrão: 8."),
  overrun_factor: z.number().min(1).max(10).default(1.5)
    .describe("Tarefa ativa com tempo real ≥ estimado × fator (e ao menos 1h acima) entra como estouro. Padrão: 1.5."),
  top_n: z.number().int().min(1).max(50).default(15)
    .describe("Máximo de itens nas listas de estouros e atrasos. Padrão: 15."),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Formato de saída"),
}).strict();

export type DailyReportInput = z.infer<typeof DailyReportSchema>;
