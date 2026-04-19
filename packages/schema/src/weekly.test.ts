import { describe, expect, test } from "vitest";
import { WeeklyRepoEntrySchema, WeeklyReportSchema } from "./weekly.js";

const validEntry = {
  repo: "iamtouchskyer/opc",
  stars_delta: 5,
  forks_delta: 1,
  views_delta: 100,
  alerts_count: 2,
};

const validReport = {
  iso_week: "2026-W16",
  generated_at: "2026-04-19T08:00:00Z",
  repos: [validEntry],
  alerts: [
    {
      rule: "active_fork",
      repo: "iamtouchskyer/opc",
      severity: "info" as const,
      message: "msg",
      captured_at: "2026-04-19T06:17:00Z",
      data: {},
    },
  ],
};

describe("WeeklyRepoEntrySchema", () => {
  test("happy", () => {
    expect(WeeklyRepoEntrySchema.parse(validEntry)).toEqual(validEntry);
  });
  test("missing field", () => {
    const rest: Record<string, unknown> = { ...validEntry };
    delete rest.stars_delta;
    expect(() => WeeklyRepoEntrySchema.parse(rest)).toThrow();
  });
  test("wrong type", () => {
    expect(() => WeeklyRepoEntrySchema.parse({ ...validEntry, stars_delta: "5" })).toThrow();
  });
  test("alerts_count must be nonnegative", () => {
    expect(() => WeeklyRepoEntrySchema.parse({ ...validEntry, alerts_count: -1 })).toThrow();
  });
});

describe("WeeklyReportSchema", () => {
  test("happy path", () => {
    expect(WeeklyReportSchema.parse(validReport)).toEqual(validReport);
  });
  test("missing iso_week", () => {
    const rest: Record<string, unknown> = { ...validReport };
    delete rest.iso_week;
    expect(() => WeeklyReportSchema.parse(rest)).toThrow();
  });
  test("invalid iso_week format", () => {
    expect(() => WeeklyReportSchema.parse({ ...validReport, iso_week: "2026-16" })).toThrow();
  });
  test("invalid generated_at", () => {
    expect(() => WeeklyReportSchema.parse({ ...validReport, generated_at: "later" })).toThrow();
  });
  test("wrong type for repos", () => {
    expect(() => WeeklyReportSchema.parse({ ...validReport, repos: validEntry })).toThrow();
  });
});
