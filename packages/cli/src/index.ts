#!/usr/bin/env bun
import { Command } from "commander";
import { join } from "node:path";
import { loadTokenOrNull, loadToken } from "./token.js";
import { createClient, redactToken } from "./github.js";
import { fetchSnapshot, fixtureSnapshot, todayUtc } from "./snapshot.js";
import { writeSnapshot } from "./writer.js";
import { DEFAULT_REPOS, expandRepo } from "./repos.js";

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

for (const stub of ["diff", "rules", "weekly", "notify"] as const) {
  program
    .command(stub)
    .description(`${stub} (not implemented in U5)`)
    .allowUnknownOption()
    .action(() => {
      // eslint-disable-next-line no-console
      console.log(`pulse ${stub}: not implemented`);
      process.exit(0);
    });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`pulse: ${scrub(raw)}`);
  process.exit(1);
});
