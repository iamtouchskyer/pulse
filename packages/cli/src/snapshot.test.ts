import { describe, it, expect, vi } from "vitest";
import { SnapshotSchema } from "@pulse/schema";
import { fetchSnapshot, fixtureSnapshot, todayUtc } from "./snapshot.js";
import type { Octokit } from "@octokit/rest";

interface Route {
  match: RegExp;
  handler: () => Promise<{ data: unknown }> | { data: unknown };
}

// Build a mock Octokit that supports .request, .paginate, .paginate.iterator.
// .paginate returns a single "page" as a flat array (test data is small).
// .paginate.iterator yields one page.
function makeMockClient(routes: Route[]): Octokit {
  async function runRoute(route: string): Promise<{ data: unknown }> {
    for (const r of routes) {
      if (r.match.test(route)) {
        return await r.handler();
      }
    }
    throw new Error(`unmatched route: ${route}`);
  }
  const request = vi.fn(runRoute);
  const paginate = Object.assign(
    vi.fn(async (route: string) => {
      const res = await runRoute(route);
      const data = res.data;
      return Array.isArray(data) ? data : [data];
    }),
    {
      iterator: (route: string) => ({
        async *[Symbol.asyncIterator]() {
          const res = await runRoute(route);
          yield { data: res.data };
        },
      }),
    }
  );
  return { request, paginate } as unknown as Octokit;
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
    expect(snap.watchers).toBe(7); // subscribers_count, not watchers_count
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

  it("traffic 404 is NOT swallowed (bubbles to allSettled degrade)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = (): never => {
      const err = new Error("Not Found") as Error & { status: number };
      err.status = 404;
      throw err;
    };
    const client = makeMockClient([
      { match: /^GET \/repos\/\{owner\}\/\{repo\}$/, handler: () => ({ data: repoData }) },
      { match: /pulls/, handler: () => ({ data: [] }) },
      { match: /\/issues$/, handler: () => ({ data: [] }) },
      { match: /traffic\/views/, handler: notFound },
      { match: /traffic\/clones/, handler: () => ({ data: { count: 0, uniques: 0 } }) },
      { match: /traffic\/popular\/referrers/, handler: () => ({ data: [] }) },
      { match: /traffic\/popular\/paths/, handler: () => ({ data: [] }) },
      { match: /stargazers/, handler: () => ({ data: [] }) },
    ]);
    const snap = await fetchSnapshot(client, "iamtouchskyer/opc", todayUtc());
    // 404 on views bubbles up; allSettled degrades to zeros and warns.
    expect(snap.traffic.views_14d).toBe(0);
    const joined = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(joined).toMatch(/traffic_views failed/);
    warnSpy.mockRestore();
  });

  it("allSettled degrades single endpoint failure (pulls 500) without tanking snapshot", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const serverError = (): never => {
      const err = new Error("boom") as Error & { status: number };
      err.status = 500;
      throw err;
    };
    const client = makeMockClient([
      { match: /^GET \/repos\/\{owner\}\/\{repo\}$/, handler: () => ({ data: repoData }) },
      { match: /pulls/, handler: serverError },
      { match: /\/issues$/, handler: () => ({ data: [] }) },
      { match: /traffic\/views/, handler: () => ({ data: { count: 0, uniques: 0 } }) },
      { match: /traffic\/clones/, handler: () => ({ data: { count: 0, uniques: 0 } }) },
      { match: /traffic\/popular\/referrers/, handler: () => ({ data: [] }) },
      { match: /traffic\/popular\/paths/, handler: () => ({ data: [] }) },
      { match: /stargazers/, handler: () => ({ data: [] }) },
    ]);
    const snap = await fetchSnapshot(client, "iamtouchskyer/opc", todayUtc());
    SnapshotSchema.parse(snap);
    expect(snap.open_prs).toBe(0); // degraded
    expect(snap.stars).toBe(42);
    const joined = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(joined).toMatch(/open_prs failed/);
    warnSpy.mockRestore();
  });

  it("repo endpoint failure is hard-fail (spine)", async () => {
    const client = makeMockClient([
      {
        match: /^GET \/repos\/\{owner\}\/\{repo\}$/,
        handler: () => {
          const err = new Error("boom") as Error & { status: number };
          err.status = 500;
          throw err;
        },
      },
    ]);
    await expect(fetchSnapshot(client, "iamtouchskyer/opc", todayUtc())).rejects.toThrow();
  });

  it("ghost stargazer maps to null login", async () => {
    const client = makeMockClient([
      { match: /^GET \/repos\/\{owner\}\/\{repo\}$/, handler: () => ({ data: repoData }) },
      { match: /pulls/, handler: () => ({ data: [] }) },
      { match: /\/issues$/, handler: () => ({ data: [] }) },
      { match: /traffic\/views/, handler: () => ({ data: { count: 0, uniques: 0 } }) },
      { match: /traffic\/clones/, handler: () => ({ data: { count: 0, uniques: 0 } }) },
      { match: /traffic\/popular\/referrers/, handler: () => ({ data: [] }) },
      { match: /traffic\/popular\/paths/, handler: () => ({ data: [] }) },
      {
        match: /stargazers/,
        handler: () => ({
          data: [{ user: null, starred_at: "2026-04-11T00:00:00Z" }],
        }),
      },
    ]);
    const snap = await fetchSnapshot(client, "iamtouchskyer/opc", todayUtc());
    expect(snap.recent_stargazers).toEqual([null]);
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

  it("default captured_at is deterministic epoch string", () => {
    const prev = process.env.PULSE_NOW;
    delete process.env.PULSE_NOW;
    try {
      const s = fixtureSnapshot("iamtouchskyer/opc", "2026-04-19");
      expect(s.captured_at).toBe("1970-01-01T00:00:00.000Z");
    } finally {
      if (prev !== undefined) process.env.PULSE_NOW = prev;
    }
  });

  it("honors explicit capturedAt argument", () => {
    const s = fixtureSnapshot("iamtouchskyer/opc", "2026-04-19", "2026-04-19T00:00:00.000Z");
    expect(s.captured_at).toBe("2026-04-19T00:00:00.000Z");
  });

  it("honors PULSE_NOW env when no arg given", () => {
    const prev = process.env.PULSE_NOW;
    process.env.PULSE_NOW = "2030-01-01T12:00:00.000Z";
    try {
      const s = fixtureSnapshot("iamtouchskyer/opc", "2030-01-01");
      expect(s.captured_at).toBe("2030-01-01T12:00:00.000Z");
    } finally {
      if (prev === undefined) delete process.env.PULSE_NOW;
      else process.env.PULSE_NOW = prev;
    }
  });
});

describe("todayUtc", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
