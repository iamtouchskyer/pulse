import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Minimal valid Snapshot builder for scratch fixtures. */
function makeSnapshot(repo: string, date: string, stars: number): Snapshot {
  return {
    schema_version: 1,
    repo,
    date,
    captured_at: `${date}T00:00:00.000Z`,
    stars,
    forks: 0,
    watchers: 0,
    open_issues: 0,
    open_prs: 0,
    traffic: { views_14d: 0, unique_visitors_14d: 0, clones_14d: 0 },
    top_referrers: [],
    top_paths: [],
    recent_issues: [],
    recent_stargazers: [],
  };
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

  it("boundary: uniques == threshold does NOT fire; threshold+1 fires", () => {
    const base = spike();
    // Use a cloned snapshot with a controlled mystery referrer row.
    const atThreshold: Snapshot = {
      ...base,
      top_referrers: [{ referrer: "new.io", count: 40, uniques: 20 }],
    };
    const above: Snapshot = {
      ...base,
      top_referrers: [{ referrer: "new.io", count: 40, uniques: 21 }],
    };
    expect(
      runNewReferrerDomain(atThreshold, {
        uniquesThreshold: 21,
        knownList: DEFAULT_KNOWN_DOMAINS,
      })
    ).toHaveLength(0);
    expect(
      runNewReferrerDomain(above, {
        uniquesThreshold: 20,
        knownList: DEFAULT_KNOWN_DOMAINS,
      })
    ).toHaveLength(1);
  });

  it("treats subdomains of known domains as known", () => {
    const base = spike();
    const snap: Snapshot = {
      ...base,
      top_referrers: [
        { referrer: "mobile.twitter.com", count: 100, uniques: 50 },
        { referrer: "amp.reddit.com", count: 100, uniques: 50 },
      ],
    };
    const alerts = runNewReferrerDomain(snap, {
      uniquesThreshold: 20,
      knownList: ["twitter.com", "reddit.com"],
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

  it("boundary: age == threshold does NOT fire; threshold+epsilon fires", () => {
    const base = spike();
    const now = new Date(base.captured_at).getTime();
    const atThreshold: Snapshot = {
      ...base,
      recent_issues: [
        {
          number: 101,
          title: "exactly 48h",
          author: "x",
          created_at: new Date(now - 48 * 3600 * 1000).toISOString(),
          comments: 0,
        },
      ],
    };
    const justOver: Snapshot = {
      ...base,
      recent_issues: [
        {
          number: 102,
          title: "48.01h old",
          author: "x",
          created_at: new Date(now - (48 * 3600 + 60) * 1000).toISOString(),
          comments: 0,
        },
      ],
    };
    expect(runUnansweredIssue(atThreshold, { ageHours: 48 })).toHaveLength(0);
    expect(runUnansweredIssue(justOver, { ageHours: 48 })).toHaveLength(1);
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
    // N<2 → std=0 (sample std undefined).
    expect(meanStd([7])).toEqual({ mean: 7, std: 0 });
    const { mean, std } = meanStd([5, 5, 5]);
    expect(mean).toBe(5);
    expect(std).toBe(0);
  });

  it("computeWeeklyDeltas returns null on missing history", () => {
    expect(computeWeeklyDeltas(FIXTURES, "unknown/repo", "2026-04-19")).toBeNull();
  });

  it("meanStd uses sample std (Bessel's correction)", () => {
    // For [2, 4, 4, 4, 5, 5, 7, 9], sample std = 2 (population = sqrt(3.5)).
    const { mean, std } = meanStd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBe(5);
    expect(std).toBeCloseTo(2.138, 2); // sample std = sqrt(32/7) ≈ 2.138
  });

  it("boundary: current == mean + σ*std does NOT fire; +1 fires", () => {
    // runStarVelocitySpike reads history from disk (not from the Snapshot
    // argument's `stars` field), so we build a scratch snapshots dir with a
    // controlled history: D-28 thru D-7 stars = 10, 10, 10, 10 → 3 prior
    // weekly deltas of 0; latest is configurable.
    // With prev=[0,0,0]: mean=0 → function's `mean <= 0` guard returns []
    // unconditionally. So use non-zero prevs: stars 0,5,10,15 over D-28 thru
    // D-7 gives prevs=[5,5,5], mean=5, sample std=0 → threshold=5.
    // current = latestStars - 15:
    //   latestStars=20 → current=5, equals threshold (miss)
    //   latestStars=21 → current=6, exceeds threshold (hit)
    const scratch = mkdtempSync(join(tmpdir(), "pulse-velocity-"));
    try {
      const repo = "scratch/velocity";
      const series: Array<{ date: string; stars: number }> = [
        { date: "2026-03-22", stars: 0 },
        { date: "2026-03-29", stars: 5 },
        { date: "2026-04-05", stars: 10 },
        { date: "2026-04-12", stars: 15 },
      ];
      for (const { date, stars } of series) {
        mkdirSync(join(scratch, date), { recursive: true });
        writeFileSync(
          join(scratch, date, "velocity.json"),
          JSON.stringify(makeSnapshot(repo, date, stars)),
          "utf8"
        );
      }

      const writeLatest = (stars: number): Snapshot => {
        const date = "2026-04-19";
        mkdirSync(join(scratch, date), { recursive: true });
        const snap = makeSnapshot(repo, date, stars);
        writeFileSync(join(scratch, date, "velocity.json"), JSON.stringify(snap), "utf8");
        return snap;
      };

      const atBoundary = writeLatest(20);
      expect(runStarVelocitySpike(atBoundary, scratch, { sigma: 3 })).toHaveLength(0);
      const justOver = writeLatest(21);
      expect(runStarVelocitySpike(justOver, scratch, { sigma: 3 })).toHaveLength(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
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

  it("null author + matching stargazer: star fires, issue-null-branch skipped", () => {
    const base = spike();
    const snap: Snapshot = {
      ...base,
      recent_issues: [
        { number: 77, title: "ghost", author: null, created_at: base.captured_at, comments: 0 },
      ],
      recent_stargazers: ["other", null],
    };
    const alerts = runWatchlistSignal(snap, ["other"]);
    // Null issue author must not crash and must not count as a hit; the
    // stargazer "other" fires exactly once.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data["kind"]).toBe("star");
  });

  it("null author + empty matching stargazers: no alerts, no crash", () => {
    const base = spike();
    const snap: Snapshot = {
      ...base,
      recent_issues: [
        { number: 88, title: "ghost", author: null, created_at: base.captured_at, comments: 0 },
      ],
      recent_stargazers: [null],
    };
    expect(runWatchlistSignal(snap, ["anybody"])).toHaveLength(0);
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
      paginate: vi.fn().mockResolvedValueOnce([
        {
          full_name: "alice/spike",
          html_url: "https://github.com/alice/spike",
          created_at: forkCreated,
          default_branch: "main",
          owner: { login: "alice" },
        },
      ]),
      request: vi.fn().mockResolvedValueOnce({ data: { ahead_by: 4 } }),
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
      paginate: vi.fn().mockResolvedValueOnce([
        {
          full_name: "stale/spike",
          html_url: "https://x",
          created_at: oldCreated,
          default_branch: "main",
          owner: { login: "stale" },
        },
      ]),
      request: vi.fn(),
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
      paginate: vi.fn().mockRejectedValueOnce({ status: 500, message: "boom" }),
      request: vi.fn(),
    };
    const alerts = await runActiveFork(spike(), {
      client: client as unknown as GitHubClient,
    });
    expect(alerts).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/active_fork forks list failed/);
    warn.mockRestore();
  });

  it("boundary: ahead_by == 0 does NOT fire; ahead_by == 1 fires", async () => {
    const now = new Date("2026-04-19T00:00:00.000Z").getTime();
    const forkCreated = new Date("2026-04-17T00:00:00.000Z").toISOString();
    const fork = {
      full_name: "alice/spike",
      html_url: "https://github.com/alice/spike",
      created_at: forkCreated,
      default_branch: "main",
      owner: { login: "alice" },
    };
    const clientZero = {
      paginate: vi.fn().mockResolvedValueOnce([fork]),
      request: vi.fn().mockResolvedValueOnce({ data: { ahead_by: 0 } }),
    };
    const zero = await runActiveFork(spike(), {
      client: clientZero as unknown as GitHubClient,
      now: () => now,
    });
    expect(zero).toHaveLength(0);

    const clientOne = {
      paginate: vi.fn().mockResolvedValueOnce([fork]),
      request: vi.fn().mockResolvedValueOnce({ data: { ahead_by: 1 } }),
    };
    const one = await runActiveFork(spike(), {
      client: clientOne as unknown as GitHubClient,
      now: () => now,
    });
    expect(one).toHaveLength(1);
    expect(one[0]?.data["ahead_by"]).toBe(1);
  });
});

describe("loadLatestSnapshots integration", () => {
  it("works across the fixture tree", () => {
    const latest = loadLatestSnapshots(FIXTURES);
    expect(latest.has("iamtouchskyer/spike")).toBe(true);
    expect(latest.has("iamtouchskyer/steady")).toBe(true);
  });
});
