/**
 * Meeting Capture Module
 *
 * Handles meeting note creation and management. Meeting notes are stored in
 * a meetings/ subdirectory of the vault inbox with YAML frontmatter containing
 * date, title, and attendees fields.
 *
 * Meeting capture flow:
 * 1. User starts a meeting with a title
 * 2. System creates meeting file with frontmatter and ## Capture section
 * 3. Subsequent captures route to meeting file instead of daily note
 * 4. User stops meeting, system returns file content for Claude Code integration
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo, MeetingState } from "@/lib/schemas";
import {
  getVaultInboxPath,
  directoryExists,
  fileExists,
} from "./vault-manager";
import {
  formatDateForFilename,
  formatTimeForTimestamp,
  findCaptureSection,
  normalizeLineEndings,
} from "./note-capture";

/**
 * Error thrown when meeting capture operations fail.
 */
export class MeetingCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingCaptureError";
  }
}

/**
 * Active meeting session state stored per-connection.
 * This is ephemeral and not persisted to disk.
 */
export interface ActiveMeeting {
  /** Meeting title */
  title: string;
  /** Full path to the meeting file */
  filePath: string;
  /** Relative path from content root (for display) */
  relativePath: string;
  /** ISO 8601 timestamp when meeting started */
  startedAt: string;
  /** Number of entries captured so far */
  entryCount: number;
}

/**
 * Result of starting a meeting.
 */
export interface StartMeetingResult {
  success: boolean;
  meeting?: ActiveMeeting;
  error?: string;
}

/**
 * Result of stopping a meeting.
 */
export interface StopMeetingResult {
  success: boolean;
  /** Full file content for Claude Code */
  content?: string;
  /** Number of entries captured */
  entryCount?: number;
  /** Relative path to the file */
  filePath?: string;
  error?: string;
}

/**
 * Result of capturing to a meeting.
 */
export interface MeetingCaptureResult {
  success: boolean;
  timestamp?: string;
  error?: string;
}

/**
 * Slugifies a title for use in filenames.
 * Converts to lowercase, replaces spaces with hyphens, removes special chars.
 *
 * @param title - The meeting title
 * @returns URL-safe slug
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Generates the filename for a meeting note.
 *
 * @param title - The meeting title
 * @param date - The date for the meeting (defaults to now)
 * @returns Filename like "2026-01-15-Q3-Planning-with-Sarah.md"
 */
export function getMeetingFilename(
  title: string,
  date: Date = new Date()
): string {
  const dateStr = formatDateForFilename(date);
  const slug = slugifyTitle(title);
  return `${dateStr}-${slug}.md`;
}

/**
 * Generates YAML frontmatter for a meeting note.
 *
 * @param title - The meeting title
 * @param date - The meeting date
 * @returns YAML frontmatter string
 */
export function generateMeetingFrontmatter(
  title: string,
  date: Date = new Date()
): string {
  const dateStr = formatDateForFilename(date);
  return `---
date: ${dateStr}
title: "${title.replace(/"/g, '\\"')}"
attendees: []
---

`;
}

/**
 * Generates the template content for a new meeting note.
 *
 * @param title - The meeting title
 * @param date - The meeting date
 * @returns Full template with frontmatter and sections
 */
export function generateMeetingTemplate(
  title: string,
  date: Date = new Date()
): string {
  const frontmatter = generateMeetingFrontmatter(title, date);
  return `${frontmatter}# ${title}

## Capture

`;
}

/**
 * Gets the meetings directory path within the inbox.
 *
 * @param vault - The vault info
 * @returns Full path to meetings directory
 */
export function getMeetingsDirectory(vault: VaultInfo): string {
  const inboxPath = getVaultInboxPath(vault);
  return join(inboxPath, "meetings");
}

/**
 * Starts a new meeting capture session.
 *
 * This function:
 * 1. Creates the meetings directory if needed
 * 2. Generates the meeting filename from title
 * 3. Creates the meeting file with frontmatter template
 * 4. Returns the active meeting state
 *
 * @param vault - The vault to create the meeting in
 * @param title - The meeting title
 * @param date - Optional date (defaults to now)
 * @returns StartMeetingResult with meeting state or error
 */
