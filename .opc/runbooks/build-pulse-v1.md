# Runbook — Build Pulse v1 in ~4 hours

End-to-end rebuild playbook. Another engineer should be able to follow this
top-to-bottom and end up with the same shipping system:
snapshot CLI + rules engine + weekly digest + Astro dashboard on Vercel,
driven by a daily GitHub Actions cron.

Mirrors the 18 units in [`.harness/plan.md`](../../.harness/plan.md).

---

## Preflight

- `bun` 1.3.10+, `node` 25+, `gh` CLI logged in as the repo owner.
- `~/.claude/.env` contains `GITHUB_TOKEN_PULSE` (scopes: `public_repo`, `repo:traffic`). Fallback: `GITHUB_TOKEN`.
- `vercel` CLI logged in; target scope `dreamworks` (or equivalent).
- Slack MCP optional — v1 defaults to dry-run; `--send` is the only code path that invokes it.

Sanity check:

```bash
bun --version            # 1.3.10+
node --version           # v25+
gh auth status
vercel whoami
grep -q GITHUB_TOKEN_PULSE ~/.claude/.env && echo "token OK" || echo "MISSING"
```

---

## Step 0 — Clone and bootstrap (~10 min)

```bash
gh repo create iamtouchskyer/pulse --public --clone
cd pulse

# Push the token to the Actions secret store *without* echoing it to stdout
gh secret set PULSE_GH_TOKEN --body "$(grep '^GITHUB_TOKEN_PULSE=' ~/.claude/.env | cut -d= -f2-)"
gh secret list | grep PULSE_GH_TOKEN
```

Root `package.json` skeleton:

```json
{
  "name": "pulse",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.10",
  "workspaces": ["packages/*"],
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx,.astro",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "snapshot": "bun packages/cli/src/index.ts snapshot",
    "diff":     "bun packages/cli/src/index.ts diff",
    "rules":    "bun packages/cli/src/index.ts rules",
    "weekly":   "bun packages/cli/src/index.ts weekly",
    "notify":   "bun packages/cli/src/index.ts notify",
    "dev":      "bun --filter @pulse/web run dev",
    "build:web":"bun --filter @pulse/web run build",
    "test:e2e": "bun --filter @pulse/web run test:e2e",
    "prepare":  "husky"
  }
}
```

Scaffold ESLint (`.eslintrc.cjs`), Prettier (`.prettierrc.json`),
`tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`.
Husky pre-commit runs `lint-staged` (eslint + prettier + `tsc --noEmit`).

**Verify:**

```bash
bun install
bun run lint
bun test                 # zero tests yet → vitest prints "no test files" and exits 0
git commit -m "chore: monorepo scaffold"   # pre-commit must fire
```

Hard rule: **never** pass `--no-verify`. If the hook blocks, fix the root cause.

---

## Step 1 — Schema package (~25 min)

`packages/schema/package.json`:

```json
{
  "name": "@pulse/schema",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "zod": "^3.23.0" }
}
```

Files:

- `packages/schema/src/snapshot.ts` — the frozen JSON shape. Fields:
  `repo`, `date` (ISO-8601 YYYY-MM-DD), `captured_at` (ISO-8601 datetime),
  `stars`, `forks`, `watchers`, `open_issues`, `open_prs`,
  `traffic: { views_14d, unique_visitors_14d, clones_14d }`,
  `top_referrers[]`, `top_paths[]`, `recent_issues[]`, `recent_stargazers[]`.
  Keep `schema_version` literal `1` so v2 can bump.
  `recent_stargazers[].user.login` must be **nullable** to tolerate GitHub
  ghost-users (deleted accounts → `null`).
- `packages/schema/src/rule.ts` — `RuleTypeSchema` as a `z.enum` of the 5
  known rule names; `RuleSchema` discriminated on `type`.
- `packages/schema/src/alert.ts` — `AlertSchema` with `rule`, `repo`, `at`,
  `severity`, `summary`, and `data` (left as `z.unknown()` in v1; v2 will
  tighten to a discriminated union).
- `packages/schema/src/weekly.ts` — `WeeklyReportSchema` for the rendered payload.
- `packages/schema/src/index.ts` — barrel export.

Every schema gets a sibling `*.test.ts` with:

1. happy-path parse
2. one missing-required-field failure
3. one wrong-type failure

**Verify:**

```bash
bun test packages/schema           # green, all schemas covered ≥95%
```

