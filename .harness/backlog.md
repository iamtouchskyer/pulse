# Backlog

## From review unit U3.0 — 2026-04-19T11:13:34.684Z

- [ ] 7. `packages/schema/src/snapshot.test.ts` — no test covers the ghost-user case for `author` or `recent_stargazers`. Add a test that feeds `author: null` and asserts current behavior, to lock in whatever fix is chosen for the 🔴 above. _(from .harness/nodes/U3.0/run_1/eval-backend.md)_

## From review unit U6.0 — 2026-04-19T11:31:07.611Z
- [ ] The hard red line on token leakage holds in every code path I traced (token never logged, never written to a snapshot file, never embedded in URLs, never reachable via stack traces because only `err.message` is printed and `process.exit` runs immediately after). The four 🟡 items are defense-in-depth — they should land before this CLI is run on a machine where `~/.claude/.env` could be world-readable or symlinked, but none of them block merge of U5.0 as a unit. _(from .harness/nodes/U6.0/run_1/eval-security.md)_
