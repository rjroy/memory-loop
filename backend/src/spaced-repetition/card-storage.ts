/**
 * Card Storage
 *
 * File operations for reading and writing spaced repetition cards.
 * Cards are stored as markdown files with YAML frontmatter.
 *
 * Spec Requirements:
 * - REQ-F-10: Cards stored as Markdown files in 06_Metadata/memory-loop/cards/
 * - REQ-F-11: Each card is one file with YAML frontmatter containing metadata
 * - REQ-F-38: System skips cards with invalid YAML frontmatter and logs warning
 * - REQ-F-39: System creates cards/ directory if not present on first discovery run
 * - REQ-F-40: System creates cards/archive/ directory if not present on first archive operation
 * - REQ-NF-4: Atomic file writes via temp+rename pattern
 *
 * Plan Reference:
 * - TD-1: Card Storage as Markdown Files
 */

import { readFile, writeFile, rename, unlink, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  type Card,
  type QACardContent,
  safeParseCardMetadata,
  safeParseQACardContent,
  formatCardError,
  isDueToday,
  getToday,
} from "./card-schema.js";
import { createLogger } from "../logger.js";

const log = createLogger("card-storage");

// =============================================================================
// Constants
// =============================================================================

/**
 * Subdirectory within vault metadata path for cards.
 */
export const CARDS_SUBDIR = "cards";

/**
 * Subdirectory within cards for archived cards.
 */
export const ARCHIVE_SUBDIR = "archive";

/**
 * File extension for card files.
 */
export const CARD_EXTENSION = ".md";

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Vault info type (subset of what vault-manager provides).
 * Using a minimal interface to avoid circular dependencies.
 */
export interface VaultPathInfo {
  /** Absolute path to vault content root */
  contentRoot: string;
  /** Relative path from content root to metadata directory */
  metadataPath: string;
}

/**
 * Get the absolute path to the cards directory for a vault.
 *
 * @param vault - Vault path information
 * @returns Absolute path to cards directory (e.g., /vault/content/06_Metadata/memory-loop/cards)
 */
export function getCardsDir(vault: VaultPathInfo): string {
  return join(vault.contentRoot, vault.metadataPath, CARDS_SUBDIR);
}

/**
 * Get the absolute path to the archive directory for a vault.
 *
 * @param vault - Vault path information
 * @returns Absolute path to archive directory (e.g., /vault/content/06_Metadata/memory-loop/cards/archive)
 */
export function getArchiveDir(vault: VaultPathInfo): string {
  return join(getCardsDir(vault), ARCHIVE_SUBDIR);
}

/**
 * Get the absolute path to a specific card file.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card
 * @returns Absolute path to the card file
 */
export function getCardPath(vault: VaultPathInfo, cardId: string): string {
  return join(getCardsDir(vault), `${cardId}${CARD_EXTENSION}`);
}

/**
 * Get the absolute path to an archived card file.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card
 * @returns Absolute path to the archived card file
 */
export function getArchivedCardPath(vault: VaultPathInfo, cardId: string): string {
  return join(getArchiveDir(vault), `${cardId}${CARD_EXTENSION}`);
}

// =============================================================================
// Card File Parsing
// =============================================================================

/**
 * Result type for parseCardFile operation.
 */
export type ParseCardResult =
  | { success: true; card: Card }
  | { success: false; error: string };

/**
 * Parse a card file's content into metadata and Q&A content.
 *
 * Card files have the format:
 * ```markdown
 * ---
 * id: "uuid"
 * type: "qa"
 * ...other metadata...
 * ---
 *
 * ## Question
 *
 * The question text...
 *
 * ## Answer
 *
 * The answer text...
 * ```
 *
 * @param content - Raw markdown content of the card file
 * @returns Parsed card or error
 */