Commit: `feat(schema): zod schemas (Snapshot, Rule, Alert, WeeklyReport)`.

---

## Step 2 — CLI base: Octokit wrapper + `snapshot` (~40 min)

`packages/cli/package.json` adds:
`@octokit/rest`, `@octokit/plugin-retry`, `@octokit/plugin-throttling`,
`commander`, `yaml`, `zod`, `@pulse/schema` (workspace).

Files:

- `packages/cli/src/token.ts` — read `GITHUB_TOKEN_PULSE` from env; if missing,
  parse `~/.claude/.env` line-by-line (no `dotenv` dep needed); fallback
  `GITHUB_TOKEN`. Export `redactToken(s)` that masks anything that
  matches `/gh[pos]_[A-Za-z0-9]{20,}/` — wrap every `console.error` with it.
- `packages/cli/src/github-schemas.ts` — minimal zod schemas for **only** the
  fields we consume from each REST response (`repos.get`, `repos.getViews`,
  `repos.getClones`, `repos.getTopReferrers`, `repos.getTopPaths`,
  `issues.listForRepo`, `activity.listStargazersForRepo`). Parsing at the
  wrapper boundary means no `any` escapes into business logic.
- `packages/cli/src/github.ts` — `createClient({ token })` assembles Octokit
  with `retry` + `throttling` plugins; on `403 rate_limit`, wait; on `404`,
  return `null`; on `5xx`, retry up to 3x then throw a typed `GitHubError`.
- `packages/cli/src/repos.ts` — `DEFAULT_REPOS` array, `expandRepo(name)`
  helper (accepts bare name or `owner/name`).
- `packages/cli/src/writer.ts` — `writeSnapshotAtomic(dir, filename, data)`:
  write to `*.tmp`, `fsync`, `rename`. Never leaves a half-written file.
- `packages/cli/src/snapshot.ts` — `captureSnapshot(repoFullName, now)`:
  parallel-fetches, zod-parses, assembles the `Snapshot`. In `--dry-run`,
  `captured_at` is pinned to `now` so output is byte-deterministic.
- `packages/cli/src/index.ts` — `commander` dispatcher: `snapshot`, `diff`,
  `rules`, `weekly`, `notify`.

Tests (`*.test.ts` co-located):

- `token.test.ts` — env precedence, `.env` parse, `redactToken` mask cases.
- `github.test.ts` — **mock only Octokit HTTP**; assert zod parse fires,
  classify 404/403/5xx, retry counts.
- `snapshot.test.ts` — golden-file test on a canned GitHub response set.
- `writer.test.ts` — atomic rename, no `.tmp` left on crash.

**Verify:**

```bash
bun test packages/cli
bun run snapshot -- --repo opc --dry-run | jq .date   # "YYYY-MM-DD"
```

Commit: `feat(cli): Octokit wrapper + snapshot command`.

---

## Step 3 — Rules engine + diff + weekly + notify (~50 min)

Files under `packages/cli/src/rules/`:

- `rules-config.ts` — `loadRulesConfig(path)` reads + zod-parses `rules.yaml`.
  Malformed YAML or unknown rule type → `zod` error, **non-zero exit**.
- `rules/new-referrer-domain.ts` — subdomain-aware `isKnown(host)`
  (`.endsWith('.'+d) || host===d`), trigger when a referrer not in
  `known_list` has `uniques_7d >= threshold`.
- `rules/unanswered-issue.ts` — `open && age_hours > 48 && comments === 0`.
- `rules/star-velocity-spike.ts` — rolling 28d **sample std-dev** (N−1) of
  weekly star counts; fire when last-7d count > mean + 3σ. Needs ≥4 weeks
  of history, else silent miss.
- `rules/active-fork.ts` — compare fork list against prior snapshot; for each
  new fork, call `repos.compareCommits` to get `ahead_by`; fire when > 0.
- `rules/watchlist-signal.ts` — read `watchlist.yaml`; v1 is a legal no-op
  (fires only if the cheap path is free).
- `rules/index.ts` — ordered dispatch `[cfg, snapshot, history] → Alert[]`.

`packages/cli/src/diff.ts` — load newest and newest-minus-Nd snapshots,
emit a markdown-ish table; on missing baseline, print literal `no baseline`
to stdout and exit 0.

