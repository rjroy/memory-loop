/**
 * Tests for Vocabulary Normalizer
 *
 * Tests cover:
 * - Exact match optimization (skips LLM for known variations)
 * - LLM-based fuzzy matching
 * - Batch normalization
 * - Error handling and fallback to original values
 * - Edge cases (empty input, no matches)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, mock } from "bun:test";
import {
  VocabularyNormalizer,
  createVocabularyNormalizer,
  normalizeTerms,
} from "../vocabulary-normalizer.js";
import type { Vocabulary } from "../schemas.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const SAMPLE_VOCABULARY: Vocabulary = {
  "Worker Placement": [
    "worker placement",
    "Worker placement game",
    "Workers placement",
  ],
  "Deck Building": ["deck building", "Deckbuilding", "Deck-building"],
  "Area Control": ["area control", "Area majority", "Territory control"],
};

// =============================================================================
// Mock Anthropic Client
// =============================================================================

/**
 * Create a mock Anthropic client that returns specified results.
 */
function createMockClient(responseResults: Array<string | null>) {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify(responseResults),
            },
          ],
        })
      ),
    },
  };
}

/**
 * Create a mock client that throws an error.
 */
function createErrorClient(errorMessage: string) {
  return {
    messages: {
      create: mock(() => Promise.reject(new Error(errorMessage))),
    },
  };
}

/**
 * Create a mock client that returns invalid JSON.
 */
