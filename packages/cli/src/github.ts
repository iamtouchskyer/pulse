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

const GENERIC_TOKEN_REGEX = /gh[ps]_[A-Za-z0-9]{20,}/g;

/**
 * Scrub a message string of any GitHub-style PAT. Always runs the generic
 * regex sweep; if a specific token value is known, it's replaced first.
 */
export function redactToken(msg: string, token?: string | null): string {
  let out = msg;
  if (token && token.length > 0) {
    out = out.split(token).join("[REDACTED]");
  }
  return out.replace(GENERIC_TOKEN_REGEX, "[REDACTED]");
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

export function classifyError(err: unknown, token?: string | null): GitHubApiError {
  const e = asErrorShape(err);
  const status = typeof e.status === "number" ? e.status : 0;
  const rawMessage = e.message ?? e.response?.data?.message ?? "GitHub API error";
  const message = redactToken(rawMessage, token);

  if (status === 404) return new GitHubApiError("not_found", status, message);

  if (status === 403) {
    const remaining = e.response?.headers?.["x-ratelimit-remaining"];
    const retryAfter = e.response?.headers?.["retry-after"];
    const body = (e.response?.data?.message ?? "").toLowerCase();
    const secondary = body.includes("secondary rate limit") || body.includes("abuse");
    if (remaining === "0" || retryAfter !== undefined || secondary) {
      return new GitHubApiError("rate_limit", status, message);
    }
    return new GitHubApiError("forbidden", status, message);
  }

  if (status === 429) {
    return new GitHubApiError("rate_limit", status, message);
  }

  if (status >= 500 && status < 600) {
    return new GitHubApiError("server_error", status, message);
  }
  return new GitHubApiError("unknown", status, message);
}

const PluggedOctokit = Octokit.plugin(retry, throttling);

interface ThrottleOptions {
  method?: string;
  url?: string;
}

export function createClient(token: string): Octokit {
  return new PluggedOctokit({
    auth: token,
    userAgent: "pulse-cli/0.0.0",
    log: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        // eslint-disable-next-line no-console
        console.warn(redactToken(msg, token));
      },
      error: (msg: string) => {
        // eslint-disable-next-line no-console
        console.error(redactToken(msg, token));
      },
    },
    throttle: {
      onRateLimit: (retryAfter: number, options: ThrottleOptions, _octokit, retryCount: number) => {
        // eslint-disable-next-line no-console
        console.warn(
          redactToken(
            `pulse: primary rate limit on ${options.method ?? "?"} ${options.url ?? "?"}; retry-after=${retryAfter}s (retryCount=${retryCount})`,
            token
          )
        );
        return retryCount < 3;
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        options: ThrottleOptions,
        _octokit,
        retryCount: number
      ) => {
        // eslint-disable-next-line no-console
        console.warn(
          redactToken(
            `pulse: secondary rate limit on ${options.method ?? "?"} ${options.url ?? "?"}; retry-after=${retryAfter}s (retryCount=${retryCount})`,
            token
          )
        );
        return retryCount < 2;
      },
    },
    retry: { doNotRetry: [400, 401, 404, 422] },
  });
}

export type GitHubClient = Octokit;
