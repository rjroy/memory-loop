/**
 * Extraction State Management
 *
 * Manages persistent state for the memory extraction pipeline, tracking
 * which transcripts have been processed to enable incremental extraction.
 *
 * Spec Requirements:
 * - REQ-F-8: Track processed transcripts to avoid reprocessing (via checksum)
 * - REQ-NF-2: Idempotent extraction (safe to re-run without duplication)
 *
 * Plan Reference:
 * - TD-5: Processed Transcript Tracking via JSON manifest at ~/.config/memory-loop/extraction-state.json
 */

import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createLogger } from "../logger.js";

const log = createLogger("extraction-state");

// =============================================================================
// Constants
// =============================================================================

/**
 * Default path for extraction state file.
 * Location: ~/.config/memory-loop/extraction-state.json (per TD-5)
 */
export const DEFAULT_STATE_PATH = join(
  homedir(),
  ".config",
  "memory-loop",
  "extraction-state.json"
);

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Schema for a processed transcript record.
 * Tracks when a transcript was processed and its content checksum.
 */
export const ProcessedTranscriptSchema = z.object({
  /** Relative path from vault root to the transcript file */
  path: z.string().min(1, "Path is required"),

  /** Source vault identifier */
  vaultId: z.string().min(1, "Vault ID is required"),

  /** SHA-256 hash of transcript content at processing time */
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "Checksum must be a valid SHA-256 hash"),

  /** ISO 8601 timestamp when transcript was processed */
  processedAt: z.string().datetime({
    offset: true,
    message: "processedAt must be an ISO 8601 datetime string",
  }),
});

/**
 * Schema for the complete extraction state.
 * Stored at ~/.config/memory-loop/extraction-state.json
 */
export const ExtractionStateSchema = z.object({
  /** ISO 8601 timestamp of last extraction run (null if never run) */
  lastRunAt: z.string().datetime({ offset: true }).nullable(),

  /** Array of processed transcript records */
  processedTranscripts: z.array(ProcessedTranscriptSchema),
});

// =============================================================================
// TypeScript Types (inferred from schemas)
// =============================================================================

export type ProcessedTranscript = z.infer<typeof ProcessedTranscriptSchema>;
export type ExtractionState = z.infer<typeof ExtractionStateSchema>;

// =============================================================================
// Default State
// =============================================================================

/**
 * Returns an empty extraction state for initialization.
 */
export function createEmptyState(): ExtractionState {
  return {
    lastRunAt: null,
    processedTranscripts: [],
  };
}

// =============================================================================
// Checksum Calculation
// =============================================================================

/**
 * Calculate SHA-256 checksum of content.
 *
 * Used to detect transcript modifications. If a transcript's content changes,
 * its checksum will differ from the stored value, triggering reprocessing.
 *
 * @param content - String content to hash
 * @returns 64-character lowercase hex string (SHA-256)
 */
export function calculateChecksum(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// =============================================================================
// Transcript Processing Check
// =============================================================================

/**
 * Check if a transcript has already been processed with the same content.
 *
 * Returns true if the transcript is found in state with a matching checksum,
 * meaning it doesn't need to be reprocessed. Returns false if:
 * - The transcript has never been processed
 * - The transcript's content has changed (different checksum)
 *
 * @param state - Current extraction state
 * @param vaultId - Vault identifier
 * @param path - Relative path to transcript
 * @param currentChecksum - Checksum of current transcript content
 * @returns true if transcript was already processed with same content
 */
export function isTranscriptProcessed(
  state: ExtractionState,
  vaultId: string,
  path: string,
  currentChecksum: string
): boolean {
  const existing = state.processedTranscripts.find(
    (t) => t.vaultId === vaultId && t.path === path
  );

  if (!existing) {
    return false;
  }

  // Transcript exists but content may have changed
  return existing.checksum === currentChecksum;
}

/**
 * Find all transcripts that need processing (new or modified).
 *
 * @param state - Current extraction state
 * @param transcripts - Array of transcripts to check, each with vaultId, path, and content
 * @returns Array of transcripts that need processing
 */
export function findUnprocessedTranscripts<T extends { vaultId: string; path: string; content: string }>(
  state: ExtractionState,
  transcripts: T[]
): T[] {
  return transcripts.filter((t) => {
    const checksum = calculateChecksum(t.content);
    return !isTranscriptProcessed(state, t.vaultId, t.path, checksum);
  });
}

// =============================================================================
// State Persistence
// =============================================================================

/**
 * Read extraction state from disk.
 *
 * Returns an empty state if:
 * - The state file doesn't exist
 * - The state file contains invalid JSON
 * - The state file fails schema validation
 *
 * This design ensures extraction can always proceed, even on first run
 * or after state file corruption.
 *
 * @param statePath - Path to state file (defaults to ~/.config/memory-loop/extraction-state.json)
 * @returns Parsed extraction state, or empty state on error
 */
export async function readExtractionState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<ExtractionState> {
  try {
    const content = await readFile(statePath, "utf-8");
    const data: unknown = JSON.parse(content);
    const result = ExtractionStateSchema.safeParse(data);

    if (result.success) {
      log.debug(`Loaded extraction state with ${result.data.processedTranscripts.length} transcripts`);
      return result.data;
    }

    log.warn(`Invalid extraction state at ${statePath}: ${result.error.message}`);
    return createEmptyState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug(`No extraction state file at ${statePath}, starting fresh`);
    } else {
      log.warn(`Failed to read extraction state: ${(error as Error).message}`);
    }
    return createEmptyState();
  }
}

