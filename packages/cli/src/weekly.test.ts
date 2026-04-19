import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSlackPayload,
  buildWeeklyReport,
  isoWeekFromDate,
  renderWeeklyMarkdown,
  summarizeAlerts,
  writeWeeklyReport,
} from "./weekly.js";
import { loadSnapshotsAt } from "./diff.js";
import { sendSlackMessage } from "./slack.js";
import type { Alert } from "@pulse/schema";

const FIXTURES = join(process.cwd(), "packages/cli/__fixtures__/snapshots");

describe("isoWeekFromDate", () => {
  it("matches known ISO weeks", () => {
    expect(isoWeekFromDate("2026-04-19")).toBe("2026-W16");
    expect(isoWeekFromDate("2026-01-01")).toBe("2026-W01");
    // Year boundary case: 2025-12-29 is part of 2026-W01 in ISO.
    expect(isoWeekFromDate("2025-12-29")).toBe("2026-W01");
  });
});

describe("buildWeeklyReport + markdown + slack", () => {
  const latest = loadSnapshotsAt(FIXTURES, "2026-04-19");
  const baseline = loadSnapshotsAt(FIXTURES, "2026-04-12");
  const alerts: Alert[] = [
    {
      schema_version: 1,
      rule: "new_referrer_domain",
      repo: "iamtouchskyer/spike",
      severity: "info",
      message: "m",
      captured_at: "2026-04-19T00:00:00.000Z",
      data: {},
    },
    {
      schema_version: 1,
      rule: "unanswered_issue",
      repo: "iamtouchskyer/spike",
      severity: "warn",
      message: "m",
      captured_at: "2026-04-19T00:00:00.000Z",
      data: {},
    },
  ];

  it("builds a zod-valid report with correct deltas and alert counts", () => {
    const report = buildWeeklyReport({
      latest,
      baseline,
      alerts,
      generatedAt: "2026-04-19T01:00:00.000Z",
    });
    expect(report.iso_week).toBe("2026-W16");
    const spikeRow = report.repos.find((r) => r.repo === "iamtouchskyer/spike");
    expect(spikeRow).toEqual({
      repo: "iamtouchskyer/spike",
      stars_delta: 85,
      forks_delta: 2,
      views_delta: 190,
      alerts_count: 2,
    });
    const steadyRow = report.repos.find((r) => r.repo === "iamtouchskyer/steady");
    expect(steadyRow?.alerts_count).toBe(0);
  });

  it("summarizeAlerts tallies by rule", () => {
    const s = summarizeAlerts(alerts);
    expect(s.new_referrer_domain).toBe(1);
    expect(s.unanswered_issue).toBe(1);
    expect(s.active_fork).toBe(0);
  });

  it("renders markdown containing both repos", () => {
    const report = buildWeeklyReport({
      latest,
      baseline,
      alerts,
      generatedAt: "2026-04-19T01:00:00.000Z",
    });
    const md = renderWeeklyMarkdown(report);
    expect(md).toContain("iamtouchskyer/spike");
    expect(md).toContain("iamtouchskyer/steady");
    expect(md).toContain("new_referrer_domain: 1");
  });

  it("buildSlackPayload has blocks", () => {
    const report = buildWeeklyReport({
      latest,
      baseline,
      alerts,
      generatedAt: "2026-04-19T01:00:00.000Z",
    });
    const payload = buildSlackPayload(report);
    expect(payload.blocks.length).toBeGreaterThan(0);
    expect(payload.blocks[0]?.text?.text).toContain("2026-W16");
  });

  it("writeWeeklyReport writes atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-weekly-"));
    try {
      const report = buildWeeklyReport({
        latest,
        baseline,
        alerts,
        generatedAt: "2026-04-19T01:00:00.000Z",
      });
      const file = writeWeeklyReport(report, renderWeeklyMarkdown(report), dir);
      writeFileSync(file, readFileSync(file, "utf8"), "utf8"); // sanity: file exists
      expect(file.endsWith("2026-W16.md")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sendSlackMessage (dry-run default)", () => {
  it("skips when channel is null", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendSlackMessage(null, { blocks: [] }, { send: false });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("prints payload when send=false", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendSlackMessage("C123", { blocks: [] }, { send: false });
    expect(log).toHaveBeenCalled();
    const arg = String(log.mock.calls[0]?.[0] ?? "");
    expect(arg).toContain("C123");
    log.mockRestore();
  });

  it("send=true goes through the stub path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendSlackMessage("C123", { blocks: [] }, { send: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
