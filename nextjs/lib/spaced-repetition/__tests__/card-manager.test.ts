/**
 * Card Manager Tests
 *
 * Tests for high-level CRUD operations and SM-2 review processing.
 * Uses real filesystem operations in temp directories (no mocks).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDueCards,
  getCard,
  submitReview,
  archiveCard,
  createCard,
  type CreateCardInput,
} from "../card-manager";
import { saveCard, getCardPath, getArchivedCardPath } from "../card-storage";
import type { VaultPathInfo } from "../card-storage";
import type { Card } from "../card-schema";

describe("card-manager", () => {
  let testDir: string;
  let vault: VaultPathInfo;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `card-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      contentRoot: testDir,
      metadataPath: "06_Metadata/memory-loop",
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // =============================================================================
  // Test Data Helpers
  // =============================================================================

  function makeCard(overrides: Partial<Card["metadata"]> = {}): Card {
    return {
      metadata: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        ...overrides,
      },
      content: {
        question: "What is the capital of France?",
        answer: "Paris",
      },
    };
  }

  // =============================================================================
  // getDueCards Tests
  // =============================================================================

  describe("getDueCards", () => {
    test("returns cards due for review (next_review <= today)", async () => {
      const today = "2026-01-23";
      const cardDue = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440001",
        next_review: "2026-01-23",
      });
      const cardOverdue = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440002",
        next_review: "2026-01-20",
      });
      const cardNotDue = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440003",
        next_review: "2026-01-25",
      });

      await saveCard(vault, cardDue);
      await saveCard(vault, cardOverdue);
      await saveCard(vault, cardNotDue);

      const dueCards = await getDueCards(vault, today);

      expect(dueCards).toHaveLength(2);
      const ids = dueCards.map((c) => c.metadata.id);
      expect(ids).toContain("550e8400-e29b-41d4-a716-446655440001");
      expect(ids).toContain("550e8400-e29b-41d4-a716-446655440002");
      expect(ids).not.toContain("550e8400-e29b-41d4-a716-446655440003");
    });

    test("sorts cards by next_review ascending (oldest first)", async () => {
      const today = "2026-01-25";
      const card1 = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440010",
        next_review: "2026-01-23",
      });
      const card2 = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440011",
        next_review: "2026-01-21",
      });
      const card3 = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440012",
        next_review: "2026-01-25",
      });

      await saveCard(vault, card1);
      await saveCard(vault, card2);
      await saveCard(vault, card3);

      const dueCards = await getDueCards(vault, today);

      expect(dueCards).toHaveLength(3);
      expect(dueCards[0].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440011"); // 01-21
      expect(dueCards[1].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440010"); // 01-23
      expect(dueCards[2].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440012"); // 01-25
    });

    test("returns empty array when no cards exist", async () => {
      const dueCards = await getDueCards(vault, "2026-01-23");
      expect(dueCards).toHaveLength(0);
    });

    test("returns empty array when no cards are due", async () => {
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440020",
        next_review: "2026-12-31",
      });
      await saveCard(vault, card);

      const dueCards = await getDueCards(vault, "2026-01-23");
      expect(dueCards).toHaveLength(0);
    });
  });

  // =============================================================================
  // getCard Tests
  // =============================================================================

  describe("getCard", () => {
    test("returns full card including question and answer", async () => {
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440030",
      });
      await saveCard(vault, card);

      const result = await getCard(vault, card.metadata.id);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.id).toBe(card.metadata.id);
        expect(result.data.content.question).toBe("What is the capital of France?");
        expect(result.data.content.answer).toBe("Paris");
      }
    });

    test("returns error for non-existent card", async () => {
      const result = await getCard(vault, "550e8400-0000-0000-0000-000000000000");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });
  });

  // =============================================================================
  // submitReview Tests
  // =============================================================================

  describe("submitReview", () => {
    test("applies SM-2 for 'good' response and updates card", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440040",
        interval: 0,
        repetitions: 0,
        ease_factor: 2.5,
        next_review: "2026-01-23",
        last_reviewed: null,
      });
      await saveCard(vault, card);

      const result = await submitReview(vault, card.metadata.id, "good", today);

      expect(result.success).toBe(true);
      if (result.success) {
        // SM-2: first "good" review sets interval to 1
        expect(result.data.metadata.interval).toBe(1);
        expect(result.data.metadata.repetitions).toBe(1);
        expect(result.data.metadata.ease_factor).toBe(2.5); // "good" doesn't change EF
        expect(result.data.metadata.last_reviewed).toBe(today);
        expect(result.data.metadata.next_review).toBe("2026-01-24"); // today + 1 day
      }
    });

    test("applies SM-2 for 'again' response (resets interval)", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440041",
        interval: 6,
        repetitions: 2,
        ease_factor: 2.5,
        next_review: "2026-01-23",
      });
      await saveCard(vault, card);

      const result = await submitReview(vault, card.metadata.id, "again", today);

      expect(result.success).toBe(true);
      if (result.success) {
        // "again" resets to learning phase
        expect(result.data.metadata.interval).toBe(1);
        expect(result.data.metadata.repetitions).toBe(0);
        // EF decreases by 0.2, clamped to min 1.3
        expect(result.data.metadata.ease_factor).toBe(2.3);
        expect(result.data.metadata.next_review).toBe("2026-01-24");
      }
    });

    test("applies SM-2 for 'hard' response", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440042",
        interval: 6,
        repetitions: 2,
        ease_factor: 2.5,
        next_review: "2026-01-23",
      });
      await saveCard(vault, card);

      const result = await submitReview(vault, card.metadata.id, "hard", today);

      expect(result.success).toBe(true);
      if (result.success) {
        // "hard" increases interval slightly (6 * 1.2 = 7.2, rounded to 7)
        expect(result.data.metadata.interval).toBe(7);
        expect(result.data.metadata.repetitions).toBe(3);
        // EF decreases by 0.15
        expect(result.data.metadata.ease_factor).toBe(2.35);
      }
    });

    test("applies SM-2 for 'easy' response (bonus interval)", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440043",
        interval: 6,
        repetitions: 2,
        ease_factor: 2.5,
        next_review: "2026-01-23",
      });
      await saveCard(vault, card);

      const result = await submitReview(vault, card.metadata.id, "easy", today);

      expect(result.success).toBe(true);
      if (result.success) {
        // "easy": 6 * 2.65 * 1.3 = 20.67, rounded to 21
        expect(result.data.metadata.interval).toBe(21);
        expect(result.data.metadata.repetitions).toBe(3);
        // EF increases by 0.15
        expect(result.data.metadata.ease_factor).toBe(2.65);
      }
    });

    test("persists changes to disk", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440044",
        interval: 0,
        repetitions: 0,
      });
      await saveCard(vault, card);

      await submitReview(vault, card.metadata.id, "good", today);

      // Re-load from disk to verify persistence
      const reloaded = await getCard(vault, card.metadata.id);
      expect(reloaded.success).toBe(true);
      if (reloaded.success) {
        expect(reloaded.data.metadata.interval).toBe(1);
        expect(reloaded.data.metadata.repetitions).toBe(1);
        expect(reloaded.data.metadata.last_reviewed).toBe(today);
      }
    });

    test("returns error for invalid response", async () => {
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440045",
      });
      await saveCard(vault, card);

      const result = await submitReview(vault, card.metadata.id, "invalid", "2026-01-23");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid review response");
        expect(result.error).toContain("again, hard, good, easy");
      }
    });

    test("returns error for non-existent card", async () => {
      const result = await submitReview(
        vault,
        "550e8400-0000-0000-0000-000000000000",
        "good",
        "2026-01-23"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });
  });

  // =============================================================================
  // archiveCard Tests
  // =============================================================================

  describe("archiveCard", () => {
    test("moves card to archive directory", async () => {
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440050",
      });
      await saveCard(vault, card);

      const result = await archiveCard(vault, card.metadata.id);

      expect(result).toBe(true);

      // Card should not be in cards directory
      const activeCardPath = getCardPath(vault, card.metadata.id);
      let activeExists = true;
      try {
        await readFile(activeCardPath);
      } catch {
        activeExists = false;
      }
      expect(activeExists).toBe(false);

      // Card should be in archive directory
      const archivedPath = getArchivedCardPath(vault, card.metadata.id);
      const archivedContent = await readFile(archivedPath, "utf-8");
      expect(archivedContent).toContain(card.metadata.id);
    });

    test("returns false for non-existent card", async () => {
      const result = await archiveCard(vault, "550e8400-0000-0000-0000-000000000000");
      expect(result).toBe(false);
    });

    test("card no longer appears in getDueCards after archive", async () => {
      const today = "2026-01-23";
      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440051",
        next_review: today,
      });
      await saveCard(vault, card);

      // Verify card is initially due
      let dueCards = await getDueCards(vault, today);
      expect(dueCards).toHaveLength(1);

      // Archive the card
      await archiveCard(vault, card.metadata.id);

      // Verify card is no longer due
      dueCards = await getDueCards(vault, today);
      expect(dueCards).toHaveLength(0);
    });
  });

  // =============================================================================
  // createCard Tests
  // =============================================================================

  describe("createCard", () => {
    test("generates UUID and creates card with defaults", async () => {
      const today = "2026-01-23";
      const input: CreateCardInput = {
        question: "What is 2 + 2?",
        answer: "4",
      };

      const result = await createCard(vault, input, today);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have a valid UUID
        expect(result.data.metadata.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        // Should have SM-2 defaults
        expect(result.data.metadata.interval).toBe(0);
        expect(result.data.metadata.repetitions).toBe(0);
        expect(result.data.metadata.ease_factor).toBe(2.5);
        expect(result.data.metadata.next_review).toBe(today);
        expect(result.data.metadata.last_reviewed).toBeNull();
        expect(result.data.metadata.created_date).toBe(today);
        // Should have content
        expect(result.data.content.question).toBe("What is 2 + 2?");
        expect(result.data.content.answer).toBe("4");
      }
    });

    test("saves card to disk", async () => {
      const input: CreateCardInput = {
        question: "Test question",
        answer: "Test answer",
      };

      const result = await createCard(vault, input, "2026-01-23");
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Verify card exists on disk
      const cardPath = getCardPath(vault, result.data.metadata.id);
      const content = await readFile(cardPath, "utf-8");
      expect(content).toContain("Test question");
      expect(content).toContain("Test answer");
    });

    test("includes source_file when provided", async () => {
      const input: CreateCardInput = {
        question: "Q",
        answer: "A",
        sourceFile: "01_Projects/notes.md",
      };

      const result = await createCard(vault, input, "2026-01-23");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.source_file).toBe("01_Projects/notes.md");
      }
    });

    test("trims whitespace from question and answer", async () => {
      const input: CreateCardInput = {
        question: "  Question with spaces  ",
        answer: "\n\tAnswer with newlines\n",
      };

      const result = await createCard(vault, input, "2026-01-23");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content.question).toBe("Question with spaces");
        expect(result.data.content.answer).toBe("Answer with newlines");
      }
    });

    test("returns error for empty question", async () => {
      const input: CreateCardInput = {
        question: "",
        answer: "Valid answer",
      };

      const result = await createCard(vault, input, "2026-01-23");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Question is required");
      }
    });

    test("returns error for whitespace-only question", async () => {
      const input: CreateCardInput = {
        question: "   \n\t  ",
        answer: "Valid answer",
      };

      const result = await createCard(vault, input, "2026-01-23");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Question is required");
      }
    });

    test("returns error for empty answer", async () => {
      const input: CreateCardInput = {
        question: "Valid question",
        answer: "",
      };

      const result = await createCard(vault, input, "2026-01-23");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Answer is required");
      }
    });

    test("generates unique UUIDs for each card", async () => {
      const input: CreateCardInput = {
        question: "Q",
        answer: "A",
      };

      const result1 = await createCard(vault, input, "2026-01-23");
      const result2 = await createCard(vault, input, "2026-01-23");

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data.metadata.id).not.toBe(result2.data.metadata.id);
      }
    });
  });

  // =============================================================================
  // Integration: Full Review Cycle
  // =============================================================================

  describe("integration: full review cycle", () => {
    test("create -> review -> review -> archive", async () => {
      const day1 = "2026-01-23";
      const day2 = "2026-01-24";
      const day3 = "2026-01-30";

      // Day 1: Create a card
      const createResult = await createCard(
        vault,
        { question: "What is TypeScript?", answer: "A typed superset of JavaScript" },
        day1
      );
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;
      const cardId = createResult.data.metadata.id;

      // Day 1: Card is due (new cards are due immediately)
      let dueCards = await getDueCards(vault, day1);
      expect(dueCards).toHaveLength(1);

      // Day 1: Review as "good" -> interval becomes 1
      let reviewResult = await submitReview(vault, cardId, "good", day1);
      expect(reviewResult.success).toBe(true);
      if (!reviewResult.success) return;
      expect(reviewResult.data.metadata.next_review).toBe("2026-01-24");

      // Day 1: Card no longer due
      dueCards = await getDueCards(vault, day1);
      expect(dueCards).toHaveLength(0);

      // Day 2: Card is due again
      dueCards = await getDueCards(vault, day2);
      expect(dueCards).toHaveLength(1);

      // Day 2: Review as "good" -> interval becomes 6
      reviewResult = await submitReview(vault, cardId, "good", day2);
      expect(reviewResult.success).toBe(true);
      if (!reviewResult.success) return;
      expect(reviewResult.data.metadata.interval).toBe(6);
      expect(reviewResult.data.metadata.next_review).toBe("2026-01-30");

      // Day 3: Card is due
      dueCards = await getDueCards(vault, day3);
      expect(dueCards).toHaveLength(1);

      // Day 3: Archive the card (user has mastered it)
      const archiveResult = await archiveCard(vault, cardId);
      expect(archiveResult).toBe(true);

      // Day 3: No cards due anymore
      dueCards = await getDueCards(vault, day3);
      expect(dueCards).toHaveLength(0);
    });
  });
});
