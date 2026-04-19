# U3.0 Review — Architect

**Reviewer:** architect
**Scope:** packages/schema/src/ (commit ad47f3e)

## Summary

Schemas are tight, honest, v1-scoped — no over-abstraction, no speculative platform generics. The YAGNI line is drawn correctly: `Snapshot` is flat and GitHub-shaped, `Alert.data` is `z.record(z.unknown())` which already absorbs v2 platform-specific payloads without reshape. No critical architectural blockers. A handful of modeling smells (unbounded `sigma`, `Alert.rule` typed as free string, no schema version) are worth fixing before this is depended on by downstream units.

## Findings

### 🔴 Critical (must fix before merge)

None. v1 is frozen, and nothing in the zod model misrepresents or over-constrains the frozen JSON contract in a way that will block v2. `Alert.data: z.record(z.unknown())` already provides the escape hatch for non-GitHub platforms; `Snapshot` can gain an optional `platform` field later without breaking readers.

### 🟡 Warn (should fix)

1. **packages/schema/src/rule.ts:15** — `StarVelocitySpikeRule.sigma: z.number()` is unbounded and accepts negatives / NaN-adjacent values. Sigma is a standard-deviation multiplier; negative is nonsense and will silently produce inverted alerts. Fix: `z.number().positive()` (or `.nonnegative()` if "off by setting 0" is desired).
2. **packages/schema/src/alert.ts:4** — `rule: z.string()` disconnects `Alert.rule` from the `RuleSchema` discriminator literals. Nothing guarantees `alert.rule === "active_fork" | "unanswered_issue" | ...`. If rules engine emits a typo, it type-checks fine and corrupts weekly aggregation. Fix: export a `RuleTypeSchema = z.enum([...])` from rule.ts and reuse it here (v2-extensible: add enum variants alongside new rule types).
3. **packages/schema/src/snapshot.ts:33 / alert.ts:3 / weekly.ts:13** — no `schema_version` / `version` field anywhere. The moment v1.1 adds a non-additive field, stored snapshots and weekly reports become ambiguous to the reader. Silence-is-a-feature makes historical files the source of truth, so versioning is cheap insurance. Fix: add `schema_version: z.literal(1)` on the three top-level schemas (`SnapshotSchema`, `AlertSchema`, `WeeklyReportSchema`). Forward-compatible: v2 bumps to 2 or uses `z.union([z.literal(1), z.literal(2)])`.
4. **packages/schema/src/alert.ts:6** — `severity: z.enum(["info", "warn"])`. Spec only uses info/warn today, but `Alert` has no extension point for severity; if v2 wants `critical` for platform-takedown signals, every reader breaks. Fix: either accept this lock-in explicitly in a comment, or widen to `z.enum(["info", "warn", "critical"])` now (critical just goes unused in v1). Not a blocker; pick one with eyes open.

### 🔵 Info / Nice-to-have

1. **packages/schema/src/snapshot.ts:4-6** — `views_14d / unique_visitors_14d / clones_14d` leaks GitHub's hardcoded 14d traffic window into field names. This is honest/explicit and I'd keep it, but worth pulling the `14` out to a shared constant (`GITHUB_TRAFFIC_WINDOW_DAYS = 14`) so the "why this suffix" is documented in code, not folklore.
2. **packages/schema/src/snapshot.ts:33** — no `platform` discriminator on `Snapshot`. Correct call for v1 (YAGNI), but when v2 adds X/小红书/即刻, the clean move is an **optional** `platform: z.literal("github").default("github")` added now — zero cost to readers, lets v2 introduce `z.discriminatedUnion("platform", [GitHubSnapshot, XSnapshot])` without rewriting v1 fixtures. Flagging as Info because adding it later is also fine given `schema_version` (see Warn #3).
3. **packages/schema/src/weekly.ts:4-10** — `WeeklyRepoEntry` exposes `stars_delta / forks_delta / views_delta` but drops `unique_visitors_delta` and `clones_delta`. Asymmetric with `TrafficSchema`. Either intentional (views is the one KPI) — add a comment — or oversight.
4. **packages/schema/src/rule.ts:18-24** — `ActiveForkRule` and `WatchlistSignalRule` are parameter-less. Discriminated union still works, but these are effectively enum values wearing object costumes. Current shape is correct (keeps future params trivial to add), so keep as-is; just noting the taste call was made.
5. **packages/schema/src/index.ts:1-4** — barrel re-exports everything with no public/internal split. Fine at 5 schemas. If the package grows past ~15 exports, split into `./public` vs internal subpath exports; not now.
6. **Tests, all files** — tests verify parsing (happy / missing / wrong type), but don't document _intent_. Per the review angle: a schema test should encode _why_ a field exists. E.g. `rule.test.ts:11` asserts `sigma: 2.5` parses but doesn't assert `sigma: -1` is rejected (which is the actual design intent — see Warn #1). Same pattern in `snapshot.test.ts` (no assertion that `views_14d: -5` is rejected, though zod does reject it via `nonnegative`). Adding a handful of "reject negative" / "reject empty repo" cases converts the suite from "parses JSON" into "documents contract".
7. **packages/schema/src/alert.ts:5, weekly.ts:5, snapshot.ts:34** — `repo` regex `^[^/]+\/[^/]+$` is duplicated 3× across files. Extract to a shared `RepoSlugSchema` in snapshot.ts (or a new `common.ts`) and reuse. DRY, and when v2 needs to widen the regex for non-GitHub slugs it's one place.

## Verdict

**PASS** — merge-ready for v1 after addressing Warn #1 (`sigma` bound) and Warn #2 (`Alert.rule` as enum). Warn #3 (`schema_version`) and Warn #4 (severity widening) are judgment calls; flag them in the loop log if deferred so v2 picks them up first. All Info items are taste/polish and can land in a follow-up cleanup commit.
