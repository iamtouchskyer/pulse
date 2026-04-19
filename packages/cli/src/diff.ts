import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SnapshotSchema, type Snapshot } from "@pulse/schema";

export class NoBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoBaselineError";
  }
}

/** Returns YYYY-MM-DD date strings that exist as subdirs of `snapshotsDir`, sorted ascending. */
export function listDateDirs(snapshotsDir: string): string[] {
  if (!existsSync(snapshotsDir)) return [];
  const names = readdirSync(snapshotsDir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
  return names
    .filter((n) => {
      try {
        return statSync(join(snapshotsDir, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function readSnapshotsInDir(dir: string): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = join(dir, file);
    const raw = readFileSync(full, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const snap = SnapshotSchema.parse(parsed);
    out.set(snap.repo, snap);
  }
  return out;
}

/** Loads the most recent day's snapshots. Returns empty map if none exist. */
export function loadLatestSnapshots(snapshotsDir: string): Map<string, Snapshot> {
  const dates = listDateDirs(snapshotsDir);
  const latest = dates[dates.length - 1];
  if (latest === undefined) return new Map();
  return readSnapshotsInDir(join(snapshotsDir, latest));
}

/** Loads all snapshots on a specific date. Throws NoBaselineError if dir missing. */
export function loadSnapshotsAt(snapshotsDir: string, date: string): Map<string, Snapshot> {
  const dir = join(snapshotsDir, date);
  if (!existsSync(dir)) {
    throw new NoBaselineError(`baseline ${date} not found in ${snapshotsDir}`);
  }
  return readSnapshotsInDir(dir);
}

export interface DiffRow {
  repo: string;
  stars_delta: number;
  forks_delta: number;
  views_delta: number;
}

export function computeDiff(
  latest: Map<string, Snapshot>,
  baseline: Map<string, Snapshot>
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [repo, snap] of latest) {
    const base = baseline.get(repo);
    if (base === undefined) continue;
    rows.push({
      repo,
      stars_delta: snap.stars - base.stars,
      forks_delta: snap.forks - base.forks,
      views_delta: snap.traffic.views_14d - base.traffic.views_14d,
    });
  }
  rows.sort((a, b) => a.repo.localeCompare(b.repo));
  return rows;
}

export function formatDiffTable(rows: DiffRow[]): string {
  const header = "repo | stars_delta | forks_delta | views_delta";
  const sep = "-".repeat(header.length);
  const lines = rows.map(
    (r) => `${r.repo} | ${r.stars_delta} | ${r.forks_delta} | ${r.views_delta}`
  );
  return [header, sep, ...lines].join("\n");
}

/** Subtract `nDays` from YYYY-MM-DD, UTC. */
export function subtractDaysUtc(dateStr: string, nDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    throw new Error(`invalid date: ${dateStr}`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - nDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Parses --since argument like "7d" → 7. Throws on malformed input. */
export function parseSince(since: string): number {
  const m = /^(\d+)d$/.exec(since);
  if (!m || m[1] === undefined) throw new Error(`invalid --since: ${since} (expected Nd, e.g. 7d)`);
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --since: ${since}`);
  return n;
}
