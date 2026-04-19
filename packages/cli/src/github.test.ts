import { describe, it, expect } from "vitest";
import { classifyError, GitHubApiError, redactToken } from "./github.js";

describe("classifyError", () => {
  it("maps 404 to not_found", () => {
    const r = classifyError({ status: 404, message: "Not Found" });
    expect(r).toBeInstanceOf(GitHubApiError);
    expect(r.kind).toBe("not_found");
    expect(r.status).toBe(404);
  });

  it("maps 403 with remaining=0 to rate_limit", () => {
    const r = classifyError({
      status: 403,
      message: "rate limit",
      response: { headers: { "x-ratelimit-remaining": "0" } },
    });
    expect(r.kind).toBe("rate_limit");
  });

  it("maps 403 without rate-limit headers to forbidden", () => {
    const r = classifyError({ status: 403, message: "Forbidden" });
    expect(r.kind).toBe("forbidden");
  });

  it("maps 429 to rate_limit", () => {
    const r = classifyError({ status: 429, message: "too many" });
    expect(r.kind).toBe("rate_limit");
  });

  it("maps 500/502/503 to server_error", () => {
    expect(classifyError({ status: 500 }).kind).toBe("server_error");
    expect(classifyError({ status: 502 }).kind).toBe("server_error");
    expect(classifyError({ status: 503 }).kind).toBe("server_error");
  });

  it("maps unknown / non-Error to unknown", () => {
    expect(classifyError({}).kind).toBe("unknown");
    expect(classifyError("oops").kind).toBe("unknown");
    expect(classifyError(null).kind).toBe("unknown");
  });

  it("maps 403 with retry-after header to rate_limit (secondary)", () => {
    const r = classifyError({
      status: 403,
      message: "You have triggered an abuse detection mechanism",
      response: { headers: { "retry-after": "60" } },
    });
    expect(r.kind).toBe("rate_limit");
  });

  it("maps 403 with body 'secondary rate limit' to rate_limit", () => {
    const r = classifyError({
      status: 403,
      message: "forbidden",
      response: { data: { message: "You have exceeded a secondary rate limit" } },
    });
    expect(r.kind).toBe("rate_limit");
  });

  it("redacts a known token from a classified error message", () => {
    const token = "ghp_realtoken0000000000000000000000";
    const r = classifyError({ status: 500, message: `boom using ${token}` }, token);
    expect(r.message).not.toContain(token);
    expect(r.message).toContain("[REDACTED]");
  });
});

describe("redactToken", () => {
  it("replaces the known token value", () => {
    const t = "ghp_known000000000000000000";
    expect(redactToken(`authorization failed for ${t}`, t)).toBe(
      "authorization failed for [REDACTED]"
    );
  });

  it("replaces unknown ghp_/ghs_ patterns via generic regex sweep", () => {
    expect(redactToken("leaked ghp_abcdefghijklmnopqrstuvwxyz12")).toBe("leaked [REDACTED]");
    expect(redactToken("leaked ghs_ABCDEFGHIJKLMNOPQRSTUVWX1234")).toBe("leaked [REDACTED]");
  });

  it("passes through clean messages unchanged", () => {
    expect(redactToken("clean message")).toBe("clean message");
    expect(redactToken("clean message", "ghp_absent")).toBe("clean message");
  });
});
