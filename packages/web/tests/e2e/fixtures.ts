import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/web/tests/e2e/fixtures.ts -> repo root
const REPO_ROOT = resolve(HERE, "../../../..");
const SNAPSHOTS_DIR = join(REPO_ROOT, "data", "snapshots");
const BACKUP_DIR = join(REPO_ROOT, "data", ".snapshots.e2e-backup");
const FIXTURE_DIR = join(HERE, "__fixtures__", "snapshots");

export function backupRealSnapshots(): void {
  if (existsSync(BACKUP_DIR)) {
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
  if (existsSync(SNAPSHOTS_DIR)) {
    cpSync(SNAPSHOTS_DIR, BACKUP_DIR, { recursive: true });
  }
}

export function restoreRealSnapshots(): void {
  if (existsSync(SNAPSHOTS_DIR)) {
    rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  }
  if (existsSync(BACKUP_DIR)) {
    cpSync(BACKUP_DIR, SNAPSHOTS_DIR, { recursive: true });
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
}

export function seedSnapshots(): void {
  // wipe then copy fixture
  if (existsSync(SNAPSHOTS_DIR)) {
    rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  }
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  // copy each dated directory under __fixtures__
  for (const entry of readdirSync(FIXTURE_DIR)) {
    const src = join(FIXTURE_DIR, entry);
    const dst = join(SNAPSHOTS_DIR, entry);
    cpSync(src, dst, { recursive: true });
  }
}

export function clearSnapshots(): void {
  if (existsSync(SNAPSHOTS_DIR)) {
    rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  }
}

export { SNAPSHOTS_DIR, REPO_ROOT, FIXTURE_DIR };

// swallow unused-import lint if any tooling flags it
void readFileSync;
void writeFileSync;