export function parseCardFile(content: string): ParseCardResult {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { success: false, error: "No YAML frontmatter found" };
  }

  const [, yamlContent, bodyContent] = frontmatterMatch;

  // Parse YAML frontmatter
  let rawMetadata: unknown;
  try {
    rawMetadata = parseYaml(yamlContent);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Invalid YAML: ${message}` };
  }

  // Validate metadata against schema
  const metadataResult = safeParseCardMetadata(rawMetadata);
  if (!metadataResult.success) {
    return { success: false, error: formatCardError(metadataResult.error) };
  }

  // Extract question and answer from body
  const qaResult = extractQAFromBody(bodyContent);
  if (!qaResult.success) {
    return qaResult;
  }

  return {
    success: true,
    card: {
      metadata: metadataResult.data,
      content: qaResult.content,
    },
  };
}

/**
 * Extract question and answer from the card body.
 *
 * Expects headers: ## Question and ## Answer
 */
function extractQAFromBody(
  body: string
): { success: true; content: QACardContent } | { success: false; error: string } {
  // Split on ## headers
  const questionMatch = body.match(/##\s*Question\s*\n([\s\S]*?)(?=##\s*Answer|$)/i);
  const answerMatch = body.match(/##\s*Answer\s*\n([\s\S]*)$/i);

  if (!questionMatch) {
    return { success: false, error: "Missing '## Question' section" };
  }
  if (!answerMatch) {
    return { success: false, error: "Missing '## Answer' section" };
  }

  const question = questionMatch[1].trim();
  const answer = answerMatch[1].trim();

  // Validate against schema
  const contentResult = safeParseQACardContent({ question, answer });
  if (!contentResult.success) {
    return { success: false, error: formatCardError(contentResult.error) };
  }

  return { success: true, content: contentResult.data };
}

// =============================================================================
// Card File Serialization
// =============================================================================

/**
 * Serialize a card to markdown file content.
 *
 * @param card - Card to serialize
 * @returns Markdown string with YAML frontmatter and Q&A body
 */
export function serializeCard(card: Card): string {
  // Build frontmatter with explicit field order for readability
  const metadata: Record<string, unknown> = {
    id: card.metadata.id,
    type: card.metadata.type,
    created_date: card.metadata.created_date,
    last_reviewed: card.metadata.last_reviewed,
    next_review: card.metadata.next_review,
    ease_factor: card.metadata.ease_factor,
    interval: card.metadata.interval,
    repetitions: card.metadata.repetitions,
  };

  // Only include source_file if present
  if (card.metadata.source_file) {
    metadata.source_file = card.metadata.source_file;
  }

  const yamlContent = stringifyYaml(metadata, {
    // Quote strings to preserve them properly
    defaultStringType: "QUOTE_DOUBLE",
    // Use quotes for dates to prevent YAML parsing issues
    defaultKeyType: "PLAIN",
  });

  const body = `## Question

${card.content.question}

## Answer

${card.content.answer}
`;

  return `---\n${yamlContent}---\n\n${body}`;
}

// =============================================================================
// Card File Operations
// =============================================================================

/**
 * Read and parse a card file.
 *
 * @param path - Absolute path to the card file
 * @returns Parsed card or error
 */
export async function readCardFile(path: string): Promise<ParseCardResult> {
  try {
    const content = await readFile(path, "utf-8");
    return parseCardFile(content);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, error: "Card file not found" };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to read card file: ${message}` };
  }
}

/**
 * Write a card file atomically using temp+rename pattern.
 *
 * Per REQ-NF-4: Atomic writes prevent corruption if process is interrupted.
 *
 * @param path - Absolute path to write the card file
 * @param card - Card to write
 * @throws Error if write fails
 */
export async function writeCardFile(path: string, card: Card): Promise<void> {
  const dir = dirname(path);
  const tempPath = join(dir, `.card-${card.metadata.id}.${Date.now()}.tmp`);

  try {
    // Ensure directory exists (REQ-F-39)
    await mkdir(dir, { recursive: true });

    // Serialize card to markdown
    const content = serializeCard(card);

    // Write to temp file
    await writeFile(tempPath, content, "utf-8");

    // Atomic rename
    await rename(tempPath, path);

    log.debug(`Wrote card ${card.metadata.id} to ${path}`);
  } catch (e) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw e;
  }
}

/**
 * Write a card to the cards directory.
 *
 * @param vault - Vault path information
 * @param card - Card to write
 * @throws Error if write fails
 */
export async function saveCard(vault: VaultPathInfo, card: Card): Promise<void> {
  const path = getCardPath(vault, card.metadata.id);
  await writeCardFile(path, card);
}

/**
 * Read a card from the cards directory.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card to read
 * @returns Parsed card or error
 */
export async function loadCard(
  vault: VaultPathInfo,
  cardId: string
): Promise<ParseCardResult> {
  const path = getCardPath(vault, cardId);
  return readCardFile(path);
}

// =============================================================================
// Card Listing
// =============================================================================

/**
 * Result type for listing cards.
 */
export interface CardListEntry {
  id: string;
  path: string;
}

/**
 * List all card files in the cards directory.
 * Does not include archived cards.
 *
 * @param vault - Vault path information
 * @returns Array of card IDs and paths
 */
