/**
 * Inspiration Manager
 *
 * Handles parsing, generation, and selection of inspiration content
 * (contextual prompts and inspirational quotes).
 *
 * File format:
 * <!-- last-generated: YYYY-MM-DD -->
 * OR for quotes: <!-- last-generated: YYYY-MM-DD (week NN) -->
 *
 * - "Quote text" -- Source
 * - "Quote text without attribution"
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// =============================================================================
// File Path Constants
// =============================================================================

/** Path to contextual prompts file relative to vault root */
export const CONTEXTUAL_PROMPTS_PATH =
  "06_Metadata/memory-loop/contextual-prompts.md";

/** Path to general inspiration file relative to vault root */
export const GENERAL_INSPIRATION_PATH =
  "06_Metadata/memory-loop/general-inspiration.md";

// =============================================================================
// Date Utility Functions
// =============================================================================

/**
 * Get ISO week number for a date
 *
 * ISO 8601 definition:
 * - Week starts on Monday
 * - Week 1 is the week containing the first Thursday of the year
 * - Week numbers range from 1 to 52 (or 53 in some years)
 *
 * @param date - The date to get the week number for
 * @returns ISO week number (1-53)
 */
export function getISOWeekNumber(date: Date): number {
  // Create a copy in UTC to avoid timezone issues
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );

  // Get the day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  // Convert to ISO day (1 = Monday, ..., 7 = Sunday)
  const dayNum = d.getUTCDay() || 7;

  // Set to nearest Thursday (current date + 4 - current day number)
  // This ensures we're in the correct ISO week year
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate week number
  // Days from start of year / 7, rounded up
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Check if a date is a weekday (Monday through Friday)
 *
 * Uses local timezone (not UTC) because this check determines
 * whether to generate prompts based on the user's perceived weekday,
 * matching the server's local date for consistency.
 *
 * @param date - The date to check
 * @returns true if Monday-Friday, false if Saturday or Sunday
 */
export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  return day >= 1 && day <= 5;
}

// =============================================================================
// Generation Check Functions
// =============================================================================

/**
 * Check if contextual prompt generation is needed
 *
 * Returns true if ALL of the following are true:
 * - It's a weekday (Mon-Fri)
 * - AND one of:
 *   - File doesn't exist
 *   - Generation marker is missing
 *   - Not generated today (different date)
 *
 * @param vaultPath - Path to the vault root
 * @returns true if generation is needed, false otherwise
 */
export async function isContextualGenerationNeeded(
  vaultPath: string
): Promise<boolean> {
  const today = new Date();

  // Only generate on weekdays (Mon-Fri)
  if (!isWeekday(today)) {
    return false;
  }

  const filePath = `${vaultPath}/${CONTEXTUAL_PROMPTS_PATH}`;
  const parsed = await parseInspirationFile(filePath);

  // If file missing or no marker, generation is needed
  if (!parsed.lastGenerated) {
    return true;
  }

  // Compare dates (year, month, day) - ignore time component
  const generatedDate = parsed.lastGenerated;
  const sameDate =
    generatedDate.getFullYear() === today.getFullYear() &&
    generatedDate.getMonth() === today.getMonth() &&
    generatedDate.getDate() === today.getDate();

  // Generation needed if NOT the same date
  return !sameDate;
}

/**
 * Check if inspirational quote generation is needed
 *
 * Returns true if ANY of the following are true:
 * - File doesn't exist
 * - Generation marker is missing
 * - Not generated this ISO week (different week or year)
 *
 * @param vaultPath - Path to the vault root
 * @returns true if generation is needed, false otherwise
 */
