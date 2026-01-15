/**
 * Vocabulary Normalizer
 *
 * Uses Claude to map incoming values to canonical terms from a configured vocabulary.
 * Falls back to raw values on LLM errors (timeout, API failure) per spec requirements.
 *
 * Spec Requirements:
 * - REQ-F-12: Define canonical vocabulary mappings in pipeline config
 * - REQ-F-13: LLM identifies best match from canonical terms
 * - REQ-F-14: Normalization applied per-field when normalize: true
 * - REQ-F-15: Unknown terms preserved as-is with warning
 * - REQ-F-29: Normalization failures preserve original value and log warning
 *
 * Plan Reference:
 * - TD-5: LLM Vocabulary Normalization design
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Vocabulary } from "./schemas.js";
import { createLogger } from "../logger.js";

const log = createLogger("vocabulary-normalizer");

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default timeout for LLM calls in milliseconds.
 * Long enough for complex batches, short enough to not block sync.
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Model to use for normalization.
 * Haiku is fast and cost-effective for this simple classification task.
 */
const NORMALIZATION_MODEL = "claude-3-5-haiku-latest";

/**
 * Maximum terms to normalize in a single batch.
 * Keeps prompt size manageable and response parsing reliable.
 */
const MAX_BATCH_SIZE = 20;

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the vocabulary normalizer.
 */
export interface VocabularyNormalizerOptions {
  /** Timeout for LLM calls in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Anthropic API client (injectable for testing) */
  client?: Anthropic;
}

/**
 * Result of normalizing a single term.
 */
export interface NormalizationResult {
  /** The original input term */
  original: string;
  /** The normalized term (canonical match or original if no match) */
  normalized: string;
  /** Whether a canonical match was found */
  matched: boolean;
}

// =============================================================================
// Vocabulary Normalizer Class
// =============================================================================

/**
 * LLM-based vocabulary normalizer.
 *
 * Uses Claude to find the best matching canonical term for input values.
 * Designed for fuzzy matching where exact string matching would fail
 * (e.g., "Worker placement game" -> "Worker Placement").
 */
