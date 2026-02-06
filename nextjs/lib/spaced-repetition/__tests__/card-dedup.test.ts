/**
 * Tests for Card Deduplication
 *
 * Tests Jaccard similarity, tokenization, and LLM verification.
 */

import { describe, it, expect, afterEach, spyOn } from "bun:test";
import {
  tokenize,
  jaccardSimilarity,
  findDuplicateCandidates,
  verifyDuplicateWithLLM,
  verifyDuplicatesWithLLM,
  checkAndHandleDuplicate,
  createDedupContext,
  createDedupStats,
  STOPWORDS,
  JACCARD_THRESHOLD,
} from "../card-dedup";
import type { Card } from "../card-schema";
import {
  configureSdkForTesting,
  _resetForTesting,
  type QueryFunction,
} from "../../sdk-provider";
import * as cardStorage from "../card-storage";

// =============================================================================
// Mock SDK Helpers
// =============================================================================

/**
 * Create a mock SDK query function that returns a predetermined response.
 */
function createMockSdk(response: string): QueryFunction {
  return (() => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: response }],
        },
      };
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

/**
 * Create a mock SDK that throws an error.
 */
function createErrorMockSdk(error: Error): QueryFunction {
  return (() => {
    // eslint-disable-next-line require-yield, @typescript-eslint/require-await
    async function* mockGenerator(): AsyncGenerator<{ type: string }> {
      throw error;
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

/**
 * Create a mock SDK that counts calls.
 */
function createCountingMockSdk(response: string, counter: { count: number }): QueryFunction {
  return (() => {
    counter.count++;
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: response }],
        },
      };
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

// =============================================================================
// Test Utilities
// =============================================================================

function createMockCard(
  id: string,
  question: string,
  answer: string = "Test answer"
): Card {
  return {
    metadata: {
      id,
      type: "qa",
      created_date: "2026-01-24",
      last_reviewed: null,
      next_review: "2026-01-24",
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
    },
    content: {
      question,
      answer,
    },
  };
}

afterEach(() => {
  _resetForTesting();
});

// =============================================================================
// Tokenize Tests
// =============================================================================

describe("tokenize", () => {
  it("converts text to lowercase", () => {
    const tokens = tokenize("Hello WORLD");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("Hello")).toBe(false);
    expect(tokens.has("WORLD")).toBe(false);
  });

  it("removes punctuation", () => {
    const tokens = tokenize("What's the answer? It's: simple!");
    expect(tokens.has("answer")).toBe(true);
    expect(tokens.has("simple")).toBe(true);
    expect(tokens.has("answer?")).toBe(false);
    expect(tokens.has("simple!")).toBe(false);
  });

  it("removes stopwords", () => {
    const tokens = tokenize("What is the capital of France");
    expect(tokens.has("capital")).toBe(true);
    expect(tokens.has("france")).toBe(true);
    // These are stopwords
    expect(tokens.has("what")).toBe(false);
    expect(tokens.has("is")).toBe(false);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("of")).toBe(false);
  });

  it("handles empty string", () => {
    const tokens = tokenize("");
    expect(tokens.size).toBe(0);
  });

  it("handles string with only stopwords", () => {
    const tokens = tokenize("the is a an");
    expect(tokens.size).toBe(0);
  });

  it("handles string with only punctuation", () => {
    const tokens = tokenize("!@#$%^&*()");
    expect(tokens.size).toBe(0);
  });

  it("preserves numbers", () => {
    const tokens = tokenize("The answer is 42");
    expect(tokens.has("42")).toBe(true);
    expect(tokens.has("answer")).toBe(true);
  });

  it("handles unicode characters", () => {
    const tokens = tokenize("Café résumé naïve");
    expect(tokens.has("café")).toBe(true);
    expect(tokens.has("résumé")).toBe(true);
    expect(tokens.has("naïve")).toBe(true);
  });

  it("returns a Set (no duplicates)", () => {
    const tokens = tokenize("test test test");
    expect(tokens.size).toBe(1);
    expect(tokens.has("test")).toBe(true);
  });

  it("handles multiple spaces and tabs", () => {
    const tokens = tokenize("hello    world\t\tfoo");
    expect(tokens.size).toBe(3);
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("foo")).toBe(true);
  });
});

