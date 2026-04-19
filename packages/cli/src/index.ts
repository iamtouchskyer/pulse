#!/usr/bin/env bun
import { Command } from "commander";
import { join } from "node:path";
import { loadToken } from "./token.js";
import { createClient } from "./github.js";
import { fetchSnapshot, fixtureSnapshot, todayUtc } from "./snapshot.js";
import { writeSnapshot } from "./writer.js";
import { DEFAULT_REPOS, expandRepo } from "./repos.js";

const program = new Command();
program.name("pulse").description("Pulse v1 — OSS monitoring radar").version("0.0.0");

interface SnapshotOpts {
  repo?: string;
  dryRun?: boolean;
  out?: string;
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
        for (const r of repos) {
          const snap = fixtureSnapshot(r, today);
          process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
        }
        process.exit(0);
      }

      const token = loadToken();
      const client = createClient(token);
      const outDir = opts.out ?? join(process.cwd(), "data/snapshots");

      for (const r of repos) {
        const snap = await fetchSnapshot(client, r, today);
        const path = writeSnapshot(snap, outDir);
        // eslint-disable-next-line no-console
        console.log(path);
      }
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`pulse snapshot failed: ${msg}`);
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
  const msg = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`pulse: ${msg}`);
  process.exit(1);
});
