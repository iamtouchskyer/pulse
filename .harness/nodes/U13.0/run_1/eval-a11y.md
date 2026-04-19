# U13.0 — A11y Review: Pulse v1 Astro Dashboard

**Reviewer angle:** WCAG 2.1 AA compliance, semantic HTML, ARIA correctness, keyboard + screen reader experience, reduced motion.
**Commit:** c0b118f
**Artifacts:**
- `screenshot-cards-light.png`
- `screenshot-cards-dark.png`
- `screenshot-cards-mobile.png`
- `screenshot-empty.png`

**Verdict: ITERATE** — 2 red, 3 yellow, 6 blue. The page is mostly well-behaved: `<html lang="en">`, single `<main>`, heading hierarchy h1→h2, `:focus-visible` declared, favicon present, no hard keyboard traps. Two issues need fixing before U15 axe-core scan: (a) `role="status"` on the empty state is the wrong live-region semantic for a persistent state, and (b) the repo-card `aria-label` duplicates the visible `<h2>`, which causes screen readers to double-announce.

---

## 🔴 RED

### R1. `role="status" aria-live="polite"` on EmptyState misuses live regions
**Where:** `packages/web/src/components/EmptyState.astro:5` — `<section class="empty" data-testid="empty-state" role="status" aria-live="polite">`.
**Screenshot:** `screenshot-empty.png`.
**Problem:** `role="status"` / `aria-live="polite"` tell assistive tech "this content updates dynamically — announce changes." But this component is SSR-rendered and static once served. On page load, NVDA/VoiceOver will announce the entire "No snapshots yet. The daily GitHub Actions workflow runs..." block as a *status change* rather than as normal page content. Worse, if the user navigates back to the page later, re-announcement happens. It's not a bug that causes silence — it's a bug that makes the screen reader talk when it shouldn't. WCAG 4.1.3 (Status Messages) requires live regions be used only for actual status updates, not page structure.
**Fix:** Drop `role="status"` and `aria-live="polite"` entirely. Replace with plain `<section aria-labelledby="empty-title">` and give the `<h2>` an `id="empty-title"`. The h2 already provides screen-reader navigability via the heading list.

### R2. Repo card `aria-label` duplicates the visible `<h2>` → double announcement
**Where:** `packages/web/src/components/RepoCard.astro:16` — `<article class="card" data-testid="repo-card" aria-label={\`Repository ${card.repo}\`}>`. Line 18: `<h2>{card.repo}</h2>`.
**Problem:** When an `<article>` has both an `aria-label` AND a heading child, AT behavior varies but common outcomes are: (a) VoiceOver announces "opc, Repository opc, article" — duplicated; or (b) the `aria-label` overrides the heading entirely so the user loses the heading-navigation affordance (the h2 is still in the DOM but the accessible name is taken from aria-label). Either way, users who rely on heading jump (press `H` in NVDA) get a weaker experience than if the heading alone named the article. The aria-label was probably added defensively because `<article>` without a heading needs a name — but here we HAVE a heading.
**Fix:** Replace `aria-label` with `aria-labelledby` pointing at the h2: `<article aria-labelledby={\`card-${card.repo}\`}>` and `<h2 id={\`card-${card.repo}\`}>{card.repo}</h2>`. That ties the article name to the heading and removes the duplication.

---

## 🟡 YELLOW

