# U6 Review — Security

**Reviewer:** security
**Scope:** packages/cli/src/ (commit 352b8dc)

## Summary
No token-leak vector found on the happy or error paths I traced end-to-end: `loadToken` never echoes the value, error handlers print only `err.message` (never `err.stack`, never `process.env`, never the full Octokit request config), and the snapshot writer is constrained by the zod-validated `repo` regex `^[^/]+/[^/]+$` in `@pulse/schema`. The hard red line ("token NEVER logged / committed / in stack traces") holds. Remaining items are defense-in-depth around `~/.claude/.env` parsing safety, dotenv edge cases, and supply-chain pinning of the Octokit plugins.

## Findings

### 🔴 Critical (must fix before merge)
None.

### 🟡 Warn (should fix)
1. `packages/cli/src/token.ts:8-27` — `~/.claude/.env` is read with no symlink check, no `lstat`, and no permission check. If `~/.claude/.env` is a symlink (intentional or planted), `readFileSync` will silently follow it; if the file is world-readable (mode `0644` or worse), the token sits exposed on disk and we never warn the user. Fix: `lstatSync` first, refuse to follow symlinks, and warn (stderr) when `mode & 0o077` is non-zero — same pattern as `ssh` enforces on `~/.ssh/id_*`.
2. `packages/cli/src/token.ts:17` — Regex `^\s*GITHUB_TOKEN_PULSE\s*=\s*(.+?)\s*$` does not strip an `export ` prefix and does not strip trailing `# comment`. A user who writes `export GITHUB_TOKEN_PULSE=ghp_xxx` will fall through to `loadToken()` throwing — but more security-relevant, `GITHUB_TOKEN_PULSE=ghp_xxx # rotated 2026-04` will capture `ghp_xxx # rotated 2026-04` as the token, and that string then gets passed to Octokit which will fail auth and may surface (truncated) substrings of it in 401 messages. Fix: strip a leading `export\s+`, and strip trailing unquoted `#…` comments before the quote-unwrap step.
3. `packages/cli/src/index.ts:49-54` and `packages/cli/src/index.ts:69-74` — Top-level catch prints `err.message` directly. Today Octokit's `RequestError.message` does not include the `Authorization` header, but a future Octokit plugin (or the retry plugin's wrapped error) could include arbitrary request context. There is no explicit redaction layer between the caught error and `console.error`. Fix: add a single `redactToken(msg, token)` helper used by both catches that does `msg.replaceAll(token, "[REDACTED]")` (and a generic `/gh[ps]_[A-Za-z0-9]{20,}/g` sweep so we also scrub tokens we didn't load).
4. `packages/cli/src/github.ts:32-49` — `classifyError` returns `e.message ?? e.response?.data?.message`. The GitHub API itself can echo the request URL inside `response.data.message` for some error shapes, and Octokit's wrapped message format is `${HTTPError} - ${url} - ${requestId}`. URLs do not contain the token (it's in the header), but the same defense-in-depth redaction (above) should cover this path too. Fix: route the constructed `GitHubApiError.message` through the same `redactToken` filter.

### 🔵 Info / Nice-to-have
1. `packages/cli/package.json:11-14` — `@octokit/rest`, `@octokit/plugin-retry`, `@octokit/plugin-throttling`, `commander` are all caret-ranged. For a CLI that handles a long-lived PAT, consider exact pins + `npm audit signatures` / Renovate gate so a compromised minor release of an Octokit plugin can't ship a token-exfil payload silently.
2. `packages/cli/src/writer.ts:5-12` — `writeSnapshot` trusts `snap.repo` to have already been zod-validated upstream; the split-and-join produces `outDir/<date>/<repoName>.json`. The schema regex `^[^/]+/[^/]+$` does prevent `/` in either segment, so neither path traversal nor absolute-path injection is reachable today. Defense-in-depth: re-assert the regex (or call `path.relative(outDir, file).startsWith("..")` and throw) so the writer is not silently coupled to schema invariants enforced elsewhere.
3. `packages/cli/src/writer.ts:8-11` — `mkdirSync(..., { recursive: true })` and `writeFileSync` create files with the process umask (typically `0644`). Snapshots themselves don't contain the token, but consider `0600` on the snapshot files anyway, and `0700` on the date directory, so we're consistent with "secrets-adjacent data on disk = owner-only".
4. `packages/cli/src/token.ts:10-16` — `existsSync` followed by `readFileSync` is the textbook TOCTOU shape. The only attacker who could exploit it owns `~/.claude/.env` already, so the practical risk is nil; a single `try { readFileSync } catch (ENOENT) { return null }` removes the window and one syscall. Pure cleanup.
5. `packages/cli/src/github.ts:51-68` — `createClient` does not set `octokit.log` to a redacting logger. By default Octokit logs to `console.warn`/`console.error` on retry/throttle. The default messages are `Request quota exhausted for request METHOD URL` (no token), but if a future plugin or a verbose `DEBUG=octokit:*` env enables request logging, headers become reachable. Worth wiring `log: { debug: noop, info: noop, warn: redactedWarn, error: redactedError }` now.
6. `packages/cli/src/snapshot.ts:51-54` — `console.warn` for traffic fallback writes to stderr (good — keeps stdout clean for the path-printed-on-success contract in `index.ts:46`). Confirmed no token, no URL with secrets — only `repoSlug`. Noted as clean.
7. `packages/cli/src/index.ts:30-36` — `--dry-run` short-circuits before `loadToken()` is ever called. Good: a dry run on a machine without the token still works and never touches the env-file parser. Noted as clean.

## Verdict
PASS

The hard red line on token leakage holds in every code path I traced (token never logged, never written to a snapshot file, never embedded in URLs, never reachable via stack traces because only `err.message` is printed and `process.exit` runs immediately after). The four 🟡 items are defense-in-depth — they should land before this CLI is run on a machine where `~/.claude/.env` could be world-readable or symlinked, but none of them block merge of U5.0 as a unit.
