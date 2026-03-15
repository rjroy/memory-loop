/**
 * Transcript Manager
 *
 * Auto-saves Think tab conversations to markdown files in {inbox}/chats/
 * for Obsidian searchability. Writes incrementally on each message to
 * survive crashes.
 */

import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo, StoredToolInvocation } from "@memory-loop/shared";
import { getVaultInboxPath, directoryExists } from "./vault-manager";
import { formatDateForFilename, formatTimeForTimestamp } from "./note-capture";

/**
 * Error thrown when transcript operations fail.
 */
export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

/**
 * Gets the absolute path to the transcripts directory for a vault.
 * Transcripts are stored in {inbox}/chats/ for organization.
 *
 * @param vault - The VaultInfo object
 * @returns Absolute path to the chats directory
 */
export function getTranscriptsDirectory(vault: VaultInfo): string {
  return join(getVaultInboxPath(vault), "chats");
}

/**
 * Generates a transcript filename from session ID and date.
 * Format: YYYY-MM-DD-HHMM-{shortId}.md
 *
 * @param sessionId - The session UUID
 * @param date - The date for the filename
 * @returns Filename like "2026-01-16-1430-a8f3b.md"
 */
export function generateTranscriptFilename(sessionId: string, date: Date): string {
  const dateStr = formatDateForFilename(date);
  const timeStr = formatTimeForTimestamp(date).replace(":", "");
  const shortId = sessionId.slice(0, 5).toLowerCase();
  return `${dateStr}-${timeStr}-${shortId}.md`;
}

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated string
 */
function truncateTitle(text: string, maxLength: number): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return firstLine.slice(0, maxLength - 1) + "…";
}

/**
 * Generates YAML frontmatter for a new transcript.
 *
 * @param sessionId - The session UUID
 * @param firstMessage - Content of the first message (for title)
 * @param date - The date of the transcript
 * @returns YAML frontmatter string
 */
export function generateTranscriptFrontmatter(
  sessionId: string,
  firstMessage: string,
  date: Date
): string {
  const dateStr = formatDateForFilename(date);
  const timeStr = formatTimeForTimestamp(date);
  const title = truncateTitle(firstMessage, 60);

  return `---
date: ${dateStr}
time: "${timeStr}"
session_id: ${sessionId}
title: "${title.replace(/"/g, '\\"')}"
---

# Discussion - ${dateStr} ${timeStr}

`;
}

/**
 * Formats a user message for the transcript.
 *
 * @param content - The message content
 * @param timestamp - When the message was sent
 * @returns Formatted markdown string
 */
export function formatUserMessage(content: string, timestamp: Date): string {
  const timeStr = formatTimeForTimestamp(timestamp);
  return `## [${timeStr}] User

${content}

`;
}

/**
 * Formats a tool invocation as a blockquote.
 *
 * @param tool - The tool invocation to format
 * @returns Formatted blockquote string
 */
export function formatToolInvocation(tool: StoredToolInvocation): string {
  const status = tool.status === "complete" ? "✓" : "…";
  let line = `> **Tool:** ${tool.toolName}`;

  // Add relevant input details for common tools
  if (tool.input && typeof tool.input === "object") {
    const input = tool.input as Record<string, unknown>;

    if (input.pattern && typeof input.pattern === "string") {
      line += `\n> Pattern: \`${input.pattern}\``;
    }
    if (input.file_path && typeof input.file_path === "string") {
      line += `\n> File: \`${input.file_path}\``;
    }
    if (input.command && typeof input.command === "string") {
      const truncated = input.command.length > 80 ? input.command.slice(0, 77) + "..." : input.command;
      line += `\n> Command: \`${truncated}\``;
    }
  }

  line += `\n> ${status}`;

  // Add brief output summary for completed tools
  if (tool.status === "complete" && tool.output != null) {
    const output = typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output);
    if (output.includes("Found") || output.includes("files")) {
      const match = output.match(/Found (\d+) (?:files?|results?|matches?)/i);
      if (match) {
        line += ` Found ${match[1]} files`;
      }
    }
  }

  return line + "\n\n";
}

/**
 * Formats an assistant message for the transcript.
 * Includes tool invocations as blockquotes.
 *
 * @param content - The message content
 * @param toolInvocations - Optional array of tool invocations
 * @param timestamp - When the message was sent
 * @returns Formatted markdown string
 */
export function formatAssistantMessage(
  content: string,
  toolInvocations: StoredToolInvocation[] | undefined,
  timestamp: Date
): string {
  const timeStr = formatTimeForTimestamp(timestamp);
  let result = `## [${timeStr}] Assistant

`;

  // Add tool invocations if present
  if (toolInvocations && toolInvocations.length > 0) {
    for (const tool of toolInvocations) {
      result += formatToolInvocation(tool);
    }
  }

  // Add the content
  if (content.trim()) {
    result += content + "\n\n";
  }

  return result;
}

/**
 * Ensures the transcripts directory exists.
 *
 * @param vault - The VaultInfo object
 * @returns Absolute path to the chats directory
 */
export async function ensureTranscriptsDirectory(vault: VaultInfo): Promise<string> {
  const chatsDir = getTranscriptsDirectory(vault);

  if (!(await directoryExists(chatsDir))) {
    try {
      await mkdir(chatsDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TranscriptError(`Failed to create chats directory "${chatsDir}": ${message}`);
    }
  }

  return chatsDir;
}

/**
 * Initializes a new transcript file with frontmatter.
 *
 * @param vault - The VaultInfo object
 * @param sessionId - The session UUID
 * @param firstMessage - Content of the first message (for title)
 * @param date - The date of the transcript
 * @returns Absolute path to the created transcript file
 */
export async function initializeTranscript(
  vault: VaultInfo,
  sessionId: string,
  firstMessage: string,
  date: Date = new Date()
): Promise<string> {
  const chatsDir = await ensureTranscriptsDirectory(vault);
  const filename = generateTranscriptFilename(sessionId, date);
  const transcriptPath = join(chatsDir, filename);

  const frontmatter = generateTranscriptFrontmatter(sessionId, firstMessage, date);

  try {
    await writeFile(transcriptPath, frontmatter, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TranscriptError(`Failed to create transcript "${transcriptPath}": ${message}`);
  }

  return transcriptPath;
}

/**
 * Appends content to an existing transcript file.
 *
 * @param transcriptPath - Absolute path to the transcript file
 * @param content - The content to append
 */
export async function appendToTranscript(
  transcriptPath: string,
  content: string
): Promise<void> {
  try {
    await appendFile(transcriptPath, content, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TranscriptError(`Failed to append to transcript "${transcriptPath}": ${message}`);
  }
}
