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
      const today = todayUtc();
      const baselineDate = subtractDaysUtc(today, n);
      const latest = loadLatestSnapshots(snapshotsDir);
      if (latest.size === 0) {
        // eslint-disable-next-line no-console
        console.log("no baseline");
        process.exit(0);
      }
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
      if (err instanceof ZodError) {
        // eslint-disable-next-line no-console
        console.error(`pulse rules check: invalid rules.yaml: ${err.message}`);
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
      const today = todayUtc();
      const baselineDate = subtractDaysUtc(today, 7);
      let baseline;
      try {
        baseline = loadSnapshotsAt(opts.snapshots, baselineDate);
      } catch {
        baseline = new Map();
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
