/**
 * Card Storage Tests
 *
 * Tests for file operations: reading, writing, listing, and archiving cards.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CARDS_SUBDIR,
  ARCHIVE_SUBDIR,
  CARD_EXTENSION,
  getCardsDir,
  getArchiveDir,
  getCardPath,
  getArchivedCardPath,
  parseCardFile,
  serializeCard,
  readCardFile,
  writeCardFile,
  saveCard,
  loadCard,
  listCards,
  loadAllCards,
  loadDueCards,
  archiveCard,
  ensureCardsDir,
  ensureArchiveDir,
  type VaultPathInfo,
} from "../card-storage";
import type { Card } from "../card-schema";

describe("card-storage", () => {
  let testDir: string;
  let vault: VaultPathInfo;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `card-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Create vault structure
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
  // Path Resolution Tests
  // =============================================================================

  describe("getCardsDir", () => {
    test("returns correct path", () => {
      const result = getCardsDir(vault);
      expect(result).toBe(join(testDir, "06_Metadata/memory-loop", CARDS_SUBDIR));
    });

    test("handles different metadata paths", () => {
      const customVault: VaultPathInfo = {
        contentRoot: "/vault",
        metadataPath: "custom/path",
      };
      expect(getCardsDir(customVault)).toBe("/vault/custom/path/cards");
    });
  });

  describe("getArchiveDir", () => {
    test("returns correct path", () => {
      const result = getArchiveDir(vault);
      expect(result).toBe(
        join(testDir, "06_Metadata/memory-loop", CARDS_SUBDIR, ARCHIVE_SUBDIR)
      );
    });
  });

  describe("getCardPath", () => {
    test("returns correct path for card ID", () => {
      const cardId = "550e8400-e29b-41d4-a716-446655440000";
      const result = getCardPath(vault, cardId);
      expect(result).toBe(
        join(testDir, "06_Metadata/memory-loop/cards", `${cardId}${CARD_EXTENSION}`)
      );
    });
  });

  describe("getArchivedCardPath", () => {
    test("returns correct path for archived card ID", () => {
      const cardId = "550e8400-e29b-41d4-a716-446655440000";
      const result = getArchivedCardPath(vault, cardId);
      expect(result).toBe(
        join(
          testDir,
          "06_Metadata/memory-loop/cards/archive",
          `${cardId}${CARD_EXTENSION}`
        )
      );
    });
  });

  // =============================================================================
  // Card File Parsing Tests
  // =============================================================================

  describe("parseCardFile", () => {
    test("parses valid card file", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
ease_factor: 2.5
interval: 0
repetitions: 0
---

## Question

What is the capital of France?

## Answer

Paris is the capital of France.
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.metadata.id).toBe("550e8400-e29b-41d4-a716-446655440000");
        expect(result.card.metadata.type).toBe("qa");
        expect(result.card.content.question).toBe("What is the capital of France?");
        expect(result.card.content.answer).toBe("Paris is the capital of France.");
      }
    });

    test("parses card with source_file", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: "2026-01-22"
next_review: "2026-01-25"
ease_factor: 2.6
interval: 3
repetitions: 2
source_file: "01_Projects/notes.md"
---

## Question

Test question

## Answer

Test answer
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.metadata.source_file).toBe("01_Projects/notes.md");
        expect(result.card.metadata.last_reviewed).toBe("2026-01-22");
        expect(result.card.metadata.interval).toBe(3);
      }
    });

    test("handles multi-line question and answer", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
ease_factor: 2.5
interval: 0
repetitions: 0
---

## Question

What are the three parts of an essay?

1. Introduction
2. Body
3. Conclusion

## Answer

The three parts are:

**Introduction**: Sets up the topic
**Body**: Main arguments
**Conclusion**: Summarizes key points
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.content.question).toContain("1. Introduction");
        expect(result.card.content.answer).toContain("**Introduction**");
      }
    });

    test("fails for missing frontmatter", () => {
      const content = `## Question
What is this?

## Answer
No frontmatter!
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("No YAML frontmatter found");
      }
    });

    test("fails for invalid YAML", () => {
      const content = `---
id: "test
type: qa
---

## Question
Q

## Answer
A
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid YAML");
      }
    });

    test("fails for invalid metadata schema", () => {
      const content = `---
id: "not-a-uuid"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## Question
Q

## Answer
A
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Invalid card data");
      }
    });

    test("fails for missing Question section", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## Answer
Just an answer, no question
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Missing '## Question' section");
      }
    });

    test("fails for missing Answer section", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## Question
Just a question, no answer
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Missing '## Answer' section");
      }
    });

    test("handles case-insensitive headers", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## question

lowercase headers

## ANSWER

UPPERCASE headers
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(true);
    });

    test("fails for empty question content", () => {
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## Question

## Answer
Answer here
`;

      const result = parseCardFile(content);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Question is required");
      }
    });
  });

  // =============================================================================
  // Card Serialization Tests
  // =============================================================================

  describe("serializeCard", () => {
    const card: Card = {
      metadata: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
      },
      content: {
        question: "What is the capital of France?",
        answer: "Paris",
      },
    };

    test("produces valid markdown with frontmatter", () => {
      const output = serializeCard(card);
      expect(output).toContain("---");
      expect(output).toContain("## Question");
      expect(output).toContain("## Answer");
    });

    test("includes all metadata fields", () => {
      const output = serializeCard(card);
      expect(output).toContain(card.metadata.id);
      expect(output).toContain(card.metadata.type);
      expect(output).toContain(card.metadata.created_date);
      expect(output).toContain(card.metadata.next_review);
      expect(output).toContain("ease_factor");
      expect(output).toContain("interval");
      expect(output).toContain("repetitions");
    });

    test("includes source_file when present", () => {
      const cardWithSource: Card = {
        ...card,
        metadata: { ...card.metadata, source_file: "notes.md" },
      };
      const output = serializeCard(cardWithSource);
      expect(output).toContain("source_file");
      expect(output).toContain("notes.md");
    });

    test("excludes source_file when not present", () => {
      const output = serializeCard(card);
      expect(output).not.toContain("source_file");
    });

    test("includes question and answer content", () => {
      const output = serializeCard(card);
      expect(output).toContain(card.content.question);
      expect(output).toContain(card.content.answer);
    });
  });

  // =============================================================================
  // Round-Trip Tests
  // =============================================================================

  describe("serialize/parse round-trip", () => {
    test("card survives serialization and parsing", () => {
      const original: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: "2026-01-22",
          next_review: "2026-01-25",
          ease_factor: 2.6,
          interval: 3,
          repetitions: 2,
          source_file: "01_Projects/notes.md",
        },
        content: {
          question: "What is SM-2?\n\nIt's an algorithm.",
          answer: "A spaced repetition algorithm\n\nUsed for learning.",
        },
      };

      const serialized = serializeCard(original);
      const result = parseCardFile(serialized);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.metadata.id).toBe(original.metadata.id);
        expect(result.card.metadata.type).toBe(original.metadata.type);
        expect(result.card.metadata.created_date).toBe(original.metadata.created_date);
        expect(result.card.metadata.last_reviewed).toBe(original.metadata.last_reviewed);
        expect(result.card.metadata.next_review).toBe(original.metadata.next_review);
        expect(result.card.metadata.ease_factor).toBe(original.metadata.ease_factor);
        expect(result.card.metadata.interval).toBe(original.metadata.interval);
        expect(result.card.metadata.repetitions).toBe(original.metadata.repetitions);
        expect(result.card.metadata.source_file).toBe(original.metadata.source_file);
        expect(result.card.content.question).toBe(original.content.question);
        expect(result.card.content.answer).toBe(original.content.answer);
      }
    });

    test("handles null last_reviewed correctly", () => {
      const original: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: {
          question: "Q",
          answer: "A",
        },
      };

      const serialized = serializeCard(original);
      const result = parseCardFile(serialized);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.metadata.last_reviewed).toBeNull();
      }
    });
  });

  // =============================================================================
  // File Operation Tests
  // =============================================================================

  describe("readCardFile", () => {
    test("reads and parses valid card file", async () => {
      await ensureCardsDir(vault);
      const cardPath = getCardPath(vault, "test-card");
      const content = `---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: null
next_review: "2026-01-23"
---

## Question
Test

## Answer
Test
`;
      await writeFile(cardPath, content);

      const result = await readCardFile(cardPath);
      expect(result.success).toBe(true);
    });

    test("returns error for non-existent file", async () => {
      const result = await readCardFile(join(testDir, "nonexistent.md"));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Card file not found");
      }
    });
  });

  describe("writeCardFile", () => {
    const card: Card = {
      metadata: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
      },
      content: {
        question: "Q",
        answer: "A",
      },
    };

    test("creates card file and parent directories", async () => {
      const cardPath = getCardPath(vault, card.metadata.id);
      await writeCardFile(cardPath, card);

      const content = await readFile(cardPath, "utf-8");
      expect(content).toContain(card.metadata.id);
    });

    test("overwrites existing card file", async () => {
      const cardPath = getCardPath(vault, card.metadata.id);
      await writeCardFile(cardPath, card);

      const updatedCard: Card = {
        ...card,
        content: { question: "Updated Q", answer: "Updated A" },
      };
      await writeCardFile(cardPath, updatedCard);

      const content = await readFile(cardPath, "utf-8");
      expect(content).toContain("Updated Q");
    });

    test("cleans up temp file on failure", async () => {
      // Create a directory at the target path to cause write failure
      const badPath = join(testDir, "blocked");
      await mkdir(badPath);

      let didThrow = false;
      try {
        await writeCardFile(badPath, card);
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(true);

      // Verify no temp files left behind
      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe("saveCard and loadCard", () => {
    const card: Card = {
      metadata: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
      },
      content: {
        question: "What is 2+2?",
        answer: "4",
      },
    };

    test("saves and loads card correctly", async () => {
      await saveCard(vault, card);
      const result = await loadCard(vault, card.metadata.id);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.card.metadata.id).toBe(card.metadata.id);
        expect(result.card.content.question).toBe(card.content.question);
      }
    });
  });

  // =============================================================================
  // Card Listing Tests
  // =============================================================================

  describe("listCards", () => {
    test("returns empty array when cards directory does not exist", async () => {
      const result = await listCards(vault);
      expect(result).toEqual([]);
    });

    test("lists all card files", async () => {
      await ensureCardsDir(vault);
      const cardsDir = getCardsDir(vault);

      await writeFile(join(cardsDir, "card1.md"), "content");
      await writeFile(join(cardsDir, "card2.md"), "content");
      await writeFile(join(cardsDir, "card3.md"), "content");

      const result = await listCards(vault);
      expect(result).toHaveLength(3);
    });

    test("excludes non-md files", async () => {
      await ensureCardsDir(vault);
      const cardsDir = getCardsDir(vault);

      await writeFile(join(cardsDir, "card.md"), "content");
      await writeFile(join(cardsDir, "other.txt"), "content");
      await writeFile(join(cardsDir, ".hidden"), "content");

      const result = await listCards(vault);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("card");
    });

    test("excludes archive directory", async () => {
      await ensureCardsDir(vault);
      await ensureArchiveDir(vault);
      const cardsDir = getCardsDir(vault);
      const archiveDir = getArchiveDir(vault);

      await writeFile(join(cardsDir, "active.md"), "content");
      await writeFile(join(archiveDir, "archived.md"), "content");

      const result = await listCards(vault);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("active");
    });
  });

  describe("loadAllCards", () => {
    test("loads all valid cards", async () => {
      const card1: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440001",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q1", answer: "A1" },
      };
      const card2: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440002",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-24",
          ease_factor: 2.5,
          interval: 1,
          repetitions: 1,
        },
        content: { question: "Q2", answer: "A2" },
      };

      await saveCard(vault, card1);
      await saveCard(vault, card2);

      const cards = await loadAllCards(vault);
      expect(cards).toHaveLength(2);
    });

    test("skips invalid cards with warning", async () => {
      await ensureCardsDir(vault);
      const cardsDir = getCardsDir(vault);

      // Write one valid card
      const validCard: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440003",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q", answer: "A" },
      };
      await saveCard(vault, validCard);

      // Write one invalid card
      await writeFile(join(cardsDir, "invalid-card.md"), "not valid yaml content");

      const cards = await loadAllCards(vault);
      expect(cards).toHaveLength(1);
      expect(cards[0].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440003");
    });
  });

  describe("loadDueCards", () => {
    test("returns cards with next_review <= today", async () => {
      const today = "2026-01-23";
      const cardDue: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440010",
          type: "qa",
          created_date: "2026-01-20",
          last_reviewed: "2026-01-20",
          next_review: "2026-01-23", // Due today
          ease_factor: 2.5,
          interval: 3,
          repetitions: 1,
        },
        content: { question: "Due", answer: "Due" },
      };
      const cardOverdue: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440011",
          type: "qa",
          created_date: "2026-01-15",
          last_reviewed: "2026-01-15",
          next_review: "2026-01-18", // Overdue
          ease_factor: 2.5,
          interval: 3,
          repetitions: 1,
        },
        content: { question: "Overdue", answer: "Overdue" },
      };
      const cardNotDue: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440012",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-25", // Not yet due
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Not due", answer: "Not due" },
      };

      await saveCard(vault, cardDue);
      await saveCard(vault, cardOverdue);
      await saveCard(vault, cardNotDue);

      const dueCards = await loadDueCards(vault, today);
      expect(dueCards).toHaveLength(2);
    });

    test("sorts by next_review ascending (oldest first)", async () => {
      const today = "2026-01-23";
      const card1: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440021",
          type: "qa",
          created_date: "2026-01-20",
          last_reviewed: null,
          next_review: "2026-01-21",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q1", answer: "A1" },
      };
      const card2: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440022",
          type: "qa",
          created_date: "2026-01-20",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q2", answer: "A2" },
      };
      const card3: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440023",
          type: "qa",
          created_date: "2026-01-20",
          last_reviewed: null,
          next_review: "2026-01-19",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q3", answer: "A3" },
      };

      await saveCard(vault, card1);
      await saveCard(vault, card2);
      await saveCard(vault, card3);

      const dueCards = await loadDueCards(vault, today);
      expect(dueCards).toHaveLength(3);
      expect(dueCards[0].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440023"); // 2026-01-19
      expect(dueCards[1].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440021"); // 2026-01-21
      expect(dueCards[2].metadata.id).toBe("550e8400-e29b-41d4-a716-446655440022"); // 2026-01-23
    });

    test("uses date-seeded secondary sort for cards with same next_review", async () => {
      const today = "2026-01-23";

      // Create 6 cards all due on the same date using valid UUIDs
      // With 6 cards (720 permutations), chance of same order on different day is < 0.2%
      const cardIds = [
        "a1b2c3d4-e5f6-4a1b-8c2d-100000000001",
        "b2c3d4e5-f6a1-4b2c-9d3e-200000000002",
        "c3d4e5f6-a1b2-4c3d-ae4f-300000000003",
        "d4e5f6a1-b2c3-4d4e-bf5a-400000000004",
        "e5f6a1b2-c3d4-4e5f-8a6b-500000000005",
        "f6a1b2c3-d4e5-4f6a-9b7c-600000000006",
      ];

      for (let i = 0; i < cardIds.length; i++) {
        const card: Card = {
          metadata: {
            id: cardIds[i],
            type: "qa",
            created_date: "2026-01-20",
            last_reviewed: "2026-01-20",
            next_review: "2026-01-23",
            ease_factor: 2.5,
            interval: 3,
            repetitions: 1,
          },
          content: { question: `Q${i}`, answer: `A${i}` },
        };
        await saveCard(vault, card);
      }

      // Same date should produce same order
      const firstLoad = await loadDueCards(vault, today);
      const secondLoad = await loadDueCards(vault, today);
      expect(firstLoad.map((c) => c.metadata.id)).toEqual(
        secondLoad.map((c) => c.metadata.id)
      );

      // Different date should produce different order
      const differentDay = await loadDueCards(vault, "2026-01-24");
      const sameOrderAsDifferentDay =
        firstLoad.map((c) => c.metadata.id).join(",") ===
        differentDay.map((c) => c.metadata.id).join(",");
      expect(sameOrderAsDifferentDay).toBe(false);
    });

    test("returns empty array when no cards are due", async () => {
      const today = "2026-01-20";
      const card: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440030",
          type: "qa",
          created_date: "2026-01-20",
          last_reviewed: null,
          next_review: "2026-01-25",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q", answer: "A" },
      };
      await saveCard(vault, card);

      const dueCards = await loadDueCards(vault, today);
      expect(dueCards).toHaveLength(0);
    });
  });

  // =============================================================================
  // Archive Tests
  // =============================================================================

  describe("archiveCard", () => {
    test("moves card to archive directory", async () => {
      const card: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440040",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q", answer: "A" },
      };
      await saveCard(vault, card);

      const result = await archiveCard(vault, card.metadata.id);
      expect(result).toBe(true);

      // Card should no longer be in cards directory
      const cardsList = await listCards(vault);
      expect(cardsList.find((c) => c.id === card.metadata.id)).toBeUndefined();

      // Card should be in archive
      const archivePath = getArchivedCardPath(vault, card.metadata.id);
      const archived = await readCardFile(archivePath);
      expect(archived.success).toBe(true);
    });

    test("creates archive directory if needed", async () => {
      const card: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440041",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
        },
        content: { question: "Q", answer: "A" },
      };
      await saveCard(vault, card);

      // Archive dir should not exist yet
      const archiveDir = getArchiveDir(vault);
      let exists = false;
      try {
        await readdir(archiveDir);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);

      await archiveCard(vault, card.metadata.id);

      // Archive dir should exist now
      const files = await readdir(archiveDir);
      expect(files).toHaveLength(1);
    });

    test("returns false for non-existent card", async () => {
      const result = await archiveCard(vault, "550e8400-e29b-41d4-a716-000000000000");
      expect(result).toBe(false);
    });

    test("preserves card metadata when archived", async () => {
      const card: Card = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440042",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: "2026-01-22",
          next_review: "2026-01-25",
          ease_factor: 2.6,
          interval: 3,
          repetitions: 2,
          source_file: "test.md",
        },
        content: { question: "Q", answer: "A" },
      };
      await saveCard(vault, card);
      await archiveCard(vault, card.metadata.id);

      const archivePath = getArchivedCardPath(vault, card.metadata.id);
      const archived = await readCardFile(archivePath);

      expect(archived.success).toBe(true);
      if (archived.success) {
        expect(archived.card.metadata).toEqual(card.metadata);
        expect(archived.card.content).toEqual(card.content);
      }
    });
  });

  // =============================================================================
  // Directory Initialization Tests
  // =============================================================================

  describe("ensureCardsDir", () => {
    test("creates cards directory if not exists", async () => {
      const cardsDir = getCardsDir(vault);

      await ensureCardsDir(vault);

      const files = await readdir(cardsDir);
      expect(files).toBeDefined();
    });

    test("is idempotent (safe to call multiple times)", async () => {
      await ensureCardsDir(vault);
      await ensureCardsDir(vault);

      const cardsDir = getCardsDir(vault);
      const files = await readdir(cardsDir);
      expect(files).toBeDefined();
    });
  });

  describe("ensureArchiveDir", () => {
    test("creates archive directory if not exists", async () => {
      const archiveDir = getArchiveDir(vault);

      await ensureArchiveDir(vault);

      const files = await readdir(archiveDir);
      expect(files).toBeDefined();
    });

    test("is idempotent (safe to call multiple times)", async () => {
      await ensureArchiveDir(vault);
      await ensureArchiveDir(vault);

      const archiveDir = getArchiveDir(vault);
      const files = await readdir(archiveDir);
      expect(files).toBeDefined();
    });
  });
});
