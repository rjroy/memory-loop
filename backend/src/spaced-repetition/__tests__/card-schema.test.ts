/**
 * Card Schema Tests
 *
 * Tests for Zod schemas, validation utilities, and helper functions.
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  CardMetadataSchema,
  QACardContentSchema,
  CardSchema,
  parseCardMetadata,
  safeParseCardMetadata,
  parseQACardContent,
  safeParseQACardContent,
  parseCard,
  safeParseCard,
  formatCardError,
  createNewCardMetadata,
  formatDate,
  parseDate,
  getToday,
  addDays,
  isDueToday,
  type CardMetadata,
  type QACardContent,
} from "../card-schema.js";

describe("card-schema", () => {
  // =============================================================================
  // CardMetadataSchema Tests
  // =============================================================================

  describe("CardMetadataSchema", () => {
    const validMetadata: CardMetadata = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "qa",
      created_date: "2026-01-23",
      last_reviewed: "2026-01-22",
      next_review: "2026-01-25",
      ease_factor: 2.5,
      interval: 3,
      repetitions: 2,
      source_file: "01_Projects/notes.md",
    };

    test("accepts valid metadata", () => {
      const result = CardMetadataSchema.safeParse(validMetadata);
      expect(result.success).toBe(true);
    });

    test("accepts metadata without source_file", () => {
      const metadataWithoutSource = {
        id: validMetadata.id,
        type: validMetadata.type,
        created_date: validMetadata.created_date,
        last_reviewed: validMetadata.last_reviewed,
        next_review: validMetadata.next_review,
        ease_factor: validMetadata.ease_factor,
        interval: validMetadata.interval,
        repetitions: validMetadata.repetitions,
        // source_file intentionally omitted
      };
      const result = CardMetadataSchema.safeParse(metadataWithoutSource);
      expect(result.success).toBe(true);
    });

    test("accepts null last_reviewed", () => {
      const metadata = { ...validMetadata, last_reviewed: null };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    test("rejects invalid UUID", () => {
      const metadata = { ...validMetadata, id: "not-a-uuid" };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("rejects invalid date format for created_date", () => {
      const metadata = { ...validMetadata, created_date: "01-23-2026" };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("rejects invalid date format for last_reviewed", () => {
      const metadata = { ...validMetadata, last_reviewed: "2026/01/22" };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("rejects invalid date format for next_review", () => {
      const metadata = { ...validMetadata, next_review: "Jan 25, 2026" };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("rejects ease_factor below 1.3", () => {
      const metadata = { ...validMetadata, ease_factor: 1.2 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("accepts ease_factor at minimum (1.3)", () => {
      const metadata = { ...validMetadata, ease_factor: 1.3 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    test("rejects negative interval", () => {
      const metadata = { ...validMetadata, interval: -1 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("accepts zero interval", () => {
      const metadata = { ...validMetadata, interval: 0 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    test("rejects non-integer interval", () => {
      const metadata = { ...validMetadata, interval: 1.5 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("rejects negative repetitions", () => {
      const metadata = { ...validMetadata, repetitions: -1 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("accepts zero repetitions", () => {
      const metadata = { ...validMetadata, repetitions: 0 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    test("rejects non-integer repetitions", () => {
      const metadata = { ...validMetadata, repetitions: 2.5 };
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    test("applies default type when not provided", () => {
      const metadataWithoutType = {
        id: validMetadata.id,
        // type intentionally omitted
        created_date: validMetadata.created_date,
        last_reviewed: validMetadata.last_reviewed,
        next_review: validMetadata.next_review,
        ease_factor: validMetadata.ease_factor,
        interval: validMetadata.interval,
        repetitions: validMetadata.repetitions,
        source_file: validMetadata.source_file,
      };
      const result = CardMetadataSchema.parse(metadataWithoutType);
      expect(result.type).toBe("qa");
    });

    test("applies default ease_factor when not provided", () => {
      const metadataWithoutEase = {
        id: validMetadata.id,
        type: validMetadata.type,
        created_date: validMetadata.created_date,
        last_reviewed: validMetadata.last_reviewed,
        next_review: validMetadata.next_review,
        // ease_factor intentionally omitted
        interval: validMetadata.interval,
        repetitions: validMetadata.repetitions,
        source_file: validMetadata.source_file,
      };
      const result = CardMetadataSchema.parse(metadataWithoutEase);
      expect(result.ease_factor).toBe(2.5);
    });

    test("applies default interval when not provided", () => {
      const metadataWithoutInterval = {
        id: validMetadata.id,
        type: validMetadata.type,
        created_date: validMetadata.created_date,
        last_reviewed: validMetadata.last_reviewed,
        next_review: validMetadata.next_review,
        ease_factor: validMetadata.ease_factor,
        // interval intentionally omitted
        repetitions: validMetadata.repetitions,
        source_file: validMetadata.source_file,
      };
      const result = CardMetadataSchema.parse(metadataWithoutInterval);
      expect(result.interval).toBe(0);
    });

    test("applies default repetitions when not provided", () => {
      const metadataWithoutReps = {
        id: validMetadata.id,
        type: validMetadata.type,
        created_date: validMetadata.created_date,
        last_reviewed: validMetadata.last_reviewed,
        next_review: validMetadata.next_review,
        ease_factor: validMetadata.ease_factor,
        interval: validMetadata.interval,
        // repetitions intentionally omitted
        source_file: validMetadata.source_file,
      };
      const result = CardMetadataSchema.parse(metadataWithoutReps);
      expect(result.repetitions).toBe(0);
    });
  });

  // =============================================================================
  // QACardContentSchema Tests
  // =============================================================================

  describe("QACardContentSchema", () => {
    test("accepts valid Q&A content", () => {
      const content: QACardContent = {
        question: "What is the capital of France?",
        answer: "Paris",
      };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    test("rejects empty question", () => {
      const content = { question: "", answer: "Paris" };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(false);
    });

    test("rejects empty answer", () => {
      const content = { question: "What is the capital of France?", answer: "" };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(false);
    });

    test("rejects missing question", () => {
      const content = { answer: "Paris" };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(false);
    });

    test("rejects missing answer", () => {
      const content = { question: "What is the capital of France?" };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(false);
    });

    test("accepts multi-line question", () => {
      const content = {
        question: "What are the steps?\n1. First\n2. Second",
        answer: "Follow them in order",
      };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    test("accepts multi-line answer", () => {
      const content = {
        question: "What is the answer?",
        answer: "Line 1\n\nLine 2\n\nLine 3",
      };
      const result = QACardContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // CardSchema Tests
  // =============================================================================

  describe("CardSchema", () => {
    const validCard = {
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
        question: "What is SM-2?",
        answer: "A spaced repetition algorithm",
      },
    };

    test("accepts valid card", () => {
      const result = CardSchema.safeParse(validCard);
      expect(result.success).toBe(true);
    });

    test("rejects card with invalid metadata", () => {
      const card = {
        ...validCard,
        metadata: { ...validCard.metadata, id: "bad-id" },
      };
      const result = CardSchema.safeParse(card);
      expect(result.success).toBe(false);
    });

    test("rejects card with invalid content", () => {
      const card = {
        ...validCard,
        content: { question: "", answer: "Something" },
      };
      const result = CardSchema.safeParse(card);
      expect(result.success).toBe(false);
    });
  });

  // =============================================================================
  // Parsing Functions Tests
  // =============================================================================

  describe("parseCardMetadata", () => {
    test("returns parsed metadata for valid input", () => {
      const data = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
      };
      const result = parseCardMetadata(data);
      expect(result.id).toBe(data.id);
    });

    test("throws ZodError for invalid input", () => {
      const data = { id: "bad" };
      expect(() => parseCardMetadata(data)).toThrow(z.ZodError);
    });
  });

  describe("safeParseCardMetadata", () => {
    test("returns success for valid input", () => {
      const data = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "qa",
        created_date: "2026-01-23",
        last_reviewed: null,
        next_review: "2026-01-23",
      };
      const result = safeParseCardMetadata(data);
      expect(result.success).toBe(true);
    });

    test("returns failure for invalid input", () => {
      const result = safeParseCardMetadata({ id: "bad" });
      expect(result.success).toBe(false);
    });
  });

  describe("parseQACardContent", () => {
    test("returns parsed content for valid input", () => {
      const data = { question: "Q?", answer: "A." };
      const result = parseQACardContent(data);
      expect(result.question).toBe("Q?");
      expect(result.answer).toBe("A.");
    });

    test("throws ZodError for invalid input", () => {
      expect(() => parseQACardContent({ question: "" })).toThrow(z.ZodError);
    });
  });

  describe("safeParseQACardContent", () => {
    test("returns success for valid input", () => {
      const result = safeParseQACardContent({ question: "Q?", answer: "A." });
      expect(result.success).toBe(true);
    });

    test("returns failure for invalid input", () => {
      const result = safeParseQACardContent({ question: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("parseCard", () => {
    test("returns parsed card for valid input", () => {
      const data = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
        },
        content: { question: "Q?", answer: "A." },
      };
      const result = parseCard(data);
      expect(result.metadata.id).toBe(data.metadata.id);
    });

    test("throws ZodError for invalid input", () => {
      expect(() => parseCard({})).toThrow(z.ZodError);
    });
  });

  describe("safeParseCard", () => {
    test("returns success for valid input", () => {
      const data = {
        metadata: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "qa",
          created_date: "2026-01-23",
          last_reviewed: null,
          next_review: "2026-01-23",
        },
        content: { question: "Q?", answer: "A." },
      };
      const result = safeParseCard(data);
      expect(result.success).toBe(true);
    });

    test("returns failure for invalid input", () => {
      const result = safeParseCard({});
      expect(result.success).toBe(false);
    });
  });

  // =============================================================================
  // formatCardError Tests
  // =============================================================================

  describe("formatCardError", () => {
    test("formats single error", () => {
      const result = safeParseCardMetadata({ id: "bad" });
      if (!result.success) {
        const message = formatCardError(result.error);
        expect(message).toContain("Invalid card data");
        expect(message).toContain("id");
      } else {
        throw new Error("Expected validation to fail");
      }
    });

    test("formats multiple errors", () => {
      const result = safeParseCardMetadata({
        id: "bad",
        created_date: "invalid",
        ease_factor: 0.5,
      });
      if (!result.success) {
        const message = formatCardError(result.error);
        const lines = message.split("\n").filter((l) => l.trim().startsWith("-"));
        expect(lines.length).toBeGreaterThan(1);
      } else {
        throw new Error("Expected validation to fail");
      }
    });

    test("handles nested path errors", () => {
      const result = safeParseCard({
        metadata: { id: "bad" },
        content: { question: "" },
      });
      if (!result.success) {
        const message = formatCardError(result.error);
        expect(message).toContain("metadata");
      } else {
        throw new Error("Expected validation to fail");
      }
    });
  });

  // =============================================================================
  // createNewCardMetadata Tests
  // =============================================================================

  describe("createNewCardMetadata", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const today = "2026-01-23";

    test("creates metadata with correct ID", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.id).toBe(id);
    });

    test("sets type to qa", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.type).toBe("qa");
    });

    test("sets created_date to provided today", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.created_date).toBe(today);
    });

    test("sets last_reviewed to null", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.last_reviewed).toBeNull();
    });

    test("sets next_review to today (due immediately)", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.next_review).toBe(today);
    });

    test("sets default ease_factor to 2.5", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.ease_factor).toBe(2.5);
    });

    test("sets interval to 0 for new cards", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.interval).toBe(0);
    });

    test("sets repetitions to 0", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.repetitions).toBe(0);
    });

    test("includes source_file when provided", () => {
      const sourceFile = "01_Projects/notes.md";
      const metadata = createNewCardMetadata(id, today, sourceFile);
      expect(metadata.source_file).toBe(sourceFile);
    });

    test("source_file is undefined when not provided", () => {
      const metadata = createNewCardMetadata(id, today);
      expect(metadata.source_file).toBeUndefined();
    });

    test("created metadata passes schema validation", () => {
      const metadata = createNewCardMetadata(id, today);
      const result = CardMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // Date Utility Tests
  // =============================================================================

  describe("formatDate", () => {
    test("formats date to YYYY-MM-DD", () => {
      const date = new Date(2026, 0, 23); // Jan 23, 2026
      expect(formatDate(date)).toBe("2026-01-23");
    });

    test("pads single-digit month", () => {
      const date = new Date(2026, 0, 15); // Jan 15, 2026
      expect(formatDate(date)).toBe("2026-01-15");
    });

    test("pads single-digit day", () => {
      const date = new Date(2026, 9, 5); // Oct 5, 2026
      expect(formatDate(date)).toBe("2026-10-05");
    });

    test("handles December correctly", () => {
      const date = new Date(2026, 11, 31); // Dec 31, 2026
      expect(formatDate(date)).toBe("2026-12-31");
    });
  });

  describe("parseDate", () => {
    test("parses valid YYYY-MM-DD date", () => {
      const date = parseDate("2026-01-23");
      expect(date).not.toBeNull();
      expect(date?.getFullYear()).toBe(2026);
      expect(date?.getMonth()).toBe(0); // January is 0
      expect(date?.getDate()).toBe(23);
    });

    test("returns null for invalid format", () => {
      expect(parseDate("01-23-2026")).toBeNull();
      expect(parseDate("2026/01/23")).toBeNull();
      expect(parseDate("Jan 23, 2026")).toBeNull();
    });

    test("returns null for impossible dates", () => {
      expect(parseDate("2026-02-30")).toBeNull(); // Feb 30 doesn't exist
      expect(parseDate("2026-13-01")).toBeNull(); // Month 13 doesn't exist
      expect(parseDate("2026-00-15")).toBeNull(); // Month 0 doesn't exist
    });

    test("returns null for empty string", () => {
      expect(parseDate("")).toBeNull();
    });

    test("returns null for partial dates", () => {
      expect(parseDate("2026-01")).toBeNull();
      expect(parseDate("2026")).toBeNull();
    });
  });

  describe("getToday", () => {
    test("returns date in YYYY-MM-DD format", () => {
      const today = getToday();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("returns parseable date", () => {
      const today = getToday();
      const date = parseDate(today);
      expect(date).not.toBeNull();
    });
  });

  describe("addDays", () => {
    test("adds positive days", () => {
      expect(addDays("2026-01-23", 5)).toBe("2026-01-28");
    });

    test("handles month rollover", () => {
      expect(addDays("2026-01-28", 5)).toBe("2026-02-02");
    });

    test("handles year rollover", () => {
      expect(addDays("2026-12-28", 5)).toBe("2027-01-02");
    });

    test("handles zero days", () => {
      expect(addDays("2026-01-23", 0)).toBe("2026-01-23");
    });

    test("handles negative days", () => {
      expect(addDays("2026-01-23", -5)).toBe("2026-01-18");
    });

    test("throws for invalid date string", () => {
      expect(() => addDays("bad-date", 5)).toThrow("Invalid date");
    });
  });

  describe("isDueToday", () => {
    test("returns true when next_review equals today", () => {
      expect(isDueToday("2026-01-23", "2026-01-23")).toBe(true);
    });

    test("returns true when next_review is before today", () => {
      expect(isDueToday("2026-01-20", "2026-01-23")).toBe(true);
    });

    test("returns false when next_review is after today", () => {
      expect(isDueToday("2026-01-25", "2026-01-23")).toBe(false);
    });

    test("handles year boundaries", () => {
      expect(isDueToday("2025-12-31", "2026-01-01")).toBe(true);
      expect(isDueToday("2026-01-01", "2025-12-31")).toBe(false);
    });
  });
});
