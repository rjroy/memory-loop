/**
 * Test Helpers
 *
 * Common utilities for creating mock objects in tests.
 */

import { open } from "node:fs/promises";
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
  };
}

/**
 * Sets the modification time (mtime) of a file.
 * Use instead of sleep() when testing mtime-based change detection.
 *
 * @param path - Absolute path to the file
 * @param time - The time to set as mtime (also sets atime)
 */
export async function setFileMtime(path: string, time: Date): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.utimes(time, time);
  } finally {
    await handle.close();
  }
}
