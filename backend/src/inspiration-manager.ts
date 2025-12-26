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
