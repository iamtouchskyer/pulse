import type { Alert, Snapshot } from "@pulse/schema";

export interface UnansweredParams {
  ageHours: number;
}

export function runUnansweredIssue(snap: Snapshot, params: UnansweredParams): Alert[] {
  const now = new Date(snap.captured_at).getTime();
  const out: Alert[] = [];
  for (const issue of snap.recent_issues) {
    if (issue.comments !== 0) continue;
    const created = new Date(issue.created_at).getTime();
    const ageHours = (now - created) / (1000 * 60 * 60);
    if (ageHours <= params.ageHours) continue;
    const [owner, repo] = snap.repo.split("/");
    const url = `https://github.com/${owner}/${repo}/issues/${issue.number}`;
    out.push({
      schema_version: 1,
      rule: "unanswered_issue",
      repo: snap.repo,
      severity: "warn",
      message: `#${issue.number} unanswered for ${Math.round(ageHours)}h`,
      captured_at: snap.captured_at,
      data: {
        number: issue.number,
        title: issue.title,
        url,
        age_hours: Math.round(ageHours * 100) / 100,
      },
    });
  }
  return out;
}
