/**
 * Card Discovery Scheduler
 *
 * Scheduled card discovery with daily and weekly passes.
 * Discovers markdown files across all vaults and extracts Q&A cards.
 *
 * Spec Requirements:
 * - REQ-F-3: System scans notes for knowledge-worthy blocks during discovery
 * - REQ-F-4: Discovery runs on configurable schedule (daily light, weekly full)
 * - REQ-NF-4: Atomic file writes via temp+rename pattern
 *
 * Plan Reference:
 * - TASK-010: Card Discovery Scheduler
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { discoverVaults } from "../vault-manager.js";
import type { VaultInfo } from "@memory-loop/shared";
import { createLogger } from "../logger.js";
import {
  readDiscoveryState,
  writeDiscoveryState,
  isFileProcessed,
  markFileProcessed,
  type CardDiscoveryState,
} from "./card-discovery-state.js";
import { createQACardGenerator } from "./card-generator.js";
import { createCard, type VaultPathInfo } from "./card-manager.js";

const log = createLogger("card-discovery-scheduler");

// =============================================================================
// Constants
// =============================================================================

/** Default cron hour for daily discovery (4am local time) */
export const DEFAULT_DISCOVERY_HOUR = 4;

/** Weekly catch-up byte limit per run (500KB) */
export const WEEKLY_CATCH_UP_LIMIT = 500 * 1024;

/** Milliseconds in a day (24 hours) */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Milliseconds in a week (7 days) */
const MS_PER_WEEK = 7 * MS_PER_DAY;

// =============================================================================
// Types
// =============================================================================

/**
 * File to process for card discovery.
 */
export interface FileToProcess {
  /** Absolute path to the file */
  absolutePath: string;
  /** Relative path within vault */
  relativePath: string;
  /** File size in bytes */
  size: number;
  /** Last modification time */
  mtime: Date;
  /** Vault info */
  vault: VaultInfo;
}

/**
 * Discovery run statistics.
 */
export interface DiscoveryStats {
  /** Number of files scanned */
  filesScanned: number;
  /** Number of files processed successfully (LLM returned a result) */
  filesProcessed: number;
  /** Number of files skipped (already processed with same checksum) */
  filesSkipped: number;
  /** Number of files that failed with retriable errors (will retry next run) */
  filesRetriable: number;
  /** Number of cards created */
  cardsCreated: number;
  /** Total bytes processed */
  bytesProcessed: number;
  /** Number of permanent errors encountered */
  errors: number;
}

/**
 * Options for the discovery scheduler.
 */
export interface SchedulerOptions {
  /** Hour of day to run daily discovery (0-23, default: 3) */
  discoveryHour?: number;
  /** Whether to run catch-up on startup if last run > 24h ago */
  catchUpOnStartup?: boolean;
  /** Function to get current time (for testing) */
  getNow?: () => Date;
}

// =============================================================================
// File Discovery
// =============================================================================

/**
 * Calculate SHA-256 checksum of content.
 *
 * @param content - Content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function calculateChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Recursively discover all markdown files in a directory.
 *
 * @param basePath - Base path to scan
 * @param vault - Vault info
 * @param relativePath - Current relative path (for recursion)
 * @returns Array of files to process
 */
