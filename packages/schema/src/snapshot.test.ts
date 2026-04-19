import { describe, expect, test } from "vitest";
import {
  PathStatSchema,
  RecentIssueSchema,
  ReferrerSchema,
  SnapshotSchema,
  TrafficSchema,
} from "./snapshot.js";

const validSnapshot = {
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
});
