import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

export type GitHubErrorKind = "not_found" | "forbidden" | "server_error" | "rate_limit" | "unknown";

export class GitHubApiError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number;
  constructor(kind: GitHubErrorKind, status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.kind = kind;
    this.status = status;
  }
}

interface OctokitErrorShape {
  status?: number;
  message?: string;
  response?: {
    headers?: Record<string, string | undefined>;
    data?: { message?: string };
  };
}

function asErrorShape(err: unknown): OctokitErrorShape {
  if (typeof err === "object" && err !== null) return err as OctokitErrorShape;
  return {};
}

export function classifyError(err: unknown): GitHubApiError {
  const e = asErrorShape(err);
  const status = typeof e.status === "number" ? e.status : 0;
  const message = e.message ?? e.response?.data?.message ?? "GitHub API error";

  if (status === 404) return new GitHubApiError("not_found", status, message);
  if (status === 403 || status === 429) {
    const remaining = e.response?.headers?.["x-ratelimit-remaining"];
    if (remaining === "0" || status === 429) {
      return new GitHubApiError("rate_limit", status, message);
    }
    return new GitHubApiError("forbidden", status, message);
  }
  if (status >= 500 && status < 600) {
    return new GitHubApiError("server_error", status, message);
  }
  return new GitHubApiError("unknown", status, message);
}

const PluggedOctokit = Octokit.plugin(retry, throttling);

export function createClient(token: string): Octokit {
  return new PluggedOctokit({
    auth: token,
    userAgent: "pulse-cli/0.0.0",
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        if (retryCount < 1) return true;
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        if (retryCount < 1) return true;
        return false;
      },
    },
  });
}

export type GitHubClient = Octokit;
