# U9 Review — Tester

**Reviewer:** tester
**Scope:** packages/cli/src/ (commit 7bf3433)

## Summary
U8.0's tests exercise the happy path for each of the 5 rules and the 4 CLI commands with real YAML + real fixtures and no inappropriate mocking of business logic. Fixtures are realistic (5 dated snapshots across 28 days with a plausible 0→5→10→15→100 star progression), and mocking stays at the external boundary (Octokit via a handcrafted client shim, Slack via a stub shim). However, boundary-condition coverage is thin across every rule (no exact-threshold test for any of the 5), several "null-user safety" assertions are decorative rather than actually exercising the null branch, the dry-run / default-mode assertion in the CLI weekly test is a comment rather than a check, and commands.test.ts shares mutable `workDir` state across tests with no teardown. Verdict: **ITERATE** — not a fail, but several gaps must be filled before merge.

## Findings

### 🔴 Critical (must fix before merge)

1. `packages/cli/src/commands.test.ts:103` — the comment `// notify_channel is null, so no payload printed.` is the ONLY check that weekly default-mode does not send to Slack. The test asserts `r.stdout` matches `/\.md/` (the report path) but never asserts that stdout does NOT contain a Slack JSON payload (which `sendSlackMessage` prints when `channel && !send`). This is exactly the "trust-me" pattern flagged in review focus #6. Fix: add `expect(r.stdout).not.toMatch(/"blocks"/)` or `expect(r.stdout).not.toMatch(/"channel":\s*"C/)` to explicitly prove no dry-run payload was emitted, and add a second case with a non-null `notify_channel` + no `--send` that asserts the payload WAS printed, to close the default-mode/send-mode dichotomy.

