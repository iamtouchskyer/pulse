import { describe, expect, test } from "vitest";
import {
  PathStatSchema,
  RecentIssueSchema,
  ReferrerSchema,
  SnapshotSchema,
  TrafficSchema,
} from "./snapshot.js";

const validSnapshot = {
  schema_version: 1 as const,
  repo: "iamtouchskyer/opc",
  date: "2026-04-19",
  captured_at: "2026-04-19T06:17:00Z",
  stars: 83,
  forks: 4,
  watchers: 12,
  open_issues: 7,
  open_prs: 2,
  traffic: { views_14d: 412, unique_visitors_14d: 89, clones_14d: 38 },
  top_referrers: [{ referrer: "news.ycombinator.com", count: 23, uniques: 18 }],
  top_paths: [{ path: "/iamtouchskyer/opc", count: 201, uniques: 156 }],
  recent_issues: [
    {
      number: 42,
      title: "title",
      author: "alice",
      created_at: "2026-04-18T10:00:00Z",
      comments: 0,
    },
  ],
  recent_stargazers: ["userA", "userB"],
};

describe("TrafficSchema", () => {
  test("happy path", () => {
    expect(TrafficSchema.parse(validSnapshot.traffic)).toEqual(validSnapshot.traffic);
  });
  test("missing field", () => {
    expect(() => TrafficSchema.parse({ views_14d: 1, unique_visitors_14d: 1 })).toThrow();
  });
  test("wrong type", () => {
    expect(() =>
      TrafficSchema.parse({
        views_14d: "1",
        unique_visitors_14d: 1,
        clones_14d: 1,
      })
    ).toThrow();
  });
});

describe("ReferrerSchema", () => {
  test("happy", () => {
    expect(ReferrerSchema.parse(validSnapshot.top_referrers[0])).toBeTruthy();
  });
  test("missing", () => {
    expect(() => ReferrerSchema.parse({ referrer: "x", count: 1 })).toThrow();
  });
  test("wrong type", () => {
    expect(() => ReferrerSchema.parse({ referrer: "x", count: "1", uniques: 1 })).toThrow();
  });
});

describe("PathStatSchema", () => {
  test("happy", () => {
    expect(PathStatSchema.parse(validSnapshot.top_paths[0])).toBeTruthy();
  });
  test("missing", () => {
    expect(() => PathStatSchema.parse({ path: "/x", count: 1 })).toThrow();
  });
  test("wrong type", () => {
    expect(() => PathStatSchema.parse({ path: 1, count: 1, uniques: 1 })).toThrow();
  });
});

describe("RecentIssueSchema", () => {
  test("happy", () => {
    expect(RecentIssueSchema.parse(validSnapshot.recent_issues[0])).toBeTruthy();
  });
  test("author nullable (ghost user)", () => {
    expect(
      RecentIssueSchema.parse({
        number: 1,
        title: "t",
        author: null,
        created_at: "2026-04-18T10:00:00Z",
        comments: 0,
      })
    ).toBeTruthy();
  });
  test("number must be positive (reject 0)", () => {
    expect(() =>
      RecentIssueSchema.parse({
        number: 0,
        title: "t",
        author: "a",
        created_at: "2026-04-18T10:00:00Z",
        comments: 0,
      })
    ).toThrow();
  });
  test("missing", () => {
    expect(() => RecentIssueSchema.parse({ number: 1, title: "t", author: "a" })).toThrow();
  });
  test("wrong type / bad datetime", () => {
    expect(() =>
      RecentIssueSchema.parse({
        number: 1,
        title: "t",
        author: "a",
        created_at: "not-iso",
        comments: 0,
      })
    ).toThrow();
  });
});

describe("SnapshotSchema", () => {
  test("happy path", () => {
    expect(SnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot);
  });
  test("missing schema_version", () => {
    const rest: Record<string, unknown> = { ...validSnapshot };
    delete rest.schema_version;
    expect(() => SnapshotSchema.parse(rest)).toThrow();
  });
  test("schema_version must be 1", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, schema_version: 2 })).toThrow();
  });
  test("missing required field (stars)", () => {
    const rest: Record<string, unknown> = { ...validSnapshot };
    delete rest.stars;
    expect(() => SnapshotSchema.parse(rest)).toThrow();
  });
  test("wrong type (stars as string)", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, stars: "83" })).toThrow();
  });
  test("invalid date format", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, date: "2026/04/19" })).toThrow();
  });
  test("invalid repo format", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, repo: "not-a-repo" })).toThrow();
  });
  test("invalid captured_at", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, captured_at: "yesterday" })).toThrow();
  });
  test("ghost stargazer entry (null) accepted", () => {
    expect(
      SnapshotSchema.parse({
        ...validSnapshot,
        recent_stargazers: ["userA", null, "userB"],
      })
    ).toBeTruthy();
  });
  test("ghost issue author (null) accepted at snapshot level", () => {
    expect(
      SnapshotSchema.parse({
        ...validSnapshot,
        recent_issues: [
          {
            number: 99,
            title: "ghost",
            author: null,
            created_at: "2026-04-18T10:00:00Z",
            comments: 0,
          },
        ],
      })
    ).toBeTruthy();
  });
  test("top_referrers max 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      referrer: `r${i}`,
      count: 1,
      uniques: 1,
    }));
    expect(() => SnapshotSchema.parse({ ...validSnapshot, top_referrers: eleven })).toThrow();
  });
  test("top_paths max 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      path: `/p${i}`,
      count: 1,
      uniques: 1,
    }));
    expect(() => SnapshotSchema.parse({ ...validSnapshot, top_paths: eleven })).toThrow();
  });
  test("recent_stargazers max 30", () => {
    const thirtyOne = Array.from({ length: 31 }, (_, i) => `u${i}`);
    expect(() =>
      SnapshotSchema.parse({ ...validSnapshot, recent_stargazers: thirtyOne })
    ).toThrow();
  });
});
