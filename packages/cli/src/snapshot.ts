import type { Octokit } from "@octokit/rest";
import { SnapshotSchema, type Snapshot } from "@pulse/schema";
import { classifyError } from "./github.js";

interface RepoData {
  stars: number;
  forks: number;
  watchers: number;
  open_issues_count: number;
}

interface PullData {
  open_prs: number;
}

interface IssueRaw {
  number: number;
  title: string;
  user: { login: string } | null;
  created_at: string;
  comments: number;
  pull_request?: unknown;
}

interface ReferrerRaw {
  referrer: string;
  count: number;
  uniques: number;
}

interface PathRaw {
  path: string;
  count: number;
  uniques: number;
}

interface TrafficViewsRaw {
  count: number;
  uniques: number;
}

interface TrafficClonesRaw {
  count: number;
}

interface StargazerRaw {
  user: { login: string } | null;
  starred_at?: string;
}

function warnTraffic(repoSlug: string, kind: string): void {
  // eslint-disable-next-line no-console
  console.warn(`pulse: traffic ${kind} unavailable for ${repoSlug} (forbidden); using zeros`);
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
    const classified = classifyError(err);
    if (classified.kind === "forbidden" || classified.kind === "not_found") {
      warnTraffic(repoSlug, kind);
      return fallback;
    }
    throw classified;
  }
}

export async function fetchSnapshot(
  client: Octokit,
  repoSlug: string,
  today: string
): Promise<Snapshot> {
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo slug: ${repoSlug}`);
  }

  const repoP = client.request("GET /repos/{owner}/{repo}", { owner, repo });
  const pullsP = client.request("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const issuesP = client.request("GET /repos/{owner}/{repo}/issues", {
    owner,
    repo,
    state: "open",
    sort: "created",
    direction: "desc",
    per_page: 30,
  });
  const viewsP = fetchTrafficSafe(
    () =>
      client.request("GET /repos/{owner}/{repo}/traffic/views", {
        owner,
        repo,
      }),
    repoSlug,
    "views",
    { data: { count: 0, uniques: 0 } as TrafficViewsRaw } as {
      data: TrafficViewsRaw;
    }
  );
  const clonesP = fetchTrafficSafe(
    () =>
      client.request("GET /repos/{owner}/{repo}/traffic/clones", {
        owner,
        repo,
      }),
    repoSlug,
    "clones",
    { data: { count: 0 } as TrafficClonesRaw } as { data: TrafficClonesRaw }
  );
  const referrersP = fetchTrafficSafe(
    () =>
      client.request("GET /repos/{owner}/{repo}/traffic/popular/referrers", {
        owner,
        repo,
      }),
    repoSlug,
    "referrers",
    { data: [] as ReferrerRaw[] } as { data: ReferrerRaw[] }
  );
  const pathsP = fetchTrafficSafe(
    () =>
      client.request("GET /repos/{owner}/{repo}/traffic/popular/paths", {
        owner,
        repo,
      }),
    repoSlug,
    "paths",
    { data: [] as PathRaw[] } as { data: PathRaw[] }
  );
  const stargazersP = client.request("GET /repos/{owner}/{repo}/stargazers", {
    owner,
    repo,
    per_page: 30,
    headers: { accept: "application/vnd.github.star+json" },
  });

  let repoRes, pullsRes, issuesRes, viewsRes, clonesRes, referrersRes, pathsRes, stargazersRes;
  try {
    [repoRes, pullsRes, issuesRes, viewsRes, clonesRes, referrersRes, pathsRes, stargazersRes] =
      await Promise.all([repoP, pullsP, issuesP, viewsP, clonesP, referrersP, pathsP, stargazersP]);
  } catch (err) {
    throw classifyError(err);
  }

  const repoData = repoRes.data as unknown as {
    stargazers_count: number;
    forks_count: number;
    subscribers_count: number;
    watchers_count: number;
    open_issues_count: number;
  };

  const open_prs = (pullsRes.data as unknown as unknown[]).length;

  const issuesRaw = issuesRes.data as unknown as IssueRaw[];
  const recent_issues = issuesRaw
    .filter((i) => i.pull_request === undefined)
    .slice(0, 30)
    .map((i) => ({
      number: i.number,
      title: i.title,
      author: i.user?.login ?? null,
      created_at: i.created_at,
      comments: i.comments,
    }));

  const viewsData = viewsRes.data as unknown as TrafficViewsRaw;
  const clonesData = clonesRes.data as unknown as TrafficClonesRaw;
  const referrersData = referrersRes.data as unknown as ReferrerRaw[];
  const pathsData = pathsRes.data as unknown as PathRaw[];
  const stargazersData = stargazersRes.data as unknown as StargazerRaw[];

  const recent_stargazers = stargazersData.slice(-30).map((s) => s.user?.login ?? null);

  const watchers =
    typeof repoData.subscribers_count === "number"
      ? repoData.subscribers_count
      : repoData.watchers_count;

  const snap: Snapshot = SnapshotSchema.parse({
    schema_version: 1,
    repo: repoSlug,
    date: today,
    captured_at: new Date().toISOString(),
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    watchers,
    open_issues: Math.max(0, repoData.open_issues_count - open_prs),
    open_prs,
    traffic: {
      views_14d: viewsData.count ?? 0,
      unique_visitors_14d: viewsData.uniques ?? 0,
      clones_14d: clonesData.count ?? 0,
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

export function fixtureSnapshot(repoSlug: string, today: string): Snapshot {
  return SnapshotSchema.parse({
    schema_version: 1,
    repo: repoSlug,
    date: today,
    captured_at: new Date().toISOString(),
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

// Internal types are exposed only via the Snapshot return; no extra exports.
export type { RepoData, PullData };