`packages/cli/src/weekly.ts` — ISO-week (`getISOWeek`, `getISOWeekYear` —
do not use calendar week), render `reports/YYYY-WNN.md`, build a Slack
payload object. `--send` is the **only** code path that calls the Slack MCP
stub (`slack.ts`); default mode prints the payload to stdout.

`packages/cli/src/slack.ts` — thin wrapper around the MCP tool; export
`sendDraft(channel, payload)`. In tests, import and mock this module
(never mock the rules engine itself).

Fixtures live under `packages/cli/src/__fixtures__/`: one `hit` and one
`miss` snapshot per rule. Tests assert each rule fires on its `hit` fixture
and is silent on `miss`.

**Verify:**

```bash
bun test packages/cli
bun run diff -- --since 7d          # table or "no baseline"
bun run rules                        # empty stdout + exit 0 on clean data
bun run weekly                       # writes reports/YYYY-WNN.md + prints payload
```

Commit: `feat(cli): rules engine + diff + weekly + notify`.

---

## Step 4 — GitHub Actions daily cron (~10 min)

`.github/workflows/snapshot.yml`:

```yaml
name: snapshot
on:
  schedule:
    - cron: "17 6 * * *"      # 06:17 UTC daily (off-the-hour on purpose)
  workflow_dispatch:
permissions:
  contents: write             # least privilege for commit-back
jobs:
  snapshot:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 1 }
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.10 }
      - run: bun install --frozen-lockfile
      - name: Capture snapshots
        env:
          GITHUB_TOKEN_PULSE: ${{ secrets.PULSE_GH_TOKEN }}
        run: bun run snapshot
      - name: Commit snapshots
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/snapshots/
          if git diff --staged --quiet; then
            echo "No new snapshot files to commit"; exit 0
          fi
          git commit -m "chore(snapshot): $(date -u +%Y-%m-%d)"
          git push
```

**Verify:**

```bash
gh workflow run snapshot.yml && gh run watch
gh api /repos/iamtouchskyer/pulse/commits/main --jq .author.login
# → github-actions[bot]
ls data/snapshots/$(date -u +%Y-%m-%d)/ | wc -l    # → 4
```

Commit: `chore(ci): daily snapshot workflow`.

---

## Step 5 — Astro dashboard (~40 min)

`packages/web/package.json` adds `astro@^5`, `@pulse/schema`, `zod`.

- `packages/web/src/lib/load-snapshots.ts` — find the newest `data/snapshots/YYYY-MM-DD/`,
  read + zod-parse each `*.json`; return `{ date, snapshots[] } | null`.
- `packages/web/src/pages/index.astro` — render 4 `[data-testid="repo-card"]`
  showing stars / forks / open_issues; if empty, render `[data-testid="empty-state"]`.
- `packages/web/src/components/RepoCard.astro` — visual hierarchy: large
  number, small label, muted sub-metric. `aria-labelledby` referring to the
  card title `<h3>`.
- Dark/light via `@media (prefers-color-scheme: dark)`. Respect
  `@media (prefers-reduced-motion: reduce)` — no flashy transitions.
- Visible focus ring (solid 2px outline, never `outline: none`).
- Favicon, `<title>` set distinctly per page.

**Verify:**

```bash
bun --filter @pulse/web run dev &    # http://localhost:4321
curl -s http://localhost:4321 | grep -c 'data-testid="repo-card"'   # → 4
```

Commits: `feat(web): astro dashboard with 4 repo cards + empty state`,
then `fix(web): address U13 review — visual hierarchy, dark contrast, aria-labelledby, reduced-motion`.

---

## Step 6 — E2E + a11y (~30 min)

`packages/web/playwright.config.ts`:

- `webServer: { command: 'bun run dev', port: 4321, reuseExistingServer: !process.env.CI }`
- Projects for `chromium` at 375×667 (mobile) and 1440×900 (desktop).

Tests under `packages/web/tests/`:

- `cards.spec.ts` — waits for 4 `[data-testid="repo-card"]`.
- `empty-state.spec.ts` — fixture swaps `data/snapshots/` to an empty dir
  in `beforeAll`, restores in `afterAll`; asserts `[data-testid="empty-state"]`.
- `keyboard-nav.spec.ts` — tabs through, asserts `:focus-visible` ring.
- `responsive.spec.ts` — screenshots at both viewports (artifacts).
- `a11y.spec.ts` — `@axe-core/playwright` scan; zero `critical` / `serious`
  violations. Anything > 0 is a **build blocker**, not a warning.

