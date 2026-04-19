# Pulse

Passive OSS monitoring radar for iamtouchskyer's public repos (`opc`, `memex`, `logex`, `blog`).
**Principle: silence is a feature** — no signal, no noise.

**Live dashboard:** https://pulse-dreamworks.vercel.app

## Architecture

```mermaid
graph LR
  cron[GitHub Actions<br/>cron 06:17 UTC] --> cli[pulse snapshot]
  cli -->|REST + zod parse| gh[(GitHub API)]
  cli -->|atomic write JSON| data[(data/snapshots/<br/>YYYY-MM-DD/*.json)]
  data --> rules[pulse rules check]
  data --> diff[pulse diff --since 7d]
  data --> weekly[pulse weekly]
  rules -->|alerts| slack1[Slack MCP<br/>dry-run default]
  weekly -->|markdown + payload| reports[(reports/YYYY-WNN.md)]
  weekly -.--send.-> slack2[Slack MCP]
  data --> astro[Astro dashboard<br/>packages/web]
  astro -->|git push main| vercel[Vercel auto-deploy<br/>scope=dreamworks]
  vercel --> prod[pulse-dreamworks.vercel.app]
```

The snapshot pipeline is the spine: one JSON-per-repo-per-day, committed by the
GitHub Actions bot. Everything downstream (diff, rules, weekly digest, dashboard)
is a pure function over that filesystem.

## Quick start

```bash
git clone https://github.com/iamtouchskyer/pulse
cd pulse
bun install

# token lives in ~/.claude/.env as GITHUB_TOKEN_PULSE (fallback: GITHUB_TOKEN)
# needs only public_repo read + repo:traffic
echo "GITHUB_TOKEN_PULSE=ghp_yourtoken" >> ~/.claude/.env

bun run snapshot -- --repo opc --dry-run
```

Expected: a single zod-valid `Snapshot` JSON printed to stdout, no disk write.

## Commands

| Command                          | Purpose                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| `bun run snapshot`               | Capture all 4 repos → `data/snapshots/YYYY-MM-DD/*.json`                  |
| `bun run snapshot -- --repo opc` | Single repo (name or `owner/name`)                                        |
| `bun run snapshot -- --dry-run`  | Print JSON to stdout, no disk write, deterministic                        |
| `bun run diff -- --since 7d`     | Stars / forks / views deltas table (prints "no baseline" when missing)    |
| `bun run rules`                  | Apply the 5 rules from `rules.yaml`                                       |
| `bun run weekly`                 | Render `reports/YYYY-WNN.md` + print Slack draft payload (no send)        |
| `bun run weekly -- --send`       | Send the Slack payload via Slack MCP once                                 |
| `bun run notify`                 | Dispatch rule-hit alerts to the channel in `rules.yaml` (no-op if absent) |
| `bun run dev`                    | Astro dashboard dev server                                                |
| `bun run test:e2e`               | Playwright + axe-core end-to-end suite                                    |
| `bun test`                       | Unit tests across all packages (vitest)                                   |
| `bun run lint`                   | ESLint over `.ts`, `.tsx`, `.astro`                                       |
| `bun run typecheck`              | `tsc --noEmit` across the workspace                                       |

## Adding a repo

1. Edit [`packages/cli/src/repos.ts`](packages/cli/src/repos.ts) — append to `DEFAULT_REPOS`:

   ```ts
   export const DEFAULT_REPOS = [
     "iamtouchskyer/opc",
     "iamtouchskyer/memex",
     "iamtouchskyer/logex",
     "iamtouchskyer/blog",
     "iamtouchskyer/<new>",
   ] as const;
   ```

2. Smoke-test the new repo:

   ```bash
   bun run snapshot -- --repo <new> --dry-run
   ```

3. Commit. The daily cron (`.github/workflows/snapshot.yml`) picks it up automatically
   on the next run at 06:17 UTC, and the dashboard re-renders on the next Vercel deploy.

## Project layout

```
packages/
  schema/    # zod schemas (Snapshot, Rule, Alert, WeeklyReport)
  cli/       # Octokit wrapper, snapshot, diff, rules, weekly, notify
  web/       # Astro dashboard (consumed by Vercel)
data/
  snapshots/YYYY-MM-DD/*.json    # committed by github-actions[bot]
reports/
  YYYY-WNN.md                    # weekly digests
.github/workflows/
  snapshot.yml                   # cron 06:17 UTC + workflow_dispatch
rules.yaml                       # 5 rules config
watchlist.yaml                   # usernames to track
```

## Tech stack

Bun 1.3.10 workspaces · TypeScript strict · zod 3 · Astro 5 · @octokit/rest
(+ retry + throttling plugins) · commander · vitest · Playwright · axe-core · Vercel.

## Security posture

- Token read from `~/.claude/.env` (`GITHUB_TOKEN_PULSE`) or `GITHUB_TOKEN` env; **never logged, committed, bundled, or deployed.**
- GitHub API responses zod-parsed at the Octokit wrapper boundary — no `any` escapes.
- Slack MCP is **dry-run by default**; only `weekly --send` and `notify` call it.
- CI secret `PULSE_GH_TOKEN` has least-privilege `public_repo` read + `repo:traffic`.

## v2 roadmap (out of scope for v1)

- X/Twitter monitoring (requires login session, no public API).
- 小红书, 即刻, and other non-public-API platforms.
- Historical backfill prior to day-1 cron run.
- Real-time webhooks instead of 24h polling.
- Portfolio-level aggregation across all repos.
- Dashboard authentication (v1 is public read-only).
- Editable `watchlist.yaml` from the dashboard UI.
- Per-rule typed `data` schemas on `Alert` (currently discriminated union-ready).

## License

MIT © iamtouchskyer
