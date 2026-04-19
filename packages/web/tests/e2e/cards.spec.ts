import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedSnapshots, clearSnapshots } from "./fixtures";

test.describe("dashboard — cards rendered", () => {
  test.beforeAll(() => seedSnapshots());
  test.afterAll(() => clearSnapshots());

  test("renders 4 repo cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("repo-card")).toHaveCount(4);
  });

  test("each card shows stars/forks/issues labels", async ({ page }) => {
    await page.goto("/");
    const first = page.getByTestId("repo-card").first();
    await expect(first).toContainText(/stars/i);
    await expect(first).toContainText(/forks/i);
    await expect(first).toContainText(/issues/i);
  });

  test("keyboard tab reaches focusable elements with visible focus ring", async ({ page }) => {
    await page.goto("/");

    // Count interactive/focusable elements. The dashboard has a footer link (astro.build).
    const focusableCount = await page.evaluate(() => {
      const sel = 'a[href], button, [tabindex]:not([tabindex="-1"]), input, select, textarea';
      return document.querySelectorAll(sel).length;
    });

    if (focusableCount === 0) {
      test.skip(true, "no focusable elements on static dashboard");
      return;
    }

    // Tab through every focusable element, asserting visible focus indicator.
    for (let i = 0; i < focusableCount; i++) {
      await page.keyboard.press("Tab");
      const focusInfo = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          outlineWidth: s.outlineWidth,
          outlineStyle: s.outlineStyle,
          boxShadow: s.boxShadow,
        };
      });
      if (!focusInfo) continue;
      // Visible focus = outline with width & non-none style, OR a focus box-shadow.
      const hasOutline =
        focusInfo.outlineStyle !== "none" &&
        focusInfo.outlineWidth !== "0px" &&
        focusInfo.outlineWidth !== "";
      const hasBoxShadow = focusInfo.boxShadow !== "none" && focusInfo.boxShadow !== "";
      expect(hasOutline || hasBoxShadow).toBe(true);
    }
  });

  test("a11y: zero critical/serious violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    if (criticalOrSerious.length > 0) {
      // eslint-disable-next-line no-console
      console.log("axe violations:", JSON.stringify(criticalOrSerious, null, 2));
    }
    expect(criticalOrSerious).toEqual([]);
  });
});
