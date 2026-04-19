import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { clearSnapshots } from "./fixtures";

test.describe("dashboard — empty state", () => {
  test.beforeAll(() => clearSnapshots());

  test("shows empty-state when no snapshots exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("repo-card")).toHaveCount(0);
  });

  test("empty-state a11y: zero critical/serious violations", async ({ page }) => {
    await page.goto("/");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    if (bad.length > 0) {
      // eslint-disable-next-line no-console
      console.log("axe violations (empty):", JSON.stringify(bad, null, 2));
    }
    expect(bad).toEqual([]);
  });
});
