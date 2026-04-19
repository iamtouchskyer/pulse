import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@pulse/schema";

export function writeSnapshot(snap: Snapshot, outDir: string): string {
  const repoName = snap.repo.split("/")[1];
  if (!repoName) throw new Error(`Invalid repo in snapshot: ${snap.repo}`);
  const dir = join(outDir, snap.date);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${repoName}.json`);
  writeFileSync(file, JSON.stringify(snap, null, 2) + "\n", "utf8");
  return file;
}
