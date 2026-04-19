import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { SnapshotSchema } from "@pulse/schema";

const CLI = join(process.cwd(), "packages/cli/src/index.ts");

describe("pulse CLI dry-run", () => {
  it("prints zod-valid Snapshot JSON to stdout for one repo", () => {
    const r = spawnSync("bun", [CLI, "snapshot", "--repo", "opc", "--dry-run"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    SnapshotSchema.parse(parsed);
    expect(parsed.repo).toBe("iamtouchskyer/opc");
  });

  it("accepts owner/repo form", () => {
    const r = spawnSync("bun", [CLI, "snapshot", "--repo", "foo/bar", "--dry-run"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.repo).toBe("foo/bar");
  });

  it("stub commands exit 0", () => {
    for (const stub of ["diff", "rules", "weekly", "notify"]) {
      const r = spawnSync("bun", [CLI, stub], { encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/not implemented/);
    }
  });
});
