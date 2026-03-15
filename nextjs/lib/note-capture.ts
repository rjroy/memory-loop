/**
 * Note Capture Module
 *
 * Handles daily note creation and text appending for the note-adding mode.
 * Daily notes use ISO 8601 date format (YYYY-MM-DD) and are stored in the
 * vault's inbox directory.
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo, RecentNoteEntry } from "@memory-loop/shared";
import { getVaultInboxPath, directoryExists, fileExists } from "./vault-manager";

/**
 * Error thrown when note capture operations fail.
 */
export class NoteCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteCaptureError";
  }
}

/**
 * Result of a capture operation.
 */
export interface CaptureResult {
  /** Whether the capture was successful */
  success: boolean;
  /** ISO 8601 timestamp when the capture occurred */
  timestamp: string;
  /** Path to the daily note file */
  notePath: string;
  /** Error message if capture failed */
  error?: string;
}

/**
 * Formats a Date object as YYYY-MM-DD.
 *
 * @param date - The date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object as HH:MM for timestamp prefixes.
 *
 * @param date - The date to format
 * @returns Time string in HH:MM format (24-hour)
 */
export function formatTimeForTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Gets the filename for today's daily note.
 *
 * @param date - Optional date to use (defaults to now)
 * @returns Filename in YYYY-MM-DD.md format
 */
export function getDailyNoteFilename(date: Date = new Date()): string {
  return `${formatDateForFilename(date)}.md`;
}

/**
 * Generates the template content for a new daily note.
 *
 * @param date - The date for the note
 * @returns Template content with heading and Capture section
 */
export function generateDailyNoteTemplate(date: Date = new Date()): string {
  const dateStr = formatDateForFilename(date);
  return `# ${dateStr}\n\n## Capture\n\n`;
}

/**
 * Formats captured text with a timestamp prefix.
 *
 * @param text - The text to capture
 * @param date - Optional date to use for timestamp (defaults to now)
 * @returns Formatted capture entry with timestamp prefix
 */
export function formatCaptureEntry(text: string, date: Date = new Date()): string {
  const timeStr = formatTimeForTimestamp(date);
  return `- [${timeStr}] ${text}\n`;
}

/**
 * Normalizes line endings to LF for consistent processing.
 * Windows-style CRLF (\r\n) is converted to LF (\n).
 *
 * @param content - The content to normalize
 * @returns Content with normalized line endings
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/**
 * Finds the ## Capture section and returns info about where to insert new content.
 * New captures are appended at the END of the section (before the next ## heading).
 *
 * @param content - The note content (LF-normalized)
 * @returns Object with found status and insert position at end of section
 */
export function findCaptureSection(content: string): {
  found: boolean;
  insertPosition: number;
} {
  const lines = content.split("\n");
  let captureLineIndex = -1;

  // Find the ## Capture section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "## Capture") {
      captureLineIndex = i;
      break;
    }
  }

  if (captureLineIndex === -1) {
    return { found: false, insertPosition: content.length };
  }

  // Find the end of the ## Capture section
  // End is either the next ## heading or end of content
  let endLineIndex = lines.length;
  for (let i = captureLineIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) {
      endLineIndex = i;
      break;
    }
  }

  // Calculate position at end of section (before next heading or at EOF)
  // For end of file, just use content length
  if (endLineIndex === lines.length) {
    return { found: true, insertPosition: content.length };
  }

  // For position before a heading, calculate byte position
  let position = 0;
  for (let i = 0; i < endLineIndex; i++) {
    position += lines[i].length + 1; // +1 for newline
  }

  return { found: true, insertPosition: position };
}

/**
 * Appends text to the ## Capture section of existing content.
 * If no ## Capture section exists, appends it at the end.
 * Content is normalized to LF line endings before processing.
 *
 * @param existingContent - The existing note content
 * @param captureEntry - The formatted capture entry to append
 * @returns Updated note content with capture entry appended
 */
export function appendToCaptureSection(
  existingContent: string,
  captureEntry: string
): string {
  // Normalize line endings for consistent processing
  const normalizedContent = normalizeLineEndings(existingContent);
  const { found, insertPosition } = findCaptureSection(normalizedContent);

  if (!found) {
    // No ## Capture section found, append one at the end
    const suffix = normalizedContent.endsWith("\n") ? "" : "\n";
    return normalizedContent + suffix + "\n## Capture\n\n" + captureEntry;
  }

  // Insert the capture entry at the end of the section
  const before = normalizedContent.slice(0, insertPosition);
  const after = normalizedContent.slice(insertPosition);

  // Ensure proper spacing: if section doesn't end with blank line, add one
  const needsNewline = !before.endsWith("\n\n") && !before.endsWith("\n");
  const prefix = needsNewline ? "\n" : "";

  return before + prefix + captureEntry + after;
}

/**
 * Captures text to today's daily note in the specified vault.
 *
 * This function:
 * 1. Creates the inbox directory if it doesn't exist
 * 2. Creates the daily note with template if it doesn't exist
 * 3. Appends the captured text under ## Capture with timestamp
 * 4. Preserves all existing content
 *
 * @param vault - The vault to capture to
 * @param text - The text to capture
 * @param date - Optional date to use (defaults to now)
 * @returns CaptureResult indicating success or failure
 */
