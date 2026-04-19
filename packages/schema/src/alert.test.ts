import { describe, expect, test } from "vitest";
import { AlertSchema } from "./alert.js";

const valid = {
  rule: "active_fork",
  repo: "iamtouchskyer/opc",
  severity: "info" as const,
  message: "fork activity detected",
  captured_at: "2026-04-19T06:17:00Z",
  data: { fork: "someone/opc", commits_ahead: 3 },
};

describe("AlertSchema", () => {
  test("happy path", () => {
    expect(AlertSchema.parse(valid)).toEqual(valid);
  });
  test("missing required field (rule)", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.rule;
    expect(() => AlertSchema.parse(rest)).toThrow();
  });
  test("wrong type (severity not in enum)", () => {
    expect(() => AlertSchema.parse({ ...valid, severity: "critical" })).toThrow();
  });
  test("invalid repo", () => {
    expect(() => AlertSchema.parse({ ...valid, repo: "norepo" })).toThrow();
  });
  test("invalid captured_at", () => {
    expect(() => AlertSchema.parse({ ...valid, captured_at: "now" })).toThrow();
  });
  test("data must be object", () => {
    expect(() => AlertSchema.parse({ ...valid, data: "string" })).toThrow();
  });
});