// =============================================================================
// Jaccard Similarity Tests
// =============================================================================

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["hello", "world"]);
    const b = new Set(["hello", "world"]);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for completely different sets", () => {
    const a = new Set(["hello", "world"]);
    const b = new Set(["foo", "bar"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    // A = {a, b, c}, B = {b, c, d}
    // Intersection = {b, c} = 2
    // Union = {a, b, c, d} = 4
    // Jaccard = 2/4 = 0.5
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("returns 1 for two empty sets", () => {
    const a = new Set<string>();
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns 0 when one set is empty", () => {
    const a = new Set(["hello"]);
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(0);
    expect(jaccardSimilarity(b, a)).toBe(0);
  });

  it("is symmetric", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d", "e"]);
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it("handles single element sets", () => {
    const a = new Set(["only"]);
    const b = new Set(["only"]);
    expect(jaccardSimilarity(a, b)).toBe(1);

    const c = new Set(["other"]);
    expect(jaccardSimilarity(a, c)).toBe(0);
  });

  it("calculates spec example correctly: identical after processing", () => {
    // From spec: "What is the Q4 shipping deadline?" vs "What is the deadline for Q4 shipping?"
    // After stopword removal: {q4, shipping, deadline} for both
    const q1Tokens = tokenize("What is the Q4 shipping deadline?");
    const q2Tokens = tokenize("What is the deadline for Q4 shipping?");

    // Both should have: q4, shipping, deadline
    expect(q1Tokens.size).toBe(3);
    expect(q2Tokens.size).toBe(3);
    expect(jaccardSimilarity(q1Tokens, q2Tokens)).toBe(1);
  });

  it("calculates spec example correctly: similar but distinct", () => {
    // From spec: frontend vs backend framework questions
    // Q1 tokens: {frontend, framework, memory, loop, use}
    // Q2 tokens: {backend, runtime, memory, loop, use}
    // Intersection: {memory, loop, use} = 3
    // Union: 7
    // Similarity: 3/7 = 0.43 (below threshold)
    const q1Tokens = tokenize("What frontend framework does Memory Loop use?");
    const q2Tokens = tokenize("What backend runtime does Memory Loop use?");

    const similarity = jaccardSimilarity(q1Tokens, q2Tokens);
    expect(similarity).toBeCloseTo(3 / 7, 5);
    expect(similarity).toBeLessThan(JACCARD_THRESHOLD);
  });
});

// =============================================================================
// Find Duplicate Candidates Tests
// =============================================================================

describe("findDuplicateCandidates", () => {
  it("returns empty array when no cards exist", () => {
    const candidates = findDuplicateCandidates("What is X?", []);
    expect(candidates).toHaveLength(0);
  });

  it("returns empty array when no cards match threshold", () => {
    const cards = [
      createMockCard("1", "Completely different question about apples"),
      createMockCard("2", "Another unrelated question about oranges"),
    ];
    const candidates = findDuplicateCandidates("What is the capital of France?", cards);
    expect(candidates).toHaveLength(0);
  });

  it("returns candidates above threshold", () => {
    const cards = [
      createMockCard("1", "What is the Q4 shipping deadline?"),
      createMockCard("2", "Unrelated question about cats"),
    ];
    const candidates = findDuplicateCandidates(
      "What is the deadline for Q4 shipping?",
      cards
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].existingCard.metadata.id).toBe("1");
    expect(candidates[0].similarity).toBe(1); // Identical after processing
  });

  it("sorts candidates by similarity descending", () => {
    const cards = [
      createMockCard("1", "memory loop frontend"),
      createMockCard("2", "memory loop frontend framework react"),
      createMockCard("3", "memory loop"),
    ];
    const candidates = findDuplicateCandidates("memory loop frontend framework", cards);

    // Should be sorted by similarity (highest first)
    expect(candidates.length).toBeGreaterThan(0);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].similarity).toBeLessThanOrEqual(candidates[i - 1].similarity);
    }
  });

  it("respects custom threshold", () => {
    const cards = [
      createMockCard("1", "memory loop frontend"),
    ];

    // With high threshold, should not match
    const highThreshold = findDuplicateCandidates("memory loop backend", cards, 0.9);
    expect(highThreshold).toHaveLength(0);

    // With low threshold, should match
    const lowThreshold = findDuplicateCandidates("memory loop backend", cards, 0.3);
    expect(lowThreshold).toHaveLength(1);
  });

  it("handles identical questions", () => {
    const cards = [createMockCard("1", "What is the answer?")];
    const candidates = findDuplicateCandidates("What is the answer?", cards);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].similarity).toBe(1);
  });
});