async function discoverMarkdownFiles(
  basePath: string,
  vault: VaultInfo,
  relativePath: string = ""
): Promise<FileToProcess[]> {
  const files: FileToProcess[] = [];
  const currentPath = relativePath ? join(basePath, relativePath) : basePath;

  let entries: string[];
  try {
    entries = await readdir(currentPath);
  } catch {
    return files;
  }

  for (const entry of entries) {
    // Skip hidden files and directories
    if (entry.startsWith(".")) {
      continue;
    }

    const entryRelPath = relativePath ? `${relativePath}/${entry}` : entry;
    const entryAbsPath = join(basePath, entryRelPath);

    let stats;
    try {
      stats = await stat(entryAbsPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      // Skip metadata directory (cards are stored here)
      if (entry === "06_Metadata" || entryRelPath === vault.metadataPath) {
        continue;
      }
      // Skip chat transcripts directory (ephemeral, not curated knowledge)
      if (entryRelPath === `${vault.inboxPath}/chats`) {
        continue;
      }
      // Recurse into subdirectory
      const subFiles = await discoverMarkdownFiles(basePath, vault, entryRelPath);
      files.push(...subFiles);
    } else if (stats.isFile() && extname(entry).toLowerCase() === ".md") {
      // Skip CLAUDE.md files (project instructions, not knowledge content)
      if (entry === "CLAUDE.md") {
        continue;
      }
      files.push({
        absolutePath: entryAbsPath,
        relativePath: entryRelPath,
        size: stats.size,
        mtime: stats.mtime,
        vault,
      });
    }
  }

  return files;
}

/**
 * Discover all markdown files across all vaults.
 * Skips vaults with cardsEnabled === false.
 *
 * @returns Array of files to process
 */
export async function discoverAllFiles(): Promise<FileToProcess[]> {
  const vaults = await discoverVaults();
  const allFiles: FileToProcess[] = [];
  let skippedVaults = 0;

  for (const vault of vaults) {
    // Skip vaults with card discovery disabled
    if (!vault.cardsEnabled) {
      log.debug(`Skipping vault ${vault.name}: card discovery disabled`);
      skippedVaults++;
      continue;
    }

    try {
      const vaultFiles = await discoverMarkdownFiles(vault.contentRoot, vault);
      allFiles.push(...vaultFiles);
      log.debug(`Found ${vaultFiles.length} markdown files in vault: ${vault.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Failed to scan vault ${vault.name}: ${msg}`);
    }
  }

  const enabledVaults = vaults.length - skippedVaults;
  log.info(`Discovered ${allFiles.length} total markdown files across ${enabledVaults} vaults (${skippedVaults} skipped)`);
  return allFiles;
}

// =============================================================================
// File Processing
// =============================================================================

/**
 * Process a single file for card extraction.
 *
 * Only marks file as processed if generation succeeds. Retriable errors
 * (rate limits, network issues) leave the file unprocessed for retry.
 *
 * @param file - File to process
 * @param state - Current discovery state
 * @param stats - Stats to update
 * @returns Updated state (file marked as processed only on success)
 */
async function processFile(
  file: FileToProcess,
  state: CardDiscoveryState,
  stats: DiscoveryStats
): Promise<CardDiscoveryState> {
  // Read file content
  let content: string;
  try {
    content = await readFile(file.absolutePath, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Failed to read file ${file.relativePath}: ${msg}`);
    stats.errors++;
    return state;
  }

  // Calculate checksum
  const checksum = calculateChecksum(content);

  // Check if already processed with same checksum
  if (isFileProcessed(state, file.absolutePath, checksum)) {
    log.debug(`Skipping ${file.relativePath}: already processed with same checksum`);
    stats.filesSkipped++;
    return state;
  }

  // Generate cards from content
  const generator = createQACardGenerator();
  const result = await generator.generate(content, file.relativePath);

  // Handle generation failure - don't mark as processed so it retries
  if (!result.success) {
    if (result.retriable) {
      log.warn(`Retriable error for ${file.relativePath}: ${result.error} (will retry next run)`);
      stats.filesRetriable++;
    } else {
      log.error(`Permanent error for ${file.relativePath}: ${result.error}`);
      stats.errors++;
      // Mark permanent failures as processed to avoid infinite retries
      return markFileProcessed(state, file.absolutePath, checksum);
    }
    return state;
  }

  // Generation succeeded
  stats.filesProcessed++;
  stats.bytesProcessed += file.size;

  // Skipped files (too short) are marked as processed but don't create cards
  if (result.skipped) {
    return markFileProcessed(state, file.absolutePath, checksum);
  }

  // Create cards via CardManager
  const vaultPathInfo: VaultPathInfo = {
    contentRoot: file.vault.contentRoot,
    metadataPath: file.vault.metadataPath,
  };

  for (const card of result.cards) {
    try {
      const createResult = await createCard(vaultPathInfo, {
        question: card.question,
        answer: card.answer,
        sourceFile: file.relativePath,
      });
      if (createResult.success) {
        stats.cardsCreated++;
      } else {
        log.warn(`Failed to create card: ${createResult.error}`);
        stats.errors++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Exception creating card: ${msg}`);
      stats.errors++;
    }
  }

  // Mark file as processed only after successful generation
  return markFileProcessed(state, file.absolutePath, checksum);
}