### Y1. Stat numbers announced as bare integers — "42" not "42 stars"
**Where:** `RepoCard.astro:21-33` uses `<dl><div class="stat"><dt>stars</dt><dd>42</dd>...`. `<dl>`/`<dt>`/`<dd>` is semantically correct, BUT AT support for `<dl>` is inconsistent — NVDA announces it as a "definition list with 3 items" and reads label→value pairs; VoiceOver on iOS treats the value as an orphan paragraph in many cases. A user tabbing through (there's no focus stop, but arrow-key reading in browse mode) may hear "stars" then "42" separately with a pause, or just "42" if the AT skips the `<dt>`.
**Screenshot:** `screenshot-cards-light.png` — visually the label→number relationship is clear; it's AT pairing that's weak.
**Fix:** Either (a) keep the `<dl>` but wrap each pair so the pair reads together, e.g. `<div role="group" aria-label={\`${fmt(stars)} stars\`}>...`, or (b) replace with a visually-hidden full phrase: `<span class="sr-only">42 stars, </span>` before each number, stripping pause-causing structure.

### Y2. Focus ring color contrast against card surface in dark mode borderline
**Where:** `global.css:43-47` `outline: 2px solid var(--focus)` with `--focus: #8a8aff` in dark mode. Card surface is `#141418`.
**Computed:** #8a8aff vs #141418 = ~6.8:1 — passes WCAG 2.1 non-text contrast of 3:1 ✓. Against page `#0b0b0f` = ~7.4:1 ✓. OK numerically.
**But:** `outline-offset: 2px` places the ring between the card's border (`#26262c`) and the page. That's 2px of background visible between ring and border. If a user's browser renders offset slightly differently (Safari), the ring can visually merge with the 1px border. Also, on the footer's `Astro` link (accent color `#8a8aff`), the focus ring is THE SAME color as the link text → ring is invisible against the link's own color when focused.
**Fix:** Add `outline-color` override on focusable text elements, or pick a focus color distinct from `--accent` (e.g. `--focus: #ffcc00` universally — high-contrast amber used by Gov.uk design system).

### Y3. No `prefers-reduced-motion` override for card hover transform
**Where:** `RepoCard.astro:47-54` — `transition: transform 0.15s ease, border-color 0.15s ease;` and `:hover { transform: translateY(-1px) }`. No media query to disable.
**Problem:** WCAG 2.3.3 (AAA) and best practice — motion triggered on hover should respect `prefers-reduced-motion: reduce`. A 1px lift is tiny but the animation still fires, and users with vestibular sensitivity set the media query precisely because they want ZERO non-essential motion.
**Fix:** Add to global.css: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` — one-time global override. Or locally on `.card`.

---

## 🔵 BLUE

### B1. `<header class="site">` has no role but is not in a landmark
`header` inside `<main>` does NOT become a `banner` landmark (only top-level `<header>` does). So the site header is just a `<header>` element. That's fine — but if you intended it to be a banner, promote it outside `<main>`. If not, no change needed.

### B2. `<title>` is unique and descriptive ✓
"Pulse — OSS Radar" (`index.astro:21`). Good. Consider appending date on populated state: "Pulse — 2026-04-19" for browser history differentiation across days (tiny polish).

### B3. `<html lang="en">` present ✓
`index.astro:11`. Correct.

### B4. No skip link
Not required for a 1-page dashboard with a single `<main>` — screen reader users can jump via landmark navigation. If a nav bar is added later, revisit.

### B5. Empty-state SVG `aria-hidden="true"` ✓
`EmptyState.astro:14`. Correct — decorative. No inline `<title>` needed. ✓

### B6. Heading hierarchy: h1 (Pulse) → h2 (card / empty title)
No h3 skipped. One h1 per page ✓. Cards all use h2 — correct for "siblings under page title."

### B7. Landmarks: single `<main>` ✓
`<footer>` is inside `<main>` — this means it's NOT a `contentinfo` landmark. That's actually appropriate given it's section-scoped ("built with Astro" credit), not page-scoped legal info. Fine.

### B8. Color contrast body text (light mode)
`--text: #18181b` on `--bg: #fafafa` → ~16.1:1 ✓ (AAA).
`--text-muted: #52525b` on `--bg: #fafafa` → ~7.6:1 ✓ (AAA).

### B9. Color contrast body text (dark mode)
`--text: #fafafa` on `--bg: #0b0b0f` → ~17.9:1 ✓ (AAA).
`--text-muted: #a1a1aa` on `--bg: #0b0b0f` → ~9.5:1 ✓ (AAA).
`--text-muted` on `--surface: #141418` → ~8.9:1 ✓ (AAA). Passes cleanly.

### B10. Keyboard traps
None — page is static, no JS focus management, no modals. Tab through: skips header h1 → skips unfocusable `<article>` elements → `Astro` link in footer → end. Logical order. ✓

### B11. Favicon: `<link rel="icon" href="/favicon.ico">` ✓
Not an accessibility issue, noted for completeness.

### B12. Badge "no data" contrast
`RepoCard.astro:67-74` — `color: var(--text-muted)` on `background: var(--bg)` (which in dark mode is `#0b0b0f`). Contrast of #a1a1aa on #0b0b0f = ~9.5:1 — passes. But `font-size: 0.75rem` on a pill; borderline for some vision-impaired users. Not a failure. Monitor for U15 axe-core.

---

## Angle-by-angle

1. **Semantic HTML** — `<main>`, `<header>`, `<article>`, `<section>`, `<h1>→<h2>`, `<dl>` for key-value. Solid. Only issue is `<section>` on EmptyState carrying a live-region role it shouldn't (R1).
2. **Focus order** — logical: top→bottom, left→right. No focusable cards (good — no false affordance).
3. **Focus ring visibility** — declared globally. Dark-mode `--focus` borderline against `--accent` on link focus (Y2).
4. **Color contrast** — all AAA in both modes for the measured pairs (B8/B9). ✓
5. **aria-label / aria-labelledby on cards** — duplicates heading (R2).
6. **Empty state live region** — wrong (R1).
7. **`<title>`** — unique, descriptive (B2).
8. **Skip link** — not needed (B4).
9. **Landmarks** — single `<main>` ✓ (B7).
10. **Reduced motion** — not honored (Y3).
11. **Screen reader number announcement** — `<dl>` pairing is weak (Y1).
12. **Language** — `lang="en"` ✓ (B3).
13. **Image alt** — decorative SVG `aria-hidden` ✓ (B5); favicon rel=icon is non-AT.
14. **Keyboard traps** — none (B10).

---

**Next action for U15:** R1 + R2 fixes are 4 lines of JSX each, zero risk. Y1/Y2/Y3 are polish but the axe-core run in U15 will likely flag Y3 (reduced-motion) and possibly Y2 (focus ring vs. accent). Suggest batching all 5 before the axe scan to avoid a second iteration.
