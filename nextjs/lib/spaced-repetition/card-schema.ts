/**
 * Card Schema
 *
 * Zod schemas and TypeScript types for spaced repetition cards.
 * Cards are stored as markdown files with YAML frontmatter.
 *
 * Spec Requirements:
 * - REQ-F-10: Cards stored as Markdown files in 06_Metadata/memory-loop/cards/
 * - REQ-F-11: Each card is one file with YAML frontmatter containing metadata
 * - REQ-F-12: Card metadata includes SM-2 algorithm fields
 * - REQ-F-13: Card body contains question and answer in markdown format
 *
 * Plan Reference:
 * - TD-1: Card Storage as Markdown Files
 * - TD-6: Card ID Generation (UUID v4)
 */

import { z } from "zod";

// =============================================================================
// Date Pattern
// =============================================================================

/**
 * ISO 8601 date pattern (YYYY-MM-DD).
 * Used for all date fields in card metadata.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// =============================================================================
// Card Metadata Schema
// =============================================================================

/**
 * Schema for card metadata stored in YAML frontmatter.
 *
 * SM-2 algorithm fields:
 * - ease_factor: Multiplier for interval calculation (min 1.3, default 2.5)
 * - interval: Days until next review (starts at 0 for new cards)
 * - repetitions: Number of successful reviews (reset on "again")
 *
 * Lifecycle fields:
 * - created_date: When the card was created
 * - last_reviewed: When the card was last reviewed (null for new cards)
 * - next_review: When the card is due for review
 */
export const CardMetadataSchema = z.object({
  /** UUID v4 identifier for the card (also used as filename) */
  id: z.string().uuid(),

  /** Card type for extensibility. Currently only "qa" is supported. */
  type: z.string().default("qa"),

  /** Date when card was created (YYYY-MM-DD) */
  created_date: z.string().regex(DATE_PATTERN, "Date must be YYYY-MM-DD format"),

  /** Date when card was last reviewed (YYYY-MM-DD), null if never reviewed */
  last_reviewed: z
    .string()
    .regex(DATE_PATTERN, "Date must be YYYY-MM-DD format")
    .nullable(),

  /** Date when card is due for next review (YYYY-MM-DD) */
  next_review: z.string().regex(DATE_PATTERN, "Date must be YYYY-MM-DD format"),

  /** SM-2 ease factor (difficulty multiplier). Min 1.3, default 2.5 */
  ease_factor: z.number().min(1.3).default(2.5),

  /** SM-2 interval in days. 0 for new cards. */
  interval: z.number().int().min(0).default(0),

  /** SM-2 repetition count. Reset to 0 on "again" response. */
  repetitions: z.number().int().min(0).default(0),

  /** Optional path to the source file that generated this card */
  source_file: z.string().optional(),
});

/**
 * Schema for creating new cards with required fields only.
 * Defaults will be applied for SM-2 fields.
 */
export const NewCardMetadataSchema = CardMetadataSchema.extend({
  // Override defaults to make them truly optional on input
  type: z.string().default("qa"),
  ease_factor: z.number().min(1.3).default(2.5),
  interval: z.number().int().min(0).default(0),
  repetitions: z.number().int().min(0).default(0),
});

// =============================================================================
// Card Content Schema
// =============================================================================

/**
 * Schema for Q&A card content (the markdown body).
 */
export const QACardContentSchema = z.object({
  /** The question to display during review */
  question: z.string().min(1, "Question is required"),

  /** The expected answer to reveal after user response */
  answer: z.string().min(1, "Answer is required"),
});

/**
 * Schema for a complete card (metadata + content).
 */
export const CardSchema = z.object({
  metadata: CardMetadataSchema,
  content: QACardContentSchema,
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type CardMetadata = z.infer<typeof CardMetadataSchema>;
export type NewCardMetadata = z.input<typeof NewCardMetadataSchema>;
export type QACardContent = z.infer<typeof QACardContentSchema>;
export type Card = z.infer<typeof CardSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Parse and validate card metadata from YAML frontmatter.
 * @throws ZodError if validation fails
 */
export function parseCardMetadata(data: unknown): CardMetadata {
  return CardMetadataSchema.parse(data);
}

/**
 * Safely parse card metadata, returning success/error result.
 */
export function safeParseCardMetadata(data: unknown) {
  return CardMetadataSchema.safeParse(data);
}

/**
 * Parse and validate Q&A card content from markdown body.
 * @throws ZodError if validation fails
 */
export function parseQACardContent(data: unknown): QACardContent {
  return QACardContentSchema.parse(data);
}

/**
 * Safely parse Q&A card content, returning success/error result.
 */
export function safeParseQACardContent(data: unknown) {
  return QACardContentSchema.safeParse(data);
}

/**
 * Parse and validate a complete card.
 * @throws ZodError if validation fails
 */
export function parseCard(data: unknown): Card {
  return CardSchema.parse(data);
}

/**
 * Safely parse a complete card, returning success/error result.
 */
export function safeParseCard(data: unknown) {
  return CardSchema.safeParse(data);
}

/**
 * Format a Zod validation error into a human-readable message.
 */
export function formatCardError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });
  return "Invalid card data:\n" + issues.join("\n");
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create default metadata for a new card.
 * Sets initial SM-2 values per REQ-F-34:
 * - interval: 1 (first review after 1 day)
 * - repetitions: 0 (never reviewed)
 * - ease_factor: 2.5 (default ease)
 * - next_review: today (due immediately)
 * - last_reviewed: null (never reviewed)
 *
 * @param id - UUID for the card (generate with crypto.randomUUID())
 * @param today - Today's date in YYYY-MM-DD format
 * @param sourceFile - Optional path to source file that generated this card
 */
export function createNewCardMetadata(
  id: string,
  today: string,
  sourceFile?: string
): CardMetadata {
  return {
    id,
    type: "qa",
    created_date: today,
    last_reviewed: null,
    next_review: today,
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    source_file: sourceFile,
  };
}

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string to a Date object.
 * Returns null if the string is invalid.
 */
export function parseDate(dateStr: string): Date | null {
  if (!DATE_PATTERN.test(dateStr)) {
    return null;
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  // Validate the date is real (e.g., not Feb 30)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
export function getToday(): string {
  return formatDate(new Date());
}

/**
 * Add days to a date string and return the result in YYYY-MM-DD format.
 */
export function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  if (!date) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/**
 * Check if a date string is on or before today.
 */
export function isDueToday(nextReview: string, today: string = getToday()): boolean {
  return nextReview <= today;
}