**Verify:**

```bash
bun --filter @pulse/web run test:e2e
# 8+ green, 0 axe violations, screenshots in test-results/
```

Commit: `test(web): playwright e2e + axe-core a11y suite`.

---

## Step 7 — Vercel deploy (~15 min)

```bash
vercel link --scope dreamworks        # pick this repo
```

`vercel.json` at repo root:

```json
{
  "buildCommand": "bun install && bun --filter @pulse/web run build",
  "outputDirectory": "packages/web/dist",
  "framework": "astro",
  "installCommand": "bun install"
}
```

(Root Directory stays at repo root — Bun workspaces need the lockfile visible.)

```bash
git add vercel.json && git commit -m "chore(ci): vercel deploy config" && git push
# Auto-deploy triggers. Don't run `vercel --prod` manually.
```

Resolve the prod alias (v1 shipped as `pulse-dreamworks.vercel.app`):

```bash
vercel alias ls | grep pulse
```

**Verify:**

```bash
curl -I https://pulse-dreamworks.vercel.app                             # 200
curl -w "%{time_starttransfer}\n" -o /dev/null -s https://pulse-dreamworks.vercel.app
# → < 2.0
```

No secrets in the bundle:

```bash
curl -s https://pulse-dreamworks.vercel.app/_astro/ 2>/dev/null | grep -ci 'ghp_\|GITHUB_TOKEN'   # → 0
```

---

## Red lines (hard)

- No `any`. Only `// @ts-expect-error: <reason>` when unavoidable.
- Every GitHub API response is zod-parsed at the Octokit wrapper boundary.
- ≥95% coverage on new code. No `test.skip`, `test.todo`, `xit`, `xdescribe`.
- Mocks only at external boundaries (Octokit HTTP, fs, Slack MCP).
- Atomic commits: exactly one logical change per commit, conventional prefix
  (`feat(scope):`, `fix(scope):`, `chore(scope):`, `test(scope):`, `docs:`).
- `--no-verify` is forbidden. If a hook blocks, fix the root cause.
- Token never logged, committed, bundled, or deployed.
- axe-core zero critical/serious = build failure, not warning.
- Dashboard E2E runs against a real Astro dev server, not jsdom.

---

## Verification checklist

Copy into the acceptance handshake at U18:

- [ ] `bun install` clean, lockfile committed.
- [ ] `bun run lint && bun run typecheck && bun test` — all green.
- [ ] `bun run snapshot` → 4 zod-valid JSONs in `data/snapshots/YYYY-MM-DD/`.
- [ ] `bun run snapshot -- --repo opc --dry-run` → prints one JSON, no disk write.
- [ ] `bun run diff -- --since 7d` → table or literal `no baseline`.
- [ ] `bun run rules` → clean stdout + exit 0, or alerts + exit 0.
- [ ] Malformed `rules.yaml` → non-zero exit with a zod parse error.
- [ ] `bun run weekly` → `reports/YYYY-WNN.md` written + Slack payload printed.
- [ ] `bun run weekly -- --send` → exactly one Slack MCP call (mock recorded).
- [ ] `gh workflow run snapshot.yml && gh run watch` → success; commit author
      is `github-actions[bot]`.
- [ ] `bun run dev` → 4 cards render; empty `data/snapshots/` → empty state.
- [ ] `bun run test:e2e` → ≥8 green, 0 axe critical/serious, screenshots present.
- [ ] `curl -I https://pulse-dreamworks.vercel.app` → `HTTP/2 200`; TTFB < 2s.
- [ ] No `ghp_*` / `GITHUB_TOKEN_PULSE` anywhere in `packages/web/dist/` or the deployed bundle.

If every box is ticked, Pulse v1 is shipped.

---

## File map for navigation

- Schemas: `packages/schema/src/{snapshot,rule,alert,weekly}.ts`
- Octokit wrapper: `packages/cli/src/{github,github-schemas,token,writer}.ts`
- Commands: `packages/cli/src/{snapshot,diff,weekly,slack,rules-config}.ts`, `packages/cli/src/rules/*.ts`
- Dashboard: `packages/web/src/pages/index.astro`, `packages/web/src/lib/load-snapshots.ts`
- Cron: `.github/workflows/snapshot.yml`
- Deploy: `vercel.json`
- Config: `rules.yaml`, `watchlist.yaml`
