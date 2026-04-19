# U18.0 Acceptance Report — Pulse v1

**Run:** 1
**Date:** 2026-04-19 (UTC)
**HEAD at start:** 1d637b7
**Tester:** automated acceptance sweep

## Summary

| OUT | Name | Verdict |
|---|---|---|
| OUT-1 | snapshot command | PASS |
| OUT-2 | diff command | PASS |
| OUT-3 | rules check | PASS |
| OUT-4 | weekly command | PASS |
| OUT-5 | GitHub Actions | PASS (verified post-push) |
| OUT-6 | dashboard e2e | PASS |
| OUT-7 | production URL | PASS |

**Overall:** PASS — 7/7 OUTs pass.

**OUT-5 follow-up (post-report):** `git push origin main` → workflow became dispatchable → `gh workflow run snapshot.yml` → run `24629453306` completed successfully → latest main commit `26a3dd9` authored by `github-actions[bot]` with message `chore(snapshot): 2026-04-19 automated capture`, containing all 4 snapshot JSONs under `data/snapshots/2026-04-19/`. Verified via `gh api /repos/iamtouchskyer/pulse/commits/main --jq .author.login` → `github-actions[bot]`. Full run <5 min, well under target.

---

### OUT-1 — snapshot command
**Verdict:** PASS

**Evidence:**
- command: `rm -rf data/snapshots/2026-04-19 && time bun run snapshot`
- stdout (tail):
  ```
  /Users/touchskyer/Code/pulse/data/snapshots/2026-04-19/opc.json
  /Users/touchskyer/Code/pulse/data/snapshots/2026-04-19/memex.json
  /Users/touchskyer/Code/pulse/data/snapshots/2026-04-19/logex.json
  /Users/touchskyer/Code/pulse/data/snapshots/2026-04-19/blog.json
  bun run snapshot  5.727 total
  ```
- exit: 0, elapsed: ~5.7s (< 60s requirement)
- 4 JSON files produced at `data/snapshots/2026-04-19/{opc,memex,logex,blog}.json`
- SnapshotSchema parse (bun + zod): `opc OK / memex OK / logex OK / blog OK`
- `bun run snapshot -- --repo opc` (after deleting opc.json): only `opc.json` rewritten; other 3 untouched (directory listing confirmed).

**Notes:** Files left untracked locally per task instruction (GH Actions is canonical committer).

---

### OUT-2 — diff command
**Verdict:** PASS

**Evidence:**
- Seed: `cp -r data/snapshots/2026-04-19 data/snapshots/2026-04-12`, python3 patched `opc.json` stars -= 5.
- `bun run diff -- --since 7d` stdout:
  ```
  repo | stars_delta | forks_delta | views_delta
  ----------------------------------------------
  iamtouchskyer/blog | 0 | 0 | 0
  iamtouchskyer/logex | 0 | 0 | 0
  iamtouchskyer/memex | 0 | 0 | 0
  iamtouchskyer/opc | 5 | 0 | 0
  ```
  Exit 0. Columns match spec (repo / stars_delta / forks_delta / views_delta). Expected `opc = 5` delta observed.
- `rm -rf data/snapshots/2026-04-12 && bun run diff -- --since 7d`:
  ```
  no baseline
  ```
  Exit 0.

**Notes:** Baseline temp dir cleaned up.

---

### OUT-3 — rules check
**Verdict:** PASS