// =============================================================================
// LLM Verification Tests
// =============================================================================

describe("verifyDuplicateWithLLM", () => {
  it("returns true when LLM says YES", async () => {
    configureSdkForTesting(createMockSdk("YES"));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is X?", candidate);
    expect(result).toBe(true);
  });

  it("returns false when LLM says NO", async () => {
    configureSdkForTesting(createMockSdk("NO"));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is Y?", candidate);
    expect(result).toBe(false);
  });

  it("handles YES with extra text", async () => {
    configureSdkForTesting(createMockSdk("YES, these questions test the same knowledge."));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is X?", candidate);
    expect(result).toBe(true);
  });

  it("handles lowercase yes", async () => {
    configureSdkForTesting(createMockSdk("yes"));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is X?", candidate);
    expect(result).toBe(true);
  });

  it("fails open on error (returns false)", async () => {
    configureSdkForTesting(createErrorMockSdk(new Error("Rate limit exceeded")));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is X?", candidate);
    expect(result).toBe(false);
  });

  it("fails open on network error", async () => {
    configureSdkForTesting(createErrorMockSdk(new Error("ECONNREFUSED")));

    const candidate = {
      existingCard: createMockCard("1", "What is X?"),
      similarity: 0.8,
    };

    const result = await verifyDuplicateWithLLM("What is X?", candidate);
    expect(result).toBe(false);
  });
});

