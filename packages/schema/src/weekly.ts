import { z } from "zod";
import { AlertSchema } from "./alert.js";

export const WeeklyRepoEntrySchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  stars_delta: z.number().int(),
  forks_delta: z.number().int(),
  views_delta: z.number().int(),
  alerts_count: z.number().int().nonnegative(),
});
export type WeeklyRepoEntry = z.infer<typeof WeeklyRepoEntrySchema>;

export const WeeklyReportSchema = z.object({
  schema_version: z.literal(1),
  iso_week: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
  generated_at: z.string().datetime(),
  repos: z.array(WeeklyRepoEntrySchema),
  alerts: z.array(AlertSchema),
});
export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;
