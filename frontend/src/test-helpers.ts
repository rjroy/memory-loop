/**
 * Test Helpers for Frontend
 *
 * Common utilities for creating mock objects in tests.
 */

import type { VaultInfo } from "@memory-loop/shared";

/**
 * Creates a mock VaultInfo object with sensible defaults.
 * All required fields are populated; pass overrides as needed.
 */
export function createMockVault(overrides: Partial<VaultInfo> = {}): VaultInfo {
  const path = overrides.path ?? "/vaults/test-vault";
  const contentRoot = overrides.contentRoot ?? path;

  return {
    id: "test-vault",
    name: "Test Vault",
    path,
    hasClaudeMd: true,
    contentRoot,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: false,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    ...overrides,
    // Ensure order is always a number (Partial<VaultInfo> allows undefined)
    order: overrides.order ?? 999999,
    // Ensure cardsEnabled is always a boolean
    cardsEnabled: overrides.cardsEnabled ?? true,
  };
}