export async function isQuoteGenerationNeeded(
  vaultPath: string
): Promise<boolean> {
  const today = new Date();
  const currentWeek = getISOWeekNumber(today);
  const currentYear = today.getFullYear();

  const filePath = `${vaultPath}/${GENERAL_INSPIRATION_PATH}`;
  const parsed = await parseInspirationFile(filePath);

  // If file missing or no marker, generation is needed
  if (!parsed.lastGenerated) {
    return true;
  }

  // Use week number from marker if available, otherwise calculate from date
  const generatedWeek =
    parsed.weekNumber ?? getISOWeekNumber(parsed.lastGenerated);
  const generatedYear = parsed.lastGenerated.getFullYear();

  // Same year AND same week = already generated this week
  const sameWeek = generatedYear === currentYear && generatedWeek === currentWeek;

  // Generation needed if NOT the same week
  return !sameWeek;
}

// =============================================================================
// Context Gathering Configuration
// =============================================================================

/** Maximum context size in characters (~800 tokens at ~4 chars/token) */
export const MAX_CONTEXT_CHARS = 3200;

/** Maximum entries in each inspiration pool (REQ-F-19, REQ-F-24) */
export const MAX_POOL_SIZE = 50;

/** Path to inbox folder containing daily notes */
export const INBOX_PATH = "00_Inbox";

/** Path to projects folder */
export const PROJECTS_PATH = "01_Projects";

/** Path to areas folder */
export const AREAS_PATH = "02_Areas";

/**
 * Day type for context configuration
 * - monday: Previous week's notes + projects
 * - midweek: Previous day's note (Tue-Thu)
 * - friday: Current week's notes + areas
 * - weekend: No generation (Saturday-Sunday)
 */
export type DayType = "monday" | "midweek" | "friday" | "weekend";

/**
 * Context configuration for each day type
 */
export interface DayContextConfig {
  /** Days of daily notes to include (relative to today, negative = past) */
  dailyNoteDays: number[];
  /** Additional folder to scan for README/index.md files */
  additionalFolder?: string;
}

/**
 * Mapping of day types to their context gathering configuration
 *
 * REQ-F-15: Day-specific context for contextual generation
 * REQ-F-18: Easily configurable day-to-context mapping
 */
export const DAY_CONTEXT_CONFIG: Record<DayType, DayContextConfig> = {
  // Monday: Previous week's daily notes (7 days) + projects
  monday: {
    dailyNoteDays: [-7, -6, -5, -4, -3, -2, -1],
    additionalFolder: PROJECTS_PATH,
  },
  // Tuesday-Thursday: Previous day's daily note only
  midweek: {
    dailyNoteDays: [-1],
  },
  // Friday: Current week's daily notes (Mon-Fri) + areas
  friday: {
    dailyNoteDays: [-4, -3, -2, -1, 0],
    additionalFolder: AREAS_PATH,
  },
  // Weekend: No context (generation doesn't run)
  weekend: {
    dailyNoteDays: [],
  },
};

// =============================================================================
// Context Gathering Functions
// =============================================================================

/**
 * Get the day type for a given date
 *
 * @param date - The date to check
 * @returns DayType for the given day
 */
export function getDayType(date: Date): DayType {
  const day = date.getDay();
  // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  if (day === 0 || day === 6) return "weekend";
  if (day === 1) return "monday";
  if (day === 5) return "friday";
  return "midweek";
}

/**
 * Format a date as YYYY-MM-DD for daily note filename
 *
 * @param date - The date to format
 * @returns Formatted date string
 */
export function formatDateForDailyNote(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get a date offset by a number of days from a base date
 *
 * @param baseDate - The starting date
 * @param dayOffset - Number of days to offset (negative = past)
 * @returns New date with offset applied
 */
export function getDateWithOffset(baseDate: Date, dayOffset: number): Date {
  const result = new Date(baseDate);
  result.setDate(result.getDate() + dayOffset);
  return result;
}

/**
 * Read a daily note file from the inbox
 *
 * @param vaultPath - Path to the vault root
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns File content or null if not found
 */
export async function readDailyNote(
  vaultPath: string,
  dateStr: string
): Promise<string | null> {
  const filePath = join(vaultPath, INBOX_PATH, `${dateStr}.md`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist or can't be read - return null gracefully
    return null;
  }
}

/**
 * Read README.md or index.md from a project/area folder
 *
 * @param folderPath - Path to the project/area folder
 * @returns File content or null if not found
 */
export async function readFolderIndex(
  folderPath: string
): Promise<string | null> {
  // Try README.md first, then index.md (per REQ-F-17)
  for (const filename of ["README.md", "index.md"]) {
    const filePath = join(folderPath, filename);
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      // Continue to next filename
    }
  }
  return null;
}

