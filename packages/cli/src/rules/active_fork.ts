import { z } from "zod";
import type { Alert, Snapshot } from "@pulse/schema";
import type { GitHubClient } from "../github.js";
import { classifyError } from "../github.js";

const ForkSchema = z
  .object({
    full_name: z.string(),
    html_url: z.string(),
    created_at: z.string(),
    default_branch: z.string(),
    owner: z.object({ login: z.string() }).passthrough(),
  })
  .passthrough();

const ForksResponseSchema = z.array(ForkSchema);

const CompareSchema = z
  .object({
    ahead_by: z.number().int().nonnegative(),
  })
  .passthrough();

export interface ActiveForkDeps {
  client: GitHubClient | null;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: () => number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function runActiveFork(snap: Snapshot, deps: ActiveForkDeps): Promise<Alert[]> {
  const { client } = deps;
  if (client === null) {
    // eslint-disable-next-line no-console
    console.warn(`pulse: active_fork skipped for ${snap.repo} (no GitHub token)`);
    return [];
  }
  const [owner, repo] = snap.repo.split("/");
  if (owner === undefined || repo === undefined) return [];

  let forks: z.infer<typeof ForksResponseSchema>;
  try {
    // Paginate across all pages; we filter to last 7d below. octokit.paginate
    // will stream all pages and concatenate, so we're not capped at per_page.
    const all = await client.paginate("GET /repos/{owner}/{repo}/forks", {
      owner,
      repo,
      sort: "newest",
      per_page: 100,
    });
    forks = ForksResponseSchema.parse(all);
  } catch (err) {
    const classified = classifyError(err);
    // eslint-disable-next-line no-console
    console.warn(
      `pulse: active_fork forks list failed for ${snap.repo} (${classified.kind}); skipping`
    );
    return [];
  }

  const nowMs = (deps.now ?? Date.now)();
  const out: Alert[] = [];
  for (const fork of forks) {
    const createdMs = new Date(fork.created_at).getTime();
    if (Number.isNaN(createdMs) || nowMs - createdMs > SEVEN_DAYS_MS) continue;
    try {
      const basehead = `${owner}:${fork.default_branch}...${fork.owner.login}:${fork.default_branch}`;
      const cmp = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner,
        repo,
        basehead,
      });
      const parsed = CompareSchema.parse(cmp.data);
      if (parsed.ahead_by > 0) {
        out.push({
          schema_version: 1,
          rule: "active_fork",
          repo: snap.repo,
          severity: "info",
          message: `Active fork by ${fork.owner.login} (${parsed.ahead_by} ahead)`,
          captured_at: snap.captured_at,
          data: {
            fork_url: fork.html_url,
            forker: fork.owner.login,
            ahead_by: parsed.ahead_by,
          },
        });
      }
    } catch (err) {
      const classified = classifyError(err);
      // eslint-disable-next-line no-console
      console.warn(
        `pulse: active_fork compare failed for ${fork.full_name} (${classified.kind}); skipping`
      );
    }
  }
  return out;
}
