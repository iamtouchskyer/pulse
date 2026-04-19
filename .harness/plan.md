# Pulse v1 — Build Plan

Target: iamtouchskyer/pulse passive OSS monitoring radar for 4 repos (opc, memex, logex, blog).
Principle: silence is a feature.

## External Validators (detected)

- bun 1.3.10, node 25.5.0
- GitHub Actions (activated in U11)
- husky + lint-staged (set up in U1)
- vitest (U1), Playwright (U12/U15), axe-core (U15)

## Project Context (forwarded to every tick)

- `~/.claude/.env` contains `GITHUB_TOKEN_PULSE` — read-only, never log, never commit.
- `gh` logged in as iamtouchskyer; `vercel` scope = dreamworks.
- Slack MCP available via OPC; v1 default is dry-run.
- Monorepo: bun workspaces under `packages/{schema,cli,web}`.
- TypeScript strict; no `any` (only `// @ts-expect-error` with reason).
- All GitHub API responses zod-parsed at the Octokit wrapper boundary.
- Atomic commits with `feat(scope): ...` prefix; `--no-verify` forbidden.
- UI changes require Playwright screenshot artifact in review handshake.

## Snapshot JSON Shape (frozen)

Fields: repo, date, captured_at, stars, forks, watchers, open_issues, open_prs, traffic{views_14d, unique_visitors_14d, clones_14d}, top_referrers[], top_paths[], recent_issues[], recent_stargazers[].

## Rules (rules.yaml)

1. new_referrer_domain — 7d new referrer not in known_list and uniques >= 20
2. unanswered_issue — open issue age > 48h and comments == 0
3. star_velocity_spike — 7d delta > 3σ of 28d weekly avg
4. active_fork — new fork with forker ahead_by > 0
5. watchlist_signal — watchlist.yaml user acts on repo (v1 noop legal)

known_list: [github.com, google.com, t.co, bing.com, duckduckgo.com, news.ycombinator.com, reddit.com]

## Units

- U1.0: chore — monorepo scaffold (bun workspaces, tsconfig strict, eslint, prettier, husky, lint-staged, vitest, root package.json) + set `gh secret set PULSE_GH_TOKEN` from `~/.claude/.env` without echoing token.
  - verify: `bun install && bun run lint && bun test` green; `gh secret list` contains PULSE_GH_TOKEN.
  - eval: workspaces resolve; tsconfig.strict=true; husky blocks `--no-verify`; no token in any tracked file.

- U2.0: implement — packages/schema zod schemas (Snapshot, Rule, Alert, WeeklyReport) matching the frozen JSON shape exactly.
  - verify: `bun test --filter schema` green; coverage >= 95%.
  - eval: fields align with GitHub API names; missing-field and wrong-type cases have tests; no over-engineering.

- U3.0: review — independent review of U2 schemas by >=2 subagents (backend + architect angles).
  - verify: two eval-{role}.md files with 🔴/🟡/🔵 severity and file:line refs.
  - eval: naming alignment with GitHub API; extensibility to v2; no over-engineering.

- U4.0: fix — address every 🔴 and 🟡 finding from U3.
  - verify: tests still green; lint green; each cited finding closed in commit body.
  - eval: no new code smells introduced; test coverage maintained >= 95%.

- U5.0: implement — packages/cli base (Octokit wrapper + `snapshot` command) reading `GITHUB_TOKEN_PULSE` from `~/.claude/.env` (fallback `GITHUB_TOKEN`); commander-based `snapshot --repo <name> --dry-run`; fetches REST data, zod-parses, writes to `data/snapshots/YYYY-MM-DD/{repo}.json`.
  - verify: `bun run snapshot -- --repo opc --dry-run` prints valid JSON to stdout; `bun test --filter cli` green.
  - eval: Octokit retry+rate-limit plugin used; 404/403/5xx classified; token never logged; Octokit mocked, business logic not.

- U6.0: review — independent review of U5 by security + backend subagents (>=2).
  - verify: two eval files with file:line refs.
  - eval: token handling, log scrubbing, error classification, retry strategy.

- U7.0: fix — address every 🔴 and 🟡 from U6.
  - verify: tests green; lint green; security findings explicitly closed in commit body.
  - eval: no regressions in existing snapshot command.

