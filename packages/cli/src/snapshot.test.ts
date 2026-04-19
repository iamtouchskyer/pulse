import { describe, it, expect, vi } from "vitest";
import { SnapshotSchema } from "@pulse/schema";
import { fetchSnapshot, fixtureSnapshot, todayUtc } from "./snapshot.js";
import type { Octokit } from "@octokit/rest";

interface Route {
  match: RegExp;
  handler: () => Promise<{ data: unknown }> | { data: unknown };
}

function makeMockClient(routes: Route[]): Octokit {
  const request = vi.fn(async (route: string) => {
    for (const r of routes) {
      if (r.match.test(route)) {
        return await r.handler();
      }
    }
    throw new Error(`unmatched route: ${route}`);
  });
  return { request } as unknown as Octokit;
}

const repoData = {
  stargazers_count: 42,
  forks_count: 3,
  watchers_count: 5,
  subscribers_count: 7,
  open_issues_count: 10,
};

describe("fetchSnapshot", () => {
  it("produces zod-valid Snapshot from fake data", async () => {
    const client = makeMockClient([
      { match: /^GET \/repos\/\{owner\}\/\{repo\}$/, handler: () => ({ data: repoData }) },
      {
        match: /pulls/,
        handler: () => ({
          data: [{ number: 1 }, { number: 2 }, { number: 3 }],
        }),
      },
      {
        match: /\/issues$/,
        handler: () => ({
          data: [
            {
              number: 11,
              title: "real issue",
              user: { login: "alice" },
              created_at: "2026-04-19T00:00:00Z",
              comments: 0,
            },
            {
              number: 12,
              title: "ghost",
              user: null,
              created_at: "2026-04-18T00:00:00Z",
              comments: 1,
            },
            {
              number: 13,
              title: "PR thing",
              user: { login: "bob" },
              created_at: "2026-04-17T00:00:00Z",
              comments: 0,
              pull_request: { url: "x" },
            },
          ],
        }),
      },
      {
        match: /traffic\/views/,
        handler: () => ({ data: { count: 100, uniques: 30 } }),
      },
      {
        match: /traffic\/clones/,
        handler: () => ({ data: { count: 7, uniques: 4 } }),
      },
      {
        match: /traffic\/popular\/referrers/,
        handler: () => ({
          data: [{ referrer: "google.com", count: 50, uniques: 20 }],
        }),
      },
      {
        match: /traffic\/popular\/paths/,
        handler: () => ({
          data: [{ path: "/readme", count: 80, uniques: 25 }],
        }),
      },
      {
        match: /stargazers/,
        handler: () => ({
          data: [
            { user: { login: "carol" }, starred_at: "2026-04-10T00:00:00Z" },
            { user: null, starred_at: "2026-04-11T00:00:00Z" },
          ],
        }),
      },
    ]);

    const today = todayUtc();
    const snap = await fetchSnapshot(client, "iamtouchskyer/opc", today);

    SnapshotSchema.parse(snap);
    expect(snap.repo).toBe("iamtouchskyer/opc");
    expect(snap.stars).toBe(42);
    expect(snap.open_prs).toBe(3);
    expect(snap.open_issues).toBe(7); // 10 - 3
    expect(snap.recent_issues).toHaveLength(2); // PR filtered
    expect(snap.recent_issues[1]?.author).toBeNull(); // ghost
    expect(snap.recent_stargazers).toEqual(["carol", null]);
    expect(snap.traffic.views_14d).toBe(100);
    expect(snap.traffic.clones_14d).toBe(7);
  });

  it("traffic 403 produces zeros and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const forbidden = (): never => {
      const err = new Error("Forbidden") as Error & { status: number };
      err.status = 403;
      throw err;
    };

    const client = makeMockClient([
      { match: /^GET \/repos\/\{owner\}\/\{repo\}$/, handler: () => ({ data: repoData }) },
      { match: /pulls/, handler: () => ({ data: [] }) },
      { match: /\/issues$/, handler: () => ({ data: [] }) },
      { match: /traffic\/views/, handler: forbidden },
      { match: /traffic\/clones/, handler: forbidden },
      { match: /traffic\/popular\/referrers/, handler: forbidden },
      { match: /traffic\/popular\/paths/, handler: forbidden },
      { match: /stargazers/, handler: () => ({ data: [] }) },
    ]);

    const snap = await fetchSnapshot(client, "iamtouchskyer/opc", todayUtc());
    expect(snap.traffic.views_14d).toBe(0);
    expect(snap.traffic.unique_visitors_14d).toBe(0);
    expect(snap.traffic.clones_14d).toBe(0);
    expect(snap.top_referrers).toEqual([]);
    expect(snap.top_paths).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    for (const call of warnSpy.mock.calls) {
      const text = call.join(" ");
      expect(text).not.toMatch(/ghp_|github_pat_/);
    }
    warnSpy.mockRestore();
  });

  it("rejects invalid repo slug", async () => {
    const client = makeMockClient([]);
    await expect(fetchSnapshot(client, "no-slash", todayUtc())).rejects.toThrow(
      /Invalid repo slug/
    );
  });
});

describe("fixtureSnapshot", () => {
  it("produces valid Snapshot", () => {
    const s = fixtureSnapshot("iamtouchskyer/opc", todayUtc());
    SnapshotSchema.parse(s);
  });
});

describe("todayUtc", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
