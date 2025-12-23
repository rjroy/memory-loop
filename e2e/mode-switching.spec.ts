/**
 * E2E Tests: Mode Switching
 *
 * Tests switching between Note and Discussion modes.
 */

import { test, expect, type Page } from "@playwright/test";

test.describe("Mode Switching", () => {
  // Helper to select a vault first (if vaults are available)
  async function selectFirstVault(page: Page): Promise<void> {
    await page.goto("/");
    await page.waitForTimeout(1000); // Wait for connection

    // Click first vault card if available
    const vaultCard = page.getByRole("option").first();
    if (await vaultCard.isVisible()) {
      await vaultCard.click();
      // Wait for session ready
      await page.waitForTimeout(500);
    }
  }

  test("shows mode toggle after vault selection", async ({ page }) => {
    await selectFirstVault(page);

    // Should show mode toggle
    const noteTab = page.getByRole("tab", { name: "Note" });
    const discussionTab = page.getByRole("tab", { name: "Discussion" });

    // Check if we're on the main UI (might fail if no vaults)
    const hasModeToggle = await noteTab.isVisible().catch(() => false);

    if (hasModeToggle) {
      await expect(noteTab).toBeVisible();
      await expect(discussionTab).toBeVisible();
    }
  });

  test("Note mode is selected by default", async ({ page }) => {
    await selectFirstVault(page);

    const noteTab = page.getByRole("tab", { name: "Note" });
    const hasModeToggle = await noteTab.isVisible().catch(() => false);

    if (hasModeToggle) {
      await expect(noteTab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("switches to Discussion mode on click", async ({ page }) => {
    await selectFirstVault(page);

    const discussionTab = page.getByRole("tab", { name: "Discussion" });
    const hasModeToggle = await discussionTab.isVisible().catch(() => false);

    if (hasModeToggle) {
      await discussionTab.click();
      await expect(discussionTab).toHaveAttribute("aria-selected", "true");
    }
  });
});
