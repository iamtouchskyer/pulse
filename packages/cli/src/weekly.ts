import * as fs from "node:fs";
import { join } from "node:path";
import {
  WeeklyReportSchema,
  type Alert,
  type RuleType,
  type Snapshot,
  type WeeklyReport,
  type WeeklyRepoEntry,
} from "@pulse/schema";
import type { SlackPayload } from "./slack.js";

/**
 * ISO 8601 week computation.
 * Standard algorithm: week containing Thursday of that week; weeks numbered 01-53.
 */
export function isoWeekFromDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`invalid date: ${dateStr}`);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  // Thursday in current week decides the year.
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const year = date.getUTCFullYear();
  const firstJan = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - firstJan.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface BuildWeeklyInput {
  latest: Map<string, Snapshot>;
  baseline: Map<string, Snapshot>;
  alerts: Alert[];
  generatedAt: string;
  /**
   * Optional: full list of repos that should appear in the report even if
   * missing from `latest` (e.g. a failed snapshot day). Missing repos emit a
   * placeholder row with all deltas = 0. Defaults to the distinct repos in
   * `latest`.
   */
  expectedRepos?: readonly string[];
}

export function buildWeeklyReport(input: BuildWeeklyInput): WeeklyReport {
  const latestDate = pickLatestDate(input.latest);
  const isoWeek = isoWeekFromDate(latestDate);
  const alertsByRepo = new Map<string, number>();
  for (const a of input.alerts) {
    alertsByRepo.set(a.repo, (alertsByRepo.get(a.repo) ?? 0) + 1);
  }
  const expected =
    input.expectedRepos && input.expectedRepos.length > 0
      ? Array.from(new Set(input.expectedRepos))
      : Array.from(input.latest.keys());
  const repos: WeeklyRepoEntry[] = [];
  for (const repo of expected) {
    const snap = input.latest.get(repo);
    const base = input.baseline.get(repo);
    if (snap === undefined) {
      // Missing from latest: emit placeholder so all expected repos appear.
      repos.push({
        repo,
        stars_delta: 0,
        forks_delta: 0,
        views_delta: 0,
        alerts_count: alertsByRepo.get(repo) ?? 0,
      });
      continue;
    }
    const stars_delta = base ? snap.stars - base.stars : 0;
    const forks_delta = base ? snap.forks - base.forks : 0;
    const views_delta = base ? snap.traffic.views_14d - base.traffic.views_14d : 0;
    repos.push({
      repo,
      stars_delta,
      forks_delta,
      views_delta,
      alerts_count: alertsByRepo.get(repo) ?? 0,
    });
  }
  repos.sort((a, b) => a.repo.localeCompare(b.repo));

  return WeeklyReportSchema.parse({
    schema_version: 1,
    iso_week: isoWeek,
    generated_at: input.generatedAt,
    repos,
    alerts: input.alerts,
  });
}

function pickLatestDate(snapshots: Map<string, Snapshot>): string {
  let best: string | null = null;
  for (const s of snapshots.values()) {
    if (best === null || s.date > best) best = s.date;
  }
  if (best === null) {
    // Fall back to today's UTC date so isoWeekFromDate has something valid.
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    best = `${yyyy}-${mm}-${dd}`;
  }
  return best;
}

export function summarizeAlerts(alerts: Alert[]): Record<RuleType, number> {
  const init: Record<RuleType, number> = {
    new_referrer_domain: 0,
    unanswered_issue: 0,
    star_velocity_spike: 0,
    active_fork: 0,
    watchlist_signal: 0,
  };
  for (const a of alerts) init[a.rule] += 1;
  return init;
}

export function renderWeeklyMarkdown(report: WeeklyReport): string {
  const summary = summarizeAlerts(report.alerts);
  const rows = report.repos.map(
    (r) =>
      `| ${r.repo} | ${r.stars_delta} | ${r.forks_delta} | ${r.views_delta} | ${r.alerts_count} |`
  );
  const alertLines = (Object.keys(summary) as RuleType[])
    .map((k) => `- ${k}: ${summary[k]}`)
    .join("\n");
  return [
    `# Pulse Weekly — ${report.iso_week}`,
    "",
    `_Generated at ${report.generated_at}_`,
    "",
    "## Repositories",
    "",
    "| repo | stars_delta | forks_delta | views_delta | alerts |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Alerts summary",
    "",
    alertLines,
    "",
  ].join("\n");
}

export function buildSlackPayload(report: WeeklyReport): SlackPayload {
  const summary = summarizeAlerts(report.alerts);
  const repoLines = report.repos
    .map((r) => `• *${r.repo}* — ★${r.stars_delta} ⑂${r.forks_delta} 👁${r.views_delta}`)
    .join("\n");
  const alertLine = (Object.keys(summary) as RuleType[])
    .map((k) => `${k}:${summary[k]}`)
    .join(" | ");
  return {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Pulse Weekly — ${report.iso_week}*` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: repoLines || "_no repos_" },
      },
      {
        type: "context",
        text: { type: "mrkdwn", text: `Alerts — ${alertLine}` },
      },
    ],
  };
}

/** Atomic write of the weekly markdown report to `reports/YYYY-WNN.md`. */
export function writeWeeklyReport(report: WeeklyReport, md: string, reportsDir: string): string {
  fs.mkdirSync(reportsDir, { recursive: true });
  const file = join(reportsDir, `${report.iso_week}.md`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, md, "utf8");
  fs.renameSync(tmp, file);
  return file;
}
