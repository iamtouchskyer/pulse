import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSnapshot } from "./writer.js";
import { fixtureSnapshot, todayUtc } from "./snapshot.js";
import { SnapshotSchema, type Snapshot } from "@pulse/schema";

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

  it("throws on repo slug without '/' (bypasses schema)", () => {
    const today = todayUtc();
    const snap = fixtureSnapshot("iamtouchskyer/opc", today);
    // Bypass zod by hand-crafting an invalid repo field.
    const broken = { ...snap, repo: "noslash" } as unknown as Snapshot;
    expect(() => writeSnapshot(broken, dir)).toThrow(/Invalid repo/);
  });

  it("atomic write: leaves no .tmp sibling on success", () => {
    const today = todayUtc();
    const snap = fixtureSnapshot("iamtouchskyer/opc", today);
    writeSnapshot(snap, dir);
    const files = readdirSync(join(dir, today));
    expect(files).toEqual(["opc.json"]);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
