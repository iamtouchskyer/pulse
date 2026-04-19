import type { Octokit } from "@octokit/rest";
import { SnapshotSchema, type Snapshot } from "@pulse/schema";
import { classifyError, GitHubApiError } from "./github.js";
import {
  IssuesResponseSchema,
  PathsResponseSchema,
  PullsResponseSchema,
  ReferrersResponseSchema,
  RepoResponseSchema,
  StargazersResponseSchema,
  TrafficClonesResponseSchema,
  TrafficViewsResponseSchema,
  stargazerLogin,
  type IssueResponse,
  type PathResponse,
  type ReferrerResponse,
  type RepoResponse,
  type StargazerResponse,
  type TrafficClonesResponse,
  type TrafficViewsResponse,
} from "./github-schemas.js";

const EPOCH_ZERO = "1970-01-01T00:00:00.000Z";

function warnStderr(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(msg);
}

async function fetchTrafficSafe<T>(
  fn: () => Promise<T>,
  repoSlug: string,
  kind: string,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const classified = err instanceof GitHubApiError ? err : classifyError(err);
    if (classified.kind === "forbidden") {
      warnStderr(`pulse: traffic ${kind} unavailable for ${repoSlug} (forbidden); using zeros`);
      return fallback;
    }
    throw classified;
  }
}

async function fetchRepo(client: Octokit, owner: string, repo: string): Promise<RepoResponse> {
  const res = await client.request("GET /repos/{owner}/{repo}", { owner, repo });
  return RepoResponseSchema.parse(res.data);
}

