import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { loadLatestSnapshots, loadSnapshotsAt } from "./diff.js";
import { DEFAULT_KNOWN_DOMAINS } from "./rules-config.js";
import { runNewReferrerDomain, extractDomain } from "./rules/new_referrer_domain.js";
import { runUnansweredIssue } from "./rules/unanswered_issue.js";
import { runStarVelocitySpike, computeWeeklyDeltas, meanStd } from "./rules/star_velocity_spike.js";
import { runWatchlistSignal } from "./rules/watchlist_signal.js";
import { runActiveFork } from "./rules/active_fork.js";
import type { Snapshot } from "@pulse/schema";
import type { GitHubClient } from "./github.js";

const FIXTURES = join(process.cwd(), "packages/cli/__fixtures__/snapshots");

function spike(): Snapshot {
  const snaps = loadSnapshotsAt(FIXTURES, "2026-04-19");
  const s = snaps.get("iamtouchskyer/spike");
  if (!s) throw new Error("fixture missing");
  return s;
}

function steady(): Snapshot {
  const snaps = loadSnapshotsAt(FIXTURES, "2026-04-19");
  const s = snaps.get("iamtouchskyer/steady");
  if (!s) throw new Error("fixture missing");
  return s;
}

describe("extractDomain", () => {
  it("normalizes host and URL forms", () => {
    expect(extractDomain("GitHub.com")).toBe("github.com");
    expect(extractDomain("https://news.ycombinator.com/path")).toBe("news.ycombinator.com");
    expect(extractDomain("")).toBe("");
  });
});

describe("runNewReferrerDomain", () => {
  it("emits alert for unknown domain over threshold", () => {
    const alerts = runNewReferrerDomain(spike(), {
      uniquesThreshold: 20,
      knownList: DEFAULT_KNOWN_DOMAINS,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data["domain"]).toBe("mystery.dev");
    expect(alerts[0]?.data["uniques"]).toBe(50);
  });

  it("skips known domains and below-threshold rows", () => {
    const alerts = runNewReferrerDomain(steady(), {
      uniquesThreshold: 20,
      knownList: DEFAULT_KNOWN_DOMAINS,
    });
    expect(alerts).toHaveLength(0);
  });
});

describe("runUnansweredIssue", () => {
  it("emits alert for old uncommented issues and skips answered/new", () => {
    const alerts = runUnansweredIssue(spike(), { ageHours: 48 });
    // #1 qualifies (4d, 0 comments). #2 has comments. #3 is <48h.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data["number"]).toBe(1);
  });

  it("no hits on steady fixture", () => {
    expect(runUnansweredIssue(steady(), { ageHours: 48 })).toHaveLength(0);
  });
});

describe("runStarVelocitySpike", () => {
  it("flags spike when current delta well above 28d mean+σ*std", () => {
    const alerts = runStarVelocitySpike(spike(), FIXTURES, { sigma: 3 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data["delta"]).toBe(85);
  });

  it("returns [] for insufficient history", () => {
    const snap = steady(); // no 28d of steady history
    const alerts = runStarVelocitySpike(snap, FIXTURES, { sigma: 3 });
    expect(alerts).toHaveLength(0);
  });

  it("meanStd handles edge cases", () => {
    expect(meanStd([])).toEqual({ mean: 0, std: 0 });
    const { mean, std } = meanStd([5, 5, 5]);
    expect(mean).toBe(5);
    expect(std).toBe(0);
  });

  it("computeWeeklyDeltas returns null on missing history", () => {
    expect(computeWeeklyDeltas(FIXTURES, "unknown/repo", "2026-04-19")).toBeNull();
  });
});

describe("runWatchlistSignal", () => {
  it("hits on issue author and star login", () => {
    const alerts = runWatchlistSignal(spike(), ["watcheduser"]);
    // Should fire twice — one as issue author, one as stargazer.
    expect(alerts).toHaveLength(2);
    const kinds = alerts.map((a) => a.data["kind"]).sort();
    expect(kinds).toEqual(["issue", "star"]);
  });

  it("empty watchlist is a noop", () => {
    expect(runWatchlistSignal(spike(), [])).toHaveLength(0);
  });

  it("ignores null authors/stargazers safely", () => {
    const alerts = runWatchlistSignal(spike(), ["not-here"]);
    expect(alerts).toHaveLength(0);
  });
});

describe("runActiveFork", () => {
  it("skips with warn when no client", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const alerts = await runActiveFork(spike(), { client: null });
    expect(alerts).toHaveLength(0);
    warn.mockRestore();
  });

  it("emits alert when fork has ahead_by > 0", async () => {
    const now = new Date("2026-04-19T00:00:00.000Z").getTime();
    const forkCreated = new Date("2026-04-17T00:00:00.000Z").toISOString();
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              full_name: "alice/spike",
              html_url: "https://github.com/alice/spike",
              created_at: forkCreated,
              default_branch: "main",
              owner: { login: "alice" },
            },
          ],
        })
        .mockResolvedValueOnce({ data: { ahead_by: 4 } }),
    };
    const alerts = await runActiveFork(spike(), {
      client: client as unknown as GitHubClient,
      now: () => now,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data["ahead_by"]).toBe(4);
    expect(alerts[0]?.data["forker"]).toBe("alice");
  });

  it("skips stale forks (>7d)", async () => {
    const now = new Date("2026-04-19T00:00:00.000Z").getTime();
    const oldCreated = new Date("2026-04-01T00:00:00.000Z").toISOString();
    const client = {
      request: vi.fn().mockResolvedValueOnce({
        data: [
          {
            full_name: "stale/spike",
            html_url: "https://x",
            created_at: oldCreated,
            default_branch: "main",
            owner: { login: "stale" },
          },
        ],
      }),
    };
    const alerts = await runActiveFork(spike(), {
      client: client as unknown as GitHubClient,
      now: () => now,
    });
    expect(alerts).toHaveLength(0);
  });

  it("degrades on forks API failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = {
      request: vi.fn().mockRejectedValueOnce({ status: 500, message: "boom" }),
    };
    const alerts = await runActiveFork(spike(), {
      client: client as unknown as GitHubClient,
    });
    expect(alerts).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("loadLatestSnapshots integration", () => {
  it("works across the fixture tree", () => {
    const latest = loadLatestSnapshots(FIXTURES);
    expect(latest.has("iamtouchskyer/spike")).toBe(true);
    expect(latest.has("iamtouchskyer/steady")).toBe(true);
  });
});