// =============================================================================
// Discovery Passes
// =============================================================================

/**
 * Run daily discovery pass.
 * Processes files modified in the last 24 hours.
 *
 * @param getNow - Function to get current time (for testing)
 * @returns Discovery statistics
 */
export async function runDailyPass(getNow: () => Date = () => new Date()): Promise<DiscoveryStats> {
  const stats: DiscoveryStats = {
    filesScanned: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    filesRetriable: 0,
    cardsCreated: 0,
    bytesProcessed: 0,
    errors: 0,
  };

  const now = getNow();
  const cutoffTime = new Date(now.getTime() - MS_PER_DAY);

  log.info(`Starting daily discovery pass (files modified since ${cutoffTime.toISOString()})`);

  // Discover all files
  const allFiles = await discoverAllFiles();
  stats.filesScanned = allFiles.length;

  // Filter to recently modified files
  const recentFiles = allFiles.filter((f) => f.mtime >= cutoffTime);
  log.info(`Found ${recentFiles.length} files modified in last 24 hours`);

  if (recentFiles.length === 0) {
    log.info("No recent files to process");
    return stats;
  }

  // Load current state
  let state = await readDiscoveryState();

  // Process each file, saving state after each to prevent repeat work on crash
  for (const file of recentFiles) {
    const prevState = state;
    state = await processFile(file, state, stats);
    // Save immediately if state changed (file was processed or marked)
    if (state !== prevState) {
      await writeDiscoveryState(state);
    }
  }

  // Determine if run was successful enough to mark as complete
  // If mostly retriable errors (e.g., rate limit), don't mark as complete so next run retries
  const totalAttempted = stats.filesProcessed + stats.filesSkipped + stats.filesRetriable + stats.errors;
  const successfullyHandled = stats.filesProcessed + stats.filesSkipped;
  const runSuccessful = totalAttempted === 0 || successfullyHandled > stats.filesRetriable;

  if (runSuccessful) {
    state = {
      ...state,
      lastDailyRun: now.toISOString(),
    };
    log.info(
      `Daily pass complete: ${stats.filesProcessed} processed, ${stats.cardsCreated} cards, ${stats.filesSkipped} skipped, ${stats.filesRetriable} retriable, ${stats.errors} errors`
    );
  } else {
    log.warn(
      `Daily pass incomplete (${stats.filesRetriable} retriable errors) - will retry next run. ` +
      `${stats.filesProcessed} processed, ${stats.cardsCreated} cards, ${stats.filesSkipped} skipped, ${stats.errors} permanent errors`
    );
  }

  // Always save state (processed files are tracked even on incomplete runs)
  await writeDiscoveryState(state);

  return stats;
}

/**
 * Run weekly catch-up pass.
 * Processes oldest unprocessed files up to the byte limit.
 *
 * @param byteLimit - Maximum bytes to process (default: 500KB)
 * @param getNow - Function to get current time (for testing)
 * @returns Discovery statistics
 */
