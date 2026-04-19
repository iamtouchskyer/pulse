# U6 Review — Backend

**Reviewer:** backend
**Scope:** packages/cli/src/ (commit 352b8dc)

## Summary
The CLI shape, token loader, and dry-run path are solid, and the throttling/retry plugins are wired in. But the U5 hard red line "zod-parse all GitHub API responses at the wrapper boundary" is **not enforced** — every GitHub response is dropped through `as unknown as {...}` casts and only the assembled output is parsed. Combined with broken pagination on `open_prs`/`recent_issues`, a wrong-direction `recent_stargazers` slice, non-atomic file writes, and a `Promise.all` that lets any transient 5xx tank the entire snapshot, this needs ITERATE before merge.

## Findings

### 🔴 Critical (must fix before merge)

1. `packages/cli/src/snapshot.ts:156-184` — Zod parse boundary violated. `repoRes.data`, `pullsRes.data`, `issuesRes.data`, traffic responses, and stargazers are all `as unknown as {...}` casts; only the *assembled* `snap` is `SnapshotSchema.parse`d. A malformed/missing GitHub field produces silent `undefined` reads and only fails much later (or, for nullable fields, never fails). This is exactly the boundary the spec tells you to validate.
   **Fix:** Add per-endpoint zod schemas (`RepoResponseSchema`, `PullSummarySchema`, `IssueResponseSchema`, `TrafficViewsResponseSchema`, `TrafficClonesResponseSchema`, `ReferrerResponseSchema`, `PathResponseSchema`, `StargazerResponseSchema`) inside `github.ts`, parse `res.data` immediately after each `client.request(...)`, and have `fetchSnapshot` consume already-validated values. Drop every `as unknown as` in this file.

2. `packages/cli/src/snapshot.ts:84-90,164` — `open_prs` is computed from a single page (`per_page: 100`) of `/pulls?state=open` with no pagination. For any repo with >100 open PRs the count is silently capped at 100, and `open_issues = max(0, open_issues_count - open_prs)` then becomes wrong. The `open_issues_count` field on the repo object already includes PRs, so capped subtraction yields inflated `open_issues`.
   **Fix:** Either use the Search API count (`GET /search/issues?q=repo:X+is:pr+is:open`) or paginate with `octokit.paginate` until exhausted. For Pulse v1 with small repos this is unlikely to hit, but it's a silent-truncation correctness bug — flag with a warning at minimum, ideally compute correctly.

3. `packages/cli/src/snapshot.ts:184` — `recent_stargazers` is wrong direction. `GET /stargazers` defaults to oldest-first; with `per_page: 30` you receive the 30 *earliest* stargazers, then `.slice(-30)` returns the same 30 oldest. The field is named "recent" but contains "ancient". The Star JSON media type sorts ascending too.
   **Fix:** Page to the last page (`per_page: 100, page: <last>` derived from `Link` header) and take the tail, or use the `sort=desc` option if available (the stargazers endpoint does not support sort — must paginate to the last page). Document the limit and validate against `recent_stargazers.max(30)` in schema.

