import { z } from "zod";
import { RuleTypeSchema } from "./rule.js";

// v1: severity locked to info|warn; v2 may widen to include "critical".
export const AlertSchema = z.object({
  schema_version: z.literal(1),
  rule: RuleTypeSchema,
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  severity: z.enum(["info", "warn"]),
  message: z.string(),
  captured_at: z.string().datetime(),
  data: z.record(z.unknown()),
});
export type Alert = z.infer<typeof AlertSchema>;