export async function runWeeklyPass(
  byteLimit: number = WEEKLY_CATCH_UP_LIMIT,
  getNow: () => Date = () => new Date()
): Promise<DiscoveryStats> {
  const stats: DiscoveryStats = {
    filesScanned: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    filesRetriable: 0,
    cardsCreated: 0,
    bytesProcessed: 0,
    errors: 0,
  };

  log.info(`Starting weekly catch-up pass (limit: ${byteLimit} bytes)`);

  // Discover all files
  const allFiles = await discoverAllFiles();
  stats.filesScanned = allFiles.length;

  // Load current state
  let state = await readDiscoveryState();

  // Check/reset weekly progress
  const now = getNow();
  const weekStart = getWeekStart(now);
  if (state.weeklyProgress?.weekStartDate !== weekStart) {
    // New week, reset progress
    state = {
      ...state,
      weeklyProgress: {
        bytesProcessed: 0,
        weekStartDate: weekStart,
      },
    };
  }

  const weeklyBytesRemaining = byteLimit - (state.weeklyProgress?.bytesProcessed ?? 0);
  if (weeklyBytesRemaining <= 0) {
    log.info("Weekly byte limit already reached");
    return stats;
  }

  // Filter to unprocessed files and sort by oldest first
  const unprocessedFiles: FileToProcess[] = [];
  for (const file of allFiles) {
    // Quick check without reading content - if path isn't in state, it's unprocessed
    if (!state.processedFiles[file.absolutePath]) {
      unprocessedFiles.push(file);
    }
  }

  // Sort by modification time (oldest first)
  unprocessedFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

  log.info(`Found ${unprocessedFiles.length} unprocessed files`);

  if (unprocessedFiles.length === 0) {
    log.info("No unprocessed files to catch up on");
    return stats;
  }

  // Process files up to byte limit, saving state after each to prevent repeat work
  let bytesThisRun = 0;
  for (const file of unprocessedFiles) {
    if (bytesThisRun + file.size > weeklyBytesRemaining) {
      log.info(`Stopping: would exceed weekly byte limit`);
      break;
    }

    const prevState = state;
    state = await processFile(file, state, stats);
    bytesThisRun += file.size;
    // Save immediately if state changed (file was processed or marked)
    if (state !== prevState) {
      await writeDiscoveryState(state);
    }
  }

  // Determine if run was successful enough to mark as complete
  const totalAttempted = stats.filesProcessed + stats.filesSkipped + stats.filesRetriable + stats.errors;
  const successfullyHandled = stats.filesProcessed + stats.filesSkipped;
  const runSuccessful = totalAttempted === 0 || successfullyHandled > stats.filesRetriable;

  // Always update weekly progress (bytes attempted), but only update lastWeeklyRun on success
  state = {
    ...state,
    weeklyProgress: {
      bytesProcessed: (state.weeklyProgress?.bytesProcessed ?? 0) + bytesThisRun,
      weekStartDate: weekStart,
    },
  };

  if (runSuccessful) {
    state = { ...state, lastWeeklyRun: now.toISOString() };
    log.info(
      `Weekly pass complete: ${stats.filesProcessed} processed, ${stats.cardsCreated} cards, ${stats.filesRetriable} retriable, ${stats.errors} errors, ${stats.bytesProcessed} bytes`
    );
  } else {
    log.warn(
      `Weekly pass incomplete (${stats.filesRetriable} retriable errors) - will retry. ` +
      `${stats.filesProcessed} processed, ${stats.cardsCreated} cards, ${stats.errors} permanent errors, ${stats.bytesProcessed} bytes`
    );
  }

  await writeDiscoveryState(state);
  return stats;
}

/**
 * Get the start of the current week (Monday) in YYYY-MM-DD format.
 *
 * @param date - Date to get week start for
 * @returns Week start date string
 */
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust to Monday (day 1). Sunday (0) becomes -6, others subtract to Monday.
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

// =============================================================================
// Scheduler
// =============================================================================

/**
 * Scheduler state for managing discovery runs.
 */
interface SchedulerState {
  /** Timer ID for daily check interval */
  timerId: ReturnType<typeof setInterval> | null;
  /** Whether scheduler is running */
  running: boolean;
}

/**
 * Global scheduler state.
 */
const schedulerState: SchedulerState = {
  timerId: null,
  running: false,
};

/**
 * Check if it's time to run daily discovery.
 *
 * @param hour - Hour to run (0-23)
 * @param lastRun - Last run time (ISO string or null)
 * @param getNow - Function to get current time
 * @returns true if should run
 */
export function shouldRunDaily(
  hour: number,
  lastRun: string | null,
  getNow: () => Date = () => new Date()
): boolean {
  const now = getNow();
  const currentHour = now.getHours();

  // Only run at the configured hour
  if (currentHour !== hour) {
    return false;
  }

  // If never run, run now
  if (!lastRun) {
    return true;
  }

  // Check if last run was before today at the configured hour
  const lastRunDate = new Date(lastRun);
  const todayAtHour = new Date(now);
  todayAtHour.setHours(hour, 0, 0, 0);

  return lastRunDate < todayAtHour;
}

/**
 * Check if it's time to run weekly catch-up.
 * Runs on Sundays at the configured hour.
 *
 * @param hour - Hour to run (0-23)
 * @param lastRun - Last run time (ISO string or null)
 * @param getNow - Function to get current time
 * @returns true if should run
 */