function createInvalidResponseClient() {
  return {
    messages: {
      create: mock(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: "This is not valid JSON",
            },
          ],
        })
      ),
    },
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("VocabularyNormalizer", () => {
  // ===========================================================================
  // Exact Match Tests (No LLM needed)
  // ===========================================================================

  describe("exact matches", () => {
    it("should match canonical term exactly (case-insensitive)", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("worker placement", SAMPLE_VOCABULARY);

      expect(result).toBe("Worker Placement");
      // LLM should not be called for exact matches
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should match variation exactly", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("Deckbuilding", SAMPLE_VOCABULARY);

      expect(result).toBe("Deck Building");
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should match canonical term by name", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("Area Control", SAMPLE_VOCABULARY);

      expect(result).toBe("Area Control");
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should handle case variations in exact match", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("DECK BUILDING", SAMPLE_VOCABULARY);

      expect(result).toBe("Deck Building");
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // LLM Fuzzy Match Tests
  // ===========================================================================

  describe("LLM fuzzy matching", () => {
    it("should use LLM for terms not in vocabulary", async () => {
      const mockClient = createMockClient(["Worker Placement"]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize(
        "placing workers on spaces",
        SAMPLE_VOCABULARY
      );

      expect(result).toBe("Worker Placement");
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it("should return original term when LLM finds no match", async () => {
      const mockClient = createMockClient([null]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize(
        "completely unrelated term",
        SAMPLE_VOCABULARY
      );

      expect(result).toBe("completely unrelated term");
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it("should validate LLM response against canonical terms", async () => {
      // LLM returns a term that's not in our vocabulary
      const mockClient = createMockClient(["Invalid Term"]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("some term", SAMPLE_VOCABULARY);

      // Should preserve original since LLM returned invalid term
      expect(result).toBe("some term");
    });
  });

  // ===========================================================================
  // Batch Normalization Tests
  // ===========================================================================

  describe("batch normalization", () => {
    it("should normalize multiple terms in one call", async () => {
      const mockClient = createMockClient(["Worker Placement", null]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const terms = [
        "deck building", // Exact match - no LLM
        "placing workers", // LLM match
        "unknown mechanic", // LLM no match
      ];

      const results = await normalizer.normalizeBatch(terms, SAMPLE_VOCABULARY);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        original: "deck building",
        normalized: "Deck Building",
        matched: true,
      });
      expect(results[1]).toEqual({
        original: "placing workers",
        normalized: "Worker Placement",
        matched: true,
      });
      expect(results[2]).toEqual({
        original: "unknown mechanic",
        normalized: "unknown mechanic",
        matched: false,
      });

      // Only 2 terms sent to LLM (deck building was exact match)
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it("should skip LLM entirely when all terms are exact matches", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const terms = ["worker placement", "Deckbuilding", "area control"];
      const results = await normalizer.normalizeBatch(terms, SAMPLE_VOCABULARY);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.matched)).toBe(true);
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should handle empty array", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const results = await normalizer.normalizeBatch([], SAMPLE_VOCABULARY);

      expect(results).toEqual([]);
      expect(mockClient.messages.create).not.toHaveBeenCalled();
    });

    it("should maintain order of results", async () => {
      const mockClient = createMockClient(["Area Control", "Deck Building"]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const terms = ["territory game", "card game"];
      const results = await normalizer.normalizeBatch(terms, SAMPLE_VOCABULARY);

      expect(results[0].original).toBe("territory game");
      expect(results[0].normalized).toBe("Area Control");
      expect(results[1].original).toBe("card game");
      expect(results[1].normalized).toBe("Deck Building");
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("error handling", () => {
    it("should preserve original values on API error", async () => {
      const mockClient = createErrorClient("API rate limit exceeded");
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("fuzzy term", SAMPLE_VOCABULARY);

      // Should return original term on error
      expect(result).toBe("fuzzy term");
    });

    it("should preserve all values in batch on API error", async () => {
      const mockClient = createErrorClient("Network timeout");
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const terms = ["fuzzy1", "fuzzy2", "fuzzy3"];
      const results = await normalizer.normalizeBatch(terms, SAMPLE_VOCABULARY);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.original === r.normalized)).toBe(true);
      expect(results.every((r) => r.matched === false)).toBe(true);
    });

    it("should handle invalid JSON response", async () => {
      const mockClient = createInvalidResponseClient();
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalize("fuzzy term", SAMPLE_VOCABULARY);

      // Should return original term when response can't be parsed
      expect(result).toBe("fuzzy term");
    });

    it("should handle response with wrong number of results", async () => {
      // LLM returns 2 results for 3 terms
      const mockClient = createMockClient(["Worker Placement", "Deck Building"]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const terms = ["term1", "term2", "term3"];
      const results = await normalizer.normalizeBatch(terms, SAMPLE_VOCABULARY);

      // Should fall back to originals
      expect(results.every((r) => r.matched === false)).toBe(true);
    });
  });

  // ===========================================================================
  // normalizeWithDetails Tests
  // ===========================================================================

  describe("normalizeWithDetails", () => {
    it("should return detailed result for matched term", async () => {
      const mockClient = createMockClient([]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalizeWithDetails(
        "worker placement",
        SAMPLE_VOCABULARY
      );

      expect(result).toEqual({
        original: "worker placement",
        normalized: "Worker Placement",
        matched: true,
      });
    });

    it("should return detailed result for unmatched term", async () => {
      const mockClient = createMockClient([null]);
      const normalizer = new VocabularyNormalizer({ client: mockClient as any });

      const result = await normalizer.normalizeWithDetails(
        "unknown term",
        SAMPLE_VOCABULARY
      );

      expect(result).toEqual({
        original: "unknown term",
        normalized: "unknown term",
        matched: false,
      });
    });
  });
});

// =============================================================================
// Convenience Function Tests
// =============================================================================

describe("normalizeTerms", () => {
  it("should normalize terms and return string array", async () => {
    const mockClient = createMockClient([]);
    const normalizer = new VocabularyNormalizer({ client: mockClient as any });

    const result = await normalizeTerms(
      ["deck building", "worker placement"],
      SAMPLE_VOCABULARY,
      normalizer
    );

    expect(result).toEqual(["Deck Building", "Worker Placement"]);
  });
});

describe("createVocabularyNormalizer", () => {
  it("should create normalizer with default options", () => {
    const normalizer = createVocabularyNormalizer();
    expect(normalizer).toBeInstanceOf(VocabularyNormalizer);
  });

  it("should create normalizer with custom options", () => {
    const normalizer = createVocabularyNormalizer({ timeoutMs: 5000 });
    expect(normalizer).toBeInstanceOf(VocabularyNormalizer);
  });
});

// =============================================================================
// LLM Response Format Tests
// =============================================================================

describe("LLM response parsing", () => {
  it("should handle response wrapped in markdown code block", async () => {
    const mockClient = {
      messages: {
        create: mock(() =>
          Promise.resolve({
            content: [
              {
                type: "text",
                text: '```json\n["Worker Placement"]\n```',
              },
            ],
          })
        ),
      },
    };
    const normalizer = new VocabularyNormalizer({ client: mockClient as any });

    const result = await normalizer.normalize("placing workers", SAMPLE_VOCABULARY);

    expect(result).toBe("Worker Placement");
  });

  it("should handle response with leading/trailing whitespace", async () => {
    const mockClient = {
      messages: {
        create: mock(() =>
          Promise.resolve({
            content: [
              {
                type: "text",
                text: '\n  ["Worker Placement"]  \n',
              },
            ],
          })
        ),
      },
    };
    const normalizer = new VocabularyNormalizer({ client: mockClient as any });

    const result = await normalizer.normalize("placing workers", SAMPLE_VOCABULARY);

    expect(result).toBe("Worker Placement");
  });
});