2. `packages/cli/src/rules.test.ts:108-111` — the test titled `"ignores null authors/stargazers safely"` passes watchlist `["not-here"]` against the spike fixture. Because no watchlist entry matches anything, the loop returns `[]` trivially — the `issue.author === null` / `user === null` branches in `watchlist_signal.ts:20,24` are never the reason for the 0-length result. No fixture row currently has `author: null` (spike's three issues are alice/bob/watcheduser). This is a fake-green per review focus #11 and #14. Fix: either (a) add a fixture snapshot whose `recent_issues` contains `{..., "author": null, ...}` and watchlist includes the matching stargazer, and assert length is 1 (star only, issue skipped); or (b) call `runWatchlistSignal` with a hand-built Snapshot containing a null-author row and assert no throw + correct count. The existing `null` stargazer in `recent_stargazers: ["other", "watcheduser", null]` is nice but the current test does not exercise it — change the test's watchlist to `["other"]` so the stargazer path actually iterates past the null.

3. `packages/cli/src/rules.test.ts` / `rules/*.ts` — **no boundary-threshold test for any of the 5 rules** (review focus #1). Concretely missing:
   - `new_referrer_domain`: `uniquesThreshold: 20` with a fixture row at `uniques: 20` (code uses `< threshold` → should skip; untested) and `uniques: 21` (should fire; untested).
   - `unanswered_issue`: `age_hours: 48` with an issue exactly 48h old (code uses `<= ageHours` → should skip) and 48.01h (should fire).
   - `star_velocity_spike`: `current == mean + sigma*std` exact boundary (code uses `<= threshold` → skip), and the `mean <= 0` early return at `star_velocity_spike.ts:98` is entirely untested.
   - `active_fork`: `ahead_by: 0` case (code filters with `> 0`, so no alert) is not tested — the existing tests cover `ahead_by: 4` and API-failure only.
   - Fix: add one boundary case per rule. These are one-line fixture edits + one assertion each; gap is material because off-by-one bugs are the single most common regression path here.

4. `packages/cli/src/weekly.test.ts:104-119` — the test is named `"writeWeeklyReport writes atomically"` but never actually verifies atomicity. It calls `writeWeeklyReport`, reads the result, writes it back over itself (`writeFileSync(file, readFileSync(file, "utf8"), "utf8")`), and asserts the filename ends with `.md`. The read/rewrite line is tautological (of course the file exists — `writeFileSync` just wrote it). There is no check that `.tmp` is gone, no check that a failed rename leaves the destination untouched, no check that content equals `md`. Fix: replace the self-rewrite with `expect(readFileSync(file, "utf8")).toBe(md)` and `expect(existsSync(file + ".tmp")).toBe(false)`. If a real atomicity test (simulated crash mid-write) is out of scope, rename the test to `"writeWeeklyReport writes file with expected contents"` to stop over-claiming.

### 🟡 Warn (should fix)

1. `packages/cli/src/commands.test.ts:12-30` — `beforeAll` creates a single `workDir` shared across all 6 tests. The `rules check fails ...` test (line 67) writes `bad-rules.yaml` into it; the `notify with channel prints payload` test writes `rules-chan.yaml` into it; the `weekly` test `rmSync`s `reports` subdir. There is no `afterAll` teardown, so `/tmp/pulse-e2e-*` leaks on disk every run, and no guarantee tests are independently runnable (review focus #12). Fix: move `mkdtempSync` into `beforeEach` (cheap — fixture copy is tiny) OR keep `beforeAll` but add `afterAll(() => rmSync(workDir, { recursive: true, force: true }))`. Also verify each `it` block would pass in isolation by giving it its own scratch dir.

2. `packages/cli/src/commands.test.ts:32-142` — `spawnSync("bun", [CLI, ...])` runs the TypeScript source directly. This is fine under bun but: (a) no `env` is passed, so tests inherit the developer's real `GITHUB_TOKEN` / `PULSE_*` env — `pulse rules check` calls `loadTokenOrNull()` and `createClient(token)`, meaning a developer running tests locally with a real token will hit live GitHub from `runActiveFork` if the fixture triggers it (current fixture luckily has no `active_fork` rule in this test, but the risk remains). (b) no slow-test marker or timeout; bun cold-start + 4 spawn tests in sequence. Fix: pass `env: { ...process.env, GITHUB_TOKEN: "", PATH: process.env.PATH }` to every `spawnSync` call, and add `{ timeout: 15_000 }` to the `describe` block.

3. `packages/cli/src/weekly.test.ts:19-26` — ISO week edge cases are partially covered (2026-04-19→W16, 2026-01-01→W01, 2025-12-29→W01) but miss: (i) a year with W53 (2020-12-31 → 2020-W53; 2026-12-31 → 2026-W53), (ii) the Dec-31-maps-to-next-year case (2024-12-30 → 2025-W01). Fix: add both cases — the algorithm is subtle enough that a regression would pass the current 3 tests.

4. `packages/cli/src/rules-config.test.ts:32-47` — only one malformed-YAML case (missing discriminator). Review focus #5 asked for three: missing discriminator ✅, extra fields, nonexistent file via `loadRulesFile` (not `OrNull`). The latter two are not tested. The `strict`/`passthrough`/`strip` behaviour on unknown keys is schema-defined and deserves an explicit assertion. Fix: add `it("accepts / rejects extra fields in rules.yaml")` matching whichever policy `RulesFileSchema` implements, and `it("loadRulesFile throws ENOENT when file missing")`.

5. `packages/cli/src/weekly.test.ts:122-145` — `sendSlackMessage` tests spy on `console.log` to detect behaviour. That is fine for the stub path, but `"send=true goes through the stub path"` asserts `expect(log).toHaveBeenCalled()` — which is true solely because the stub itself calls `console.log("pulse: (stub) would send to ...")`. If the stub is replaced with a real MCP call later, this test will silently flip to asserting nothing useful (the real call may or may not log). Fix: assert on the logged content, e.g. `expect(arg).toMatch(/stub|would send|slack_send_message/i)`, or mark this test as explicitly testing the stub by renaming it.

6. `packages/cli/src/rules.test.ts:77-81` — `"returns [] for insufficient history"` uses `steady()` which has no historical fixtures. That works, but the same branch is already covered at line 90-92 via `computeWeeklyDeltas(FIXTURES, "unknown/repo", ...)`. The more interesting uncovered case is "28d of history exists but one intermediate day is missing" — that tests the `if (!dates.has(d)) return null` inner check at `star_velocity_spike.ts:31`. Fix: add a third variant using a scratch snapshots dir with 4 weeks present but the D-14 day deleted, asserting `null`.

7. `packages/cli/src/rules.test.ts:173-183` — `"degrades on forks API failure"` does not await-check the warn spy contents. The test only asserts `alerts` is empty and that warn was mocked (but never checks warn was actually CALLED). A bug that swallows the error silently (no warn) would pass this test. Fix: `expect(warn).toHaveBeenCalledWith(expect.stringContaining("active_fork forks list failed"))`.

8. `packages/cli/src/rules-config.test.ts:6` — `loadWatchlistOrEmpty` is tested for happy path + ENOENT + empty file, but not for malformed content (non-array, e.g. `{ alice: true }`). The Zod `WatchlistSchema` would throw — untested. Fix: add one malformed-watchlist test asserting a thrown error (or the documented swallow behaviour, whichever is intended).

### 🔵 Info / Nice-to-have

1. `packages/cli/__fixtures__/snapshots/2026-03-22/spike.json:6` — the baseline-most snapshot has `stars: 0, forks: 0, views: 0, top_referrers: []`. That makes the 28d mean easy to hand-verify but slightly unrealistic (every real repo has ≥1 view by day 1). Nice-to-have: bump to small nonzero values so `mean <= 0` short-circuit doesn't accidentally mask future regressions in the velocity rule.

2. `packages/cli/src/commands.test.ts:42-65` — asserts `lines.length >= 4` but does not pin the exact composition of alerts. If a new rule accidentally starts firing from this fixture, the test still passes. Nice-to-have: `expect(rulesFired.sort()).toEqual(["new_referrer_domain", "unanswered_issue", "watchlist_signal", "watchlist_signal"])`.

3. `packages/cli/src/weekly.test.ts:52-70` — excellent: asserts full `WeeklyRepoEntry` object shape including `alerts_count`. Keep.

4. No test covers `weekly` + `notify` with `--send` flag (actual stub invocation path through CLI). Not a hard red line since `slack.test` covers the stub directly, but CLI wiring is verified only in default mode. Nice-to-have: add a `--send` smoke test that greps stdout for `(stub) would send`.

5. `packages/cli/src/rules/engine.ts:24` — the `knownList` override fallback (`rulesFile.known_list.length > 0 ? rulesFile.known_list : DEFAULT_KNOWN_DOMAINS`) is not unit-tested. If a user passes `known_list: []`, they would expect the default list to kick in. Add an engine-level test with empty `known_list` and verify `github.com` is still filtered.

6. Future schema-version compatibility (review focus #13): every fixture uses `schema_version: 1`. No fixture exercises a v2 snapshot; SnapshotSchema's behaviour on unknown version is therefore untested. Nice-to-have given v2 doesn't exist yet, but worth a TODO comment.

7. `packages/cli/src/diff.test.ts:71-74` — good coverage for missing-snapshots-dir. Add the symmetric case: `computeDiff` with partial overlap (latest has repo A+B, baseline has only A) — should emit one row for A, none for B. The fixture already supports this (2026-04-12 has both, 2026-03-22 has only spike) — one line to test.

8. `packages/cli/src/index.ts:263` — `notify` has a `alerts.length === 0` short-circuit that is unreachable through the existing command tests (every test fixture has at least one alert). Nice-to-have: add a test with a rules.yaml that uses only rules which don't fire on the fixture (e.g. `new_referrer_domain: uniques_threshold: 9999`) and assert `r.stdout === ""`.

## Verdict
ITERATE
