/**
 * Extraction Manager and Scheduler
 *
 * Orchestrates the extraction pipeline and schedules daily runs.
 *
 * Spec Requirements:
 * - REQ-F-4: Overnight batch processing
 * - REQ-F-5: Process transcripts from all vaults
 * - REQ-NF-2: Idempotent extraction
 *
 * Plan Reference:
 * - TD-1: Scheduled batch via node-cron
 * - TD-12: Sandbox pattern for safe operations
 */

import { CronJob } from "cron";
import { createLogger } from "../logger.js";
import { getVaultsDir } from "../vault-manager.js";
import {
  readExtractionState,
  writeExtractionState,
  markTranscriptProcessed,
  updateLastRunAt,
  type ExtractionState,
} from "./extraction-state.js";
import { discoverTranscripts } from "./transcript-reader.js";
import { extractFacts } from "./fact-extractor.js";
import {
  setupSandbox,
  commitSandbox,
  cleanupSandbox,
  checkAndRecover,
} from "./memory-writer.js";

const log = createLogger("extraction-manager");

// =============================================================================
// Constants
// =============================================================================

/**
 * Default cron schedule: 3am daily.
 * Can be overridden via EXTRACTION_SCHEDULE environment variable.
 */
export const DEFAULT_CRON_SCHEDULE = "0 3 * * *";

/**
 * Default catch-up threshold: 24 hours in milliseconds.
 * If lastRunAt is older than this, trigger catch-up extraction on startup.
 */
export const DEFAULT_CATCHUP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Environment variable names.
 */
export const ENV_EXTRACTION_SCHEDULE = "EXTRACTION_SCHEDULE";
export const ENV_CATCHUP_THRESHOLD_HOURS = "EXTRACTION_CATCHUP_HOURS";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of an extraction run.
 */
export interface ExtractionRunResult {
  /** Whether the extraction succeeded */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
  /** Number of transcripts discovered */
  transcriptsDiscovered: number;
  /** Number of unprocessed transcripts */
  transcriptsUnprocessed: number;
  /** Number of transcripts processed this run */
  transcriptsProcessed: number;
  /** Number of duplicates filtered */
  duplicatesFiltered: number;
  /** Duration of the extraction in milliseconds */
  durationMs: number;
  /** Whether this was a catch-up run */
  wasCatchUp: boolean;
}

/**
 * Extraction manager instance state.
 */
interface ManagerState {
  /** The cron job instance */
  cronJob: CronJob | null;
  /** Whether an extraction is currently running */
  isRunning: boolean;
  /** Last run result */
  lastResult: ExtractionRunResult | null;
}

// =============================================================================
// Module State
// =============================================================================

const state: ManagerState = {
  cronJob: null,
  isRunning: false,
  lastResult: null,
};

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get the configured cron schedule.
 *
 * @returns Cron expression from environment or default
 */
export function getCronSchedule(): string {
  return process.env[ENV_EXTRACTION_SCHEDULE] ?? DEFAULT_CRON_SCHEDULE;
}

/**
 * Get the configured catch-up threshold in milliseconds.
 *
 * @returns Threshold from environment or default (24 hours)
 */
export function getCatchUpThresholdMs(): number {
  const hoursStr = process.env[ENV_CATCHUP_THRESHOLD_HOURS];
  if (hoursStr) {
    const hours = parseInt(hoursStr, 10);
    if (!isNaN(hours) && hours > 0) {
      return hours * 60 * 60 * 1000;
    }
  }
  return DEFAULT_CATCHUP_THRESHOLD_MS;
}

/**
 * Check if catch-up extraction is needed based on lastRunAt.
 *
 * @param state - Current extraction state
 * @returns True if catch-up is needed
 */
export function needsCatchUp(extractionState: ExtractionState): boolean {
  // Null means never run, so catch-up is always needed
  if (extractionState.lastRunAt === null) {
    return true;
  }

  const threshold = getCatchUpThresholdMs();
  const now = Date.now();
  const lastRunAt = new Date(extractionState.lastRunAt).getTime();

  return now - lastRunAt > threshold;
}