/**
 * Write extraction state to disk atomically.
 *
 * Uses temp file + rename pattern to prevent partial writes if the
 * process is interrupted. Creates parent directories if needed.
 *
 * @param state - State to persist
 * @param statePath - Path to state file (defaults to ~/.config/memory-loop/extraction-state.json)
 * @throws Error if write fails
 */
export async function writeExtractionState(
  state: ExtractionState,
  statePath: string = DEFAULT_STATE_PATH
): Promise<void> {
  // Validate state before writing
  const result = ExtractionStateSchema.safeParse(state);
  if (!result.success) {
    throw new Error(`Invalid extraction state: ${result.error.message}`);
  }

  const dir = dirname(statePath);
  const tempPath = join(dir, `.extraction-state.${Date.now()}.tmp`);

  try {
    // Ensure parent directory exists
    await mkdir(dir, { recursive: true });

    // Write to temp file
    const content = JSON.stringify(state, null, 2) + "\n";
    await writeFile(tempPath, content, "utf-8");

    // Atomic rename
    await rename(tempPath, statePath);

    log.debug(`Wrote extraction state with ${state.processedTranscripts.length} transcripts`);
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// =============================================================================
// State Update Helpers
// =============================================================================

/**
 * Mark a transcript as processed in the state.
 *
 * If the transcript was previously processed, updates the checksum and timestamp.
 * Otherwise, adds a new record.
 *
 * @param state - Current extraction state (mutated in place)
 * @param vaultId - Vault identifier
 * @param path - Relative path to transcript
 * @param checksum - SHA-256 checksum of transcript content
 * @returns The updated state (same reference)
 */
export function markTranscriptProcessed(
  state: ExtractionState,
  vaultId: string,
  path: string,
  checksum: string
): ExtractionState {
  const now = new Date().toISOString();
  const existingIndex = state.processedTranscripts.findIndex(
    (t) => t.vaultId === vaultId && t.path === path
  );

  if (existingIndex >= 0) {
    // Update existing record
    state.processedTranscripts[existingIndex] = {
      path,
      vaultId,
      checksum,
      processedAt: now,
    };
  } else {
    // Add new record
    state.processedTranscripts.push({
      path,
      vaultId,
      checksum,
      processedAt: now,
    });
  }

  return state;
}

/**
 * Update the lastRunAt timestamp.
 *
 * @param state - Current extraction state (mutated in place)
 * @returns The updated state (same reference)
 */
export function updateLastRunAt(state: ExtractionState): ExtractionState {
  state.lastRunAt = new Date().toISOString();
  return state;
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Parse and validate extraction state data.
 *
 * @throws ZodError if validation fails
 */
export function parseExtractionState(data: unknown): ExtractionState {
  return ExtractionStateSchema.parse(data);
}

/**
 * Safely parse extraction state, returning success/error result.
 */
export function safeParseExtractionState(data: unknown) {
  return ExtractionStateSchema.safeParse(data);
}

/**
 * Format a Zod validation error into an actionable message.
 */
export function formatExtractionStateError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });
  return "Invalid extraction state:\n" + issues.join("\n");
}
