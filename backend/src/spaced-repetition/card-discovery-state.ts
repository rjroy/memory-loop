/**
 * Card Discovery State
 *
 * Persists card discovery tracking state to prevent re-processing files
 * that have already been scanned for card extraction.
 *
 * Spec Requirements:
 * - REQ-F-3: System scans notes for knowledge-worthy blocks during discovery
 * - REQ-F-4: Discovery runs on configurable schedule (daily light, weekly full)
 * - REQ-NF-4: Atomic file writes via temp+rename pattern
 *
 * Plan Reference:
 * - TD-3: File Processing State Tracking
 */

import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { createLogger } from "../logger.js";

const log = createLogger("card-discovery-state");

// =============================================================================
// Constants
// =============================================================================

/**
 * Config directory name within user home.
 */
const CONFIG_DIR = ".config/memory-loop";

/**
 * State file name.
 */
const STATE_FILE = "card-discovery-state.json";

// =============================================================================
// Schema
// =============================================================================

/**
 * Schema for tracking a processed file.
 */
const ProcessedFileSchema = z.object({
  /** Checksum of file content when processed */
  checksum: z.string(),
  /** ISO datetime when file was processed */
  processedAt: z.string().datetime(),
});

/**
 * Schema for weekly progress tracking.
 */
const WeeklyProgressSchema = z.object({
  /** Total bytes processed this week */
  bytesProcessed: z.number().int().min(0).default(0),
  /** Start date of current week (YYYY-MM-DD format), null if not started */
  weekStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

/**
 * Schema for the complete card discovery state.
 */
export const CardDiscoveryStateSchema = z.object({
  /** ISO datetime of last daily discovery run, null if never run */
  lastDailyRun: z.string().datetime().nullable(),
  /** ISO datetime of last weekly discovery run, null if never run */
  lastWeeklyRun: z.string().datetime().nullable(),
  /** Map of file path to processing info */
  processedFiles: z.record(z.string(), ProcessedFileSchema),
  /** Weekly progress tracking */
  weeklyProgress: WeeklyProgressSchema.optional(),
});

// =============================================================================
// Types
// =============================================================================

export type ProcessedFile = z.infer<typeof ProcessedFileSchema>;
export type WeeklyProgress = z.infer<typeof WeeklyProgressSchema>;
export type CardDiscoveryState = z.infer<typeof CardDiscoveryStateSchema>;

// =============================================================================
// Default State
// =============================================================================

/**
 * Create a new empty discovery state.
 */
export function createEmptyState(): CardDiscoveryState {
  return {
    lastDailyRun: null,
    lastWeeklyRun: null,
    processedFiles: {},
    weeklyProgress: {
      bytesProcessed: 0,
      weekStartDate: null,
    },
  };
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the absolute path to the state file.
 *
 * Checks HOME environment variable first (for testing), then uses os.homedir().
 *
 * @returns Absolute path to ~/.config/memory-loop/card-discovery-state.json
 */
export function getStateFilePath(): string {
  // Use HOME env var if set (allows tests to override), else use os.homedir()
  const home = process.env.HOME ?? homedir();
  return join(home, CONFIG_DIR, STATE_FILE);
}

// =============================================================================
// State File Operations
// =============================================================================

/**
 * Read the discovery state from disk.
 * Returns empty state if file doesn't exist (first run).
 *
 * @returns Current discovery state
 */
export async function readDiscoveryState(): Promise<CardDiscoveryState> {
  const statePath = getStateFilePath();

  let content: string;
  try {
    content = await readFile(statePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug("State file not found, returning empty state");
      return createEmptyState();
    }

    log.error(`Failed to read state file: ${(e as Error).message}`);
    throw e;
  }

  // Parse JSON separately to handle parse errors gracefully
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    log.warn(`Invalid JSON in state file at ${statePath}, returning empty state`);
    return createEmptyState();
  }

  // Validate against schema
  const result = CardDiscoveryStateSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(
      `Invalid state file schema at ${statePath}, returning empty state`,
      result.error.issues
    );
    return createEmptyState();
  }

  return result.data;
}

/**
 * Write the discovery state to disk using atomic write pattern.
 *
 * Per REQ-NF-4: Uses temp file + rename for atomic writes.
 *
 * @param state - State to write
 */
export async function writeDiscoveryState(state: CardDiscoveryState): Promise<void> {
  const statePath = getStateFilePath();
  const dir = dirname(statePath);
  const tempPath = join(dir, `.${STATE_FILE}.${Date.now()}.tmp`);

  try {
    // Ensure config directory exists
    await mkdir(dir, { recursive: true });

    // Serialize state to JSON with pretty formatting
    const content = JSON.stringify(state, null, 2);

    // Write to temp file
    await writeFile(tempPath, content, "utf-8");

    // Atomic rename
    await rename(tempPath, statePath);

    log.debug(`Wrote discovery state to ${statePath}`);
  } catch (e) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw e;
  }
}

// =============================================================================
// File Processing Utilities
// =============================================================================

/**
 * Check if a file has already been processed with the given checksum.
 *
 * Returns true if the file is in the state with a matching checksum,
 * indicating no re-processing is needed.
 *
 * @param state - Current discovery state
 * @param path - File path to check
 * @param checksum - Current checksum of file content
 * @returns true if file was processed with same checksum, false otherwise
 */
export function isFileProcessed(
  state: CardDiscoveryState,
  path: string,
  checksum: string
): boolean {
  const processed = state.processedFiles[path];
  if (!processed) {
    return false;
  }
  return processed.checksum === checksum;
}

/**
 * Mark a file as processed with the given checksum.
 *
 * Returns a new state object with the file marked as processed.
 * Does not mutate the input state.
 *
 * @param state - Current discovery state
 * @param path - File path to mark as processed
 * @param checksum - Checksum of file content
 * @returns New state with file marked as processed
 */
export function markFileProcessed(
  state: CardDiscoveryState,
  path: string,
  checksum: string
): CardDiscoveryState {
  const now = new Date().toISOString();

  return {
    ...state,
    processedFiles: {
      ...state.processedFiles,
      [path]: {
        checksum,
        processedAt: now,
      },
    },
  };
}
