/**
 * localStorage utilities for session persistence.
 *
 * Handles vault ID, browser path, pinned folders, and view mode persistence.
 */

import type { BrowseViewMode } from "./types";

export const STORAGE_KEY_VAULT = "memory-loop:vaultId";
const STORAGE_KEY_BROWSER_PATH = "memory-loop:browserPath";
const STORAGE_KEY_PINNED_FOLDERS_PREFIX = "memory-loop:pinnedFolders:";
const STORAGE_KEY_VIEW_MODE = "memory-loop:viewMode";

/**
 * Loads persisted vault ID from localStorage.
 */
export function loadPersistedVaultId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_VAULT);
  } catch {
    return null;
  }
}

/**
 * Persists vault ID to localStorage.
 */
export function persistVaultId(vaultId: string | null): void {
  try {
    if (vaultId) {
      localStorage.setItem(STORAGE_KEY_VAULT, vaultId);
    } else {
      localStorage.removeItem(STORAGE_KEY_VAULT);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Loads persisted browser path from localStorage.
 */
export function loadPersistedBrowserPath(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_BROWSER_PATH);
  } catch {
    return null;
  }
}

/**
 * Persists browser path to localStorage.
 */
export function persistBrowserPath(path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_BROWSER_PATH, path);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Loads pinned folders for a specific vault from localStorage.
 */
export function loadPinnedFolders(vaultId: string): string[] {
  try {
    const stored = localStorage.getItem(
      STORAGE_KEY_PINNED_FOLDERS_PREFIX + vaultId
    );
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === "string");
      }
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

/**
 * Persists pinned folders for a specific vault to localStorage.
 */
export function persistPinnedFolders(vaultId: string, paths: string[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_PINNED_FOLDERS_PREFIX + vaultId,
      JSON.stringify(paths)
    );
  } catch {
    // Ignore storage errors
  }
}

/**
 * Loads persisted view mode from localStorage.
 */
export function loadPersistedViewMode(): BrowseViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VIEW_MODE);
    if (stored === "tasks" || stored === "files") {
      return stored;
    }
  } catch {
    // Ignore storage errors
  }
  return "files";
}

/**
 * Persists view mode to localStorage.
 */
export function persistViewMode(mode: BrowseViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_VIEW_MODE, mode);
  } catch {
    // Ignore storage errors
  }
}
