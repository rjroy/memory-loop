/**
 * Memory Writer with Sandbox Pattern
 *
 * Handles memory file persistence with sandbox copy pattern for safe
 * Claude Agent SDK operations, and vault CLAUDE.md section isolation.
 *
 * Spec Requirements:
 * - REQ-F-1: Store facts in ~/.claude/rules/memory.md for context injection
 * - REQ-F-3: Write vault-specific insights to CLAUDE.md
 * - REQ-NF-1: Enforce 50KB memory file limit
 * - REQ-NF-3: Privacy/safety via sandboxing
 *
 * Plan Reference:
 * - TD-7: Append to dedicated `## Memory Loop Insights` section in CLAUDE.md
 * - TD-9: Prune oldest entries when approaching 50KB limit
 * - TD-12: Sandbox copy pattern for safe extraction
 */

import { readFile, writeFile, rename, unlink, mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "../logger.js";
import { fileExists, getVaultsDir } from "../vault-manager.js";

const log = createLogger("memory-writer");

// =============================================================================
// Constants
// =============================================================================

/**
 * Get the path to the global memory file that Claude reads.
 * This is where facts are injected into Claude's context.
 *
 * Uses MEMORY_FILE_PATH_OVERRIDE env var if set (for testing),
 * otherwise defaults to ~/.claude/rules/memory.md
 */
export function getMemoryFilePath(): string {
  if (process.env.MEMORY_FILE_PATH_OVERRIDE) {
    return process.env.MEMORY_FILE_PATH_OVERRIDE;
  }
  return join(homedir(), ".claude", "rules", "memory.md");
}

/**
 * Path to the global memory file that Claude reads.
 * @deprecated Use getMemoryFilePath() instead for testability
 */
export const MEMORY_FILE_PATH = join(homedir(), ".claude", "rules", "memory.md");

/**
 * Relative path for the sandbox copy within VAULTS_DIR.
 */
export const SANDBOX_RELATIVE_PATH = ".memory-extraction/memory.md";

/**
 * Maximum size for the memory file in bytes (50KB).
 */
export const MAX_MEMORY_SIZE_BYTES = 50 * 1024;

/**
 * Warning threshold for memory file size in bytes (45KB).
 */
export const MEMORY_SIZE_WARNING_BYTES = 45 * 1024;

/**
 * Section header for Memory Loop insights in vault CLAUDE.md files.
 */
export const VAULT_INSIGHTS_SECTION = "## Memory Loop Insights";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a sandbox operation.
 */
export interface SandboxResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Path to the sandbox copy */
  sandboxPath: string;
}

/**
 * Result of a memory write operation.
 */
export interface WriteResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Final file size in bytes */
  sizeBytes?: number;
  /** Whether pruning was performed */
  wasPruned?: boolean;
}

/**
 * Recovery check result.
 */
