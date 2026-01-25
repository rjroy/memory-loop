/**
 * Card Generator
 *
 * LLM-based extraction of Q&A pairs from markdown content.
 * Uses Claude Haiku for cost-efficient card generation.
 *
 * Spec Requirements:
 * - REQ-F-5: LLM extracts knowledge-worthy Q&A pairs from content
 * - REQ-F-6: Generated cards are factual, testable questions
 * - REQ-NF-2: Uses Claude Haiku for cost efficiency
 *
 * Plan Reference:
 * - TASK-009: LLM Card Generator
 */

import { getSdkQuery, type QueryFunction } from "../sdk-provider.js";
import { createLogger } from "../logger.js";

const log = createLogger("card-generator");

// =============================================================================
// Types
// =============================================================================

/**
 * Content for a generated card (question and answer).
 * This is the raw output from the generator before being wrapped
 * in full card metadata.
 */
export interface CardContent {
  question: string;
  answer: string;
}

/**
 * Result of card generation - either success with cards or failure with error.
 * Using a discriminated union makes failure handling explicit.
 */
export type GenerationResult =
  | { success: true; cards: CardContent[]; skipped?: boolean }
  | { success: false; error: string; retriable: boolean };

/**
 * Interface for card type generators.
 * Allows different extraction strategies for different card types.
 */
export interface CardTypeGenerator {
  /** Identifier for the card type (e.g., "qa") */
  type: string;
  /** Extract cards from content */
  generate(content: string, filePath: string): Promise<GenerationResult>;
}

// =============================================================================
// Constants
// =============================================================================

/** Model to use for card generation (cost-efficient) */
export const GENERATION_MODEL = "haiku";

/** Minimum content length to attempt extraction (characters) */
export const MIN_CONTENT_LENGTH = 100;

/** Maximum content length to send to LLM (characters, ~2000 tokens) */
export const MAX_CONTENT_LENGTH = 8000;

// =============================================================================
// Prompt Templates
// =============================================================================

/**
 * Builds the prompt for Q&A extraction from content.
 *
 * The prompt asks for factual, testable Q&A pairs suitable for spaced repetition.
 * Output is JSON for reliable parsing.
 *
 * @param content - The markdown content to extract from
 * @param filePath - Path to source file (for context)
 * @returns The prompt to send to the LLM
 */
export function buildQAExtractionPrompt(content: string, filePath: string): string {
  return `Extract factual Q&A pairs from the following content for spaced repetition learning.

Requirements:
- Focus on key facts, concepts, definitions, and relationships
- Questions must be self-contained and answerable without seeing the source
- Never use "this", "the above", or assume the reader knows the context
- Include enough context in the question itself (name the system, concept, or domain)
- Answers should be concise but complete
- Each question should test a distinct piece of knowledge - avoid variations that ask the same thing differently
- Skip subjective opinions, TODOs, or transient information
- Skip self-referential questions about the note-taker's actions, decisions, or personal context
- Questions must be answerable by anyone, not just the person who wrote the note
- Avoid first-person or second-person framing ("you", "we", "I", "my", "our")
- Only extract facts that would be useful to recall weeks or months later
- If the content has no extractable facts, return an empty array

Source file: ${filePath}

Content:
---
${content}
---

Respond ONLY with a JSON array in this exact format (no markdown, no explanation):
[{"question": "...", "answer": "..."}]

If no suitable Q&A pairs can be extracted, respond with: []`;
}

// =============================================================================
// Type Guards
// =============================================================================

/** Shape of a Q&A object from JSON parsing */
interface QAObject {
  question: string;
  answer: string;
}

/**
 * Type guard to check if a value is a valid Q&A object.
 */
function isQAObject(value: unknown): value is QAObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "question" in value &&
    "answer" in value &&
    typeof (value as Record<string, unknown>).question === "string" &&
    typeof (value as Record<string, unknown>).answer === "string"
  );
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse JSON array of Q&A pairs from LLM response.
 *
 * Handles common response formats:
 * - Clean JSON array
 * - JSON wrapped in markdown code blocks
 * - Single Q&A object (wraps in array)
 *
 * @param response - Raw LLM response text
 * @returns Array of parsed CardContent, empty array on parse failure
 */
