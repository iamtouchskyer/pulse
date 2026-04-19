import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@pulse/schema";

/**
 * Atomic snapshot writer: writes to a sibling `.tmp` file then renames onto
 * the canonical path. POSIX rename is atomic within the same filesystem, so a
 * crash/OOM mid-write never leaves a partial JSON at the destination.
 */
export function writeSnapshot(snap: Snapshot, outDir: string): string {
  const parts = snap.repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo in snapshot: ${snap.repo}`);
  }
  const repoName = parts[1];
  const dir = join(outDir, snap.date);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${repoName}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  return file;
}