export class VocabularyNormalizer {
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor(options: VocabularyNormalizerOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Normalize a single term against a vocabulary.
   *
   * @param term - The term to normalize
   * @param vocabulary - Mapping of canonical terms to their variations
   * @returns The canonical term if matched, otherwise the original term
   */
  async normalize(term: string, vocabulary: Vocabulary): Promise<string> {
    const result = await this.normalizeWithDetails(term, vocabulary);
    return result.normalized;
  }

  /**
   * Normalize a single term and return detailed results.
   *
   * @param term - The term to normalize
   * @param vocabulary - Mapping of canonical terms to their variations
   * @returns NormalizationResult with original, normalized, and match status
   */
  async normalizeWithDetails(
    term: string,
    vocabulary: Vocabulary
  ): Promise<NormalizationResult> {
    const results = await this.normalizeBatch([term], vocabulary);
    return results[0];
  }

  /**
   * Normalize multiple terms in a single LLM call.
   *
   * More efficient than individual calls when normalizing arrays (e.g., mechanics list).
   * Automatically batches large arrays to stay within prompt limits.
   *
   * @param terms - Array of terms to normalize
   * @param vocabulary - Mapping of canonical terms to their variations
   * @returns Array of NormalizationResults in the same order as input
   */
  async normalizeBatch(
    terms: string[],
    vocabulary: Vocabulary
  ): Promise<NormalizationResult[]> {
    if (terms.length === 0) {
      return [];
    }

    // Check for exact matches first (optimization: skip LLM for obvious matches)
    const canonicalTerms = Object.keys(vocabulary);
    const allVariations = new Map<string, string>();

    for (const [canonical, variations] of Object.entries(vocabulary)) {
      // Canonical term matches itself
      allVariations.set(canonical.toLowerCase(), canonical);
      // Each variation maps to its canonical form
      for (const variation of variations) {
        allVariations.set(variation.toLowerCase(), canonical);
      }
    }

    // Separate terms that need LLM from exact matches
    const needsLlm: Array<{ index: number; term: string }> = [];
    const results: NormalizationResult[] = Array.from<NormalizationResult>({ length: terms.length });

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const exactMatch = allVariations.get(term.toLowerCase());

      if (exactMatch) {
        results[i] = { original: term, normalized: exactMatch, matched: true };
      } else {
        needsLlm.push({ index: i, term });
      }
    }

    // If all terms had exact matches, we're done
    if (needsLlm.length === 0) {
      return results;
    }

    // Process remaining terms through LLM in batches
    for (let i = 0; i < needsLlm.length; i += MAX_BATCH_SIZE) {
      const batch = needsLlm.slice(i, i + MAX_BATCH_SIZE);
      const batchTerms = batch.map((b) => b.term);

      try {
        const llmResults = await this.callLlm(batchTerms, canonicalTerms);

        for (let j = 0; j < batch.length; j++) {
          const { index, term } = batch[j];
          const llmResult = llmResults[j];

          if (llmResult && canonicalTerms.includes(llmResult)) {
            results[index] = { original: term, normalized: llmResult, matched: true };
          } else {
            // No match found, preserve original
            log.warn(`No canonical match found for term: "${term}"`);
            results[index] = { original: term, normalized: term, matched: false };
          }
        }
      } catch (error) {
        // LLM error: preserve original values per REQ-F-29
        log.warn(
          `Vocabulary normalization failed, preserving original values: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        for (const { index, term } of batch) {
          results[index] = { original: term, normalized: term, matched: false };
        }
      }
    }

    return results;
  }

  /**
   * Call the LLM to normalize terms.
   * Returns array of canonical matches (or null for no match) in same order as input.
   */
  private async callLlm(
    terms: string[],
    canonicalTerms: string[]
  ): Promise<Array<string | null>> {
    const termsJson = JSON.stringify(terms);
    const canonicalJson = JSON.stringify(canonicalTerms);

    const prompt = `You are a term matching assistant. Match each input term to the most appropriate canonical term from the provided list.

Canonical terms:
${canonicalJson}

Input terms to match:
${termsJson}

For each input term, respond with the best matching canonical term. If no good match exists (the term is completely unrelated), respond with null.

Respond with ONLY a JSON array of results in the same order as the input. Each element should be either a string (the matching canonical term) or null (no match).

Example:
Input: ["deck building", "worker place", "unrelated term"]
Canonical: ["Deck Building", "Worker Placement", "Area Control"]
Output: ["Deck Building", "Worker Placement", null]`;

    const response = await this.client.messages.create(
      {
        model: NORMALIZATION_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      },
      {
        timeout: this.timeoutMs,
      }
    );

    // Extract text from response
    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("LLM response did not contain text content");
    }

    // Parse JSON response
    const text = textContent.text.trim();
    // Handle potential markdown code blocks
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`Invalid LLM response format: ${text.slice(0, 100)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<string | null>;

    if (!Array.isArray(parsed) || parsed.length !== terms.length) {
      throw new Error(
        `LLM returned ${parsed.length} results for ${terms.length} terms`
      );
    }

    return parsed;
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create a vocabulary normalizer instance with default options.
 */
export function createVocabularyNormalizer(
  options?: VocabularyNormalizerOptions
): VocabularyNormalizer {
  return new VocabularyNormalizer(options);
}

/**
 * Normalize an array of terms, extracting just the normalized strings.
 *
 * Convenience function for the common case of normalizing a field value.
 *
 * @param terms - Array of terms to normalize
 * @param vocabulary - Vocabulary mapping
 * @param normalizer - Optional normalizer instance (creates one if not provided)
 * @returns Array of normalized strings
 */
export async function normalizeTerms(
  terms: string[],
  vocabulary: Vocabulary,
  normalizer?: VocabularyNormalizer
): Promise<string[]> {
  const norm = normalizer ?? createVocabularyNormalizer();
  const results = await norm.normalizeBatch(terms, vocabulary);
  return results.map((r) => r.normalized);
}
