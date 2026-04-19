#!/usr/bin/env bun
import { Command } from "commander";
import { join } from "node:path";
import { loadTokenOrNull, loadToken } from "./token.js";
import { createClient, redactToken } from "./github.js";
import { fetchSnapshot, fixtureSnapshot, todayUtc } from "./snapshot.js";
import { writeSnapshot } from "./writer.js";
import { DEFAULT_REPOS, expandRepo } from "./repos.js";
import {
  computeDiff,
  formatDiffTable,
  loadLatestSnapshots,
  loadSnapshotsAt,
  NoBaselineError,
  parseSince,
  subtractDaysUtc,
} from "./diff.js";
import { loadRulesFile, loadWatchlistOrEmpty } from "./rules-config.js";
import { runAllRules } from "./rules/engine.js";
import {
  buildSlackPayload,
  buildWeeklyReport,
  renderWeeklyMarkdown,
  writeWeeklyReport,
} from "./weekly.js";
import { sendSlackMessage } from "./slack.js";
import { ZodError } from "zod";
import { YAMLParseError } from "yaml";
import type { Snapshot } from "@pulse/schema";

const program = new Command();
// --dry-run is mapped by commander to the `dryRun` camelCase field on opts;
// renaming the flag would silently break consumers — keep this in sync.
program.name("pulse").description("Pulse v1 — OSS monitoring radar").version("0.0.0");

interface SnapshotOpts {
  repo?: string;
  dryRun?: boolean;
  out?: string;
}

function scrub(msg: string): string {
  const token = loadTokenOrNull();
  return redactToken(msg, token);
}

/**
 * Pick the max `date` field across a loaded snapshots map. Used to anchor
 * diff / weekly baselines to the actual latest snapshot rather than wall-clock
 * today — otherwise a stale cron silently produces empty/zero deltas.
 */
function pickLatestSnapshotDate(snapshots: Map<string, Snapshot>): string {
  let best: string | null = null;
  for (const s of snapshots.values()) {
    if (best === null || s.date > best) best = s.date;
  }
  if (best === null) throw new Error("pickLatestSnapshotDate: empty snapshots map");
  return best;
}

program
  .command("snapshot")
  .description("Fetch and write daily snapshot(s)")
  .option("--repo <name>", "single repo (shorthand or owner/repo)")
  .option("--dry-run", "emit fixture snapshot to stdout, no network")
  .option("--out <dir>", "output directory", join(process.cwd(), "data/snapshots"))
  .action(async (opts: SnapshotOpts) => {
    try {
      const today = todayUtc();
      const repos = opts.repo ? [expandRepo(opts.repo)] : [...DEFAULT_REPOS];

      if (opts.dryRun) {
        // Deterministic captured_at so dry-run output is stable for CI diffs.
        const capturedAt = process.env.PULSE_NOW ?? `${today}T00:00:00.000Z`;
        for (const r of repos) {
          const snap = fixtureSnapshot(r, today, capturedAt);
          process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
        }
        process.exit(0);
      }

      const token = loadToken();
      const client = createClient(token);
      const outDir = opts.out ?? join(process.cwd(), "data/snapshots");

      let ok = 0;
      let failed = 0;
      for (const r of repos) {
        try {
          const snap = await fetchSnapshot(client, r, today);
          const path = writeSnapshot(snap, outDir);
          // eslint-disable-next-line no-console
          console.log(path);
          ok += 1;
        } catch (err) {
          failed += 1;
          const raw = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(`pulse: ${r} failed: ${redactToken(raw, token)}`);
        }
      }
      // Exit non-zero only if ALL repos failed (and at least one was attempted).
      process.exit(ok === 0 && failed > 0 ? 1 : 0);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse snapshot failed: ${scrub(raw)}`);
      process.exit(1);
    }
  });

interface DiffOpts {
  since: string;
  snapshots?: string;
}

program
  .command("diff")
  .description("Print star/fork/views deltas vs an Nd-old snapshot")
  .requiredOption("--since <nd>", "baseline offset like 7d", "7d")
  .option("--snapshots <dir>", "snapshots root", join(process.cwd(), "data/snapshots"))
  .action((opts: DiffOpts) => {
    try {
      const snapshotsDir = opts.snapshots ?? join(process.cwd(), "data/snapshots");
      const n = parseSince(opts.since);
      const latest = loadLatestSnapshots(snapshotsDir);
      if (latest.size === 0) {
        // eslint-disable-next-line no-console
        console.log("no baseline");
        process.exit(0);
      }
      // Anchor baseline to the *latest snapshot date*, not todayUtc(), so a
      // stale cron or weekend gap still produces a meaningful diff instead
      // of silently collapsing to zeros.
      const latestDate = pickLatestSnapshotDate(latest);
      const baselineDate = subtractDaysUtc(latestDate, n);
      let baseline;
      try {
        baseline = loadSnapshotsAt(snapshotsDir, baselineDate);
      } catch (err) {
        if (err instanceof NoBaselineError) {
          // eslint-disable-next-line no-console
          console.log("no baseline");
          process.exit(0);
        }
        throw err;
      }
      const rows = computeDiff(latest, baseline);
      // Disjoint repo sets → treat as no baseline (not an empty table) so the
      // operator can tell "no overlap" apart from "all deltas are 0".
      if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.log("no baseline");
        process.exit(0);
      }
      // eslint-disable-next-line no-console
      console.log(formatDiffTable(rows));
      process.exit(0);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse diff failed: ${scrub(raw)}`);
      process.exit(1);
    }
  });