/**
 * Get all subfolder paths within a directory
 *
 * @param dirPath - Path to the directory
 * @returns Array of subfolder paths
 */
export async function getSubfolders(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dirPath, entry.name));
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }
}

/**
 * Content item with date for ordering
 */
interface ContentItem {
  date: Date;
  content: string;
  source: string;
}

/**
 * Gather context for contextual prompt generation based on day of week
 *
 * REQ-F-15: Day-specific context gathering
 * REQ-F-16: Daily notes in 00_Inbox/ with YYYY-MM-DD.md pattern
 * REQ-F-17: Project/area README or index files
 * REQ-NF-2: Cap context at ~800 tokens (~3200 chars)
 *
 * @param vaultPath - Path to the vault root
 * @param today - Optional date override for testing (defaults to now)
 * @returns Gathered context string, empty if no content found
 */
export async function gatherDayContext(
  vaultPath: string,
  today: Date = new Date()
): Promise<string> {
  const dayType = getDayType(today);
  const config = DAY_CONTEXT_CONFIG[dayType];

  // Weekend returns empty (no generation)
  if (dayType === "weekend") {
    return "";
  }

  const contentItems: ContentItem[] = [];

  // Gather daily notes
  for (const dayOffset of config.dailyNoteDays) {
    const targetDate = getDateWithOffset(today, dayOffset);
    const dateStr = formatDateForDailyNote(targetDate);
    const content = await readDailyNote(vaultPath, dateStr);

    if (content && content.trim()) {
      contentItems.push({
        date: targetDate,
        content: content.trim(),
        source: `Daily Note: ${dateStr}`,
      });
    }
  }

  // Gather additional folder content (projects/areas)
  if (config.additionalFolder) {
    const folderPath = join(vaultPath, config.additionalFolder);
    const subfolders = await getSubfolders(folderPath);

    for (const subfolder of subfolders) {
      const content = await readFolderIndex(subfolder);
      if (content && content.trim()) {
        // Use today's date for ordering (folder content is less time-specific)
        contentItems.push({
          date: today,
          content: content.trim(),
          source: `Folder: ${subfolder}`,
        });
      }
    }
  }

  // No content found - return empty string gracefully
  if (contentItems.length === 0) {
    return "";
  }

  // Sort by date (oldest first) for truncation
  contentItems.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Build context string, truncating oldest first if over budget
  return truncateContext(contentItems, MAX_CONTEXT_CHARS);
}

/**
 * Truncate context to fit within character budget
 *
 * Strategy: Remove oldest content first until within budget.
 * If a single item exceeds budget, truncate it from the beginning.
 *
 * @param items - Content items sorted by date (oldest first)
 * @param maxChars - Maximum total characters
 * @returns Truncated context string
 */
export function truncateContext(items: ContentItem[], maxChars: number): string {
  // Calculate total size
  let totalChars = items.reduce((sum, item) => sum + item.content.length, 0);

  // If already within budget, join all
  if (totalChars <= maxChars) {
    return items.map((item) => item.content).join("\n\n---\n\n");
  }

  // Need to truncate - start removing oldest items
  const result = [...items];
  while (result.length > 0 && totalChars > maxChars) {
    const oldest = result.shift()!;
    totalChars -= oldest.content.length;
  }

  // If all items removed and we still need content, use last item truncated
  if (result.length === 0 && items.length > 0) {
    const lastItem = items[items.length - 1];
    // Take the last maxChars characters (most recent content)
    const truncated = lastItem.content.slice(-maxChars);
    return truncated;
  }

  // Join remaining items
  return result.map((item) => item.content).join("\n\n---\n\n");
}

