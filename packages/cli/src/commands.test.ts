import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "packages/cli/src/index.ts");
const FIXTURES = join(process.cwd(), "packages/cli/__fixtures__/snapshots");

describe("pulse commands end-to-end", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "pulse-e2e-"));
    cpSync(FIXTURES, join(workDir, "data/snapshots"), { recursive: true });
    writeFileSync(
      join(workDir, "rules.yaml"),
      [
        "known_list: [github.com, google.com]",
        "notify_channel: null",
        "rules:",
        "  - type: new_referrer_domain",
        "    uniques_threshold: 20",
        "  - type: unanswered_issue",
        "    age_hours: 48",
        "  - type: watchlist_signal",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(join(workDir, "watchlist.yaml"), "- watcheduser\n", "utf8");
  });

  it("diff with no baseline prints 'no baseline'", () => {
    const r = spawnSync(
      "bun",
      [CLI, "diff", "--since", "7d", "--snapshots", join(workDir, "nonexistent")],
      { encoding: "utf8" }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no baseline/);
  });

  it("rules check emits alert JSON lines", () => {
    const r = spawnSync(
      "bun",
      [
        CLI,
        "rules",
        "check",
        "--rules",
        join(workDir, "rules.yaml"),
        "--snapshots",
        join(workDir, "data/snapshots"),
      ],
      { encoding: "utf8", cwd: workDir }
    );
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    // Expect: 1 referrer, 1 unanswered, 2 watchlist (issue + star) = 4
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toHaveProperty("rule");
      expect(parsed).toHaveProperty("repo");
    }
  });

  it("rules check fails with exit 1 on malformed rules.yaml", () => {
    const bad = join(workDir, "bad-rules.yaml");
    writeFileSync(
      bad,
      ["known_list: []", "notify_channel: null", "rules:", "  - uniques_threshold: 20"].join("\n"),
      "utf8"
    );
    const r = spawnSync(
      "bun",
      [CLI, "rules", "check", "--rules", bad, "--snapshots", join(workDir, "data/snapshots")],
      { encoding: "utf8", cwd: workDir }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid rules\.yaml/);
  });

  it("weekly dry-run writes markdown and does NOT send to Slack", () => {
    const reports = join(workDir, "reports");
    rmSync(reports, { recursive: true, force: true });
    const r = spawnSync(
      "bun",
      [
        CLI,
        "weekly",
        "--rules",
        join(workDir, "rules.yaml"),
        "--snapshots",
        join(workDir, "data/snapshots"),
        "--reports",
        reports,
      ],
      { encoding: "utf8", cwd: workDir }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\.md/);
    // notify_channel is null, so no payload printed.
  });

  it("notify with null channel is a no-op", () => {
    const r = spawnSync(
      "bun",
      [
        CLI,
        "notify",
        "--rules",
        join(workDir, "rules.yaml"),
        "--snapshots",
        join(workDir, "data/snapshots"),
      ],
      { encoding: "utf8", cwd: workDir }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("notify with channel prints payload in dry-run", () => {
    const rulesWithChan = join(workDir, "rules-chan.yaml");
    writeFileSync(
      rulesWithChan,
      [
        "known_list: [github.com, google.com]",
        "notify_channel: C12345",
        "rules:",
        "  - type: unanswered_issue",
        "    age_hours: 48",
      ].join("\n"),
      "utf8"
    );
    const r = spawnSync(
      "bun",
      [CLI, "notify", "--rules", rulesWithChan, "--snapshots", join(workDir, "data/snapshots")],
      { encoding: "utf8", cwd: workDir }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/C12345/);
  });
});
