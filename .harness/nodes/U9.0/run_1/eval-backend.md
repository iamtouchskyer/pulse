# U9 Review — Backend

**Reviewer:** backend
**Scope:** packages/cli/src/ (commit 7bf3433)

## Summary

U8.0 lands the `diff` / `rules check` / `weekly` / `notify` commands plus the 5-rule engine. Code is clean, reasonably typed (no `any`, zod at every external boundary, atomic writes, ghost-user nulls handled), and the dry-run-by-default Slack posture is correctly enforced — MCP is stubbed out, `sendSlackMessage` never reaches a network call path in v1. Rule logic is mostly right, but there are a few behavioral gaps worth fixing before U9 closes: `weekly` anchors baseline lookup to `todayUtc()` instead of latest-snapshot-date, `new_referrer_domain` has no subdomain-aware matching, `active_fork` silently drops pagination at 10, and the weekly report only contains repos present in `latest` (doesn't ensure all 4 DEFAULT_REPOS appear). Test coverage is solid on the happy path but misses a handful of boundary cases.

## Findings

### 🔴 Critical (must fix before merge)

1. `packages/cli/src/index.ts:201` — `weekly` computes `baselineDate = subtractDaysUtc(today, 7)` from `todayUtc()` rather than from the latest snapshot date in `latest`. If cron is stale or the user runs `weekly` on a day with no fresh snapshot, `loadLatestSnapshots` returns e.g. 2026-04-18 data, but the baseline lookup targets `today - 7 = 2026-04-19 - 7 = 2026-04-12` — which may not align with the latest. Worse, `diff.ts:94 subtractDaysUtc(today,…)` has the same issue in `index.ts:111`. Result: for a 7-day spaced cron that misses a day, baseline silently becomes an empty map and all deltas collapse to 0 with no warning. Fix: derive baseline date from the max `snap.date` across `latest` (same helper used in `weekly.ts:71 pickLatestDate`) and subtract from that. For `diff`, do the same before calling `subtractDaysUtc`.

2. `packages/cli/src/index.ts:113-117` / `diff.ts:42-47` — the "no baseline" path only triggers when `latest.size === 0` OR the baseline *directory* is missing. If the baseline directory exists but contains a disjoint set of repos (e.g. you renamed a repo, or the daily job partially failed 7 days ago), `computeDiff` silently produces 0 rows and the CLI prints only the header — indistinguishable from "everything is zero delta". Fix: after `computeDiff`, if `rows.length === 0 && latest.size > 0`, print `no baseline` (or `no overlap`) instead of an empty table; alternatively emit one row per `latest` repo with an explicit "missing" marker.

### 🟡 Warn (should fix)

1. `packages/cli/src/rules/new_referrer_domain.ts:28` — `known.has(domain)` does exact-host comparison only. `mobile.twitter.com` will NOT match a `twitter.com` entry in `known_list`, so every mobile/amp/www subdomain triggers a "new referrer" alert on first appearance. This is almost certainly not the intended behavior for a curated known-list; it will produce noisy alerts in practice. Fix: also match if any suffix `domain` endswith `.${known}` (e.g. iterate known and test `domain === k || domain.endsWith('.' + k)`).

2. `packages/cli/src/rules/active_fork.ts:48` — `per_page: 10` with no pagination means forks beyond the 10 newest are ignored. `sort: "newest"` mitigates the time-window filter (you'd only care about forks in the last 7 days anyway), but if a repo gets >10 forks in a single burst, the 11th-Nth are silently dropped. Fix: either document this as intentional (v1 cap) with a comment citing the rationale, or page until `created_at < now - 7d` and then stop.

3. `packages/cli/src/weekly.ts:47-59` — `buildWeeklyReport` only emits a `WeeklyRepoEntry` for repos that exist in the `latest` map. Spec says "all 4 repos present even if some missing". If snapshot for `repo_X` failed that day, the weekly report shows 3 rows and silently omits the 4th. Fix: pass `DEFAULT_REPOS` (or rules.yaml watchlist-of-monitored-repos) through `BuildWeeklyInput` and emit a placeholder entry (`stars_delta: 0`, marker in message) when absent from `latest`.

4. `packages/cli/src/rules/star_velocity_spike.ts:85` — `meanStd` uses **population** variance (divides by N), not sample variance (divides by N-1). With only 3 prior samples this materially under-estimates σ and makes the 3σ threshold too easy to trip. Fix: use `(values.length - 1)` as denominator when `length > 1` (Bessel's correction); fall back to 0 when length ≤ 1.

5. `packages/cli/src/index.ts:169-173` — `rules check` catches `ZodError` specifically for the "invalid rules.yaml" message, but a YAML *syntax* error (malformed indentation, unclosed quote) throws from `yaml.parse` as a `YAMLParseError`, not `ZodError`. It will fall through to the generic catch at :174 and print `pulse rules check failed: <yaml parse message>` with exit 1 — functionally correct, but the user-facing classification says "failed" instead of "invalid rules.yaml" and `commands.test.ts:67` only covers the zod-structure failure, not the YAML-syntax failure. Fix: catch `YAMLParseError` (from `yaml` package) in the same branch and render "invalid rules.yaml" uniformly; add a test case with unparseable YAML.

6. `packages/cli/src/rules-config.ts:40-50` — `loadWatchlistOrEmpty` rethrows any non-ENOENT error (e.g. a malformed watchlist that fails `WatchlistSchema.parse` or a permission error). This bubbles out of `rules check` / `weekly` / `notify` with exit 1 and message `pulse … failed: …`. A broken watchlist shouldn't brick the whole pipeline — the whole point of "or empty" is tolerance. Fix: log a warning and return `[]` on any parse error; only rethrow on unexpected IO error.

7. `packages/cli/src/index.ts:226` — `weekly` calls `sendSlackMessage` unconditionally in every run. In dry-run with `notify_channel: null` this is a no-op (slack.ts:26 early-returns), but it means the *only* thing that prevents the CLI from printing a Slack payload by default is `notify_channel === null` in `rules.yaml`. If a user sets `notify_channel` and runs `pulse weekly` without `--send`, they get the Slack JSON on stdout mixed with the report path line at :224 — which is the documented behavior, but nothing in `commands.test.ts` asserts that the payload is NOT printed when channel is null OR that it IS printed when channel is set without `--send`. Fix: add explicit assertions in commands.test.ts covering both paths, and consider separating report-path output (`:224`) from the payload JSON (`slack.ts:32`) to different streams (stdout vs stderr) to avoid downstream parsing confusion.

### 🔵 Info / Nice-to-have

1. `packages/cli/src/diff.ts:115-121` — `parseSince` is case-sensitive on the `d` suffix (`7D` is rejected) and accepts only integer days (no `1w`, `24h`). Comment or doc should state this; or relax to `/^(\d+)[dD]$/`.

2. `packages/cli/src/rules/star_velocity_spike.ts:52` — `need[1] as string` relies on the upstream loop having pushed 5 entries; the compiler could infer this with a `const [,weekAgo] = need` pattern. The `as string` cast is harmless but reads like a non-null assertion; consider re-expressing without it.

3. `packages/cli/src/rules/star_velocity_spike.ts:98` — `if (mean <= 0) return []` silently suppresses alerts when the 28-day history is all-zero or declining. Intentional for a "spike" rule but worth a comment noting the rationale (otherwise a future reader will "fix" it).

4. `packages/cli/src/rules/star_velocity_spike.ts:99-100` — when `std === 0` and `mean > 0`, any `current > mean` trips the alert regardless of σ multiplier. With only 3 prior samples, this is the degenerate "all three weeks identical" case — probably fine but should be called out or floored to some min-σ.

5. `packages/cli/src/weekly.ts:99-124` — markdown table uses `|` separators. `repo` comes from validated schema so no injection vector there, but `alert.message` is *not* rendered into the table (only into `summarizeAlerts` counts), so injection risk is low. Worth noting: if a future iteration adds alert messages to the table, GitHub repo names can't contain `|` but alert strings can. Escape on render.

6. `packages/cli/src/rules/active_fork.ts:64` — `Number.isNaN(createdMs)` is the only guard on `fork.created_at`. If GitHub ever returns an un-parseable timestamp zod has already validated it's a string; but `new Date("not-a-date").getTime() → NaN` is handled. OK.

7. `packages/cli/src/slack.ts:37-39` — `send=true` silently falls through to a `console.log("(stub) would send …")`. If a user wires `--send` expecting a real call, they get dry-run-like output with no non-zero exit. Consider printing to stderr with a clearer "MCP not wired; no-op" message, or returning an indicator that callers can surface.

8. `packages/cli/src/commands.test.ts:34` — spawns `bun <CLI.ts>` directly on source, no `cwd` on the first test (relies on parent cwd). Tests are effectively integration-level but tied to bun being on PATH. Consider also testing a compiled entry to catch tsc breakage.

9. `packages/cli/src/commands.test.ts` — no E2E for (a) `weekly --send` when channel is set, (b) `rules check` with `active_fork` + mocked token, (c) malformed YAML *syntax* (as opposed to malformed schema). These are all unit-tested or partially covered, but the E2E gap leaves real command-wiring regressions possible.

10. `packages/cli/src/rules.test.ts:45` — no boundary test for `uniques === threshold` (inclusive). Current code uses `r.uniques < threshold` → `continue`, so equal-to-threshold fires. A one-line assertion would pin this contract.

11. `packages/cli/__fixtures__/snapshots/` — only 2 repos present (`spike`, `steady`) but `DEFAULT_REPOS` has 4. Weekly's "all 4 repos present" contract can't be tested until fixtures reflect it.

12. `packages/cli/src/rules-config.ts:28-35` — `loadRulesFileOrNull` is exported but unused in index.ts (index always calls `loadRulesFile`). Either wire it in as a fallback-to-default path or drop it (YAGNI).

13. `packages/cli/src/rules/unanswered_issue.ts:15` — `snap.repo.split("/")` destructures into `[owner, repo]` without a length check. With a schema-validated `owner/repo` format this is safe, but an explicit guard or `as const` tuple destructure would make the intent clearer and prevent drift.

14. `packages/schema/src/rule.ts:44-48` — `RulesFileSchema` is not `.strict()`; unknown top-level fields (typos like `notify_channels`) pass silently. Non-blocking, but a strict variant would catch operator typos early.

15. `packages/cli/src/index.ts:155,198,254` — watchlist path is hard-coded to `${cwd}/watchlist.yaml` with no CLI flag. Tests work only because they spawn with `cwd: workDir`. A `--watchlist <path>` flag would be consistent with `--rules`.

## Verdict

ITERATE

Two real correctness bugs (baseline date anchoring, disjoint-repo silent zeros) and a handful of rule-semantics issues (subdomain matching, population-variance σ, missing-repo rows in weekly) should land before this is considered merged. No hard-red-line violations (no `any`, zod on all external responses, MCP stays stubbed), and the test scaffolding is in the right shape — just needs the extra boundary cases. Core architecture is sound.
