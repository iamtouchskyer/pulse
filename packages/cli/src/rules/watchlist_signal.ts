import type { Alert, Snapshot } from "@pulse/schema";

export function runWatchlistSignal(snap: Snapshot, watchlist: readonly string[]): Alert[] {
  if (watchlist.length === 0) return [];
  const watchSet = new Set(watchlist.map((u) => u.toLowerCase()));
  const out: Alert[] = [];
  const hit = (user: string, kind: "issue" | "star"): void => {
    out.push({
      schema_version: 1,
      rule: "watchlist_signal",
      repo: snap.repo,
      severity: "info",
      message: `Watchlist user ${user} triggered ${kind}`,
      captured_at: snap.captured_at,
      data: { user, kind },
    });
  };

  for (const issue of snap.recent_issues) {
    if (issue.author === null) continue;
    if (watchSet.has(issue.author.toLowerCase())) hit(issue.author, "issue");
  }
  for (const user of snap.recent_stargazers) {
    if (user === null) continue;
    if (watchSet.has(user.toLowerCase())) hit(user, "star");
  }
  return out;
}
