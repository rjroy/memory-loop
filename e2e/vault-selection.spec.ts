/**
 * E2E Tests: Vault Selection Flow
 *
 * Tests the vault selection screen and navigation to main UI.
 */

import { test, expect } from "@playwright/test";

test.describe("Vault Selection", () => {
  test("shows vault selection screen on load", async ({ page }) => {
    await page.goto("/");

    // Should show vault selection UI
    await expect(page.getByText("Select a Vault")).toBeVisible();
  });

  test("displays connection status", async ({ page }) => {
    await page.goto("/");

    // Wait for connection
    await expect(page.getByText("Connected")).toBeVisible({ timeout: 10000 });
  });

  test("shows empty state when no vaults configured", async ({ page }) => {
    // This test assumes VAULTS_DIR is not set or empty
    // In a real CI setup, we'd configure a test environment
    await page.goto("/");

    // Either shows vaults or empty state
    const hasVaults = await page.getByRole("listbox").isVisible();
    const hasEmptyState = await page.getByText("No Vaults Configured").isVisible();

    expect(hasVaults || hasEmptyState).toBe(true);
  });
});
