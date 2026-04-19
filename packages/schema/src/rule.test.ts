import { describe, expect, test } from "vitest";
import { RuleSchema, RulesFileSchema } from "./rule.js";

describe("RuleSchema discriminated union", () => {
  test("new_referrer_domain happy", () => {
    expect(RuleSchema.parse({ type: "new_referrer_domain", uniques_threshold: 5 })).toBeTruthy();
  });
  test("unanswered_issue happy", () => {
    expect(RuleSchema.parse({ type: "unanswered_issue", age_hours: 48 })).toBeTruthy();
  });
  test("star_velocity_spike happy", () => {
    expect(RuleSchema.parse({ type: "star_velocity_spike", sigma: 2.5 })).toBeTruthy();
  });
  test("active_fork happy", () => {
    expect(RuleSchema.parse({ type: "active_fork" })).toBeTruthy();
  });
  test("watchlist_signal happy", () => {
    expect(RuleSchema.parse({ type: "watchlist_signal" })).toBeTruthy();
  });
  test("unknown type fails with invalid_union_discriminator", () => {
    const result = RuleSchema.safeParse({ type: "bogus" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("invalid_union_discriminator");
    }
  });
  test("missing required field (uniques_threshold)", () => {
    expect(() => RuleSchema.parse({ type: "new_referrer_domain" })).toThrow();
  });
  test("wrong type for sigma", () => {
    expect(() => RuleSchema.parse({ type: "star_velocity_spike", sigma: "high" })).toThrow();
  });
  test("sigma must be positive (reject -1)", () => {
    expect(() => RuleSchema.parse({ type: "star_velocity_spike", sigma: -1 })).toThrow();
  });
  test("sigma must be positive (reject 0)", () => {
    expect(() => RuleSchema.parse({ type: "star_velocity_spike", sigma: 0 })).toThrow();
  });
  test("missing age_hours on unanswered_issue", () => {
    expect(() => RuleSchema.parse({ type: "unanswered_issue" })).toThrow();
  });
  test("age_hours must be positive (reject 0)", () => {
    expect(() => RuleSchema.parse({ type: "unanswered_issue", age_hours: 0 })).toThrow();
  });
});

describe("RulesFileSchema", () => {
  const valid = {
    known_list: ["alice", "bob"],
    notify_channel: "#pulse",
    rules: [{ type: "active_fork" as const }, { type: "unanswered_issue" as const, age_hours: 24 }],
  };
  test("happy", () => {
    expect(RulesFileSchema.parse(valid)).toEqual(valid);
  });
  test("notify_channel can be null", () => {
    expect(RulesFileSchema.parse({ ...valid, notify_channel: null })).toBeTruthy();
  });
  test("missing rules array", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.rules;
    expect(() => RulesFileSchema.parse(rest)).toThrow();
  });
  test("wrong type known_list", () => {
    expect(() => RulesFileSchema.parse({ ...valid, known_list: "alice" })).toThrow();
  });
});
