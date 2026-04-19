import { readFileSync, existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NOT_FOUND_MESSAGE =
  "GitHub token not found (expected GITHUB_TOKEN_PULSE in env or ~/.claude/.env)";

/**
 * Strip a trailing unquoted `# comment` from a .env-style value. Called only
 * after the value has been determined to be unquoted.
 */
function stripTrailingComment(value: string): string {
  const idx = value.indexOf("#");
  if (idx === -1) return value;
  return value.slice(0, idx).trimEnd();
}

function readFromClaudeEnv(): string | null {
  const path = join(homedir(), ".claude", ".env");
  if (!existsSync(path)) return null;

  // Symlink & permission defense-in-depth (U6 security W1).
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    // eslint-disable-next-line no-console
    console.warn(`pulse: refusing to follow symlink at ${path}`);
    return null;
  }
  // eslint-disable-next-line no-bitwise
  if ((st.mode & 0o077) !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `pulse: ${path} is accessible by group/other (mode=${(st.mode & 0o777).toString(8)}); consider 'chmod 600'`
    );
  }

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  // Allow optional leading `export ` shell-style prefix.
  const match = content.match(/^\s*(?:export\s+)?GITHUB_TOKEN_PULSE\s*=\s*(.+?)\s*$/m);
  if (!match || !match[1]) return null;
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = stripTrailingComment(value);
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