describe("verifyDuplicatesWithLLM", () => {
  it("returns empty array when no candidates", async () => {
    // No SDK needed for empty candidates
    const result = await verifyDuplicatesWithLLM("What is X?", []);
    expect(result.duplicates).toHaveLength(0);
  });

  it("returns first confirmed duplicate", async () => {
    configureSdkForTesting(createMockSdk("YES"));

    const candidates = [
      { existingCard: createMockCard("1", "Question 1"), similarity: 0.9 },
      { existingCard: createMockCard("2", "Question 2"), similarity: 0.8 },
    ];

    const result = await verifyDuplicatesWithLLM("What is X?", candidates);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].metadata.id).toBe("1");
  });

  it("returns empty array when all candidates rejected", async () => {
    configureSdkForTesting(createMockSdk("NO"));

    const candidates = [
      { existingCard: createMockCard("1", "Question 1"), similarity: 0.9 },
      { existingCard: createMockCard("2", "Question 2"), similarity: 0.8 },
    ];

    const result = await verifyDuplicatesWithLLM("What is X?", candidates);
    expect(result.duplicates).toHaveLength(0);
  });

  it("stops checking after first confirmed duplicate", async () => {
    const counter = { count: 0 };
    configureSdkForTesting(createCountingMockSdk("YES", counter));

    const candidates = [
      { existingCard: createMockCard("1", "Question 1"), similarity: 0.9 },
      { existingCard: createMockCard("2", "Question 2"), similarity: 0.8 },
      { existingCard: createMockCard("3", "Question 3"), similarity: 0.7 },
    ];

    await verifyDuplicatesWithLLM("What is X?", candidates);
    expect(counter.count).toBe(1); // Should stop after first YES
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("checkAndHandleDuplicate", () => {
  const mockVaultPathInfo = {
    contentRoot: "/test/vault",
    metadataPath: "06_Metadata/memory-loop",
  };

  it("returns isDuplicate false when no existing cards", async () => {
    const context = createDedupContext([], mockVaultPathInfo);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the answer?",
      "42",
      context,
      stats
    );

    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(0);
    expect(stats.duplicatesArchived).toBe(0);
  });

  it("returns isDuplicate false when no candidates above threshold", async () => {
    const existingCards = [createMockCard("1", "Completely different question")];
    const context = createDedupContext(existingCards, mockVaultPathInfo);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the capital of France?",
      "Paris",
      context,
      stats
    );

    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(0);
  });

  it("archives duplicate and returns isDuplicate false (new card replaces old)", async () => {
    configureSdkForTesting(createMockSdk("YES"));
    const mockArchiveCard = spyOn(cardStorage, "archiveCard").mockResolvedValue(true);

    const existingCards = [createMockCard("old-id", "What is the Q4 deadline?")];
    const context = createDedupContext(existingCards, mockVaultPathInfo);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the deadline for Q4?",
      "December 31",
      context,
      stats
    );

    // New card should still be created (replaces the old one)
    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(1);
    expect(stats.duplicatesArchived).toBe(1);
    expect(mockArchiveCard).toHaveBeenCalledWith(mockVaultPathInfo, "old-id");

    // Existing card should be removed from context
    expect(context.existingCards).toHaveLength(0);

    mockArchiveCard.mockRestore();
  });

  it("handles archive failure gracefully", async () => {
    configureSdkForTesting(createMockSdk("YES"));
    const mockArchiveCard = spyOn(cardStorage, "archiveCard").mockResolvedValue(false);

    const existingCards = [createMockCard("old-id", "What is the Q4 deadline?")];
    const context = createDedupContext(existingCards, mockVaultPathInfo);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the deadline for Q4?",
      "December 31",
      context,
      stats
    );

    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(1);
    expect(stats.duplicatesArchived).toBe(0); // Archive failed

    mockArchiveCard.mockRestore();
  });

  it("checks against newCards for self-deduplication", async () => {
    configureSdkForTesting(createMockSdk("YES"));
    const mockArchiveCard = spyOn(cardStorage, "archiveCard").mockResolvedValue(true);

    // Simulate a card created earlier in the same pass
    const newCard = createMockCard("new-1", "What is the Q4 deadline?");
    const context = createDedupContext([], mockVaultPathInfo);
    context.newCards.push(newCard);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the deadline for Q4?",
      "December 31",
      context,
      stats
    );

    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(1);
    expect(stats.duplicatesArchived).toBe(1);

    // New card should be removed from context
    expect(context.newCards).toHaveLength(0);

    mockArchiveCard.mockRestore();
  });

  it("fails open when LLM verification fails", async () => {
    configureSdkForTesting(createErrorMockSdk(new Error("API error")));

    const existingCards = [createMockCard("old-id", "What is the Q4 deadline?")];
    const context = createDedupContext(existingCards, mockVaultPathInfo);
    const stats = createDedupStats();

    const result = await checkAndHandleDuplicate(
      "What is the deadline for Q4?",
      "December 31",
      context,
      stats
    );

    // Should allow the new card (fail open)
    expect(result.isDuplicate).toBe(false);
    expect(stats.duplicatesDetected).toBe(1);
    expect(stats.duplicatesArchived).toBe(0); // No archive because verification failed
  });
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe("createDedupContext", () => {
  it("creates context with existing cards", () => {
    const cards = [createMockCard("1", "Q1"), createMockCard("2", "Q2")];
    const vaultPathInfo = { contentRoot: "/test", metadataPath: "meta" };

    const context = createDedupContext(cards, vaultPathInfo);

    expect(context.existingCards).toHaveLength(2);
    expect(context.newCards).toHaveLength(0);
    expect(context.vaultPathInfo).toBe(vaultPathInfo);
  });

  it("creates context with empty cards", () => {
    const vaultPathInfo = { contentRoot: "/test", metadataPath: "meta" };
    const context = createDedupContext([], vaultPathInfo);

    expect(context.existingCards).toHaveLength(0);
    expect(context.newCards).toHaveLength(0);
  });
});

describe("createDedupStats", () => {
  it("creates empty stats", () => {
    const stats = createDedupStats();

    expect(stats.duplicatesDetected).toBe(0);
    expect(stats.duplicatesArchived).toBe(0);
  });
});

describe("STOPWORDS constant", () => {
  it("contains common English stopwords", () => {
    expect(STOPWORDS.has("the")).toBe(true);
    expect(STOPWORDS.has("is")).toBe(true);
    expect(STOPWORDS.has("a")).toBe(true);
    expect(STOPWORDS.has("what")).toBe(true);
    expect(STOPWORDS.has("of")).toBe(true);
  });

  it("does not contain content words", () => {
    expect(STOPWORDS.has("capital")).toBe(false);
    expect(STOPWORDS.has("france")).toBe(false);
    expect(STOPWORDS.has("deadline")).toBe(false);
  });
});

describe("JACCARD_THRESHOLD constant", () => {
  it("is 0.5 as specified", () => {
    expect(JACCARD_THRESHOLD).toBe(0.5);
  });
});
