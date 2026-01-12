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
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { VaultInfo } from "@memory-loop/shared";
import { DEFAULT_MAX_POOL_SIZE } from "./vault-config";

// =============================================================================
// File Path Constants
// =============================================================================

/** Filename for contextual prompts */
export const CONTEXTUAL_PROMPTS_FILENAME = "contextual-prompts.md";

/** Filename for general inspiration */
export const GENERAL_INSPIRATION_FILENAME = "general-inspiration.md";

/** @deprecated Use vault.metadataPath + CONTEXTUAL_PROMPTS_FILENAME instead */
export const CONTEXTUAL_PROMPTS_PATH =
  "06_Metadata/memory-loop/contextual-prompts.md";

/** @deprecated Use vault.metadataPath + GENERAL_INSPIRATION_FILENAME instead */
export const GENERAL_INSPIRATION_PATH =
  "06_Metadata/memory-loop/general-inspiration.md";

// =============================================================================
// Path Resolution Helpers
// =============================================================================

/**
 * Gets the absolute path to the contextual prompts file for a vault.
 */
export function getContextualPromptsPath(vault: VaultInfo): string {
  return join(vault.contentRoot, vault.metadataPath, CONTEXTUAL_PROMPTS_FILENAME);
}

/**
 * Gets the absolute path to the general inspiration file for a vault.
 */
export function getGeneralInspirationPath(vault: VaultInfo): string {
  return join(vault.contentRoot, vault.metadataPath, GENERAL_INSPIRATION_FILENAME);
}

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
 * Returns true if ANY of the following are true:
 * - File doesn't exist
 * - Generation marker is missing
 * - Not generated today (different date)
 *
 * Note: Generation runs every day including weekends.
 * Weekdays get work-reflection prompts, weekends get creative prompts.
 *
 * @param vault - VaultInfo object
 * @returns true if generation is needed, false otherwise
 */
export async function isContextualGenerationNeeded(
  vault: VaultInfo
): Promise<boolean> {
  const today = new Date();

  const filePath = getContextualPromptsPath(vault);
  const parsed = await parseInspirationFile(filePath);

  // If file missing or no marker, generation is needed
  if (!parsed.lastGenerated) {
    return true;
  }

  // Compare dates (year, month, day) - ignore time component
  const generatedDate = parsed.lastGenerated;
  // Only generate if the last generated date is in the past based on date
  const yearDiff = generatedDate.getFullYear() - today.getFullYear();
  if (yearDiff > 0) {
    // Future year - never generate
    return false;
  } else if (yearDiff < 0) {
    // Past year - always generate
    return true;
  } else {
    // Same year - check month
    const monthDiff = generatedDate.getMonth() - today.getMonth();
    if (monthDiff > 0) {
      // Future month - never generate
      return false;
    } else if (monthDiff < 0) {
      // Past month - always generate
      return true;
    } else {
      // Same month - check day
      return generatedDate.getDate() < today.getDate();
    }
  }
}

/**
 * Check if inspirational quote generation is needed
 *
 * Returns true if ANY of the following are true:
 * - File doesn't exist
 * - Generation marker is missing
 * - Not generated this ISO week (different week or year)
 *
 * @param vault - VaultInfo object
 * @returns true if generation is needed, false otherwise
 */
export async function isQuoteGenerationNeeded(
  vault: VaultInfo
): Promise<boolean> {
  const today = new Date();
  const currentWeek = getISOWeekNumber(today);
  const currentYear = today.getFullYear();

  const filePath = getGeneralInspirationPath(vault);
  const parsed = await parseInspirationFile(filePath);

  // If file missing or no marker, generation is needed
  if (!parsed.lastGenerated) {
    return true;
  }

  // Use week number from marker if available, otherwise calculate from date
  const generatedWeek =
    parsed.weekNumber ?? getISOWeekNumber(parsed.lastGenerated);
  const generatedYear = parsed.lastGenerated.getFullYear();

  if (generatedYear > currentYear) {
    // Future year - never generated this week
    return false;
  } else if (generatedYear == currentYear) {
    // Only generate if week number is less than current week
    return generatedWeek < currentWeek;
  } else {
    // Past year - definitely needs generation
    return true;
  }
}

