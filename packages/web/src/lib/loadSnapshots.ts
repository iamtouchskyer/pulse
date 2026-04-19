import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SnapshotSchema, type Snapshot } from "@pulse/schema";
import { DISPLAY_REPOS, type DisplayRepo } from "../config.js";

export interface CardData {
  repo: DisplayRepo;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  hasData: boolean;
}

export interface LoadResult {
  cards: CardData[];
  empty: boolean;
  latestDate: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRootDir(): string {
  // resolve relative to this file: packages/web/src/lib/loadSnapshots.ts -> repo root /data/snapshots
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../../data/snapshots");
}

export function loadSnapshots(rootDir?: string): LoadResult {
  const dir = rootDir ?? defaultRootDir();

  if (!existsSync(dir)) {
    return emptyResult();
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return emptyResult();
  }

  const dated = entries
    .filter((name) => DATE_RE.test(name))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();

  if (dated.length === 0) {
    return emptyResult();
  }

  const latestDate = dated[0]!;
  const latestDir = join(dir, latestDate);

  const snapshotsByRepo = new Map<string, Snapshot>();
  let files: string[] = [];
  try {
    files = readdirSync(latestDir).filter((f) => f.endsWith(".json"));
  } catch {
    return emptyResult();
  }

  for (const file of files) {
    const full = join(latestDir, file);
    try {
      const raw = readFileSync(full, "utf-8");
      const parsed = SnapshotSchema.parse(JSON.parse(raw));
      const shortName = parsed.repo.includes("/") ? parsed.repo.split("/")[1]! : parsed.repo;
      snapshotsByRepo.set(shortName, parsed);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[loadSnapshots] skipping ${full}:`, err);
    }
  }

  const cards: CardData[] = DISPLAY_REPOS.map((repo) => {
    const snap = snapshotsByRepo.get(repo);
    if (!snap) {
      return {
        repo,
        stars: null,
        forks: null,
        open_issues: null,
        hasData: false,
      };
    }
    return {
      repo,
      stars: snap.stars,
      forks: snap.forks,
      open_issues: snap.open_issues,
      hasData: true,
    };
  });

  return { cards, empty: false, latestDate };
}

function emptyResult(): LoadResult {
  return { cards: [], empty: true, latestDate: null };
}
