import { test, expect } from "@playwright/test";
import { seedSnapshots, clearSnapshots } from "./fixtures";

test.describe("responsive screenshots", () => {
  test.beforeAll(() => seedSnapshots());
  test.afterAll(() => clearSnapshots());

  test("1440px desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("repo-card")).toHaveCount(4);
    await page.screenshot({ path: "test-results/cards-1440.png", fullPage: true });
  });

  test("375px mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(page.getByTestId("repo-card")).toHaveCount(4);
    await page.screenshot({ path: "test-results/cards-375.png", fullPage: true });
  });
});