export async function captureToDaily(
  vault: VaultInfo,
  text: string,
  date: Date = new Date()
): Promise<CaptureResult> {
  const timestamp = date.toISOString();

  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        timestamp,
        notePath: "",
        error: "Cannot capture empty text",
      };
    }

    const inboxPath = getVaultInboxPath(vault);
    const filename = getDailyNoteFilename(date);
    const notePath = join(inboxPath, filename);

    // Ensure inbox directory exists
    if (!(await directoryExists(inboxPath))) {
      try {
        await mkdir(inboxPath, { recursive: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new NoteCaptureError(
          `Failed to create inbox directory "${inboxPath}": ${message}`
        );
      }
    }

    // Read existing content or create template
    let content: string;
    const noteExists = await fileExists(notePath);

    if (noteExists) {
      try {
        content = await readFile(notePath, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new NoteCaptureError(
          `Failed to read daily note "${notePath}": ${message}`
        );
      }
    } else {
      content = generateDailyNoteTemplate(date);
    }

    // Format and append the capture entry (preserving text verbatim per REQ-F-15)
    const captureEntry = formatCaptureEntry(text, date);
    const updatedContent = appendToCaptureSection(content, captureEntry);

    // Write the updated content
    try {
      await writeFile(notePath, updatedContent, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NoteCaptureError(
        `Failed to write daily note "${notePath}": ${message}`
      );
    }

    return {
      success: true,
      timestamp,
      notePath,
    };
  } catch (error) {
    if (error instanceof NoteCaptureError) {
      return {
        success: false,
        timestamp,
        notePath: "",
        error: error.message,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      timestamp,
      notePath: "",
      error: `Unexpected error during capture: ${message}`,
    };
  }
}

/**
 * Parses capture entries from a daily note's content.
 * Extracts entries in the format "- [HH:MM] text" from the ## Capture section.
 *
 * @param content - The note content to parse
 * @returns Array of parsed entries with time, text, and line number
 */
export function parseCaptureSectionEntries(
  content: string
): Array<{ time: string; text: string; lineNum: number }> {
  const normalized = normalizeLineEndings(content);
  const { found, insertPosition } = findCaptureSection(normalized);

  if (!found) {
    return [];
  }

  // Find the start of the Capture section content
  const captureHeaderIndex = normalized.indexOf("## Capture");
  if (captureHeaderIndex === -1) {
    return [];
  }

  // Extract section content (from after header to insert position)
  const sectionStart = normalized.indexOf("\n", captureHeaderIndex) + 1;
  const sectionContent = normalized.slice(sectionStart, insertPosition);

  // Parse entries line by line
  const lines = sectionContent.split("\n");
  const entries: Array<{ time: string; text: string; lineNum: number }> = [];

  // Calculate starting line number
  const linesBeforeSection = normalized.slice(0, sectionStart).split("\n").length;

  // Pattern: "- [HH:MM] text" or "- [c] [HH:MM] text" (with optional checkbox)
  const entryPattern = /^- (?:\[.\] )?\[(\d{2}:\d{2})\] (.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(entryPattern);
    if (match) {
      entries.push({
        time: match[1],
        text: match[2],
        lineNum: linesBeforeSection + i,
      });
    }
  }

  return entries;
}

/**
 * Retrieves the most recent captured notes from a vault's inbox.
 * Reads daily note files and extracts entries from their ## Capture sections.
 *
 * @param vault - The vault to read notes from
 * @param limit - Maximum number of notes to return (default: 5)
 * @returns Array of recent note entries, newest first
 */
export async function getRecentNotes(
  vault: VaultInfo,
  limit: number = 5
): Promise<RecentNoteEntry[]> {
  const inboxPath = getVaultInboxPath(vault);

  // Check if inbox directory exists
  if (!(await directoryExists(inboxPath))) {
    return [];
  }

  // List all files in inbox
  const files = await readdir(inboxPath);

  // Filter for daily note files (YYYY-MM-DD.md) and sort descending (newest first)
  const dailyNotePattern = /^\d{4}-\d{2}-\d{2}\.md$/;
  const dailyNoteFiles = files
    .filter((f) => dailyNotePattern.test(f))
    .sort((a, b) => b.localeCompare(a));

  const allEntries: RecentNoteEntry[] = [];

  // Read each file until we have enough entries
  for (const filename of dailyNoteFiles) {
    if (allEntries.length >= limit) {
      break;
    }

    const date = filename.replace(".md", "");
    const filePath = join(inboxPath, filename);

    try {
      const content = await readFile(filePath, "utf-8");
      const entries = parseCaptureSectionEntries(content);

      // Add entries in reverse order (most recent first within the file)
      for (let i = entries.length - 1; i >= 0 && allEntries.length < limit; i--) {
        const entry = entries[i];
        allEntries.push({
          id: `${date}-${entry.time}-${entry.lineNum}`,
          text: entry.text,
          time: entry.time,
          date,
        });
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return allEntries;
}
