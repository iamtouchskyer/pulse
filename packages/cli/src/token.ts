import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NOT_FOUND_MESSAGE =
  "GitHub token not found (expected GITHUB_TOKEN_PULSE in env or ~/.claude/.env)";

function readFromClaudeEnv(): string | null {
  const path = join(homedir(), ".claude", ".env");
  if (!existsSync(path)) return null;
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const match = content.match(/^\s*GITHUB_TOKEN_PULSE\s*=\s*(.+?)\s*$/m);
  if (!match || !match[1]) return null;
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value || null;
}

export function loadTokenOrNull(): string | null {
  const fromEnv = process.env.GITHUB_TOKEN_PULSE ?? process.env.GITHUB_TOKEN;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return readFromClaudeEnv();
}

export function loadToken(): string {
  const t = loadTokenOrNull();
  if (!t) throw new Error(NOT_FOUND_MESSAGE);
  return t;
}

export const TOKEN_NOT_FOUND_MESSAGE = NOT_FOUND_MESSAGE;
