import { z } from "zod";

// Narrow zod schemas for the GitHub API response shapes Pulse actually consumes.
// These are parsed at the wrapper boundary (see github.ts request helpers) so
// downstream code (snapshot.ts) never touches unchecked `unknown` data.

export const RepoResponseSchema = z
  .object({
    stargazers_count: z.number().int().nonnegative(),
    forks_count: z.number().int().nonnegative(),
    subscribers_count: z.number().int().nonnegative(),
    open_issues_count: z.number().int().nonnegative(),
  })
  .passthrough();
export type RepoResponse = z.infer<typeof RepoResponseSchema>;

export const PullSummarySchema = z
  .object({
    number: z.number().int().positive(),
  })
  .passthrough();
export type PullSummary = z.infer<typeof PullSummarySchema>;

export const PullsResponseSchema = z.array(PullSummarySchema);

export const IssueResponseSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    user: z.object({ login: z.string() }).passthrough().nullable(),
    created_at: z.string(),
    comments: z.number().int().nonnegative(),
    pull_request: z.unknown().optional(),
  })
  .passthrough();
export type IssueResponse = z.infer<typeof IssueResponseSchema>;

export const IssuesResponseSchema = z.array(IssueResponseSchema);

export const TrafficViewsResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    uniques: z.number().int().nonnegative(),
  })
  .passthrough();
export type TrafficViewsResponse = z.infer<typeof TrafficViewsResponseSchema>;

export const TrafficClonesResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    uniques: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type TrafficClonesResponse = z.infer<typeof TrafficClonesResponseSchema>;

export const ReferrerResponseSchema = z
  .object({
    referrer: z.string(),
    count: z.number().int().nonnegative(),
    uniques: z.number().int().nonnegative(),
  })
  .passthrough();
export type ReferrerResponse = z.infer<typeof ReferrerResponseSchema>;

export const ReferrersResponseSchema = z.array(ReferrerResponseSchema);

export const PathResponseSchema = z
  .object({
    path: z.string(),
    count: z.number().int().nonnegative(),
    uniques: z.number().int().nonnegative(),
  })
  .passthrough();
export type PathResponse = z.infer<typeof PathResponseSchema>;

export const PathsResponseSchema = z.array(PathResponseSchema);

// Stargazer with Star media type (star+json) has shape { user, starred_at }.
// Plain stargazers list has shape { login, ... } at the top level.
// We only use star+json; but allow either for defense.
export const StargazerResponseSchema = z.union([
  z
    .object({
      user: z.object({ login: z.string() }).passthrough().nullable(),
      starred_at: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      login: z.string(),
    })
    .passthrough(),
]);
export type StargazerResponse = z.infer<typeof StargazerResponseSchema>;

export const StargazersResponseSchema = z.array(StargazerResponseSchema);

export function stargazerLogin(s: StargazerResponse): string | null {
  if ("user" in s) {
    const u = (s as { user: { login: string } | null }).user;
    return u?.login ?? null;
  }
  if ("login" in s) {
    return (s as { login: string }).login;
  }
  return null;
}