/**
 * Represents a single inspiration item (prompt or quote)
 */
export interface InspirationItem {
  text: string;
  attribution?: string;
}

/**
 * Result of parsing an inspiration file
 */
export interface ParsedInspirationFile {
  lastGenerated: Date | null;
  weekNumber?: number; // Only for quotes file (week NN format)
  items: InspirationItem[];
}

/**
 * Parse generation marker from a line
 * Supports both formats:
 * - <!-- last-generated: YYYY-MM-DD -->
 * - <!-- last-generated: YYYY-MM-DD (week NN) -->
 *
 * @param line - The line to parse
 * @returns Object with date (or null) and optional week number
 */
export function parseGenerationMarker(line: string): {
  date: Date | null;
  weekNumber?: number;
} {
  const match = line.match(
    /<!--\s*last-generated:\s*(\d{4}-\d{2}-\d{2})(?:\s*\(week\s*(\d+)\))?\s*-->/
  );
  if (!match) return { date: null };

  // Parse date in local timezone to avoid timezone issues
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(year, month - 1, day);

  // Validate date is valid (not NaN)
  if (isNaN(date.getTime())) {
    return { date: null };
  }

  const weekNumber = match[2] ? parseInt(match[2], 10) : undefined;

  return { date, weekNumber };
}

/**
 * Parse a single inspiration line
 * Format: - "Quote text" or - "Quote text" -- Source
 *
 * @param line - The line to parse
 * @returns InspirationItem or null if malformed
 */
export function parseInspirationLine(line: string): InspirationItem | null {
  // Match: - "text" or - "text" -- attribution
  // The regex captures quoted text and optional attribution after --
  const match = line.match(/^-\s*"(.+?)"\s*(?:--\s*(.+))?$/);
  if (!match) return null;

  const text = match[1].trim();
  const attribution = match[2]?.trim();

  // Skip if text is empty after trimming
  if (!text) return null;

  // Return with or without attribution
  return attribution ? { text, attribution } : { text };
}

/**
 * Parse an inspiration file and return structured data
 *
 * @param filePath - Path to the inspiration file
 * @returns ParsedInspirationFile with items and metadata
 */
export async function parseInspirationFile(
  filePath: string
): Promise<ParsedInspirationFile> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseInspirationContent(content);
  } catch (error) {
    // Return empty for missing files (ENOENT) or any other error
    // This is graceful handling per REQ-F-11
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { lastGenerated: null, items: [] };
    }
    // For other errors, also return empty (graceful handling)
    return { lastGenerated: null, items: [] };
  }
}

/**
 * Parse inspiration content from a string
 * Useful for testing without file I/O
 *
 * @param content - The file content to parse
 * @returns ParsedInspirationFile with items and metadata
 */
export function parseInspirationContent(content: string): ParsedInspirationFile {
  // Handle empty content
  if (!content || !content.trim()) {
    return { lastGenerated: null, items: [] };
  }

  const lines = content.split("\n");

  let lastGenerated: Date | null = null;
  let weekNumber: number | undefined;
  const items: InspirationItem[] = [];
  let markerFound = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check for generation marker (only check if not found yet)
    if (!markerFound && line.startsWith("<!--")) {
      const marker = parseGenerationMarker(line);
      if (marker.date) {
        lastGenerated = marker.date;
        weekNumber = marker.weekNumber;
        markerFound = true;
        continue;
      }
    }

    // Try to parse as inspiration item
    const item = parseInspirationLine(line);
    if (item) {
      items.push(item);
    }
    // Skip malformed lines gracefully (REQ-F-11)
  }

  return { lastGenerated, weekNumber, items };
}