interface RulesCheckOpts {
  rules: string;
  snapshots: string;
}

const rulesCmd = program.command("rules").description("Rule operations");
rulesCmd
  .command("check")
  .description("Evaluate rules against latest snapshots, emit Alert JSON lines")
  .option("--rules <file>", "rules.yaml path", join(process.cwd(), "rules.yaml"))
  .option("--snapshots <dir>", "snapshots root", join(process.cwd(), "data/snapshots"))
  .action(async (opts: RulesCheckOpts) => {
    try {
      const rulesFile = loadRulesFile(opts.rules);
      const watchlist = loadWatchlistOrEmpty(join(process.cwd(), "watchlist.yaml"));
      const latest = loadLatestSnapshots(opts.snapshots);
      const token = loadTokenOrNull();
      const client = token ? createClient(token) : null;
      const alerts = await runAllRules(latest, rulesFile, {
        snapshotsDir: opts.snapshots,
        watchlist,
        client,
      });
      for (const a of alerts) {
        process.stdout.write(`${JSON.stringify(a)}\n`);
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof YAMLParseError || err instanceof ZodError) {
        const reason = err instanceof YAMLParseError ? err.message : err.message;
        // eslint-disable-next-line no-console
        console.error(`pulse rules check: invalid rules.yaml: ${reason}`);
        process.exit(1);
      }
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse rules check failed: ${scrub(raw)}`);
      process.exit(1);
    }
  });

interface WeeklyOpts {
  send?: boolean;
  rules: string;
  snapshots: string;
  reports: string;
}

program
  .command("weekly")
  .description("Build weekly report, render markdown, optionally send to Slack")
  .option("--send", "actually send Slack message (default: dry-run)")
  .option("--rules <file>", "rules.yaml path", join(process.cwd(), "rules.yaml"))
  .option("--snapshots <dir>", "snapshots root", join(process.cwd(), "data/snapshots"))
  .option("--reports <dir>", "reports root", join(process.cwd(), "reports"))
  .action(async (opts: WeeklyOpts) => {
    try {
      const rulesFile = loadRulesFile(opts.rules);
      const watchlist = loadWatchlistOrEmpty(join(process.cwd(), "watchlist.yaml"));
      const latest = loadLatestSnapshots(opts.snapshots);
      // Anchor baseline to latest snapshot date - 7d (not todayUtc() - 7d) so
      // stale snapshot data still diffs against the correct week-prior bucket.
      let baseline: Map<string, Snapshot> = new Map();
      if (latest.size > 0) {
        const latestDate = pickLatestSnapshotDate(latest);
        const baselineDate = subtractDaysUtc(latestDate, 7);
        try {
          baseline = loadSnapshotsAt(opts.snapshots, baselineDate);
        } catch {
          baseline = new Map();
        }
      }
      const token = loadTokenOrNull();
      const client = token ? createClient(token) : null;
      const alerts = await runAllRules(latest, rulesFile, {
        snapshotsDir: opts.snapshots,
        watchlist,
        client,
      });
      const report = buildWeeklyReport({
        latest,
        baseline,
        alerts,
        generatedAt: new Date().toISOString(),
        expectedRepos: [...DEFAULT_REPOS],
      });
      const md = renderWeeklyMarkdown(report);
      const file = writeWeeklyReport(report, md, opts.reports);
      // eslint-disable-next-line no-console
      console.log(file);
      const payload = buildSlackPayload(report);
      await sendSlackMessage(rulesFile.notify_channel, payload, { send: opts.send ?? false });
      process.exit(0);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse weekly failed: ${scrub(raw)}`);
      process.exit(1);
    }
  });

interface NotifyOpts {
  send?: boolean;
  rules: string;
  snapshots: string;
}

program
  .command("notify")
  .description("Run rules and send alerts to Slack (dry-run by default)")
  .option("--send", "actually send Slack message (default: dry-run)")
  .option("--rules <file>", "rules.yaml path", join(process.cwd(), "rules.yaml"))
  .option("--snapshots <dir>", "snapshots root", join(process.cwd(), "data/snapshots"))
  .action(async (opts: NotifyOpts) => {
    try {
      const rulesFile = loadRulesFile(opts.rules);
      if (rulesFile.notify_channel === null || rulesFile.notify_channel.length === 0) {
        process.exit(0);
      }
      const watchlist = loadWatchlistOrEmpty(join(process.cwd(), "watchlist.yaml"));
      const latest = loadLatestSnapshots(opts.snapshots);
      const token = loadTokenOrNull();
      const client = token ? createClient(token) : null;
      const alerts = await runAllRules(latest, rulesFile, {
        snapshotsDir: opts.snapshots,
        watchlist,
        client,
      });
      if (alerts.length === 0) {
        process.exit(0);
      }
      const lines = alerts.map((a) => `• *[${a.severity}]* ${a.repo}: ${a.message}`).join("\n");
      const payload = {
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Pulse alerts* (${alerts.length})` },
          },
          { type: "section", text: { type: "mrkdwn", text: lines } },
        ],
      };
      await sendSlackMessage(rulesFile.notify_channel, payload, { send: opts.send ?? false });
      process.exit(0);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse notify failed: ${scrub(raw)}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`pulse: ${scrub(raw)}`);
  process.exit(1);
});
