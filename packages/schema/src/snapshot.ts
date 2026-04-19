import { z } from "zod";

export const TrafficSchema = z.object({
  views_14d: z.number().int().nonnegative(),
  unique_visitors_14d: z.number().int().nonnegative(),
  clones_14d: z.number().int().nonnegative(),
});
export type Traffic = z.infer<typeof TrafficSchema>;

export const ReferrerSchema = z.object({
  referrer: z.string(),
  count: z.number().int().nonnegative(),
  uniques: z.number().int().nonnegative(),
});
export type Referrer = z.infer<typeof ReferrerSchema>;

export const PathStatSchema = z.object({
  path: z.string(),
  count: z.number().int().nonnegative(),
  uniques: z.number().int().nonnegative(),
});
export type PathStat = z.infer<typeof PathStatSchema>;

export const RecentIssueSchema = z.object({
  number: z.number().int().nonnegative(),
  title: z.string(),
  author: z.string(),
  created_at: z.string().datetime(),
  comments: z.number().int().nonnegative(),
});
export type RecentIssue = z.infer<typeof RecentIssueSchema>;

export const SnapshotSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  captured_at: z.string().datetime(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  watchers: z.number().int().nonnegative(),
  open_issues: z.number().int().nonnegative(),
  open_prs: z.number().int().nonnegative(),
  traffic: TrafficSchema,
  top_referrers: z.array(ReferrerSchema),
  top_paths: z.array(PathStatSchema),
  recent_issues: z.array(RecentIssueSchema),
  recent_stargazers: z.array(z.string()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