// =============================================================================
// Pool Management Functions
// =============================================================================

/**
 * Format an inspiration item as a markdown list entry
 *
 * @param item - The inspiration item to format
 * @returns Formatted markdown string (e.g., `- "Quote text" -- Source`)
 */
export function formatInspirationItem(item: InspirationItem): string {
  if (item.attribution) {
    return `- "${item.text}" -- ${item.attribution}`;
  }
  return `- "${item.text}"`;
}

/**
 * Format a generation marker
 *
 * @param date - The generation date
 * @param weekNumber - Optional week number for quote files
 * @returns Formatted marker (e.g., `<!-- last-generated: 2025-12-26 -->`)
 */
export function formatGenerationMarker(
  date: Date,
  weekNumber?: number
): string {
  const dateStr = formatDateForDailyNote(date);
  if (weekNumber !== undefined) {
    return `<!-- last-generated: ${dateStr} (week ${weekNumber}) -->`;
  }
  return `<!-- last-generated: ${dateStr} -->`;
}

/**
 * Append new entries to an inspiration file
 *
 * REQ-F-13: Append generated prompts (don't overwrite existing)
 * REQ-F-20: Create directory if it doesn't exist
 *
 * @param filePath - Path to the inspiration file
 * @param entries - New entries to append
 * @param weekNumber - Optional week number for quote files
 * @returns Promise that resolves when file is written
 */
export async function appendToInspirationFile(
  filePath: string,
  entries: InspirationItem[],
  weekNumber?: number
): Promise<void> {
  // Ensure directory exists (REQ-F-20)
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  // Read existing content
  const parsed = await parseInspirationFile(filePath);

  // Combine existing items with new entries
  const allItems = [...parsed.items, ...entries];

  // Format the new file content
  const today = new Date();
  const marker = formatGenerationMarker(today, weekNumber);
  const itemLines = allItems.map(formatInspirationItem).join("\n");

  const content = `${marker}\n\n${itemLines}\n`;

  await writeFile(filePath, content, "utf-8");
}

/**
 * Prune an inspiration pool to stay within size limit
 *
 * REQ-F-19: Limit contextual prompt pool to 50 entries
 * REQ-F-24: Limit inspiration pool to 50 entries
 *
 * Removes oldest entries first (from the beginning of the list).
 *
 * @param filePath - Path to the inspiration file
 * @param maxSize - Maximum number of entries to keep (default: MAX_POOL_SIZE)
 * @returns Promise that resolves when pruning is complete
 */
export async function prunePool(
  filePath: string,
  maxSize: number = MAX_POOL_SIZE
): Promise<void> {
  const parsed = await parseInspirationFile(filePath);

  // No pruning needed if within limit
  if (parsed.items.length <= maxSize) {
    return;
  }

  // Keep only the newest entries (from the end)
  const prunedItems = parsed.items.slice(-maxSize);

  // Format the new file content
  const today = new Date();
  const marker = formatGenerationMarker(today, parsed.weekNumber);
  const itemLines = prunedItems.map(formatInspirationItem).join("\n");

  const content = `${marker}\n\n${itemLines}\n`;

  await writeFile(filePath, content, "utf-8");
}

/**
 * Append entries to file and prune if over limit
 *
 * Convenience function that combines append and prune operations.
 * This is the main function to use when adding generated content.
 *
 * @param filePath - Path to the inspiration file
 * @param entries - New entries to append
 * @param weekNumber - Optional week number for quote files
 * @param maxSize - Maximum pool size (default: MAX_POOL_SIZE)
 */
export async function appendAndPrune(
  filePath: string,
  entries: InspirationItem[],
  weekNumber?: number,
  maxSize: number = MAX_POOL_SIZE
): Promise<void> {
  await appendToInspirationFile(filePath, entries, weekNumber);
  await prunePool(filePath, maxSize);
}