export function shouldRunWeekly(
  hour: number,
  lastRun: string | null,
  getNow: () => Date = () => new Date()
): boolean {
  const now = getNow();
  const dayOfWeek = now.getDay();
  const currentHour = now.getHours();

  // Only run on Sundays at the configured hour
  if (dayOfWeek !== 0 || currentHour !== hour) {
    return false;
  }

  // If never run, run now
  if (!lastRun) {
    return true;
  }

  // Check if last run was more than a week ago
  const lastRunDate = new Date(lastRun);
  const weekAgo = new Date(now.getTime() - MS_PER_WEEK);

  return lastRunDate < weekAgo;
}

/**
 * Check if catch-up should run on startup.
 *
 * Returns false for first run ever - let weekly catch-up handle the backlog
 * gradually instead of processing everything at once.
 *
 * @param lastRun - Last daily run time (ISO string or null)
 * @param getNow - Function to get current time
 * @returns true if should run catch-up (only if has run before and >24h ago)
 */
export function shouldCatchUpOnStartup(
  lastRun: string | null,
  getNow: () => Date = () => new Date()
): boolean {
  // First run ever: don't do catch-up, let weekly pass handle the backlog
  if (!lastRun) {
    return false;
  }

  const lastRunDate = new Date(lastRun);
  const now = getNow();
  const dayAgo = new Date(now.getTime() - MS_PER_DAY);

  return lastRunDate < dayAgo;
}

/**
 * Start the card discovery scheduler.
 *
 * @param options - Scheduler options
 */
export async function startScheduler(options: SchedulerOptions = {}): Promise<void> {
  if (schedulerState.running) {
    log.warn("Scheduler already running");
    return;
  }

  const discoveryHour = options.discoveryHour ?? DEFAULT_DISCOVERY_HOUR;
  const catchUpOnStartup = options.catchUpOnStartup ?? true;
  const getNow = options.getNow ?? (() => new Date());

  log.info(`Starting card discovery scheduler (daily at ${discoveryHour}:00)`);
  schedulerState.running = true;

  // Check for catch-up on startup (only if has run before and >24h ago)
  // First run ever skips catch-up - let weekly pass handle the backlog gradually
  if (catchUpOnStartup) {
    const state = await readDiscoveryState();
    const isFirstRun = state.lastDailyRun === null;
    if (isFirstRun) {
      log.info("First run - skipping catch-up, weekly pass will handle backlog");
    } else if (shouldCatchUpOnStartup(state.lastDailyRun, getNow)) {
      log.info("Running catch-up discovery (last run > 24h ago)");
      try {
        await runDailyPass(getNow);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Catch-up discovery failed: ${msg}`);
      }
    }
  }

  // Set up hourly check for scheduled runs
  schedulerState.timerId = setInterval(() => {
    void (async () => {
      try {
        const state = await readDiscoveryState();

        // Check for daily run
        if (shouldRunDaily(discoveryHour, state.lastDailyRun, getNow)) {
          log.info("Running scheduled daily discovery");
          await runDailyPass(getNow);
        }

        // Check for weekly run
        if (shouldRunWeekly(discoveryHour, state.lastWeeklyRun, getNow)) {
          log.info("Running scheduled weekly catch-up");
          await runWeeklyPass(WEEKLY_CATCH_UP_LIMIT, getNow);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Scheduled discovery check failed: ${msg}`);
      }
    })();
  }, 60 * 60 * 1000); // Check every hour
}

/**
 * Stop the card discovery scheduler.
 */
export function stopScheduler(): void {
  if (!schedulerState.running) {
    log.warn("Scheduler not running");
    return;
  }

  if (schedulerState.timerId) {
    clearInterval(schedulerState.timerId);
    schedulerState.timerId = null;
  }

  schedulerState.running = false;
  log.info("Card discovery scheduler stopped");
}

/**
 * Check if scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return schedulerState.running;
}

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * Get the configured discovery hour from environment.
 *
 * @returns Hour (0-23) or default
 */
export function getDiscoveryHourFromEnv(): number {
  const envValue = process.env.CARD_DISCOVERY_HOUR;
  if (!envValue) {
    return DEFAULT_DISCOVERY_HOUR;
  }

  const hour = parseInt(envValue, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    log.warn(`Invalid CARD_DISCOVERY_HOUR: ${envValue}, using default ${DEFAULT_DISCOVERY_HOUR}`);
    return DEFAULT_DISCOVERY_HOUR;
  }

  return hour;
}