export interface RecoveryResult {
  /** Whether recovery was needed */
  recoveryNeeded: boolean;
  /** What action was taken */
  action: "none" | "copy-back" | "delete-stale";
  /** Error if recovery failed */
  error?: string;
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the absolute path to the sandbox memory file.
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 * @returns Absolute path to sandbox memory file
 */
export function getSandboxPath(vaultsDir?: string): string {
  const dir = vaultsDir ?? getVaultsDir();
  return join(dir, SANDBOX_RELATIVE_PATH);
}

/**
 * Get the sandbox directory path (parent of sandbox file).
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 * @returns Absolute path to sandbox directory
 */
export function getSandboxDir(vaultsDir?: string): string {
  return dirname(getSandboxPath(vaultsDir));
}

// =============================================================================
// Atomic Write Helper
// =============================================================================

/**
 * Write content to a file atomically using temp file + rename.
 *
 * @param filePath - Target file path
 * @param content - Content to write
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = join(dir, `.memory-${Date.now()}.tmp`);

  try {
    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write to temp file
    await writeFile(tempPath, content, "utf-8");

    // Atomic rename
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// =============================================================================
// Sandbox Operations
// =============================================================================

/**
 * Copy memory.md to the sandbox directory before extraction.
 *
 * If the global memory file doesn't exist, creates an empty file in the sandbox.
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 * @returns Sandbox operation result
 */
export async function setupSandbox(vaultsDir?: string): Promise<SandboxResult> {
  const sandboxPath = getSandboxPath(vaultsDir);
  const sandboxDir = getSandboxDir(vaultsDir);

  try {
    // Ensure sandbox directory exists
    await mkdir(sandboxDir, { recursive: true });

    // Check if global memory file exists
    const memoryPath = getMemoryFilePath();
    if (await fileExists(memoryPath)) {
      // Copy to sandbox
      await copyFile(memoryPath, sandboxPath);
      log.info(`Copied memory file to sandbox: ${sandboxPath}`);
    } else {
      // Create empty file in sandbox
      await writeFile(sandboxPath, "# Memory\n\n", "utf-8");
      log.info(`Created empty memory file in sandbox: ${sandboxPath}`);
    }

    return {
      success: true,
      sandboxPath,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Failed to setup sandbox: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
      sandboxPath,
    };
  }
}

/**
 * Copy memory.md from sandbox back to global location after extraction.
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 * @returns Write result
 */
export async function commitSandbox(vaultsDir?: string): Promise<WriteResult> {
  const sandboxPath = getSandboxPath(vaultsDir);

  try {
    // Check sandbox file exists
    if (!(await fileExists(sandboxPath))) {
      return {
        success: false,
        error: "Sandbox file does not exist",
      };
    }

    // Read sandbox content
    const content = await readFile(sandboxPath, "utf-8");

    // Enforce size limit
    const { content: finalContent, wasPruned } = enforceMemoryLimit(content);

    // Ensure target directory exists
    const memoryPath = getMemoryFilePath();
    await mkdir(dirname(memoryPath), { recursive: true });

    // Atomic write to global location
    await atomicWrite(memoryPath, finalContent);

    // Get final size
    const stats = await stat(memoryPath);

    log.info(`Committed sandbox to global memory file (${stats.size} bytes, pruned: ${wasPruned})`);

    return {
      success: true,
      sizeBytes: stats.size,
      wasPruned,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Failed to commit sandbox: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Clean up the sandbox after extraction is complete.
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 */
export async function cleanupSandbox(vaultsDir?: string): Promise<void> {
  const sandboxPath = getSandboxPath(vaultsDir);

  try {
    if (await fileExists(sandboxPath)) {
      await unlink(sandboxPath);
      log.debug(`Cleaned up sandbox file: ${sandboxPath}`);
    }
  } catch (error) {
    log.warn(`Failed to cleanup sandbox: ${(error as Error).message}`);
  }
}

// =============================================================================
// Recovery Logic
// =============================================================================

/**
 * Check for and recover from crashed extraction.
 *
 * Called on startup. If sandbox file exists:
 * - If newer than global: previous extraction crashed after write, complete copy-back
 * - If older/same: stale file from aborted run, delete it
 *
 * @param vaultsDir - Optional VAULTS_DIR override (for testing)
 * @returns Recovery result
 */
export async function checkAndRecover(vaultsDir?: string): Promise<RecoveryResult> {
  const sandboxPath = getSandboxPath(vaultsDir);

  try {
    // Check if sandbox file exists
    if (!(await fileExists(sandboxPath))) {
      return { recoveryNeeded: false, action: "none" };
    }

    log.info("Found sandbox file, checking recovery status...");

    // Get sandbox file stats
    const sandboxStats = await stat(sandboxPath);

    // Check global file
    const memoryPath = getMemoryFilePath();
    if (await fileExists(memoryPath)) {
      const globalStats = await stat(memoryPath);

      // Compare modification times
      if (sandboxStats.mtime > globalStats.mtime) {
        // Sandbox is newer - crashed after write, complete copy-back
        log.info("Sandbox is newer than global file, completing recovery...");
        const result = await commitSandbox(vaultsDir);

        if (result.success) {
          await cleanupSandbox(vaultsDir);
          return { recoveryNeeded: true, action: "copy-back" };
        } else {
          return {
            recoveryNeeded: true,
            action: "copy-back",
            error: result.error,
          };
        }
      } else {
        // Sandbox is older/same - stale file, delete it
        log.info("Sandbox is stale, deleting...");
        await cleanupSandbox(vaultsDir);
        return { recoveryNeeded: true, action: "delete-stale" };
      }
    } else {
      // No global file - sandbox is the only copy, recover it
      log.info("No global file exists, recovering from sandbox...");
      const result = await commitSandbox(vaultsDir);

      if (result.success) {
        await cleanupSandbox(vaultsDir);
        return { recoveryNeeded: true, action: "copy-back" };
      } else {
        return {
          recoveryNeeded: true,
          action: "copy-back",
          error: result.error,
        };
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Recovery check failed: ${errorMessage}`);
    return {
      recoveryNeeded: true,
      action: "none",
      error: errorMessage,
    };
  }
}

// =============================================================================
// Size Management
// =============================================================================

/**
 * Enforce the 50KB memory limit by pruning oldest entries.
 *
 * Pruning strategy: Remove lines from the top of each section (oldest by
 * file position) until the file is under the limit.
 *
 * @param content - Current memory file content
 * @returns Content after pruning and whether pruning occurred
 */
export function enforceMemoryLimit(
  content: string
): { content: string; wasPruned: boolean } {
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  if (sizeBytes <= MAX_MEMORY_SIZE_BYTES) {
    return { content, wasPruned: false };
  }

  log.warn(`Memory file exceeds limit (${sizeBytes} bytes), pruning...`);

  // Parse into sections
  const sections = parseMemorySections(content);

  // Keep pruning until under limit
  let pruned = content;
  let iterations = 0;
  const maxIterations = 1000; // Safety limit

  while (
    Buffer.byteLength(pruned, "utf-8") > MAX_MEMORY_SIZE_BYTES &&
    iterations < maxIterations
  ) {
    iterations++;

    // Find section with most content and prune from it
    const largestSection = findLargestSection(sections);
    if (!largestSection || largestSection.lines.length === 0) {
      break; // Can't prune anymore
    }

    // Calculate how aggressive to prune based on overage
    const currentSize = Buffer.byteLength(pruned, "utf-8");
    const overage = currentSize - MAX_MEMORY_SIZE_BYTES;
    // Remove more lines when significantly over (up to 10% of section)
    const linesToRemove = Math.min(
      Math.max(1, Math.ceil(overage / 100)), // Remove more when further over
      Math.ceil(largestSection.lines.length * 0.1) // But never more than 10% of section
    );

    // Remove lines from the start (oldest by position)
    for (let i = 0; i < linesToRemove && largestSection.lines.length > 0; i++) {
      largestSection.lines.shift();
    }

    // Rebuild content
    pruned = rebuildMemoryContent(sections);
  }

  if (iterations >= maxIterations) {
    log.warn(`Hit max pruning iterations (${maxIterations})`);
  }

  const finalSize = Buffer.byteLength(pruned, "utf-8");
  log.info(`Pruned memory from ${sizeBytes} to ${finalSize} bytes`);

  return { content: pruned, wasPruned: true };
}

/**
 * Check if memory file size exceeds warning threshold.
 *
 * @param content - Memory file content
 * @returns Size info with warning flag
 */
export function checkMemorySize(content: string): {
  sizeBytes: number;
  isWarning: boolean;
  isOverLimit: boolean;
} {
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  return {
    sizeBytes,
    isWarning: sizeBytes >= MEMORY_SIZE_WARNING_BYTES,
    isOverLimit: sizeBytes > MAX_MEMORY_SIZE_BYTES,
  };
}

// =============================================================================
// Section Parsing
// =============================================================================

interface MemorySection {
  header: string;
  lines: string[];
}

/**
 * Parse memory content into sections (H2 headers).
 */
function parseMemorySections(content: string): MemorySection[] {
  const lines = content.split("\n");
  const sections: MemorySection[] = [];
  let currentSection: MemorySection | null = null;
  const headerLines: string[] = []; // Lines before first section

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // New section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        header: line,
        lines: [],
      };
    } else if (currentSection) {
      // Add to current section
      if (line.trim() !== "" || currentSection.lines.length > 0) {
        currentSection.lines.push(line);
      }
    } else {
      // Lines before first section (title, etc)
      headerLines.push(line);
    }
  }

  // Don't forget the last section
  if (currentSection) {
    sections.push(currentSection);
  }

  // Store header lines as a pseudo-section
  if (headerLines.length > 0) {
    sections.unshift({
      header: "", // No header
      lines: headerLines,
    });
  }

  return sections;
}

/**
 * Find the section with the most content lines.
 */
function findLargestSection(sections: MemorySection[]): MemorySection | null {
  let largest: MemorySection | null = null;
  let maxLines = 0;

  for (const section of sections) {
    // Skip header section (no ## prefix)
    if (section.header === "") continue;

    const contentLines = section.lines.filter((l) => l.trim() !== "").length;
    if (contentLines > maxLines) {
      maxLines = contentLines;
      largest = section;
    }
  }

  return largest;
}

/**
 * Rebuild memory content from sections.
 */
function rebuildMemoryContent(sections: MemorySection[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    if (section.header === "") {
      // Header lines (title, etc)
      parts.push(section.lines.join("\n"));
    } else {
      parts.push(section.header);
      if (section.lines.length > 0) {
        parts.push(section.lines.join("\n"));
      }
    }
  }

  return parts.join("\n").trim() + "\n";
}

// =============================================================================
// Duplicate Detection
// =============================================================================

/**
 * Similarity threshold for duplicate detection.
 * Facts with similarity >= 0.9 are considered duplicates.
 */
export const DUPLICATE_THRESHOLD = 0.9;

/**
 * Normalize text for duplicate comparison.
 *
 * @param text - Text to normalize
 * @returns Normalized text: lowercase, trimmed, punctuation removed
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " "); // Normalize whitespace
}

/**
 * Calculate Levenshtein distance between two strings.
 *
 * Uses the Wagner-Fischer algorithm with O(min(m,n)) space complexity.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Levenshtein distance (edit distance)
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Early exit for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix (space optimization)
  let prevRow = new Array<number>(m + 1);
  let currRow = new Array<number>(m + 1);

  // Initialize first row
  for (let i = 0; i <= m; i++) {
    prevRow[i] = i;
  }

  // Fill the matrix
  for (let j = 1; j <= n; j++) {
    currRow[0] = j;

    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i] + 1, // Deletion
        currRow[i - 1] + 1, // Insertion
        prevRow[i - 1] + cost // Substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[m];
}

/**
 * Calculate similarity ratio between two strings using Levenshtein distance.
 *
 * @param a - First string (normalized)
 * @param b - Second string (normalized)
 * @returns Similarity ratio between 0 and 1 (1 = identical)
 */
export function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Check if two facts are duplicates.
 *
 * @param newFact - New fact to check
 * @param existingFact - Existing fact to compare against
 * @param threshold - Similarity threshold (default: 0.9)
 * @returns True if facts are considered duplicates
 */
export function isDuplicate(
  newFact: string,
  existingFact: string,
  threshold: number = DUPLICATE_THRESHOLD
): boolean {
  const normalizedNew = normalizeText(newFact);
  const normalizedExisting = normalizeText(existingFact);

  // Exact match after normalization
  if (normalizedNew === normalizedExisting) {
    return true;
  }

  // Fuzzy match
  return calculateSimilarity(normalizedNew, normalizedExisting) >= threshold;
}

/**
 * Result of filtering duplicates from new facts.
 */
export interface DuplicateFilterResult {
  /** Facts that passed duplicate check (unique) */
  uniqueFacts: string[];
  /** Facts that were identified as duplicates */
  duplicates: string[];
  /** Number of duplicates found */
  duplicateCount: number;
}

/**
 * Filter duplicate facts from a list of new facts.
 *
 * @param newFacts - List of new facts to check
 * @param existingFacts - List of existing facts to compare against
 * @param threshold - Similarity threshold (default: 0.9)
 * @returns Filtered results with unique facts and duplicate info
 */
export function filterDuplicates(
  newFacts: string[],
  existingFacts: string[],
  threshold: number = DUPLICATE_THRESHOLD
): DuplicateFilterResult {
  const uniqueFacts: string[] = [];
  const duplicates: string[] = [];

  for (const newFact of newFacts) {
    // Skip empty facts
    if (!newFact.trim()) continue;

    // Check against existing facts
    const isDup = existingFacts.some((existing) =>
      isDuplicate(newFact, existing, threshold)
    );

    // Also check against already-accepted new facts (self-deduplication)
    const isSelfDup = uniqueFacts.some((accepted) =>
      isDuplicate(newFact, accepted, threshold)
    );

    if (isDup || isSelfDup) {
      duplicates.push(newFact);
      log.debug(`Skipping duplicate fact: "${newFact.substring(0, 50)}..."`);
    } else {
      uniqueFacts.push(newFact);
    }
  }

  if (duplicates.length > 0) {
    log.info(`Filtered ${duplicates.length} duplicate fact(s)`);
  }

  return {
    uniqueFacts,
    duplicates,
    duplicateCount: duplicates.length,
  };
}

/**
 * Extract facts from memory content (lines that aren't headers or empty).
 *
 * @param content - Memory file content
 * @returns Array of fact lines
 */
export function extractFactsFromContent(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Skip empty lines and headers
      return trimmed && !trimmed.startsWith("#");
    });
}

/**
 * Merge new facts into existing content, filtering duplicates.
 *
 * @param existingContent - Current memory file content
 * @param newFacts - New facts to merge
 * @param sectionHeader - Section header to merge into (e.g., "## Discoveries")
 * @param threshold - Similarity threshold (default: 0.9)
 * @returns Merged content and duplicate count
 */
export function mergeFactsWithDeduplication(
  existingContent: string,
  newFacts: string[],
  sectionHeader: string,
  threshold: number = DUPLICATE_THRESHOLD
): { content: string; duplicateCount: number } {
  // Extract existing facts
  const existingFacts = extractFactsFromContent(existingContent);

  // Filter duplicates
  const { uniqueFacts, duplicateCount } = filterDuplicates(
    newFacts,
    existingFacts,
    threshold
  );

  if (uniqueFacts.length === 0) {
    return { content: existingContent, duplicateCount };
  }

  // Parse sections
  const sections = parseMemorySections(existingContent);

  // Find or create target section
  let targetSection = sections.find((s) => s.header === sectionHeader);
  if (!targetSection) {
    targetSection = { header: sectionHeader, lines: [] };
    sections.push(targetSection);
  }

  // Add unique facts to section
  for (const fact of uniqueFacts) {
    targetSection.lines.push(fact);
  }

  // Rebuild content
  const content = rebuildMemoryContent(sections);

  return { content, duplicateCount };
}

// =============================================================================
// Vault CLAUDE.md Section Management
// =============================================================================

/**
 * Update the Memory Loop Insights section in a vault's CLAUDE.md.
 *
 * Only modifies the dedicated section; preserves all other content.
 *
 * @param claudeMdPath - Path to the vault's CLAUDE.md file
 * @param insights - New insights content (without the ## header)
 * @returns Write result
 */
export async function updateVaultInsights(
  claudeMdPath: string,
  insights: string
): Promise<WriteResult> {
  try {
    // Read existing content
    let content = "";
    if (await fileExists(claudeMdPath)) {
      content = await readFile(claudeMdPath, "utf-8");
    }

    // Build new section content
    const sectionContent = `${VAULT_INSIGHTS_SECTION}\n\n${insights.trim()}\n`;

    // Find and replace or append the section
    const newContent = replaceOrAppendSection(content, sectionContent);

    // Atomic write
    await atomicWrite(claudeMdPath, newContent);

    const stats = await stat(claudeMdPath);
    log.info(`Updated vault insights: ${claudeMdPath} (${stats.size} bytes)`);

    return {
      success: true,
      sizeBytes: stats.size,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Failed to update vault insights: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Replace the Memory Loop Insights section or append it to the end.
 */
function replaceOrAppendSection(content: string, newSection: string): string {
  const sectionRegex = new RegExp(
    `${escapeRegex(VAULT_INSIGHTS_SECTION)}[\\s\\S]*?(?=\\n## |$)`,
    "g"
  );

  if (sectionRegex.test(content)) {
    // Replace existing section
    return content.replace(sectionRegex, newSection.trim());
  } else {
    // Append new section
    const trimmedContent = content.trimEnd();
    return `${trimmedContent}\n\n${newSection}`;
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the current Memory Loop Insights section from a vault's CLAUDE.md.
 *
 * @param claudeMdPath - Path to the vault's CLAUDE.md file
 * @returns Section content (without header) or null if not found
 */
export async function readVaultInsights(claudeMdPath: string): Promise<string | null> {
  try {
    if (!(await fileExists(claudeMdPath))) {
      return null;
    }

    const content = await readFile(claudeMdPath, "utf-8");
    const sectionRegex = new RegExp(
      `${escapeRegex(VAULT_INSIGHTS_SECTION)}\\n([\\s\\S]*?)(?=\\n## |$)`
    );

    const match = content.match(sectionRegex);
    if (match) {
      return match[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Direct Memory Operations (for Settings UI)
// =============================================================================

/**
 * Read the global memory file content.
 *
 * @returns Content or empty string if file doesn't exist
 */
export async function readMemoryFile(): Promise<string> {
  try {
    const memoryPath = getMemoryFilePath();
    if (await fileExists(memoryPath)) {
      return await readFile(memoryPath, "utf-8");
    }
    return "";
  } catch (error) {
    log.warn(`Failed to read memory file: ${(error as Error).message}`);
    return "";
  }
}

/**
 * Write content to the global memory file.
 *
 * Enforces size limit and uses atomic write.
 *
 * @param content - Content to write
 * @returns Write result
 */
export async function writeMemoryFile(content: string): Promise<WriteResult> {
  try {
    // Enforce size limit
    const { content: finalContent, wasPruned } = enforceMemoryLimit(content);

    // Ensure directory exists
    const memoryPath = getMemoryFilePath();
    await mkdir(dirname(memoryPath), { recursive: true });

    // Atomic write
    await atomicWrite(memoryPath, finalContent);

    const stats = await stat(memoryPath);
    log.info(`Wrote memory file (${stats.size} bytes, pruned: ${wasPruned})`);

    return {
      success: true,
      sizeBytes: stats.size,
      wasPruned,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Failed to write memory file: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