// =============================================================================
// Context Gathering Configuration
// =============================================================================

/** Maximum context size in characters (~800 tokens at ~4 chars/token) */
export const MAX_CONTEXT_CHARS = 3200;

/** Maximum entries in each inspiration pool (REQ-F-19, REQ-F-24)
 * @deprecated Use vault.maxPoolSize from VaultInfo instead. This is kept for backwards compatibility.
 */
export const MAX_POOL_SIZE = DEFAULT_MAX_POOL_SIZE;

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
  // Weekend: Light context from projects for creative nudge
  weekend: {
    dailyNoteDays: [],
    additionalFolder: PROJECTS_PATH,
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
 * @param vault - VaultInfo object
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns File content or null if not found
 */
export async function readDailyNote(
  vault: VaultInfo,
  dateStr: string
): Promise<string | null> {
  const filePath = join(vault.contentRoot, vault.inboxPath, `${dateStr}.md`);
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
 * REQ-F-16: Daily notes in inbox with YYYY-MM-DD.md pattern
 * REQ-F-17: Project/area README or index files
 * REQ-NF-2: Cap context at ~800 tokens (~3200 chars)
 *
 * @param vault - VaultInfo object
 * @param today - Optional date override for testing (defaults to now)
 * @returns Gathered context string, empty if no content found
 */
export async function gatherDayContext(
  vault: VaultInfo,
  today: Date = new Date()
): Promise<string> {
  const dayType = getDayType(today);
  const config = DAY_CONTEXT_CONFIG[dayType];

  const contentItems: ContentItem[] = [];

  // Gather daily notes
  for (const dayOffset of config.dailyNoteDays) {
    const targetDate = getDateWithOffset(today, dayOffset);
    const dateStr = formatDateForDailyNote(targetDate);
    const content = await readDailyNote(vault, dateStr);

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
    const folderPath = join(vault.contentRoot, config.additionalFolder);
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

// =============================================================================
// AI Generation Functions
// =============================================================================

/** Model to use for generation (cost-efficient) */
export const GENERATION_MODEL = "haiku";

/** Maximum context characters for generation prompts */
export const MAX_GENERATION_CONTEXT = 3000;

/**
 * Builds the prompt template for generating contextual prompts.
 * Uses vault content as context to create personalized reflection questions.
 *
 * @param count - Number of prompts to generate
 */
export function buildContextualPromptTemplate(count: number): string {
  return `Based on the following content from the user's notes, generate exactly ${count} thought-provoking prompts that encourage reflection, action, or deeper thinking about the topics mentioned.

Requirements:
- Each prompt should be 1-2 sentences
- Reference specific topics, themes, or ideas from the content
- Focus on actionable reflection or creative exploration
- Be encouraging and positive in tone
- Make them personally relevant to the user's apparent interests

Format your response as a markdown list with each prompt quoted:
- "Prompt text here"
- "Another prompt"
...

User's recent notes:
---
{context}
---

Generate ${count} prompts:`;
}

/**
 * Builds the prompt template for generating weekend prompts.
 * Focuses on creativity, imagination, and non-work exploration.
 * Vault context is provided as a light nudge, not deep reflection.
 *
 * @param count - Number of prompts to generate
 */
export function buildWeekendPromptTemplate(count: number): string {
  return `Generate exactly ${count} creative prompts for weekend exploration and imagination. These should help someone step away from their usual work mindset and think differently.

Requirements:
- Focus on creativity, curiosity, play, and imagination
- Encourage thinking outside normal routines
- NOT about productivity, tasks, or work reflection
- Each prompt should be 1-2 sentences
- Be inviting and spark curiosity

{context_nudge}

Format your response as a markdown list with each prompt quoted:
- "Prompt text here"
- "Another prompt"
...

Generate ${count} creative prompts:`;
}

/**
 * Builds the prompt template for generating inspirational quotes.
 * Uses vault context to select relevant quotes from appropriate domains.
 *
 * @param count - Number of quotes to generate
 */
export function buildQuotePromptTemplate(count: number): string {
  const quoteWord = count === 1 ? "quote" : "quotes";
  const itemWord = count === 1 ? "item" : "items";
  return `Generate ${count} inspirational ${quoteWord} that would resonate with someone based on the themes in their recent notes.

{context_section}

Requirements:
- Select ${count === 1 ? "a quote" : "quotes"} relevant to the themes, challenges, or interests evident in the notes
- Draw from appropriate domains: if notes mention leadership, draw from management wisdom; if technical work, draw from engineering leaders; if creative work, from artists and creators
- Good sources include: industry pioneers, technical leaders, authors, historical figures - whoever is most relevant
- The ${quoteWord} should feel personally applicable, not generic
- Include accurate attribution

Format your response as markdown list ${itemWord} with attribution:
- "Quote text here" -- Attribution

Generate ${count} ${quoteWord}:`;
}

/**
 * Type for the SDK query function to allow mocking in tests
 */
export type QueryFunction = typeof query;

/**
 * Default query function (real SDK).
 * Can be overridden in tests using setQueryFunction.
 */
let queryFn: QueryFunction = query;

/**
 * Set the query function (for testing with mocks)
 *
 * @param fn - The query function to use
 */
export function setQueryFunction(fn: QueryFunction): void {
  queryFn = fn;
}

/**
 * Reset the query function to the real SDK (for cleanup after tests)
 */
export function resetQueryFunction(): void {
  queryFn = query;
}

/**
 * Collect full text response from an SDK query result.
 * Iterates through all events and extracts text from assistant messages.
 *
 * @param queryResult - The async generator from query()
 * @returns Full text response
 */
async function collectResponse(
  queryResult: ReturnType<QueryFunction>
): Promise<string> {
  const responseParts: string[] = [];

  for await (const event of queryResult) {
    // Cast to unknown for flexible property checking
    // The SDK types are more constrained than runtime events
    const rawEvent = event as unknown as Record<string, unknown>;
    const eventType = rawEvent.type as string;

    if (eventType === "assistant") {
      // Extract text from assistant message content blocks
      const message = rawEvent.message as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined;

      if (message?.content) {
        for (const block of message.content) {
          if (block.type === "text" && block.text) {
            responseParts.push(block.text);
          }
        }
      }
    }
  }

  return responseParts.join("");
}

/**
 * Parse AI response into inspiration items.
 * Expects markdown list format: - "text" or - "text" -- attribution
 *
 * @param response - The raw AI response
 * @returns Array of parsed inspiration items
 */
export function parseAIResponse(response: string): InspirationItem[] {
  const items: InspirationItem[] = [];

  for (const line of response.split("\n")) {
    const item = parseInspirationLine(line.trim());
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Generate contextual prompts based on vault content.
 *
 * REQ-F-12: Generate contextual prompts per generation cycle (configurable count)
 * REQ-NF-2: Use Claude Haiku model for cost efficiency
 *
 * @param context - Vault content for context (from gatherDayContext)
 * @param count - Number of prompts to generate (default: 5)
 * @returns Array of generated prompts (may be empty on error)
 */
export async function generateContextualPrompts(
  context: string,
  count: number = 5
): Promise<InspirationItem[]> {
  // Skip if no context provided
  if (!context || !context.trim()) {
    return [];
  }

  // Truncate context if too long
  const truncatedContext = context.slice(0, MAX_GENERATION_CONTEXT);

  // Build the prompt with configurable count
  const prompt = buildContextualPromptTemplate(count).replace("{context}", truncatedContext);

  try {
    const queryResult = queryFn({
      prompt,
      options: {
        model: GENERATION_MODEL,
        maxTurns: 1,
        allowedTools: [], // No tools needed for generation
      },
    });

    const response = await collectResponse(queryResult);
    return parseAIResponse(response);
  } catch (error) {
    // Log error but return empty (graceful handling per REQ-NF-3)
    console.error("[inspiration-manager] Failed to generate contextual prompts:", error);
    return [];
  }
}

/**
 * Generate creative weekend prompts focused on imagination and exploration.
 *
 * Uses vault context as a light nudge (project themes) rather than deep reflection.
 *
 * @param context - Optional vault content for light context nudge
 * @param count - Number of prompts to generate (default: 5)
 * @returns Array of generated creative prompts (may be empty on error)
 */
export async function generateWeekendPrompts(
  context?: string,
  count: number = 5
): Promise<InspirationItem[]> {
  try {
    // Build context nudge - just a hint about their interests, not detailed content
    let contextNudge: string;
    if (context && context.trim()) {
      // Extract just project/area names or high-level themes
      contextNudge =
        "The person works on various projects and interests. Feel free to occasionally draw loose inspiration from themes of creativity, learning, or personal growth - but keep prompts general and playful, not work-specific.";
    } else {
      contextNudge =
        "Generate general creative prompts suitable for anyone looking to think differently on a weekend.";
    }

    const prompt = buildWeekendPromptTemplate(count).replace("{context_nudge}", contextNudge);

    const queryResult = queryFn({
      prompt,
      options: {
        model: GENERATION_MODEL,
        maxTurns: 1,
        allowedTools: [],
      },
    });

    const response = await collectResponse(queryResult);
    return parseAIResponse(response);
  } catch (error) {
    console.error("[inspiration-manager] Failed to generate weekend prompts:", error);
    return [];
  }
}

/**
 * Generate inspirational quotes relevant to the user's work context.
 *
 * REQ-F-21: Generate inspirational quotes per week (configurable count)
 * REQ-F-25: Draw from Claude's knowledge of historical quotes
 * REQ-NF-2: Use Claude Haiku model for cost efficiency
 *
 * @param context - Optional vault content for context-aware quote selection
 * @param count - Number of quotes to generate (default: 1)
 * @returns Array of generated quotes (may be empty on error)
 */
export async function generateInspirationQuote(
  context?: string,
  count: number = 1
): Promise<InspirationItem[]> {
  try {
    // Build context section based on whether context is provided
    let contextSection: string;
    if (context && context.trim()) {
      const truncatedContext = context.slice(0, MAX_GENERATION_CONTEXT);
      contextSection = `The user's recent notes:\n---\n${truncatedContext}\n---`;
    } else {
      contextSection = "No recent notes available. Generate timeless, universally applicable quotes about growth, learning, or perseverance.";
    }

    const prompt = buildQuotePromptTemplate(count).replace("{context_section}", contextSection);

    const queryResult = queryFn({
      prompt,
      options: {
        model: GENERATION_MODEL,
        maxTurns: 1,
        allowedTools: [], // No tools needed for generation
      },
    });

    const response = await collectResponse(queryResult);
    const items = parseAIResponse(response);

    // Return up to the requested number of quotes
    return items.slice(0, count);
  } catch (error) {
    // Log error but return empty (graceful handling per REQ-NF-3)
    console.error("[inspiration-manager] Failed to generate inspiration quote:", error);
    return [];
  }
}

// =============================================================================
// Main Inspiration Handler (TASK-007)
// =============================================================================

/**
 * Hardcoded fallback quote for when quote file is missing/empty.
 * Provides a timeless, universally applicable message.
 */
export const FALLBACK_QUOTE: InspirationItem = {
  text: "The only way to do great work is to love what you do.",
  attribution: "Steve Jobs",
};

/**
 * Result type for getInspiration function
 */
export interface InspirationResult {
  /** Contextual prompt (null if file missing/empty or weekend) */
  contextual: InspirationItem | null;
  /** Inspirational quote (fallback if file missing/empty) */
  quote: InspirationItem;
}

/**
 * Select a random item from an array.
 *
 * @param items - Array of items to select from
 * @returns A random item, or undefined if array is empty
 */
export function selectRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

/**
 * Select a random item with linear recency weighting.
 *
 * Items at the end of the array (most recent) are more likely to be selected.
 * Uses linear weighting: item at index i has weight (i + 1).
 *
 * For an array of n items:
 * - First item (oldest): weight 1, probability 2/[n(n+1)]
 * - Last item (newest): weight n, probability 2/(n+1)
 * - Most recent item is n times more likely than the oldest
 *
 * @param items - Array of items to select from (newest at end)
 * @returns A weighted random item, or undefined if array is empty
 */
export function selectWeightedRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const n = items.length;

  // Total weight = 1 + 2 + ... + n = n(n+1)/2
  const totalWeight = (n * (n + 1)) / 2;

  // Random value in [0, totalWeight)
  const randomValue = Math.random() * totalWeight;

  // Find the item: cumulative weight at index i is (i+1)(i+2)/2
  // We need to find smallest i where cumulative weight > randomValue
  let cumulativeWeight = 0;
  for (let i = 0; i < n; i++) {
    cumulativeWeight += i + 1;
    if (randomValue < cumulativeWeight) {
      return items[i];
    }
  }

  // Fallback (shouldn't reach due to floating point, but safety first)
  return items[n - 1];
}

/**
 * Main orchestration function for inspiration content.
 *
 * REQ-F-1: Provide dual-content display: contextual prompts + timeless quotes
 * Weekdays show reflection prompts, weekends show creative/imagination prompts
 * REQ-F-20: Quote generation triggered once per week
 * REQ-NF-3: Graceful degradation on errors
 *
 * Flow:
 * 1. Check if contextual generation needed (not generated today)
 * 2. Check if quote generation needed (not generated this week)
 * 3. Trigger generation if needed (weekday: reflection prompts, weekend: creative prompts)
 * 4. Parse files and select random items
 * 5. Return contextual (null if unavailable) and quote (fallback if unavailable)
 *
 * @param vault - VaultInfo object
 * @returns Promise resolving to contextual prompt and quote
 */
export async function getInspiration(vault: VaultInfo): Promise<InspirationResult> {
  const contextualPath = getContextualPromptsPath(vault);
  const quotePath = getGeneralInspirationPath(vault);

  // Check freshness and trigger generation if needed
  const today = new Date();
  const currentWeek = getISOWeekNumber(today);

  // Check what generation is needed
  const needsContextual = await isContextualGenerationNeeded(vault);
  const needsQuote = await isQuoteGenerationNeeded(vault);

  // Gather context once if either generation needs it
  let context = "";
  if (needsContextual || needsQuote) {
    try {
      context = await gatherDayContext(vault, today);
    } catch (error) {
      console.error("[inspiration-manager] Failed to gather context:", error);
    }
  }

  // Phase 1: Trigger contextual generation
  // Weekdays: reflection prompts based on vault content
  // Weekends: creative/imagination prompts with light context nudge
  if (needsContextual) {
    try {
      const dayType = getDayType(today);
      let newPrompts: InspirationItem[];

      if (dayType === "weekend") {
        // Weekend: creative prompts (context is optional nudge)
        newPrompts = await generateWeekendPrompts(context, vault.promptsPerGeneration);
      } else {
        // Weekday: reflection prompts (requires context)
        newPrompts = context.trim()
          ? await generateContextualPrompts(context, vault.promptsPerGeneration)
          : [];
      }

      if (newPrompts.length > 0) {
        await appendAndPrune(contextualPath, newPrompts, undefined, vault.maxPoolSize);
      }
    } catch (error) {
      // Generation failure doesn't block response (REQ-NF-3)
      console.error("[inspiration-manager] Contextual generation failed:", error);
    }
  }

  // Phase 2: Trigger quote generation (once per week, context-aware)
  if (needsQuote) {
    try {
      const newQuotes = await generateInspirationQuote(context, vault.quotesPerWeek);

      if (newQuotes.length > 0) {
        await appendAndPrune(quotePath, newQuotes, currentWeek, vault.maxPoolSize);
      }
    } catch (error) {
      // Generation failure doesn't block response (REQ-NF-3)
      console.error("[inspiration-manager] Quote generation failed:", error);
    }
  }

  // Phase 3: Parse files and select random items
  let contextual: InspirationItem | null = null;
  let quote: InspirationItem = FALLBACK_QUOTE;

  // Show contextual prompts every day (weekdays: reflection, weekends: creative)
  try {
    const contextualFile = await parseInspirationFile(contextualPath);

    if (contextualFile.items.length > 0) {
      contextual = selectWeightedRandom(contextualFile.items) ?? null;
    }
  } catch {
    // File doesn't exist or parse error - return null for contextual
    contextual = null;
  }

  // Always try to get a quote
  try {
    const quoteFile = await parseInspirationFile(quotePath);

    if (quoteFile.items.length > 0) {
      const selected = selectRandom(quoteFile.items);
      if (selected) {
        quote = selected;
      }
    }
  } catch {
    // File doesn't exist or parse error - use fallback quote
    quote = FALLBACK_QUOTE;
  }

  return { contextual, quote };
}
