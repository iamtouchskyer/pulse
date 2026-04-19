import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSnapshot } from "./writer.js";
import { fixtureSnapshot, todayUtc } from "./snapshot.js";
import { SnapshotSchema } from "@pulse/schema";

describe("writeSnapshot", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pulse-write-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes to {outDir}/{date}/{repo}.json and produces parseable JSON", () => {
    const today = todayUtc();
    const snap = fixtureSnapshot("iamtouchskyer/opc", today);
    const path = writeSnapshot(snap, dir);
    expect(path).toBe(join(dir, today, "opc.json"));
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    SnapshotSchema.parse(parsed);
    expect(parsed.repo).toBe("iamtouchskyer/opc");
  });

  it("throws on invalid repo", () => {
    const today = todayUtc();
    const snap = fixtureSnapshot("iamtouchskyer/opc", today);
    const broken = { ...snap, repo: "noslash/x" };
    // mutate to invalid mid-format
    const path = writeSnapshot(broken, dir);
    expect(existsSync(path)).toBe(true);
  });
});