4. `packages/cli/src/snapshot.ts:148-154` — `Promise.all` over 8 endpoints means a single transient 500 on any non-traffic endpoint (repo/pulls/issues/stargazers) tanks the entire snapshot for that repo for the day. Traffic endpoints are wrapped in `fetchTrafficSafe` but the four core endpoints are not. The retry plugin will retry network/5xx some bounded number of times, but once exhausted the whole day's data is lost.
   **Fix:** Use `Promise.allSettled` and degrade per-endpoint with classification (e.g. recent_issues → `[]` on 5xx with warn; stargazers → `[]` with warn; repo metadata → still hard-fail since it's the spine). Or: retry the snapshot run as a whole at a higher level, but that should be explicit.

5. `packages/cli/src/writer.ts:11` — Non-atomic write. `writeFileSync(file, JSON.stringify(...))` directly writes to the destination. A crash, OOM, or signal mid-write leaves a half-written/corrupt JSON at the canonical path that downstream `pulse diff` will then `JSON.parse` and choke on.
   **Fix:** Write to `${file}.tmp` then `fs.renameSync(tmp, file)`. POSIX rename is atomic on the same filesystem.

### 🟡 Warn (should fix)

1. `packages/cli/src/github.ts:58-65` — Throttle handlers retry only once (`retryCount < 1`). For a daily passive radar this is needlessly aggressive — primary rate limit retry-after can be tens of seconds and a single retry burns the only chance. Also: `retryAfter` and `options` parameters are unused; no logging of which endpoint hit the limit.
   **Fix:** Bump to `retryCount < 3` for primary rate limit (Octokit recommends ≥2), and `retryCount < 2` for secondary. Log `console.warn` with `options.method options.url` and `retryAfter` so operators see which endpoint is throttled.

2. `packages/cli/src/github.ts:38-44` — Secondary rate limit detection is incomplete. Secondary/abuse rate limits return 403 with a `retry-after` header but `x-ratelimit-remaining` is often non-zero; current logic classifies these as `forbidden`, not `rate_limit`.
   **Fix:** Also treat `status === 403 && response.headers["retry-after"]` as `rate_limit`. Or check `response.data.message` for "secondary rate limit" / "abuse" substrings.

3. `packages/cli/src/snapshot.ts:66` — `fetchTrafficSafe` swallows both `forbidden` AND `not_found` as "warn + zeros". 404 on a known repo means deleted/renamed/private — a real failure that should bubble, not silently zero out traffic.
   **Fix:** Only swallow `forbidden`. Let `not_found` rethrow (and let it be classified at the `Promise.all` boundary).

4. `packages/cli/src/snapshot.ts:91-98,167-169` — `recent_issues` is fetched with `per_page: 30` then PR-filtered client-side. If the first 30 issue-or-PR records contain N PRs you only get `30 - N` true issues even when more exist. Silent under-reporting.
   **Fix:** Use `/issues` with `pulls=false` is not a valid filter — instead either over-fetch (e.g. `per_page: 60` and trim to 30 after filter) or query `/search/issues?q=repo:X+is:issue+is:open+sort:created-desc&per_page=30` which guarantees 30 issues.

5. `packages/cli/src/snapshot.ts:186-189` — `watchers` fallback logic is backwards. GitHub's `watchers_count` field is actually a duplicate of `stargazers_count` (long-standing API quirk), not the watcher count. `subscribers_count` IS the watcher count. The fallback to `watchers_count` will produce wrong data (= stars) any time `subscribers_count` is missing.
   **Fix:** Drop the fallback; require `subscribers_count` (your zod schema for the repo response should mark it required), and let parse fail loudly if absent.

6. `packages/cli/src/snapshot.ts:107,119,129,139` — Triple-cast fallbacks like `{ data: { count: 0, uniques: 0 } as TrafficViewsRaw } as { data: TrafficViewsRaw }` defeat type checking and indicate the type model is wrong.
   **Fix:** Define a proper response type once, build the fallback as that type with no casts, or use zod's `.parse({})` with defaults.

7. `packages/cli/src/writer.test.ts:29-36` — Test name claims "throws on invalid repo" but the assertion is `expect(existsSync(path)).toBe(true)` — the test asserts the *opposite* of its name and doesn't actually exercise the throw branch in `writer.ts:7`. The throw path (`repoName` undefined when `snap.repo` has no `/`) is uncovered.
   **Fix:** Rewrite test to use a snapshot whose `repo` lacks a `/` (you'd need to bypass the schema or hand-craft the object), and assert `expect(() => writeSnapshot(broken, dir)).toThrow(/Invalid repo/)`. Currently this is a fake-green test.

8. `packages/cli/src/index.ts:30-36,49-54` — `--dry-run` calls `fixtureSnapshot` which embeds `new Date().toISOString()` into `captured_at`. Non-deterministic dry-run output makes the dry-run useless for fixtures/diffing in CI.
   **Fix:** Accept an optional `captured_at` in `fixtureSnapshot(repoSlug, today, capturedAt?)` and pass `${today}T00:00:00.000Z` for dry-run. Or freeze to `today + "T00:00:00Z"` always in fixture mode.

9. `packages/cli/src/index.ts:42-47` — Loop is sequential `for await`, and any single repo failure (`fetchSnapshot` throws) aborts the rest of the repos for the day via the outer try/catch. With 4 repos, one transient failure = 0 snapshots written.
   **Fix:** Wrap each iteration in its own try/catch, log the failure, continue to next repo, and exit non-zero only if *all* repos failed (or some other policy you pick — but document it).

### 🔵 Info / Nice-to-have

1. `packages/cli/src/github.ts:51` — `retry` plugin is loaded but no `request.retries` / `request.retryAfter` is configured; defaults apply silently. Make explicit so future readers know what they're getting (`retry: { doNotRetry: [400, 401, 404, 422] }`).

2. `packages/cli/src/snapshot.ts:251` — `export type { RepoData, PullData }` re-exports unused types. Dead code; trim.

3. `packages/cli/src/snapshot.ts:223-229` — `todayUtc` is correct (uses `getUTC*`), but no test pins a fake `Date.now()` to verify boundary behavior at 23:59:59.999 UTC. Add a `vi.useFakeTimers` test for completeness if you want the 95% coverage to be meaningful.

4. `packages/cli/src/index.ts:25` — `SnapshotOpts.dryRun` relies on commander's auto-camelCase conversion of `--dry-run`. Fine, but worth a comment so a future maintainer doesn't rename the option flag and silently break the field.

5. `packages/cli/src/repos.ts:1-6` — `as const` is good; but no validation in `expandRepo` that the input contains no whitespace or shell metacharacters. Low risk because token never reaches a shell, but `--repo "../../etc"` passes through. Consider a regex guard.

6. `packages/cli/src/token.ts:17` — Regex `/^\s*GITHUB_TOKEN_PULSE\s*=\s*(.+?)\s*$/m` correctly handles whitespace; quote-stripping branch handles only matched pairs. Fine, but doesn't strip surrounding `export ` prefix common in shell-style `.env` files.

7. `packages/cli/src/cli.test.ts:6-34` — E2E shells out to `bun` which is the right boundary, but tests don't capture stderr or assert exit code semantics for failure paths (e.g. invalid repo, network down with no token). Add a negative test.

8. Tests correctly mock at the `client.request` boundary (the Octokit HTTP layer) — no business-logic mocks. ✅ This is the right pattern.

9. `packages/cli/package.json` — No `vitest` in `devDependencies` but `*.test.ts` files import from `vitest`. Presumably hoisted from workspace root; verify it's pinned at root and not just float.

## Verdict
ITERATE

Critical issues 1 (zod boundary), 3 (recent_stargazers wrong direction), and 5 (atomic write) are blockers for the U5 spec. Issues 2 and 4 are silent-correctness bugs that will rot data over time. Fix the criticals + at least warn items 1, 3, 5, 7 before merge.
