# U13.0 — Designer Review: Pulse v1 Astro Dashboard

**Reviewer angle:** visual hierarchy, typography, rhythm, brand tone, responsive behavior.
**Commit:** c0b118f
**Artifacts:**
- `screenshot-cards-light.png` (1440×900 light)
- `screenshot-cards-dark.png` (1440×900 dark)
- `screenshot-cards-mobile.png` (375×667 light)
- `screenshot-empty.png` (1440×900 light, empty)

**Verdict: ITERATE** — 1 red, 4 yellow, 5 blue. The page is calm, competent, and reads as a "monitoring instrument" rather than a marketing page — brand tone ✓. But the stat row has zero hierarchy between stars / forks / issues, the empty state's icon reads like a spinner, and dark mode's card/page differentiation leans almost entirely on 1px borders. These are fixable in a small follow-up; nothing blocks U13.0 handoff to U15.

---

## 🔴 RED

### R1. Empty-state icon looks like a loading spinner
**Where:** `packages/web/src/components/EmptyState.astro:6-24` — the inline SVG (eight short lines radiating from center at 12 o'clock, 3, 6, 9, and diagonals).
**Screenshot:** `screenshot-empty.png` — the icon above "No snapshots yet."
**Problem:** That exact shape — eight short tick marks around an empty center — is the universal "loading" / "busy" glyph (macOS spinner, CSS `spinner` SVG libraries). Combined with `role="status"` + `aria-live="polite"` (see a11y review), the user's first read is "it's still loading — I should wait." The copy says "check back tomorrow," which then fights the glyph. Design goal for U12 was "silence is a feature" — the glyph has to communicate terminal/steady, not in-flight.
**Fix:** Replace with something terminal: a muted radar/pulse ring (static), an empty bar-chart silhouette, or just a dot + horizon line. Whatever you pick, remove the rotational symmetry — that's what sells "spinner." If in a hurry, drop the icon entirely and rely on the h2 + paragraph; the dashed border already communicates "placeholder."

---

## 🟡 YELLOW

### Y1. No visual hierarchy inside the stat row — stars, forks, issues read as equals
**Where:** `packages/web/src/components/RepoCard.astro:93-99` — all three `<dd>` share `font-size: 1.5rem; font-weight: 700`.
**Screenshot:** `screenshot-cards-light.png` — compare "42 / 7 / 3" on the opc card, "156 / 12 / 7" on blog.
**Problem:** Product spec frames stars as the primary signal (repo health at a glance). On the dashboard, 42 and 7 look equally loud. In a 3-up grid where the eye sweeps left-to-right equally, you lose the "what should I look at first" affordance. The `grid-template-columns: repeat(3, 1fr)` makes it worse — each column is the same visual weight.
**Fix:** Either (a) make `stars` larger / darker / the only tabular-nums element (e.g. `stars dd` → 1.875rem, `forks/issues dd` → 1.125rem and `--text-muted`), or (b) reflow the card: big STARS block on top-left, tiny "7 forks · 3 issues" line below as secondary metadata. Option (b) is closer to a real monitoring instrument.

### Y2. Dark-mode card vs. page uses almost no luminance contrast
**Where:** `packages/web/src/styles/global.css:13-22` — `--bg: #0b0b0f`, `--surface: #141418`. Lightness delta is roughly 3 units on L\* — separation is carried almost entirely by the 1px `--border: #26262c`.
**Screenshot:** `screenshot-cards-dark.png` — cards appear to "float" but the fill is visually indistinguishable from the page.
**Problem:** On any non-OLED display with mediocre gamma or in bright ambient light, cards vanish into the page. Light mode has the opposite problem handled correctly (#fafafa page, #ffffff card — tiny delta but borders + shadow carry it). Dark loses the shadow cue because the shadow is `rgba(0,0,0,0.x)` which is invisible on a near-black page.
**Fix:** Either lift `--surface` to `#17171d` or `#1a1a21`, or drop a 1px inset highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`) in dark mode so each card has a top-edge glint. Borders alone are too subtle.

### Y3. Empty-state copy misses the "why"
**Where:** `packages/web/src/components/EmptyState.astro:25-26` — "No snapshots yet" + "The daily GitHub Actions workflow runs at 06:17 UTC — check back tomorrow."
**Screenshot:** `screenshot-empty.png`.
**Problem:** Tells *what* (no data) and *when* (tomorrow), but not *why* — a first-time visitor wonders "did it fail? is this broken? is this my first visit?" The copy also assumes the viewer knows what "snapshot" means in this product. For a v1 public dashboard, one extra sentence contextualizes.
**Fix:** Two-line copy like "No snapshots captured yet." + "Pulse takes a daily reading of four repos (opc, memex, logex, blog) and writes it here. The first snapshot runs tomorrow at 06:17 UTC." This also lists the four repos so the user knows what they'll see, removing the "is this broken" loop.

### Y4. Card height is pinned to stat row — a "no data" card would collapse visibly shorter
**Where:** `packages/web/src/components/RepoCard.astro:16-34` combined with the grid in `global.css:72-88`. No `min-height` on `.card`.
**Screenshot:** not reproduced in this run (all 4 cards had data), but inspectable from source.
**Problem:** `fmt(null)` returns `—`. A no-data card's `<dd>` row becomes three em-dashes — same height as a data card. OK so far. BUT if you ever add a row (e.g. last-updated delta), the no-data variant will shrink and break grid alignment. Preemptive `min-height` or `grid-auto-rows: 1fr` avoids the future bug.
**Fix:** Add `min-height` (e.g. 140px) to `.card`, or put `align-items: stretch` + explicit `grid-auto-rows` on `.grid`.

---

## 🔵 BLUE (nits)

### B1. UPPERCASE labels with letter-spacing 0.05em reduce scan speed
**Where:** `RepoCard.astro:86-92` — `text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem`.
Common "dashboard look" — not wrong — but the research is consistent: mixed-case is ~13% faster to scan. Consider sentence case + 0.8rem + weight 500, or keep the uppercase but drop font-size to 0.6875rem so they read more as micro-labels.

### B2. No mono font despite tabular numbers
**Where:** `RepoCard.astro:97` uses `font-variant-numeric: tabular-nums` on a humanist sans. That's fine — fixed-width digits work on system fonts. But if you want the "instrument" feel, `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` on `.stat dd` would sell the telemetry vibe hard. Optional.

### B3. Header `h1` has no contextual subtitle beyond the tagline
"Pulse" alone under the h1 is terse. The tagline "Daily OSS radar · snapshot 2026-04-19" does the job, but you could promote "OSS Radar" into a proper subtitle element for a clearer wayfinding cue. Minor.

### B4. Card hover lifts 1px (`translateY(-1px)`) even though cards are not interactive
**Where:** `RepoCard.astro:51-54`. The hover effect implies "click me." But the card has no link, no button. A user who hovers, doesn't see a cursor change, may wonder what clicking does. Either (a) make the card a link to the GitHub repo (upcoming feature?) or (b) drop the hover transform. Right now it's a visual promise with no payoff.

### B5. Footer text feels slightly low-contrast in dark mode
`--text-muted: #a1a1aa` on `--bg: #0b0b0f` is ~9.5:1 — passes AA for body easily. But the footer is `0.875rem`, and the dotted "Astro" link color `#8a8aff` against the dark page feels slightly washed next to the muted copy. Not a blocker. Consider raising accent saturation in dark mode (e.g. `#a0a0ff`) if you want the link to feel more like an instrument "lit LED."

### B6. Responsive transition 640→1024 has no intermediate "3-col" stage
**Where:** `global.css:78-88`. Goes 1-col (mobile) → 2-col (≥640px) → 4-col (≥1024px). Between 768–1023 (most iPad portrait, split-screen laptops) you get 2-col with lots of horizontal slack. Could insert `3-col @ 900px`, or leave as-is — 2-col reads fine. Noting for record.

---

## Angle-by-angle

1. **Visual hierarchy** — ⚠ Stars not visually dominant (Y1). Repo name (h2) is clear top-level anchor, good.
2. **Card legibility** — font stack is system/Inter, 16px base with 1.5 line-height → readable. Numbers at 1.5rem/700 read cleanly. Padding 1.25rem feels right; internal gap 1rem separates header from stats without crowding.
3. **Dark/light parity** — Light is textbook clean. Dark needs a lift (Y2). Tagline muted color differential is correctly scaled between schemes.
4. **Empty-state clarity** — icon problem (R1) + missing "why" (Y3). Border-dashed container and centered layout = correct pattern.
5. **Responsive at 375px** — cards stack cleanly, no horizontal scroll, numbers don't truncate. Padding holds. ✓
6. **Grid rhythm** — 1-col → 2-col → 4-col, no 3-col stage (B6). Breakpoints at 640/1024 are conventional.
7. **Brand tone** — achieves "calm monitoring instrument." Not marketing-y. ✓
8. **Whitespace** — generous below the fold but dashboards benefit from that (room for future rows). Header→grid gap of 2.5rem feels right.
9. **Typography** — system stack, humanist. No mono (B2 — optional).
10. **Dev-looking artifacts** — none seen. No rogue outlines, no unstyled scrollbars. Focus ring is declared (see a11y review). Favicon link declared, no broken image placeholder.

---

**Next action for U15:** Y1 (hierarchy), R1 (icon), Y2 (dark surface), Y3 (empty copy) in one batch — small CSS change + 2-line copy change + swap SVG. ~30 min of work, then re-run U13.0 screenshots.