// =============================================================================
// Extraction Pipeline
// =============================================================================

/**
 * Run the full extraction pipeline.
 *
 * Flow:
 * 1. Discover transcripts from all vaults
 * 2. Filter to unprocessed transcripts
 * 3. Setup sandbox (copy memory.md to VAULTS_DIR)
 * 4. Run extraction with Claude Agent SDK
 * 5. Commit sandbox (copy back to ~/.claude/rules)
 * 6. Update extraction state
 * 7. Cleanup sandbox
 *
 * @param isCatchUp - Whether this is a catch-up run
 * @returns Extraction run result
 */
export async function runExtraction(
  isCatchUp: boolean = false
): Promise<ExtractionRunResult> {
  const startTime = Date.now();

  // Prevent concurrent runs
  if (state.isRunning) {
    log.warn("Extraction already in progress, skipping");
    return {
      success: false,
      error: "Extraction already in progress",
      transcriptsDiscovered: 0,
      transcriptsUnprocessed: 0,
      transcriptsProcessed: 0,
      duplicatesFiltered: 0,
      durationMs: Date.now() - startTime,
      wasCatchUp: isCatchUp,
    };
  }

  state.isRunning = true;
  log.info(`Starting extraction run (catchUp: ${isCatchUp})`);

  try {
    const vaultsDir = getVaultsDir();

    // Step 1: Load extraction state
    const extractionState = await readExtractionState();

    // Step 2: Discover and filter transcripts across all vaults
    const discoveryResult = await discoverTranscripts(extractionState);

    // Log any discovery errors
    if (discoveryResult.errors.length > 0) {
      for (const err of discoveryResult.errors) {
        log.warn(`Error reading transcript ${err.path}: ${err.error}`);
      }
    }

    log.info(`Discovered ${discoveryResult.total} total transcript(s)`);

    // Step 3: Get unprocessed transcripts
    const unprocessed = discoveryResult.unprocessed;
    log.info(`Found ${unprocessed.length} unprocessed transcript(s)`);

    if (unprocessed.length === 0) {
      // Nothing to process
      const newState = updateLastRunAt(extractionState);
      await writeExtractionState(newState);

      const result: ExtractionRunResult = {
        success: true,
        transcriptsDiscovered: discoveryResult.total,
        transcriptsUnprocessed: 0,
        transcriptsProcessed: 0,
        duplicatesFiltered: 0,
        durationMs: Date.now() - startTime,
        wasCatchUp: isCatchUp,
      };
      state.lastResult = result;
      log.info(`Extraction complete: no new transcripts to process (${result.durationMs}ms)`);
      return result;
    }

    // Step 4: Setup sandbox
    const sandboxResult = await setupSandbox(vaultsDir);
    if (!sandboxResult.success) {
      throw new Error(`Failed to setup sandbox: ${sandboxResult.error}`);
    }

    try {
      // Step 5: Run extraction
      const extractionResult = await extractFacts(unprocessed, vaultsDir);

      if (!extractionResult.success) {
        throw new Error(`Extraction failed: ${extractionResult.error}`);
      }

      // Step 6: Commit sandbox
      const commitResult = await commitSandbox(vaultsDir);
      if (!commitResult.success) {
        throw new Error(`Failed to commit sandbox: ${commitResult.error}`);
      }

      // Step 7: Update extraction state
      let newState = extractionState;
      for (const transcript of unprocessed) {
        newState = markTranscriptProcessed(
          newState,
          transcript.vaultId,
          transcript.path,
          transcript.checksum
        );
      }
      newState = updateLastRunAt(newState);
      await writeExtractionState(newState);

      const result: ExtractionRunResult = {
        success: true,
        transcriptsDiscovered: discoveryResult.total,
        transcriptsUnprocessed: unprocessed.length,
        transcriptsProcessed: extractionResult.transcriptsProcessed,
        duplicatesFiltered: 0, // TODO: track this from merge
        durationMs: Date.now() - startTime,
        wasCatchUp: isCatchUp,
      };
      state.lastResult = result;

      log.info(
        `Extraction complete: processed ${result.transcriptsProcessed} transcript(s) in ${result.durationMs}ms`
      );

      return result;
    } finally {
      // Step 8: Cleanup sandbox
      await cleanupSandbox(vaultsDir);
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Extraction failed: ${errorMessage}`);

    const result: ExtractionRunResult = {
      success: false,
      error: errorMessage,
      transcriptsDiscovered: 0,
      transcriptsUnprocessed: 0,
      transcriptsProcessed: 0,
      duplicatesFiltered: 0,
      durationMs: Date.now() - startTime,
      wasCatchUp: isCatchUp,
    };
    state.lastResult = result;

    return result;
  } finally {
    state.isRunning = false;
  }
}

// =============================================================================
// Scheduler
// =============================================================================

/**
 * Start the extraction scheduler.
 *
 * Schedules extraction runs according to the configured cron expression.
 * Also performs recovery check and catch-up extraction if needed.
 *
 * @returns True if scheduler started successfully
 */
export async function startScheduler(): Promise<boolean> {
  if (state.cronJob) {
    log.warn("Scheduler already running");
    return false;
  }

  const vaultsDir = getVaultsDir();

  // Recovery check
  try {
    const recoveryResult = await checkAndRecover(vaultsDir);
    if (recoveryResult.recoveryNeeded) {
      log.info(`Recovery performed: ${recoveryResult.action}`);
      if (recoveryResult.error) {
        log.error(`Recovery error: ${recoveryResult.error}`);
      }
    }
  } catch (error) {
    log.error(`Recovery check failed: ${(error as Error).message}`);
  }

  // Check for catch-up extraction
  try {
    const extractionState = await readExtractionState();
    if (needsCatchUp(extractionState)) {
      log.info("Catch-up extraction needed, scheduling...");
      // Run catch-up asynchronously
      void runExtraction(true).catch((error: unknown) => {
        log.error(`Catch-up extraction failed: ${(error as Error).message}`);
      });
    }
  } catch (error) {
    log.error(`Failed to check catch-up status: ${(error as Error).message}`);
  }

  // Start cron job
  const schedule = getCronSchedule();
  log.info(`Starting extraction scheduler with schedule: ${schedule}`);

  try {
    state.cronJob = new CronJob(
      schedule,
      () => {
        void runExtraction(false).catch((error: unknown) => {
          log.error(`Scheduled extraction failed: ${(error as Error).message}`);
        });
      },
      null, // onComplete
      true, // start immediately
      "America/New_York" // timezone
    );

    log.info("Extraction scheduler started");
    return true;
  } catch (error) {
    log.error(`Failed to start scheduler: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Stop the extraction scheduler.
 */
export function stopScheduler(): void {
  if (state.cronJob) {
    void state.cronJob.stop();
    state.cronJob = null;
    log.info("Extraction scheduler stopped");
  }
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return state.cronJob !== null;
}

/**
 * Check if an extraction is currently in progress.
 */
export function isExtractionRunning(): boolean {
  return state.isRunning;
}

/**
 * Get the last extraction run result.
 */
export function getLastRunResult(): ExtractionRunResult | null {
  return state.lastResult;
}

/**
 * Get the next scheduled extraction time.
 *
 * @returns Next run date or null if scheduler not running
 */
export function getNextScheduledRun(): Date | null {
  if (!state.cronJob) {
    return null;
  }
  return state.cronJob.nextDate().toJSDate();
}

/**
 * Reset manager state for testing purposes only.
 * This clears all state including lastResult.
 * @internal
 */
export function resetManagerState(): void {
  stopScheduler();
  state.isRunning = false;
  state.lastResult = null;
}
