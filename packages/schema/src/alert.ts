import { z } from "zod";

export const AlertSchema = z.object({
  rule: z.string(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  severity: z.enum(["info", "warn"]),
  message: z.string(),
  captured_at: z.string().datetime(),
  data: z.record(z.unknown()),
});
export type Alert = z.infer<typeof AlertSchema>;
