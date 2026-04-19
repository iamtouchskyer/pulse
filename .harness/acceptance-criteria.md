# Acceptance Criteria — Pulse v1

Pulse v1 — iamtouchskyer's passive OSS monitoring radar for 4 repos (opc, memex, logex, blog).
Principle: **silence is a feature** — no signal, no noise.

## Outcomes

- OUT-1: `bun run snapshot` (no args) produces 4 zod-valid JSON files at `data/snapshots/YYYY-MM-DD/{opc,memex,logex,blog}.json` in under 60 seconds and commits them atomically; `bun run snapshot -- --repo opc` produces only opc.json.
- OUT-2: `bun run diff --since 7d` prints a table with columns repo / stars_delta / forks_delta / views_delta and exit code 0; on missing baseline, prints "no baseline" instead of crashing.
- OUT-3: `bun run rules check` applies all 5 rules in rules.yaml; on hit, prints alerts with exit code 0; on no hit, prints nothing and exits 0; on malformed rules.yaml, exits non-zero with a zod parse error.
- OUT-4: `bun run weekly` generates `reports/YYYY-WNN.md`; default mode prints the Slack draft payload without calling Slack; `--send` invokes Slack MCP once; on missing channel, skips draft creation without erroring.
- OUT-5: GitHub Actions `snapshot.yml` runs on daily cron 06:17 UTC and on workflow_dispatch; a manual dispatch completes in under 5 minutes and pushes a new commit to main authored by `github-actions[bot]`.
- OUT-6: `bun run dev` serves the Astro dashboard showing 4 cards (one per repo) with stars/forks/open_issues from the latest snapshot; on empty data directory, shows an empty-state component instead of 4 blank cards.
- OUT-7: Dashboard deployed at a Vercel URL (target pulse.vercel.app) returning HTTP 200 over HTTPS with first contentful paint under 2 seconds measured by Lighthouse or curl timing.

## Verification

- OUT-1: `bun run snapshot` (no args) produces 4 zod-valid JSON files in under 60s and commits atomically; `--repo opc` variant produces only opc.json.
- OUT-2: `bun run diff --since 7d` prints stars/forks/views deltas table with exit 0; missing baseline prints "no baseline" without crashing.
- OUT-3: `bun run rules check` applies 5 rules; hits print alerts (exit 0); no hits print nothing (exit 0); malformed rules.yaml exits non-zero via zod.
- OUT-4: `bun run weekly` generates `reports/YYYY-WNN.md`; default prints Slack payload without sending; `--send` calls Slack MCP once; missing channel skips without erroring.
- OUT-5: `snapshot.yml` runs on cron 06:17 UTC + workflow_dispatch; manual dispatch completes <5min and pushes commit authored by `github-actions[bot]`.
- OUT-6: `bun run dev` shows 4 repo cards with stars/forks/open_issues from latest snapshot; empty data directory shows empty-state component instead of blank cards.
- OUT-7: Dashboard deployed at Vercel URL returns HTTP 200 over HTTPS with FCP <2s measured by Lighthouse or curl.

### Per-OUT verification

- OUT-1: run the command; assert `data/snapshots/$(date +%Y-%m-%d)/*.json` count=4 and each parses against Snapshot zod schema; `git log -1 --format=%s` matches snapshot commit pattern.
- OUT-2: run against fixture with known deltas, parse table with grep, assert expected rows; run against empty snapshot dir and assert "no baseline" in stdout.
- OUT-3: feed fixture designed to trigger each rule individually, assert each alert fires exactly once; feed fixture that triggers none, assert empty stdout + exit 0; feed malformed rules.yaml, assert exit non-zero.
- OUT-4: run default, grep printed payload for all 4 repo names; run `--send` with mocked Slack MCP, assert mock recorded 1 draft call.
- OUT-5: `gh workflow run snapshot.yml && gh run watch`; assert success and `gh api /repos/iamtouchskyer/pulse/commits/main --jq .author.login` equals `github-actions[bot]`.
- OUT-6: start dev server; Playwright waits for 4 `[data-testid="repo-card"]`, captures screenshot; also test against empty `data/snapshots/` and assert `[data-testid="empty-state"]` visible.
- OUT-7: `curl -I https://<prod>` returns 200; `curl -w "%{time_starttransfer}" -o /dev/null -s https://<prod>` reports <2.0s.

## Quality Constraints

- TypeScript strict mode; `any` forbidden (only `// @ts-expect-error` with justification).
- All GitHub API responses parsed through zod at the edge of the Octokit wrapper.
- New-code coverage >= 95% measured by vitest; no `test.skip`, `test.todo`, `xit`, `xdescribe` in committed code.
- Mock only at external boundaries (Octokit HTTP layer, fs, Slack MCP). Business logic (rules engine, diff, weekly renderer) must be tested against real inputs.
- Dashboard e2e tests run against a real Astro dev server via Playwright, not jsdom.
- axe-core scan of the dashboard reports zero critical or serious violations (build blocker).
- Pre-commit hooks (.husky/pre-commit + lint-staged running eslint + prettier + tsc --noEmit) must pass; commits with `--no-verify` are prohibited.
- Each implement unit produces exactly 1 atomic commit with message prefix `feat(scope):`, `fix(scope):`, or `chore(scope):`.
- UI changes require a Playwright screenshot artifact in the review handshake.
- GitHub token never written to logs, committed files, the frontend bundle, or the deployed site.
- GitHub Actions secret uses `PULSE_GH_TOKEN` with least-privilege read + contents:write only for commit-back.

## Out of Scope

- X / Twitter monitoring (v2 — requires login session).
- 小红书, 即刻, or any other non-public-API social platform (v2).
- Historical backfill before the first cron run; v1 starts accumulating data from day 1 only.
- Real-time webhooks or push notifications; polling every 24h is sufficient for v1.
- Aggregating across all 4 repos into portfolio-level metrics; v1 shows per-repo only.
- Authentication on the dashboard; v1 is public read-only.
- Editing watchlist.yaml from the dashboard UI; v1 requires git commit to change.

## Quality Baseline (polished)

- Dashboard supports dark and light theme via `prefers-color-scheme`.
- Layout is responsive: verified by Playwright screenshots at 375px and 1440px widths.
- Snapshot cards have explicit loading, error, and empty states (verified by fixtures).
- Favicon.ico served at `/favicon.ico` returning 200.
- Visible focus ring on all interactive elements (tab through the page in Playwright).
- `<title>` tag present, non-empty, and distinct per page.
- WCAG AA color contrast verified by axe-core.
