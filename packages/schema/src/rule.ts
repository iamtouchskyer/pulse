import { z } from "zod";

export const RuleTypeSchema = z.enum([
  "new_referrer_domain",
  "unanswered_issue",
  "star_velocity_spike",
  "active_fork",
  "watchlist_signal",
]);
export type RuleType = z.infer<typeof RuleTypeSchema>;

export const NewReferrerDomainRule = z.object({
  type: z.literal("new_referrer_domain"),
  uniques_threshold: z.number().int().nonnegative(),
});

export const UnansweredIssueRule = z.object({
  type: z.literal("unanswered_issue"),
  age_hours: z.number().positive(),
});

export const StarVelocitySpikeRule = z.object({
  type: z.literal("star_velocity_spike"),
  sigma: z.number().positive(),
});

export const ActiveForkRule = z.object({
  type: z.literal("active_fork"),
});

export const WatchlistSignalRule = z.object({
  type: z.literal("watchlist_signal"),
});

export const RuleSchema = z.discriminatedUnion("type", [
  NewReferrerDomainRule,
  UnansweredIssueRule,
  StarVelocitySpikeRule,
  ActiveForkRule,
  WatchlistSignalRule,
]);
export type Rule = z.infer<typeof RuleSchema>;

export const RulesFileSchema = z.object({
  known_list: z.array(z.string()),
  notify_channel: z.string().nullable(),
  rules: z.array(RuleSchema),
});
export type RulesFile = z.infer<typeof RulesFileSchema>;