export async function listCards(vault: VaultPathInfo): Promise<CardListEntry[]> {
  const cardsDir = getCardsDir(vault);

  try {
    const entries = await readdir(cardsDir, { withFileTypes: true });

    return entries
      .filter((entry) => {
        // Only files with .md extension
        // Exclude archive directory
        return (
          entry.isFile() &&
          entry.name.endsWith(CARD_EXTENSION) &&
          entry.name !== ARCHIVE_SUBDIR
        );
      })
      .map((entry) => ({
        id: entry.name.slice(0, -CARD_EXTENSION.length),
        path: join(cardsDir, entry.name),
      }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // Cards directory doesn't exist yet
      return [];
    }
    throw e;
  }
}

/**
 * Load all valid cards from the cards directory.
 * Skips invalid cards with a warning (per REQ-F-38).
 *
 * @param vault - Vault path information
 * @returns Array of parsed cards
 */
export async function loadAllCards(vault: VaultPathInfo): Promise<Card[]> {
  const entries = await listCards(vault);
  const cards: Card[] = [];

  for (const entry of entries) {
    const result = await readCardFile(entry.path);
    if (result.success) {
      cards.push(result.card);
    } else {
      log.warn(`Skipping invalid card ${entry.id}: ${result.error}`);
    }
  }

  return cards;
}

/**
 * Hash a string to a 32-bit integer using djb2 variant.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Generate a deterministic hash for sorting cards.
 * Uses a pre-computed seed hash to avoid recalculating it for each comparison.
 * This prevents sequence effects where users recognize cards by position.
 *
 * @param seedHash - Pre-computed hash of the date seed
 * @param cardId - Card ID to hash
 * @returns Numeric hash for sorting
 */
function hashForSort(seedHash: number, cardId: string): number {
  let hash = seedHash;
  for (let i = 0; i < cardId.length; i++) {
    const char = cardId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash ^ seedHash;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Load all cards that are due for review (next_review <= today).
 * Sorted by next_review ascending (oldest first), with date-seeded
 * randomization as secondary sort to prevent sequence effects.
 *
 * @param vault - Vault path information
 * @param today - Today's date in YYYY-MM-DD format (defaults to actual today)
 * @returns Array of due cards, sorted by next_review then randomized by date seed
 */
export async function loadDueCards(
  vault: VaultPathInfo,
  today: string = getToday()
): Promise<Card[]> {
  const allCards = await loadAllCards(vault);
  const seedHash = hashString(today);

  return allCards
    .filter((card) => isDueToday(card.metadata.next_review, today))
    .sort((a, b) => {
      // Primary: sort by next_review date (older cards first)
      const dateCompare = a.metadata.next_review.localeCompare(b.metadata.next_review);
      if (dateCompare !== 0) return dateCompare;

      // Secondary: deterministic shuffle seeded by today's date
      return hashForSort(seedHash, a.metadata.id) - hashForSort(seedHash, b.metadata.id);
    });
}

// =============================================================================
// Card Archive Operations
// =============================================================================

/**
 * Move a card to the archive directory (per REQ-F-21).
 *
 * The card retains all its metadata (per REQ-F-36) but will no longer
 * appear in the review queue.
 *
 * @param vault - Vault path information
 * @param cardId - UUID of the card to archive
 * @returns true if archived, false if card not found
 */
export async function archiveCard(
  vault: VaultPathInfo,
  cardId: string
): Promise<boolean> {
  const sourcePath = getCardPath(vault, cardId);
  const archiveDir = getArchiveDir(vault);
  const destPath = getArchivedCardPath(vault, cardId);

  // Read the card first to verify it exists and is valid
  const result = await readCardFile(sourcePath);
  if (!result.success) {
    log.warn(`Cannot archive card ${cardId}: ${result.error}`);
    return false;
  }

  // Ensure archive directory exists (REQ-F-40)
  await mkdir(archiveDir, { recursive: true });

  // Move the file by renaming
  try {
    await rename(sourcePath, destPath);
    log.info(`Archived card ${cardId}`);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`Failed to archive card ${cardId}: ${message}`);
    return false;
  }
}

// =============================================================================
// Directory Initialization
// =============================================================================

/**
 * Ensure the cards directory exists (per REQ-F-39).
 * Called before first discovery run or card write.
 *
 * @param vault - Vault path information
 */
export async function ensureCardsDir(vault: VaultPathInfo): Promise<void> {
  const cardsDir = getCardsDir(vault);
  await mkdir(cardsDir, { recursive: true });
  log.debug(`Ensured cards directory exists: ${cardsDir}`);
}

/**
 * Ensure the archive directory exists (per REQ-F-40).
 * Called before first archive operation.
 *
 * @param vault - Vault path information
 */
export async function ensureArchiveDir(vault: VaultPathInfo): Promise<void> {
  const archiveDir = getArchiveDir(vault);
  await mkdir(archiveDir, { recursive: true });
  log.debug(`Ensured archive directory exists: ${archiveDir}`);
}
