/**
 * Transcript Reader
 *
 * Discovers and reads transcript markdown files from vault inbox directories
 * for the memory extraction pipeline.
 *
 * Spec Requirements:
 * - REQ-F-1: Extract facts from conversation transcripts
 * - REQ-F-8: Process only new or modified transcripts
 *
 * Plan Reference:
 * - TD-4: Transcripts in {inbox}/chats/*.md
 * - TD-5: Checksum-based change detection
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo } from "@memory-loop/shared";
import { discoverVaults, directoryExists } from "../vault-manager.js";
import { getTranscriptsDirectory } from "../transcript-manager.js";
import { createLogger } from "../logger.js";
import {
  calculateChecksum,
  isTranscriptProcessed,
  type ExtractionState,
} from "./extraction-state.js";

const log = createLogger("transcript-reader");

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed frontmatter from a transcript file.
 */
export interface TranscriptFrontmatter {
  /** ISO date string (YYYY-MM-DD) */
  date?: string;
  /** Time string (HH:MM) */
  time?: string;
  /** Session UUID */
  session_id?: string;
  /** Title extracted from first message */
  title?: string;
}

/**
 * A discovered transcript ready for processing.
 */
export interface DiscoveredTranscript {
  /** Vault identifier (directory name) */
  vaultId: string;
  /** Relative path from vault root to transcript file */
  path: string;
  /** Absolute path to transcript file */
  absolutePath: string;
  /** Raw file content */
  content: string;
  /** SHA-256 checksum of content */
  checksum: string;
  /** Parsed frontmatter (if valid) */
  frontmatter?: TranscriptFrontmatter;
  /** Markdown body (content after frontmatter) */
  body: string;
}

/**
 * Result of transcript discovery.
 */
export interface DiscoveryResult {
  /** All transcripts found (before filtering) */
  total: number;
  /** Transcripts needing processing */
  unprocessed: DiscoveredTranscript[];
  /** Transcripts skipped due to errors */
  errors: Array<{ path: string; error: string }>;
}

// =============================================================================
// Frontmatter Parsing
// =============================================================================

/**
 * Pattern to match YAML frontmatter delimiters.
 * Frontmatter starts with "---" on its own line, followed by YAML content,
 * and ends with "---" on its own line.
 */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter from transcript content.
 *
 * Uses simple key: value parsing to avoid external YAML dependencies.
 * Handles quoted strings and unquoted values.
 *
 * @param content - Raw file content
 * @returns Parsed frontmatter and body, or just body if no frontmatter
 */
export function parseTranscriptContent(content: string): {
  frontmatter?: TranscriptFrontmatter;
  body: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return { body: content };
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length);
  const frontmatter: TranscriptFrontmatter = {};

  // Parse simple key: value pairs
  const lines = yamlContent.split("\n");
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Map known keys
    switch (key) {
      case "date":
        frontmatter.date = value;
        break;
      case "time":
        frontmatter.time = value;
        break;
      case "session_id":
        frontmatter.session_id = value;
        break;
      case "title":
        frontmatter.title = value;
        break;
    }
  }

  return { frontmatter, body };
}

// =============================================================================
// Transcript Discovery
// =============================================================================

/**
 * List all markdown files in a vault's chats directory.
 *
 * @param vault - Vault info
 * @returns Array of filenames (just the name, not full path)
 */
export async function listTranscriptFiles(vault: VaultInfo): Promise<string[]> {
  const chatsDir = getTranscriptsDirectory(vault);

  if (!(await directoryExists(chatsDir))) {
    log.debug(`No chats directory for vault ${vault.id}: ${chatsDir}`);
    return [];
  }

  try {
    const entries = await readdir(chatsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    log.warn(`Failed to list chats directory for ${vault.id}: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Read and parse a single transcript file.
 *
 * @param vault - Vault info
 * @param filename - Transcript filename (e.g., "2026-01-18-1430-abc12.md")
 * @returns Discovered transcript, or null if reading/parsing fails
 */
export async function readTranscript(
  vault: VaultInfo,
  filename: string
): Promise<DiscoveredTranscript | null> {
  const chatsDir = getTranscriptsDirectory(vault);
  const absolutePath = join(chatsDir, filename);
  const relativePath = join(vault.inboxPath, "chats", filename);

  try {
    const content = await readFile(absolutePath, "utf-8");
    const checksum = calculateChecksum(content);
    const { frontmatter, body } = parseTranscriptContent(content);

    return {
      vaultId: vault.id,
      path: relativePath,
      absolutePath,
      content,
      checksum,
      frontmatter,
      body,
    };
  } catch (error) {
    log.warn(`Failed to read transcript ${absolutePath}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Discover all transcripts across all vaults.
 *
 * Returns transcripts that:
 * - Are markdown files in {inbox}/chats/
 * - Have not been processed (or have changed since last processing)
 *
 * @param state - Current extraction state for filtering
 * @returns Discovery result with unprocessed transcripts and any errors
 */
export async function discoverTranscripts(
  state: ExtractionState
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    total: 0,
    unprocessed: [],
    errors: [],
  };

  // Discover all vaults
  const vaults = await discoverVaults();
  log.info(`Discovering transcripts across ${vaults.length} vault(s)`);

  for (const vault of vaults) {
    // List transcript files
    const filenames = await listTranscriptFiles(vault);
    log.debug(`Found ${filenames.length} transcript(s) in vault ${vault.id}`);

    for (const filename of filenames) {
      result.total++;

      // Read the transcript
      const transcript = await readTranscript(vault, filename);
      if (!transcript) {
        result.errors.push({
          path: join(getTranscriptsDirectory(vault), filename),
          error: "Failed to read or parse file",
        });
        continue;
      }

      // Check if already processed with same content
      if (isTranscriptProcessed(state, transcript.vaultId, transcript.path, transcript.checksum)) {
        log.debug(`Skipping processed transcript: ${transcript.path}`);
        continue;
      }

      result.unprocessed.push(transcript);
    }
  }

  log.info(`Discovery complete: ${result.total} total, ${result.unprocessed.length} unprocessed, ${result.errors.length} errors`);
  return result;
}

/**
 * Discover transcripts for a specific vault.
 *
 * @param vault - Vault to discover transcripts from
 * @param state - Current extraction state for filtering
 * @returns Discovery result with unprocessed transcripts and any errors
 */
export async function discoverVaultTranscripts(
  vault: VaultInfo,
  state: ExtractionState
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    total: 0,
    unprocessed: [],
    errors: [],
  };

  const filenames = await listTranscriptFiles(vault);
  log.debug(`Found ${filenames.length} transcript(s) in vault ${vault.id}`);

  for (const filename of filenames) {
    result.total++;

    const transcript = await readTranscript(vault, filename);
    if (!transcript) {
      result.errors.push({
        path: join(getTranscriptsDirectory(vault), filename),
        error: "Failed to read or parse file",
      });
      continue;
    }

    if (isTranscriptProcessed(state, transcript.vaultId, transcript.path, transcript.checksum)) {
      log.debug(`Skipping processed transcript: ${transcript.path}`);
      continue;
    }

    result.unprocessed.push(transcript);
  }

  return result;
}