- U8.0: implement — packages/cli remaining commands: `diff --since Nd` prints delta table, `rules check` parses rules.yaml and runs 5 rule functions, `weekly` renders `reports/YYYY-WNN.md` and builds Slack payload (default dry-run, `--send` calls MCP), `notify` sends rule-hit alerts to channel from rules.yaml (no-op on missing channel).
  - verify: integration tests on fixture snapshots assert each rule hit/miss; `bun run diff --since 7d` fixture output matches expected table.
  - eval: rules.yaml malformed → zod error not crash; Slack MCP never called in default mode; weekly markdown readable.

- U9.0: review — independent review of U8 by backend + tester subagents (>=2).
  - verify: two eval files with file:line refs.
  - eval: rules engine correctness; fixture coverage; edge cases; Slack MCP default-safe.

- U10.0: fix — address every 🔴 and 🟡 from U9.
  - verify: tests green; lint green; all findings closed in commit body.
  - eval: no regressions.

- U11.0: chore — `.github/workflows/snapshot.yml`: daily cron 06:17 UTC + workflow_dispatch; uses `PULSE_GH_TOKEN` secret; runs `bun run snapshot`; commits back to main as `github-actions[bot]`.
  - verify: `gh workflow run snapshot.yml && gh run watch` succeeds; `data/snapshots/$(date +%Y-%m-%d)/` appears and is committed by bot.
  - eval: token permissions minimal (read + contents:write only); author is `github-actions[bot]`; failures surface loudly.

- U12.0: implement — packages/web Astro dashboard: index page with `loadSnapshots()` reading latest date dir and rendering 4 `[data-testid="repo-card"]` components (stars/forks/open_issues); `[data-testid="empty-state"]` on empty data; dark/light via prefers-color-scheme; favicon; `<title>`; visible focus ring.
  - verify: `bun run dev` serves; Playwright captures screenshot showing 4 cards; empty-dir test shows empty-state.
  - eval: empty state present; dark mode works; WCAG AA contrast; no token in bundle.

- U13.0: review — independent review of U12 by designer + a11y subagents (>=2).
  - verify: two eval files with file:line refs.
  - eval: visual hierarchy, card legibility, empty-state clarity, focus order, contrast, semantic markup.

- U14.0: fix — address every 🔴 and 🟡 from U13.
  - verify: Playwright screenshot re-captured; lint green.
  - eval: visual regressions absent.

- U15.0: test — dashboard e2e + a11y automation: Playwright config targeting real Astro dev server; tests for (a) 4 cards render, (b) empty-state, (c) keyboard nav, (d) responsive at 375px and 1440px; axe-core assertion zero critical/serious.
  - verify: `bun run test:e2e` green; axe zero critical/serious.
  - eval: screenshots captured as artifacts; keyboard nav + focus ring + alt text covered.

- U16.0: chore — Vercel deploy: `vercel link --scope dreamworks`, set Root Directory to `packages/web`, git push triggers first deploy, set prod domain pulse.vercel.app.
  - verify: `curl -I https://pulse.vercel.app` returns 200; TTFB <2s; build log has no warnings.
  - eval: no secret in bundle; domain resolves over HTTPS.

- U17.0: docs — README with mermaid architecture + add-a-repo flow + v2 roadmap; `.opc/runbooks/build-pulse-v1.md` checked into repo.
  - verify: manual smoke — add a 5th known public repo, run `bun run snapshot -- --repo <new>`, JSON produced.
  - eval: new contributor can run snapshot in <15 min following README.

- U18.0: accept — tick through OUT-1..OUT-7 in acceptance-criteria.md + the 10 original DoD items, attaching evidence.
  - verify: `bun run snapshot && bun run rules check && bun run weekly` end-to-end clean; all screenshots + curl checks captured.
  - eval: silence-is-a-feature upheld — 0 alerts case still produces a useful dashboard and weekly report.

## Runtime Parameters

- tick interval: 10 min
- expected total ticks: ~27 (18 units × 1.5 retry factor)
- wall-clock deadline: 24h
- reviews: parallel subagents (>=2); implements: serial