async function fetchOpenPrCount(client: Octokit, owner: string, repo: string): Promise<number> {
  const all = await client.paginate("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const parsed = PullsResponseSchema.parse(all);
  return parsed.length;
}

async function fetchRecentIssues(
  client: Octokit,
  owner: string,
  repo: string
): Promise<IssueResponse[]> {
  const collected: IssueResponse[] = [];
  const iter = client.paginate.iterator("GET /repos/{owner}/{repo}/issues", {
    owner,
    repo,
    state: "open",
    sort: "created",
    direction: "desc",
    per_page: 100,
  });
  for await (const page of iter) {
    const parsed = IssuesResponseSchema.parse(page.data);
    for (const i of parsed) {
      if (i.pull_request === undefined) collected.push(i);
      if (collected.length >= 30) return collected;
    }
  }
  return collected;
}

async function fetchRecentStargazers(
  client: Octokit,
  owner: string,
  repo: string
): Promise<StargazerResponse[]> {
  // Star media type gives us { user, starred_at }; plain list gives { login, ... }.
  // Our StargazerResponse union handles both, so we can skip the custom accept
  // header and still accept either shape.
  const all = await client.paginate("GET /repos/{owner}/{repo}/stargazers", {
    owner,
    repo,
    per_page: 100,
  });
  const parsed = StargazersResponseSchema.parse(all);
  return parsed.slice(-30);
}

async function fetchViews(
  client: Octokit,
  owner: string,
  repo: string,
  repoSlug: string
): Promise<TrafficViewsResponse> {
  return fetchTrafficSafe(
    async () => {
      const res = await client.request("GET /repos/{owner}/{repo}/traffic/views", { owner, repo });
      return TrafficViewsResponseSchema.parse(res.data);
    },
    repoSlug,
    "views",
    { count: 0, uniques: 0 }
  );
}

async function fetchClones(
  client: Octokit,
  owner: string,
  repo: string,
  repoSlug: string
): Promise<TrafficClonesResponse> {
  return fetchTrafficSafe(
    async () => {
      const res = await client.request("GET /repos/{owner}/{repo}/traffic/clones", { owner, repo });
      return TrafficClonesResponseSchema.parse(res.data);
    },
    repoSlug,
    "clones",
    { count: 0 }
  );
}

async function fetchReferrers(
  client: Octokit,
  owner: string,
  repo: string,
  repoSlug: string
): Promise<ReferrerResponse[]> {
  return fetchTrafficSafe(
    async () => {
      const res = await client.request("GET /repos/{owner}/{repo}/traffic/popular/referrers", {
        owner,
        repo,
      });
      return ReferrersResponseSchema.parse(res.data);
    },
    repoSlug,
    "referrers",
    []
  );
}

async function fetchPaths(
  client: Octokit,
  owner: string,
  repo: string,
  repoSlug: string
): Promise<PathResponse[]> {
  return fetchTrafficSafe(
    async () => {
      const res = await client.request("GET /repos/{owner}/{repo}/traffic/popular/paths", {
        owner,
        repo,
      });
      return PathsResponseSchema.parse(res.data);
    },
    repoSlug,
    "paths",
    []
  );
}

function settledOrDegrade<T>(
  res: PromiseSettledResult<T>,
  fallback: T,
  kind: string,
  repoSlug: string
): T {
  if (res.status === "fulfilled") return res.value;
  const err = res.reason;
  const classified = err instanceof GitHubApiError ? err : classifyError(err);
  warnStderr(
    `pulse: ${kind} failed for ${repoSlug} (${classified.kind} ${classified.status}); degrading to empty`
  );
  return fallback;
}

export async function fetchSnapshot(
  client: Octokit,
  repoSlug: string,
  today: string,
  capturedAt?: string
): Promise<Snapshot> {
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo slug: ${repoSlug}`);
  }

  // Spine: repo metadata is hard-fail.
  let repoData: RepoResponse;
  try {
    repoData = await fetchRepo(client, owner, repo);
  } catch (err) {
    throw classifyError(err);
  }

  // Fan out remaining endpoints and degrade individually.
  const [pullsRes, issuesRes, stargazersRes, viewsRes, clonesRes, referrersRes, pathsRes] =
    await Promise.allSettled([
      fetchOpenPrCount(client, owner, repo),
      fetchRecentIssues(client, owner, repo),
      fetchRecentStargazers(client, owner, repo),
      fetchViews(client, owner, repo, repoSlug),
      fetchClones(client, owner, repo, repoSlug),
      fetchReferrers(client, owner, repo, repoSlug),
      fetchPaths(client, owner, repo, repoSlug),
    ]);

  const open_prs = settledOrDegrade(pullsRes, 0, "open_prs", repoSlug);
  const issues = settledOrDegrade<IssueResponse[]>(issuesRes, [], "recent_issues", repoSlug);
  const stargazers = settledOrDegrade<StargazerResponse[]>(
    stargazersRes,
    [],
    "recent_stargazers",
    repoSlug
  );
  const viewsData = settledOrDegrade<TrafficViewsResponse>(
    viewsRes,
    { count: 0, uniques: 0 },
    "traffic_views",
    repoSlug
  );
  const clonesData = settledOrDegrade<TrafficClonesResponse>(
    clonesRes,
    { count: 0 },
    "traffic_clones",
    repoSlug
  );
  const referrersData = settledOrDegrade<ReferrerResponse[]>(
    referrersRes,
    [],
    "traffic_referrers",
    repoSlug
  );
  const pathsData = settledOrDegrade<PathResponse[]>(pathsRes, [], "traffic_paths", repoSlug);

  const recent_issues = issues.slice(0, 30).map((i) => ({
    number: i.number,
    title: i.title,
    author: i.user?.login ?? null,
    created_at: i.created_at,
    comments: i.comments,
  }));

  const recent_stargazers = stargazers.map((s) => stargazerLogin(s));

  const snap: Snapshot = SnapshotSchema.parse({
    schema_version: 1,
    repo: repoSlug,
    date: today,
    captured_at: capturedAt ?? new Date().toISOString(),
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    watchers: repoData.subscribers_count,
    open_issues: Math.max(0, repoData.open_issues_count - open_prs),
    open_prs,
    traffic: {
      views_14d: viewsData.count,
      unique_visitors_14d: viewsData.uniques,
      clones_14d: clonesData.count,
    },
    top_referrers: referrersData.slice(0, 10).map((r) => ({
      referrer: r.referrer,
      count: r.count,
      uniques: r.uniques,
    })),
    top_paths: pathsData.slice(0, 10).map((p) => ({
      path: p.path,
      count: p.count,
      uniques: p.uniques,
    })),
    recent_issues,
    recent_stargazers,
  });

  return snap;
}

export function todayUtc(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Deterministic fixture snapshot used by `--dry-run`. `capturedAt` defaults to
 * a frozen Epoch string so dry-run output is stable for CI diffs. Override via
 * `PULSE_NOW` env var if the caller wants a specific timestamp.
 */
export function fixtureSnapshot(repoSlug: string, today: string, capturedAt?: string): Snapshot {
  const pinned = capturedAt ?? process.env.PULSE_NOW ?? EPOCH_ZERO;
  return SnapshotSchema.parse({
    schema_version: 1,
    repo: repoSlug,
    date: today,
    captured_at: pinned,
    stars: 0,
    forks: 0,
    watchers: 0,
    open_issues: 0,
    open_prs: 0,
    traffic: { views_14d: 0, unique_visitors_14d: 0, clones_14d: 0 },
    top_referrers: [],
    top_paths: [],
    recent_issues: [],
    recent_stargazers: [],
  });
}