export function parseQAResponse(response: string): CardContent[] {
  const trimmed = response.trim();

  // Handle empty response
  if (!trimmed) {
    return [];
  }

  // Remove markdown code block wrapper if present
  let jsonStr = trimmed;
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to parse as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    log.warn("Failed to parse LLM response as JSON", { response: trimmed.slice(0, 200) });
    return [];
  }

  // Handle single object (wrap in array)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = [parsed];
  }

  // Validate array
  if (!Array.isArray(parsed)) {
    log.warn("LLM response is not an array", { parsed });
    return [];
  }

  // Validate and extract Q&A pairs
  const results: CardContent[] = [];
  for (const item of parsed) {
    if (!isQAObject(item)) {
      continue;
    }
    const question = item.question.trim();
    const answer = item.answer.trim();
    if (question.length > 0 && answer.length > 0) {
      results.push({ question, answer });
    }
  }

  return results;
}

// =============================================================================
// SDK Response Collection
// =============================================================================

/**
 * Collect full text response from an SDK query result.
 * Iterates through all events and extracts text from assistant messages.
 *
 * @param queryResult - The async generator from query()
 * @returns Full text response
 */
async function collectResponse(queryResult: ReturnType<QueryFunction>): Promise<string> {
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

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Determine if an error is retriable (should be retried on next run)
 * vs permanent (file should be marked as processed to avoid infinite retries).
 *
 * Retriable errors include:
 * - Rate limits / token limits
 * - Network/connection issues
 * - Process exit codes (usually transient SDK issues)
 * - Timeouts
 *
 * Permanent errors include:
 * - Invalid content that will never parse
 * - Authentication failures (need manual intervention)
 */
function isRetriableError(message: string): boolean {
  const retriablePatterns = [
    /rate.?limit/i,
    /token.?limit/i,
    /quota/i,
    /too many requests/i,
    /429/,
    /network/i,
    /connection/i,
    /timeout/i,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /process exited/i,
    /exit.?code/i,
  ];

  return retriablePatterns.some((pattern) => pattern.test(message));
}

// =============================================================================
// QA Card Generator
// =============================================================================

/**
 * Q&A card generator implementation.
 *
 * Extracts factual Q&A pairs from markdown content using Claude Haiku.
 * Returns 0-N cards per file depending on content quality.
 */
export class QACardGenerator implements CardTypeGenerator {
  readonly type = "qa";

  /**
   * Generate Q&A cards from markdown content.
   *
   * @param content - Markdown content to extract from
   * @param filePath - Path to source file (for context and logging)
   * @returns GenerationResult with cards on success, error details on failure
   */
  async generate(content: string, filePath: string): Promise<GenerationResult> {
    // Skip if content is too short
    if (content.length < MIN_CONTENT_LENGTH) {
      log.debug(`Skipping ${filePath}: content too short (${content.length} chars)`);
      return { success: true, cards: [], skipped: true };
    }

    // Truncate if content is too long
    const truncatedContent =
      content.length > MAX_CONTENT_LENGTH
        ? content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
        : content;

    // Build the prompt
    const prompt = buildQAExtractionPrompt(truncatedContent, filePath);

    try {
      // Call the LLM
      const queryResult = getSdkQuery()({
        prompt,
        options: {
          model: GENERATION_MODEL,
          maxTurns: 1,
          allowedTools: [], // No tools needed for extraction
        },
      });

      // Collect the response
      const response = await collectResponse(queryResult);

      // Parse the response
      const cards = parseQAResponse(response);

      log.info(`Extracted ${cards.length} Q&A pairs from ${filePath}`);
      return { success: true, cards };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Determine if this is a retriable error (rate limits, network issues)
      // vs a permanent failure (invalid content, parsing errors)
      const retriable = isRetriableError(message);

      // Log with context for diagnosability
      log.error(
        `Card generation failed for ${filePath}: ${message}`,
        { model: GENERATION_MODEL, contentLength: content.length, retriable }
      );

      return { success: false, error: message, retriable };
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new QA card generator instance.
 */
export function createQACardGenerator(): QACardGenerator {
  return new QACardGenerator();
}
