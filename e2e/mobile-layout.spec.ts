/**
 * E2E Tests: Mobile Layout
 *
 * Tests responsive layout at mobile viewport sizes.
 */

import { test, expect } from "@playwright/test";

test.describe("Mobile Layout", () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

  test("no horizontal scroll at 375px width", async ({ page }) => {
    await page.goto("/");

    // Check that body doesn't have horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.body.scrollWidth > document.body.clientWidth;
    });

    expect(hasHorizontalScroll).toBe(false);
  });

  test("vault cards are full width on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // If vault cards exist, check they're reasonably wide
    const vaultCard = page.getByRole("option").first();
    if (await vaultCard.isVisible()) {
      const box = await vaultCard.boundingBox();
      if (box) {
        // Card should be at least 80% of viewport width on mobile
        expect(box.width).toBeGreaterThan(300);
      }
    }
  });

  test("touch targets are at least 44px", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Check vault card buttons have adequate height
    const buttons = await page.getByRole("option").all();
    for (const button of buttons.slice(0, 2)) {
      const box = await button.boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
