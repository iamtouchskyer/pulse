# U3.0 Review — Backend

**Reviewer:** backend
**Scope:** packages/schema/src/ (commit ad47f3e)

## Summary

Schemas are structurally sound and the discriminated union resolves correctly, but several fields will break on real GitHub API responses. The biggest correctness risk is `RecentIssueSchema.author: z.string()` and `recent_stargazers: z.array(z.string())` — both will throw on ghost users (deleted accounts), which GitHub returns as `user: null` / missing `login`. Secondary issues: unbounded arrays, a signed `sigma`, and weak `iso_week` / issue-number constraints.

## Findings

### 🔴 Critical (must fix before merge)

1. `packages/schema/src/snapshot.ts:27` — `author: z.string()` will throw when GitHub returns a ghost user (`issue.user === null`, happens for deleted accounts). Fix: `author: z.string().nullable()` and have the Octokit wrapper coerce missing logins to `null`.
2. `packages/schema/src/snapshot.ts:47` — `recent_stargazers: z.array(z.string())` has the same ghost-user failure mode (the stargazers endpoint can return entries with `user: null` under `Accept: application/vnd.github.star+json`, and deleted login strings). Fix: `z.array(z.string().nullable())` or filter out nulls upstream before parse.

### 🟡 Warn (should fix)

1. `packages/schema/src/rule.ts:15` — `sigma: z.number()` accepts negatives and zero; a negative σ threshold is nonsensical and a 0 σ fires on every delta. Fix: `z.number().positive()` (or `nonnegative()` if zero is intentional).
2. `packages/schema/src/rule.ts:10` — `age_hours: z.number().nonnegative()` allows 0, which degenerates `unanswered_issue` into "every open issue with 0 comments". Fix: `.positive()` or enforce a sane minimum (e.g. `.min(1)`).
3. `packages/schema/src/snapshot.ts:44-46` — `top_referrers`, `top_paths`, `recent_issues`, `recent_stargazers` are unbounded. GitHub's traffic endpoints cap at 10, but the schema will happily accept megabyte payloads from a bad upstream/fixture. Fix: `.max(10)` on traffic arrays, `.max(30)` or similar on issues/stargazers per the snapshot's implied window.
4. `packages/schema/src/snapshot.ts:25` — `number: z.number().int().nonnegative()` allows 0, but GitHub issue/PR numbers start at 1. Fix: `.int().positive()`.
5. `packages/schema/src/weekly.ts:5` — `iso_week` regex `/^\d{4}-W\d{2}$/` accepts `2026-W00`, `2026-W54`, `2026-W99`. Fix: `/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/`.
6. `packages/schema/src/rule.test.ts:21` — "unknown type fails" only asserts `toThrow()`; it doesn't verify the error names the offending discriminator or lists the valid alternatives. Add an assertion on the parse error (e.g. `safeParse().error.issues[0].code === "invalid_union_discriminator"`) so regressions in the union shape surface loudly.
7. `packages/schema/src/snapshot.test.ts` — no test covers the ghost-user case for `author` or `recent_stargazers`. Add a test that feeds `author: null` and asserts current behavior, to lock in whatever fix is chosen for the 🔴 above.
8. `packages/schema/src/alert.ts:4` — `rule: z.string()` is untyped; the 5 rule `type` literals are already known. Fix: `rule: z.enum(["new_referrer_domain","unanswered_issue","star_velocity_spike","active_fork","watchlist_signal"])` so bad `rule` strings from the engine get caught at parse time.

### 🔵 Info / Nice-to-have

1. `packages/schema/src/rule.ts:18,22` — `active_fork` and `watchlist_signal` carry no thresholds. The plan mentions `forker ahead_by > 0` for active_fork; when that becomes configurable, extending the object (e.g. `min_ahead_by`) keeps the discriminated union happy.
2. `packages/schema/src/snapshot.ts:3-7` — field names `views_14d` / `unique_visitors_14d` / `clones_14d` diverge from Octokit's raw `count` / `uniques`. Fine as a derived/frozen shape, but worth a comment at the wrapper boundary so future contributors don't chase a missing `count`.
3. `packages/schema/src/alert.ts:8` — `data: z.record(z.unknown())` is intentionally loose; consider per-rule `data` schemas later (e.g. `NewReferrerDomainAlertData`) so Slack payload rendering stays type-safe.
4. `packages/schema/src/snapshot.ts:34` — `repo` regex `^[^/]+\/[^/]+$` allows spaces, dots leading, etc. GitHub's actual constraint is `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+`. Low priority since inputs are internal.
5. `packages/schema/src/weekly.ts:7-10` — deltas are plain `int()`; for `views_delta` a sanity bound (e.g. `.gte(-1_000_000).lte(1_000_000)`) would catch a corrupted baseline.
6. Consider exporting a single `parseSnapshot(raw: unknown): Snapshot` helper next to the schema so call sites don't sprinkle `SnapshotSchema.parse(...)` ad hoc.

## Verdict

ITERATE
