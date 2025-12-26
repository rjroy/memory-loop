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

import { readFile } from "node:fs/promises";

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
