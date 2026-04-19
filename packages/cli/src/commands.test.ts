import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "packages/cli/src/index.ts");
const FIXTURES = join(process.cwd(), "packages/cli/__fixtures__/snapshots");

/**
 * Build an env that's safe for E2E spawns: keep PATH, HOME, LANG; wipe every
 * token and Pulse-specific override so tests don't accidentally hit real
 * GitHub or Slack using the developer's credentials.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    LANG: process.env["LANG"] ?? "C",
    GITHUB_TOKEN: "",
    PULSE_SLACK_DRY_RUN: "1",
  };
}

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

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("diff with no baseline prints 'no baseline'", () => {
    const r = spawnSync(
      "bun",
      [CLI, "diff", "--since", "7d", "--snapshots", join(workDir, "nonexistent")],
      { encoding: "utf8", env: cleanEnv() }
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
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
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
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid rules\.yaml/);
  });

  it("rules check fails with exit 1 on YAML syntax error", () => {
    const bad = join(workDir, "syntax-rules.yaml");
    // Unclosed quote → YAMLParseError, not ZodError.
    writeFileSync(bad, 'known_list: ["broken\nrules: []\n', "utf8");
    const r = spawnSync(
      "bun",
      [CLI, "rules", "check", "--rules", bad, "--snapshots", join(workDir, "data/snapshots")],
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
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
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\.md/);
    // notify_channel is null AND default dry-run mode: no Slack payload on
    // stdout, and (because our Slack shim is side-effect-free in dry-run) no
    // network call could have happened. Explicitly pin this.
    expect(r.stdout).not.toMatch(/"blocks"/);
    expect(r.stdout).not.toMatch(/"channel"\s*:/);
  });

  it("weekly with notify_channel set prints Slack payload in dry-run", () => {
    const rulesWithChan = join(workDir, "weekly-chan.yaml");
    writeFileSync(
      rulesWithChan,
      [
        "known_list: [github.com, google.com]",
        "notify_channel: CWEEKLY",
        "rules:",
        "  - type: unanswered_issue",
        "    age_hours: 48",
      ].join("\n"),
      "utf8"
    );
    const reports = join(workDir, "reports-chan");
    rmSync(reports, { recursive: true, force: true });
    const r = spawnSync(
      "bun",
      [
        CLI,
        "weekly",
        "--rules",
        rulesWithChan,
        "--snapshots",
        join(workDir, "data/snapshots"),
        "--reports",
        reports,
      ],
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/CWEEKLY/);
    expect(r.stdout).toMatch(/"blocks"/);
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
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
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
      { encoding: "utf8", cwd: workDir, env: cleanEnv() }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/C12345/);
  });
});