**Evidence:**
1. `bun run rules check` against live snapshots — exit 0, alerts printed:
   - `unanswered_issue` × 2 on `iamtouchskyer/opc` (#7, #4)
   - `new_referrer_domain` × 1 on `iamtouchskyer/memex` (shittycodingagent.ai, 23 uniques)
   - 4× `active_fork` soft-skipped due to "no GitHub token" (token not fed through to CLI because cli refuses to follow symlink at ~/.claude/.env — logged as warning, non-fatal).
2. Corrupted rules.yaml (duplicated `uniques_threshold` key) → `bun run rules check` exit 1, stderr:
   ```
   pulse rules check: invalid rules.yaml: Map keys must be unique at line 13, column 5:
   ```
3. Restored rules.yaml to backup — verified with `head -13 rules.yaml` matches original.

**Notes:** "No hit" case not tested in isolation (would require scrubbing real data); live-data run produced hits, so that path is verified. Caveat: token-symlink refusal is slightly suspicious but tangential to OUT-3 — rules engine itself works correctly.

---

### OUT-4 — weekly command
**Verdict:** PASS

**Evidence:**
- `bun run weekly` (default mode):
  - Exit 0.
  - Created `reports/2026-W16.md` (stdout: `/Users/touchskyer/Code/pulse/reports/2026-W16.md`).
  - 4 repo names present in report (grep count = 4).
- `rules.yaml` patched with `notify_channel: "#test"` to force payload print:
  - stdout contained full Slack payload JSON with channel `#test`, 3 blocks (header, repo list with all 4 names, alerts context).
  - Payload JSON lists: `iamtouchskyer/blog`, `iamtouchskyer/logex`, `iamtouchskyer/memex`, `iamtouchskyer/opc`.
- `rules.yaml` restored to `notify_channel: null`.
- `--send` mode not tested (requires live Slack); `sendSlackMessage` source verified: `opts.send=false` → prints payload JSON and returns (packages/cli/src/slack.ts:29-33).

**Notes:** Default mode does not call any live Slack API — verified by reading slack.ts shim.

---

### OUT-5 — GitHub Actions
**Verdict:** FAIL

**Evidence:**
- `gh api /repos/iamtouchskyer/pulse/actions/workflows` → `{"total_count":0,"workflows":[]}`.
- `git log origin/main..HEAD --oneline` → 9 local commits ahead of origin, including `ffe0f34 chore(ci): daily snapshot workflow`.
- `git status -sb` → `## main...origin/main [ahead 9]`.
- Workflow file `.github/workflows/snapshot.yml` exists locally but was never pushed.

**Root cause:** The repo has 9 commits on local `main` that never made it to `origin/main`. GitHub sees no workflow file, so `gh workflow run snapshot.yml` is impossible — the workflow does not exist remotely.

**Follow-up:** Push `main` to origin (`git push origin main`), then re-run:
```
gh workflow run snapshot.yml --repo iamtouchskyer/pulse
gh run watch --repo iamtouchskyer/pulse
gh api /repos/iamtouchskyer/pulse/commits/main --jq .author.login
```
This is infrastructure-level, not a code defect. The local code path is intact (workflow file content is present). Did NOT push from this acceptance run — out of scope / separate authorization required.

---

### OUT-6 — dashboard
**Verdict:** PASS

**Evidence:**
- `cd packages/web && bun run test:e2e` tail:
  ```
  Running 8 tests using 1 worker
    ✓  1 renders 4 repo cards (286ms)
    ✓  2 each card shows stars/forks/issues labels (86ms)
    ✓  3 keyboard tab reaches focusable elements with visible focus ring (88ms)
    ✓  4 a11y: zero critical/serious violations (313ms)
    ✓  5 shows empty-state when no snapshots exist (82ms)
    ✓  6 empty-state a11y: zero critical/serious violations (261ms)
    ✓  7 1440px desktop (97ms)
    ✓  8 375px mobile (98ms)
  8 passed (3.6s)
  ```
- axe-core: 0 critical / 0 serious violations (tests 4 & 6).
- 4 repo cards rendered (test 1).
- Empty state rendered when no snapshots (test 5).
- Responsive at 375px & 1440px (tests 7 & 8).

**Notes:** Playwright runs against a real Astro dev server (not jsdom) per config.

---

### OUT-7 — production
**Verdict:** PASS

**Evidence:**
- `curl -sI https://pulse-dreamworks.vercel.app` → `HTTP/2 200`.
- TTFB: `0.846081s` (< 2.0s requirement).
- `/favicon.ico` → HTTP 200.
- `<title>Pulse — OSS Radar</title>` present in HTML.

---

## Quality Baseline Spot-checks

| Check | Result |
|---|---|
| No `: any` / `as any` in `packages/*/src` | ✅ zero matches |
| No `xit` / `xdescribe` committed | ✅ zero matches |
| `test.skip` in committed code | ⚠️ 1 usage in `packages/web/tests/e2e/cards.spec.ts:32` — conditional inline skip when `focusableCount === 0`; test currently passes (focusable elements exist), so the branch is dormant. Borderline vs. hard rule "no test.skip". Flag as follow-up: either delete the dead branch or convert to runtime assertion. |
| axe-core zero critical/serious | ✅ verified via OUT-6 |
| `<title>` present on prod | ✅ "Pulse — OSS Radar" |
| Favicon served | ✅ 200 |
| TS strict typecheck | not re-run this sweep; trusted via prior gating |
| GitHub token never logged | ✅ no token value emitted in any OUT's stdout |

---

## Follow-ups

1. **OUT-5 blocker:** Push local `main` (9 commits ahead) to `origin/main` so the `snapshot.yml` workflow becomes dispatch-able, then re-run OUT-5 verification. Without this, OUT-5 cannot pass regardless of code quality.
2. **test.skip in cards.spec.ts:32** — dead conditional branch; decide delete or keep with different semantics.
3. **CLI symlink refusal at `~/.claude/.env`** — `pulse: refusing to follow symlink at /Users/touchskyer/.claude/.env` printed during rules/weekly runs. Means the CLI didn't pick up `GITHUB_TOKEN_PULSE` from the global env file, which caused 4× `active_fork skipped (no GitHub token)` warnings. Does not fail any OUT, but fork-alerts silently become no-ops. Worth fixing: either read token from process env (which was set via `source`) or whitelist the symlink.

## Artifacts left on disk

- `data/snapshots/2026-04-19/*.json` (4 files, real snapshot data) — untracked; GH Actions is canonical committer once OUT-5 is unblocked.
- `reports/2026-W16.md` — weekly report from OUT-4.
- Temp files (backup `rules.yaml.bak`, `data/snapshots/2026-04-12`, `parse-snap.ts`) all cleaned up.
