import { describe, it, expect } from "vitest";
import { classifyError, GitHubApiError } from "./github.js";

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
});
