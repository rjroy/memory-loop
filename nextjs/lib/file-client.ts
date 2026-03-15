/**
 * Transitional File Client (REQ-DAB-23)
 *
 * Provides file/transcript operations to nextjs modules that haven't
 * migrated to the daemon yet (session-manager, vault-transfer, vault-setup).
 *
 * Uses the shared daemon-fetch module so test injection covers all clients.
 * This module will be deleted in Stage 5/6 when remaining consumers move.
 */

import { resolve } from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";
import type { VaultInfo, StoredToolInvocation } from "@memory-loop/shared";
import { createLogger, formatTimeForTimestamp } from "@memory-loop/shared";
import { daemonFetch } from "./daemon-fetch";

const log = createLogger("file-client");

// ---------------------------------------------------------------------------
// Path validation (local copies, no daemon call needed)
// TODO: Stage 5 - remove when vault-transfer and vault-setup move to daemon
// ---------------------------------------------------------------------------

/**
 * Checks whether a target path is within the vault boundary.
 * Uses filesystem realpath resolution to prevent symlink escapes.
 */
export async function isPathWithinVault(
  vaultPath: string,
  targetPath: string,
): Promise<boolean> {
  try {
    const realVaultPath = await fsRealpath(vaultPath);

    let realTargetPath: string;
    try {
      realTargetPath = await fsRealpath(targetPath);
    } catch {
      realTargetPath = resolve(targetPath);
    }

    const normalizedVault = realVaultPath.endsWith("/")
      ? realVaultPath
      : realVaultPath + "/";

    return (
      realTargetPath === realVaultPath ||
      realTargetPath.startsWith(normalizedVault)
    );
  } catch {
    return false;
  }
}

/**
 * Validates and resolves a relative path within a vault.
 * Throws if the path escapes the vault boundary.
 */
export async function validatePath(
  vaultPath: string,
  relativePath: string,
): Promise<string> {
  const targetPath = resolve(vaultPath, relativePath);

  if (!(await isPathWithinVault(vaultPath, targetPath))) {
    log.warn(`Path traversal attempt: ${relativePath}`);
    throw new Error(`Path "${relativePath}" is outside the vault boundary`);
  }

  return targetPath;
}

// ---------------------------------------------------------------------------
// Transcript operations (proxied to daemon)
// ---------------------------------------------------------------------------

/**
 * Initialize a new transcript file via the daemon.
 * Returns the absolute path to the created transcript file.
 */
export async function initializeTranscript(
  vault: VaultInfo,
  sessionId: string,
  firstMessage: string,
  date?: Date,
): Promise<string> {
  const vaultId = vault.path.split("/").pop() ?? "";
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/transcripts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        firstMessage,
        ...(date ? { date: date.toISOString() } : {}),
      }),
    },
  );

  if (!res.ok) {
    const body = (await res.json()) as { error: string };
    throw new Error(`Failed to initialize transcript: ${body.error}`);
  }

  const body = (await res.json()) as { path: string };
  return body.path;
}

/**
 * Append content to an existing transcript file via the daemon.
 *
 * The daemon route requires a vault ID in the URL. We extract it from
 * the VAULTS_DIR environment variable and the transcript path, which
 * follows the pattern: {VAULTS_DIR}/{vaultId}/...
 */
export async function appendToTranscript(
  transcriptPath: string,
  content: string,
): Promise<void> {
  // Extract vault ID from the path by finding the segment after VAULTS_DIR.
  // Transcript paths are absolute: /path/to/vaults/{vaultId}/content/00_Inbox/chats/file.md
  const vaultsDir = process.env.VAULTS_DIR ?? "";
  let vaultId = "";
  if (vaultsDir && transcriptPath.startsWith(vaultsDir)) {
    const remainder = transcriptPath.slice(vaultsDir.length).replace(/^\//, "");
    vaultId = remainder.split("/")[0] ?? "";
  }
  if (!vaultId) {
    // Fallback: use the path segments heuristic
    const segments = transcriptPath.split("/");
    // Find "content" or ".memory-loop" and use the segment before it
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] === "content" || segments[i] === ".memory-loop") {
        vaultId = segments[i - 1] ?? "";
        break;
      }
    }
  }

  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/transcripts/append`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: transcriptPath, content }),
    },
  );

  if (!res.ok) {
    const body = (await res.json()) as { error: string };
    throw new Error(`Failed to append to transcript: ${body.error}`);
  }
}

// ---------------------------------------------------------------------------
// Transcript formatting (pure functions, no I/O)
// ---------------------------------------------------------------------------

/**
 * Formats a user message for the transcript.
 */
export function formatUserMessage(content: string, timestamp: Date): string {
  const timeStr = formatTimeForTimestamp(timestamp);
  return `## [${timeStr}] User

${content}

`;
}

/**
 * Formats a tool invocation as a blockquote.
 */
function formatToolInvocation(tool: StoredToolInvocation): string {
  const status = tool.status === "complete" ? "\u2713" : "\u2026";
  let line = `> **Tool:** ${tool.toolName}`;

  if (tool.input && typeof tool.input === "object") {
    const input = tool.input as Record<string, unknown>;

    if (input.pattern && typeof input.pattern === "string") {
      line += `\n> Pattern: \`${input.pattern}\``;
    }
    if (input.file_path && typeof input.file_path === "string") {
      line += `\n> File: \`${input.file_path}\``;
    }
    if (input.command && typeof input.command === "string") {
      const truncated =
        input.command.length > 80
          ? input.command.slice(0, 77) + "..."
          : input.command;
      line += `\n> Command: \`${truncated}\``;
    }
  }

  line += `\n> ${status}`;

  if (tool.status === "complete" && tool.output != null) {
    const output =
      typeof tool.output === "string"
        ? tool.output
        : JSON.stringify(tool.output);
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
 */
export function formatAssistantMessage(
  content: string,
  toolInvocations: StoredToolInvocation[] | undefined,
  timestamp: Date,
): string {
  const timeStr = formatTimeForTimestamp(timestamp);
  let result = `## [${timeStr}] Assistant

`;

  if (toolInvocations && toolInvocations.length > 0) {
    for (const tool of toolInvocations) {
      result += formatToolInvocation(tool);
    }
  }

  if (content.trim()) {
    result += content + "\n\n";
  }

  return result;
}