export async function startMeeting(
  vault: VaultInfo,
  title: string,
  date: Date = new Date()
): Promise<StartMeetingResult> {
  const startedAt = date.toISOString();

  try {
    // Validate title
    if (!title || title.trim().length === 0) {
      return {
        success: false,
        error: "Meeting title is required",
      };
    }

    const trimmedTitle = title.trim();
    const meetingsDir = getMeetingsDirectory(vault);
    const filename = getMeetingFilename(trimmedTitle, date);
    const filePath = join(meetingsDir, filename);
    const relativePath = join(vault.inboxPath, "meetings", filename);

    // Create meetings directory if needed
    if (!(await directoryExists(meetingsDir))) {
      try {
        await mkdir(meetingsDir, { recursive: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new MeetingCaptureError(
          `Failed to create meetings directory: ${message}`
        );
      }
    }

    // Check if file already exists (edge case: same title same day)
    if (await fileExists(filePath)) {
      return {
        success: false,
        error: `Meeting file already exists: ${filename}`,
      };
    }

    // Create the meeting file with template
    const template = generateMeetingTemplate(trimmedTitle, date);
    try {
      await writeFile(filePath, template, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MeetingCaptureError(`Failed to create meeting file: ${message}`);
    }

    const meeting: ActiveMeeting = {
      title: trimmedTitle,
      filePath,
      relativePath,
      startedAt,
      entryCount: 0,
    };

    return { success: true, meeting };
  } catch (error) {
    if (error instanceof MeetingCaptureError) {
      return { success: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Unexpected error: ${message}` };
  }
}

/**
 * Captures text to an active meeting's file.
 *
 * @param meeting - The active meeting state
 * @param text - The text to capture
 * @param date - Optional date for timestamp (defaults to now)
 * @returns MeetingCaptureResult indicating success/failure
 */
export async function captureToMeeting(
  meeting: ActiveMeeting,
  text: string,
  date: Date = new Date()
): Promise<MeetingCaptureResult> {
  const timestamp = date.toISOString();

  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: "Cannot capture empty text",
      };
    }

    // Read existing content
    let content: string;
    try {
      content = await readFile(meeting.filePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read meeting file: ${message}`,
      };
    }

    // Format capture entry with timestamp
    const timeStr = formatTimeForTimestamp(date);
    const captureEntry = `- [${timeStr}] ${text}\n`;

    // Find capture section and append
    const normalizedContent = normalizeLineEndings(content);
    const { found, insertPosition } = findCaptureSection(normalizedContent);

    let updatedContent: string;
    if (!found) {
      // No ## Capture section found, append one at the end
      const suffix = normalizedContent.endsWith("\n") ? "" : "\n";
      updatedContent =
        normalizedContent + suffix + "\n## Capture\n\n" + captureEntry;
    } else {
      // Insert at end of capture section
      const before = normalizedContent.slice(0, insertPosition);
      const after = normalizedContent.slice(insertPosition);
      const needsNewline = !before.endsWith("\n\n") && !before.endsWith("\n");
      const prefix = needsNewline ? "\n" : "";
      updatedContent = before + prefix + captureEntry + after;
    }

    // Write updated content
    try {
      await writeFile(meeting.filePath, updatedContent, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to write meeting file: ${message}`,
      };
    }

    // Update entry count
    meeting.entryCount++;

    return { success: true, timestamp };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Unexpected error: ${message}` };
  }
}

/**
 * Stops an active meeting and returns the file content.
 *
 * @param meeting - The active meeting to stop
 * @returns StopMeetingResult with file content for Claude Code
 */
export async function stopMeeting(
  meeting: ActiveMeeting
): Promise<StopMeetingResult> {
  try {
    // Read final content
    let content: string;
    try {
      content = await readFile(meeting.filePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read meeting file: ${message}`,
      };
    }

    return {
      success: true,
      content,
      entryCount: meeting.entryCount,
      filePath: meeting.relativePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Unexpected error: ${message}` };
  }
}

/**
 * Converts active meeting state to protocol MeetingState.
 *
 * @param meeting - The active meeting or null
 * @returns MeetingState object for client
 */
export function toMeetingState(meeting: ActiveMeeting | null): MeetingState {
  if (!meeting) {
    return { isActive: false };
  }
  return {
    isActive: true,
    title: meeting.title,
    filePath: meeting.relativePath,
    startedAt: meeting.startedAt,
  };
}

/**
 * Counts capture entries in a meeting file content.
 * Entries are lines matching the pattern "- [HH:MM] text" in the ## Capture section.
 *
 * @param content - The file content
 * @returns Number of capture entries
 */
export function countMeetingEntries(content: string): number {
  const normalizedContent = normalizeLineEndings(content);
  const { found, insertPosition } = findCaptureSection(normalizedContent);

  if (!found) {
    return 0;
  }

  // Find start of capture section
  const captureHeaderIndex = normalizedContent.indexOf("## Capture");
  if (captureHeaderIndex === -1) {
    return 0;
  }

  const sectionStart = normalizedContent.indexOf("\n", captureHeaderIndex) + 1;
  const sectionContent = normalizedContent.slice(sectionStart, insertPosition);

  // Count lines matching the entry pattern
  const entryPattern = /^- \[\d{2}:\d{2}\] .+$/gm;
  const matches = sectionContent.match(entryPattern);
  return matches ? matches.length : 0;
}
