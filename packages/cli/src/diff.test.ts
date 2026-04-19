import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  computeDiff,
  formatDiffTable,
  loadLatestSnapshots,
  loadSnapshotsAt,
  NoBaselineError,
  parseSince,
  subtractDaysUtc,
} from "./diff.js";

const FIXTURES = join(process.cwd(), "packages/cli/__fixtures__/snapshots");

describe("diff helpers", () => {
  it("parseSince accepts Nd", () => {
    expect(parseSince("7d")).toBe(7);
    expect(parseSince("28d")).toBe(28);
  });

  it("parseSince rejects bad input", () => {
    expect(() => parseSince("7")).toThrow();
    expect(() => parseSince("0d")).toThrow();
    expect(() => parseSince("abc")).toThrow();
  });

  it("subtractDaysUtc wraps across months", () => {
    expect(subtractDaysUtc("2026-04-19", 7)).toBe("2026-04-12");
    expect(subtractDaysUtc("2026-04-05", 7)).toBe("2026-03-29");
  });

  it("loadLatestSnapshots picks the newest dated dir", () => {
    const latest = loadLatestSnapshots(FIXTURES);
    expect(latest.size).toBeGreaterThan(0);
    for (const snap of latest.values()) {
      expect(snap.date).toBe("2026-04-19");
    }
  });

  it("loadSnapshotsAt throws NoBaselineError for missing date", () => {
    expect(() => loadSnapshotsAt(FIXTURES, "1999-01-01")).toThrow(NoBaselineError);
  });

  it("computeDiff produces expected deltas", () => {
    const latest = loadSnapshotsAt(FIXTURES, "2026-04-19");
    const baseline = loadSnapshotsAt(FIXTURES, "2026-04-12");
    const rows = computeDiff(latest, baseline);
    const spike = rows.find((r) => r.repo === "iamtouchskyer/spike");
    expect(spike).toEqual({
      repo: "iamtouchskyer/spike",
      stars_delta: 85,
      forks_delta: 2,
      views_delta: 190,
    });
    const steady = rows.find((r) => r.repo === "iamtouchskyer/steady");
    expect(steady).toEqual({
      repo: "iamtouchskyer/steady",
      stars_delta: 2,
      forks_delta: 0,
      views_delta: 20,
    });
  });

  it("formatDiffTable emits header + rows", () => {
    const rows = [{ repo: "a/b", stars_delta: 1, forks_delta: 2, views_delta: 3 }];
    const out = formatDiffTable(rows);
    expect(out).toMatch(/repo \| stars_delta/);
    expect(out).toMatch(/a\/b \| 1 \| 2 \| 3/);
  });

  it("loadLatestSnapshots returns empty map when dir missing", () => {
    const m = loadLatestSnapshots(join(FIXTURES, "__does_not_exist__"));
    expect(m.size).toBe(0);
  });
});
