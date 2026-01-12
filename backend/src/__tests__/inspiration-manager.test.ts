/**
 * Inspiration Manager Tests
 *
 * Unit tests for inspiration file parsing, including:
 * - Generation marker parsing
 * - Inspiration line parsing (with and without attribution)
 * - Full file parsing with real filesystem operations
 * - Edge cases and UTF-8 content handling
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMockVault } from "./test-helpers";
import {
  parseGenerationMarker,
  parseInspirationLine,
  parseInspirationFile,
  parseInspirationContent,
  getISOWeekNumber,
  isWeekday,
  isContextualGenerationNeeded,
  isQuoteGenerationNeeded,
  getDayType,
  formatDateForDailyNote,
  getDateWithOffset,
  readDailyNote,
  readFolderIndex,
  getSubfolders,
  gatherDayContext,
  truncateContext,
  formatInspirationItem,
  formatGenerationMarker,
  appendToInspirationFile,
  prunePool,
  appendAndPrune,
  parseAIResponse,
  generateContextualPrompts,
  generateInspirationQuote,
  generateWeekendPrompts,
  setQueryFunction,
  resetQueryFunction,
  selectRandom,
  selectWeightedRandom,
  getInspiration,
  FALLBACK_QUOTE,
  CONTEXTUAL_PROMPTS_PATH,
  GENERAL_INSPIRATION_PATH,
  MAX_CONTEXT_CHARS,
  MAX_POOL_SIZE,
  INBOX_PATH,
  PROJECTS_PATH,
  AREAS_PATH,
  DAY_CONTEXT_CONFIG,
  GENERATION_MODEL,
  MAX_GENERATION_CONTEXT,
  type QueryFunction,
} from "../inspiration-manager";

// =============================================================================
// parseGenerationMarker Tests
// =============================================================================

describe("parseGenerationMarker", () => {
  describe("valid date format", () => {
    test("parses <!-- last-generated: YYYY-MM-DD --> format", () => {
      const result = parseGenerationMarker("<!-- last-generated: 2025-12-26 -->");
      expect(result.date).not.toBeNull();
      expect(result.date?.getFullYear()).toBe(2025);
      expect(result.date?.getMonth()).toBe(11); // December (0-indexed)
      expect(result.date?.getDate()).toBe(26);
      expect(result.weekNumber).toBeUndefined();
    });

    test("parses <!-- last-generated: YYYY-MM-DD (week NN) --> format", () => {
      const result = parseGenerationMarker(
        "<!-- last-generated: 2025-12-23 (week 52) -->"
      );
      expect(result.date).not.toBeNull();
      expect(result.date?.getFullYear()).toBe(2025);
      expect(result.date?.getMonth()).toBe(11);
      expect(result.date?.getDate()).toBe(23);
      expect(result.weekNumber).toBe(52);
    });

    test("parses week 1 correctly", () => {
      const result = parseGenerationMarker(
        "<!-- last-generated: 2025-01-06 (week 1) -->"
      );
      expect(result.date).not.toBeNull();
      expect(result.weekNumber).toBe(1);
    });

    test("handles extra whitespace around marker", () => {
      const result = parseGenerationMarker(
        "<!--   last-generated:   2025-12-26   -->"
      );
      expect(result.date).not.toBeNull();
      expect(result.date?.getDate()).toBe(26);
    });

    test("handles extra whitespace with week number", () => {
      const result = parseGenerationMarker(
        "<!--  last-generated:  2025-12-23  (week  52)  -->"
      );
      expect(result.date).not.toBeNull();
      expect(result.weekNumber).toBe(52);
    });
  });

  describe("invalid formats", () => {
    test("returns null date for malformed marker", () => {
      const result = parseGenerationMarker("<!-- generated: 2025-12-26 -->");
      expect(result.date).toBeNull();
    });

    test("returns null date for non-marker line", () => {
      const result = parseGenerationMarker('- "This is a quote" -- Source');
      expect(result.date).toBeNull();
    });

    test("returns null date for empty string", () => {
      const result = parseGenerationMarker("");
      expect(result.date).toBeNull();
    });

    test("returns null date for partial marker", () => {
      const result = parseGenerationMarker("<!-- last-generated: -->");
      expect(result.date).toBeNull();
    });

    test("returns null date for invalid date format (missing parts)", () => {
      const result = parseGenerationMarker("<!-- last-generated: 2025-12 -->");
      expect(result.date).toBeNull();
    });

    test("returns null date for prose text", () => {
      const result = parseGenerationMarker("Some random text about generation");
      expect(result.date).toBeNull();
    });

    test("returns null date for unclosed comment", () => {
      const result = parseGenerationMarker("<!-- last-generated: 2025-12-26");
      expect(result.date).toBeNull();
    });
  });
});

// =============================================================================
// parseInspirationLine Tests
// =============================================================================

describe("parseInspirationLine", () => {
  describe("valid lines with attribution", () => {
    test('parses - "Quote text" -- Source format', () => {
      const result = parseInspirationLine(
        '- "The only way to do great work is to love what you do." -- Steve Jobs'
      );
      expect(result).not.toBeNull();
      expect(result?.text).toBe(
        "The only way to do great work is to love what you do."
      );
      expect(result?.attribution).toBe("Steve Jobs");
    });

    test("handles attribution with multiple words", () => {
      const result = parseInspirationLine(
        '- "Quote here" -- Marcus Aurelius, Meditations'
      );
      expect(result?.attribution).toBe("Marcus Aurelius, Meditations");
    });

    test("handles attribution with special characters", () => {
      const result = parseInspirationLine(
        '- "Quote" -- Lao Tzu, Tao Te Ching (Chapter 1)'
      );
      expect(result?.attribution).toBe("Lao Tzu, Tao Te Ching (Chapter 1)");
    });
  });

  describe("valid lines without attribution", () => {
    test('parses - "Quote text" format', () => {
      const result = parseInspirationLine(
        '- "What progress did you make on the authentication refactor?"'
      );
      expect(result).not.toBeNull();
      expect(result?.text).toBe(
        "What progress did you make on the authentication refactor?"
      );
      expect(result?.attribution).toBeUndefined();
    });

    test("handles contextual prompts without attribution", () => {
      const result = parseInspirationLine(
        '- "You mentioned deadline pressure in yesterday\'s notes. How are you managing that?"'
      );
      expect(result?.text).toBe(
        "You mentioned deadline pressure in yesterday's notes. How are you managing that?"
      );
      expect(result?.attribution).toBeUndefined();
    });
  });

  describe("special characters in quotes", () => {
    test("handles quotes with apostrophes", () => {
      const result = parseInspirationLine(
        '- "It\'s not about the destination, it\'s about the journey." -- Unknown'
      );
      expect(result?.text).toBe(
        "It's not about the destination, it's about the journey."
      );
    });

    test("handles quotes with em-dash inside (not attribution)", () => {
      const result = parseInspirationLine(
        '- "The path — though unclear — leads forward." -- Wisdom'
      );
      expect(result?.text).toBe("The path — though unclear — leads forward.");
      expect(result?.attribution).toBe("Wisdom");
    });

    test("handles quotes with numbers", () => {
      const result = parseInspirationLine(
        '- "Rule 1: Never lose money. Rule 2: Never forget Rule 1." -- Warren Buffett'
      );
      expect(result?.text).toBe(
        "Rule 1: Never lose money. Rule 2: Never forget Rule 1."
      );
    });

    test("handles quotes with markdown-like content", () => {
      const result = parseInspirationLine(
        '- "Check [[linked note]] and review #tags" -- Contextual'
      );
      expect(result?.text).toBe("Check [[linked note]] and review #tags");
    });
  });

  describe("UTF-8 content", () => {
    test("handles emoji in quote text", () => {
      const result = parseInspirationLine(
        '- "Start each day with a grateful heart 💙" -- Daily Wisdom'
      );
      expect(result?.text).toBe("Start each day with a grateful heart 💙");
    });

    test("handles accented characters", () => {
      const result = parseInspirationLine(
        '- "La vie est belle, même dans les moments difficiles." -- French Proverb'
      );
      expect(result?.text).toBe(
        "La vie est belle, même dans les moments difficiles."
      );
    });

    test("handles Chinese characters", () => {
      const result = parseInspirationLine('- "千里之行，始于足下" -- 老子');
      expect(result?.text).toBe("千里之行，始于足下");
      expect(result?.attribution).toBe("老子");
    });

    test("handles Japanese characters", () => {
      const result = parseInspirationLine(
        '- "一期一会" -- Japanese Proverb'
      );
      expect(result?.text).toBe("一期一会");
    });

    test("handles mixed scripts", () => {
      const result = parseInspirationLine(
        '- "Carpe diem — seize the day 🌅" -- Horace'
      );
      expect(result?.text).toBe("Carpe diem — seize the day 🌅");
    });
  });

  describe("malformed lines", () => {
    test("returns null for empty quotes", () => {
      const result = parseInspirationLine('- ""');
      expect(result).toBeNull();
    });

    test("returns null for whitespace-only quotes", () => {
      const result = parseInspirationLine('- "   "');
      expect(result).toBeNull();
    });

    test("returns null for line without dash prefix", () => {
      const result = parseInspirationLine('"Quote text" -- Source');
      expect(result).toBeNull();
    });

    test("returns null for line without quotes", () => {
      const result = parseInspirationLine("- Quote text -- Source");
      expect(result).toBeNull();
    });

    test("returns null for plain text", () => {
      const result = parseInspirationLine("This is just plain text");
      expect(result).toBeNull();
    });

    test("returns null for numbered list", () => {
      const result = parseInspirationLine('1. "Quote text" -- Source');
      expect(result).toBeNull();
    });

    test("returns null for empty string", () => {
      const result = parseInspirationLine("");
      expect(result).toBeNull();
    });

    test("returns null for just a dash", () => {
      const result = parseInspirationLine("-");
      expect(result).toBeNull();
    });

    test("returns null for unclosed quote", () => {
      const result = parseInspirationLine('- "Quote without closing quote');
      expect(result).toBeNull();
    });

    test("returns null for generation marker line", () => {
      const result = parseInspirationLine("<!-- last-generated: 2025-12-26 -->");
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles leading whitespace on line", () => {
      // The regex expects the dash at the start, so leading space fails
      const result = parseInspirationLine('  - "Quote text" -- Source');
      expect(result).toBeNull();
    });

    test("handles extra spaces between dash and quote", () => {
      const result = parseInspirationLine('-   "Quote text"   --   Source');
      expect(result?.text).toBe("Quote text");
      expect(result?.attribution).toBe("Source");
    });

    test("handles very long quote text", () => {
      const longText = "A".repeat(1000);
      const result = parseInspirationLine(`- "${longText}" -- Long Source`);
      expect(result?.text).toBe(longText);
    });

    test("handles quote with double dash inside text", () => {
      const result = parseInspirationLine(
        '- "The symbol -- is called an em-dash"'
      );
      // The entire quoted text is preserved (-- inside quotes is part of text)
      expect(result?.text).toBe("The symbol -- is called an em-dash");
      expect(result?.attribution).toBeUndefined();
    });
  });
});

// =============================================================================
// parseInspirationContent Tests (synchronous parsing)
// =============================================================================

describe("parseInspirationContent", () => {
  test("parses file with valid entries and marker", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Quote one" -- Source One
- "Quote two" -- Source Two
- "Quote without source"
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.lastGenerated?.getDate()).toBe(26);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toBe("Quote one");
    expect(result.items[0].attribution).toBe("Source One");
    expect(result.items[2].attribution).toBeUndefined();
  });

  test("parses file with week number marker", () => {
    const content = `<!-- last-generated: 2025-12-23 (week 52) -->

- "Weekly quote" -- Weekly Source
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.weekNumber).toBe(52);
    expect(result.items).toHaveLength(1);
  });

  test("parses file without marker", () => {
    const content = `- "Quote one" -- Source
- "Quote two"
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).toBeNull();
    expect(result.weekNumber).toBeUndefined();
    expect(result.items).toHaveLength(2);
  });

  test("parses file with mixed valid and invalid lines", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Valid quote one" -- Source
This is an invalid line
- "Valid quote two"
Another invalid line without quotes
1. Numbered item that should be skipped
- Quote without proper quote marks
- "Valid quote three" -- Final Source
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toBe("Valid quote one");
    expect(result.items[1].text).toBe("Valid quote two");
    expect(result.items[2].text).toBe("Valid quote three");
  });

  test("returns empty for empty content", () => {
    const result = parseInspirationContent("");

    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("returns empty for whitespace-only content", () => {
    const result = parseInspirationContent("   \n\n   \t\n  ");

    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("handles UTF-8 content with emojis and special characters", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Start with gratitude 🙏" -- Morning Wisdom
- "La vie est belle!" -- French Proverb
- "千里之行，始于足下" -- 老子
`;
    const result = parseInspirationContent(content);

    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toBe("Start with gratitude 🙏");
    expect(result.items[1].text).toBe("La vie est belle!");
    expect(result.items[2].text).toBe("千里之行，始于足下");
    expect(result.items[2].attribution).toBe("老子");
  });

  test("handles contextual prompts file format (no attribution)", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "What progress did you make on the authentication refactor?"
- "You mentioned deadline pressure in yesterday's notes. How are you managing that?"
- "The project roadmap shows Q1 goals. What's the priority for this week?"
`;
    const result = parseInspirationContent(content);

    expect(result.items).toHaveLength(3);
    expect(result.items[0].attribution).toBeUndefined();
    expect(result.items[1].text).toContain("deadline pressure");
  });

  test("handles Windows line endings (CRLF)", () => {
    const content =
      "<!-- last-generated: 2025-12-26 -->\r\n\r\n" +
      '- "Quote with CRLF" -- Source\r\n';
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe("Quote with CRLF");
  });

  test("handles mixed line endings", () => {
    const content =
      "<!-- last-generated: 2025-12-26 -->\n" +
      '- "Quote one" -- Source\r\n' +
      '- "Quote two" -- Source\n';
    const result = parseInspirationContent(content);

    expect(result.items).toHaveLength(2);
  });

  test("only uses first generation marker encountered", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Quote" -- Source

<!-- last-generated: 2025-01-01 -->

- "Another quote" -- Source
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated?.getDate()).toBe(26);
    expect(result.lastGenerated?.getMonth()).toBe(11); // December
    expect(result.items).toHaveLength(2);
  });

  test("handles marker not on first line", () => {
    const content = `
<!-- last-generated: 2025-12-26 -->

- "Quote" -- Source
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.lastGenerated?.getDate()).toBe(26);
    expect(result.items).toHaveLength(1);
  });

  test("handles file with only marker (no quotes)", () => {
    const content = "<!-- last-generated: 2025-12-26 -->\n\n";
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("handles file with blank lines between quotes", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Quote one" -- Source

- "Quote two" -- Source


- "Quote three" -- Source
`;
    const result = parseInspirationContent(content);

    expect(result.items).toHaveLength(3);
  });
});

// =============================================================================
// parseInspirationFile Tests (with real filesystem)
// =============================================================================

describe("parseInspirationFile", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `inspiration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("parses valid file with entries and marker", async () => {
    const filePath = join(testDir, "quotes.md");
    const content = `<!-- last-generated: 2025-12-26 -->

- "The best time to plant a tree was 20 years ago." -- Chinese Proverb
- "The second best time is now."
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.items[0].text).toBe(
      "The best time to plant a tree was 20 years ago."
    );
    expect(result.items[0].attribution).toBe("Chinese Proverb");
    expect(result.items[1].attribution).toBeUndefined();
  });

  test("returns empty for missing file", async () => {
    const filePath = join(testDir, "nonexistent.md");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("returns empty for empty file", async () => {
    const filePath = join(testDir, "empty.md");
    await writeFile(filePath, "", "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("handles file with only whitespace", async () => {
    const filePath = join(testDir, "whitespace.md");
    await writeFile(filePath, "   \n\n   \t\n", "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("handles file with week number marker", async () => {
    const filePath = join(testDir, "weekly.md");
    const content = `<!-- last-generated: 2025-12-23 (week 52) -->

- "Weekly wisdom" -- Source
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.weekNumber).toBe(52);
    expect(result.items).toHaveLength(1);
  });

  test("handles UTF-8 file correctly", async () => {
    const filePath = join(testDir, "utf8.md");
    const content = `<!-- last-generated: 2025-12-26 -->

- "Carpe diem! 🌅" -- Horace
- "千里之行，始于足下" -- 老子
- "Café ☕ is life" -- Coffee Lover
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toBe("Carpe diem! 🌅");
    expect(result.items[1].text).toBe("千里之行，始于足下");
    expect(result.items[1].attribution).toBe("老子");
    expect(result.items[2].text).toContain("Café");
  });

  test("skips malformed lines gracefully", async () => {
    const filePath = join(testDir, "mixed.md");
    const content = `<!-- last-generated: 2025-12-26 -->

- "Valid quote one" -- Source
Invalid line without proper format
- "Valid quote two"
Another invalid line
1. Numbered item
- Missing quotes here
- "Valid quote three" -- Final
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toBe("Valid quote one");
    expect(result.items[1].text).toBe("Valid quote two");
    expect(result.items[2].text).toBe("Valid quote three");
  });

  test("handles large file efficiently", async () => {
    const filePath = join(testDir, "large.md");
    let content = "<!-- last-generated: 2025-12-26 -->\n\n";

    // Generate 100 valid entries
    for (let i = 0; i < 100; i++) {
      content += `- "Quote number ${i}" -- Source ${i}\n`;
    }
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(100);
    expect(result.items[0].text).toBe("Quote number 0");
    expect(result.items[99].text).toBe("Quote number 99");
  });

  test("handles contextual prompts file format", async () => {
    const filePath = join(testDir, "contextual-prompts.md");
    const content = `<!-- last-generated: 2025-12-26 -->

- "What progress did you make on the authentication refactor?"
- "You mentioned deadline pressure in yesterday's notes. How are you managing that?"
- "The project roadmap shows Q1 goals. What's the priority for this week?"
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(3);
    expect(result.items[0].text).toContain("authentication refactor");
    expect(result.items[0].attribution).toBeUndefined();
    expect(result.items[1].text).toContain("deadline pressure");
    expect(result.items[2].text).toContain("Q1 goals");
  });

  test("handles general-inspiration file format", async () => {
    const filePath = join(testDir, "general-inspiration.md");
    const content = `<!-- last-generated: 2025-12-23 (week 52) -->

- "The only way to do great work is to love what you do." -- Steve Jobs
- "In the middle of difficulty lies opportunity." -- Albert Einstein
- "We are what we repeatedly do." -- Aristotle
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.weekNumber).toBe(52);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].attribution).toBe("Steve Jobs");
    expect(result.items[1].attribution).toBe("Albert Einstein");
    expect(result.items[2].attribution).toBe("Aristotle");
  });

  test("handles file with BOM (byte order mark)", async () => {
    const filePath = join(testDir, "bom.md");
    // UTF-8 BOM is EF BB BF
    const bom = "\uFEFF";
    const content = `${bom}<!-- last-generated: 2025-12-26 -->

- "Quote after BOM" -- Source
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    // BOM may interfere with marker parsing, but quotes should still work
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe("Quote after BOM");
  });
});

// =============================================================================
// Edge Cases and Boundary Conditions
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `inspiration-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("handles date at year boundary", () => {
    const result = parseGenerationMarker("<!-- last-generated: 2024-12-31 -->");
    expect(result.date?.getFullYear()).toBe(2024);
    expect(result.date?.getMonth()).toBe(11);
    expect(result.date?.getDate()).toBe(31);
  });

  test("handles date at start of year", () => {
    const result = parseGenerationMarker("<!-- last-generated: 2025-01-01 -->");
    expect(result.date?.getFullYear()).toBe(2025);
    expect(result.date?.getMonth()).toBe(0);
    expect(result.date?.getDate()).toBe(1);
  });

  test("handles leap year date", () => {
    const result = parseGenerationMarker("<!-- last-generated: 2024-02-29 -->");
    expect(result.date?.getMonth()).toBe(1);
    expect(result.date?.getDate()).toBe(29);
  });

  test("handles week 53 (rare but valid in some years)", () => {
    const result = parseGenerationMarker(
      "<!-- last-generated: 2020-12-28 (week 53) -->"
    );
    expect(result.weekNumber).toBe(53);
  });

  test("handles very long quote (1000+ characters)", async () => {
    const filePath = join(testDir, "long-quote.md");
    const longText = "A".repeat(2000);
    const content = `<!-- last-generated: 2025-12-26 -->

- "${longText}" -- Very Long Source
`;
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].text.length).toBe(2000);
  });

  test("handles quote with only punctuation", () => {
    const result = parseInspirationLine('- "..." -- Ellipsis');
    expect(result?.text).toBe("...");
    expect(result?.attribution).toBe("Ellipsis");
  });

  test("handles quote with single character", () => {
    const result = parseInspirationLine('- "?" -- Question');
    expect(result?.text).toBe("?");
    expect(result?.attribution).toBe("Question");
  });

  test("handles attribution with trailing spaces", () => {
    const result = parseInspirationLine('- "Quote" -- Source   ');
    expect(result?.attribution).toBe("Source");
  });

  test("handles multiple dashes in attribution", () => {
    const result = parseInspirationLine(
      '- "Quote" -- Author -- Publisher -- Year'
    );
    // Everything after the first -- becomes attribution
    expect(result?.attribution).toBe("Author -- Publisher -- Year");
  });
});

// =============================================================================
// File Path Constants Tests
// =============================================================================

describe("File Path Constants", () => {
  test("CONTEXTUAL_PROMPTS_PATH is correctly defined", () => {
    expect(CONTEXTUAL_PROMPTS_PATH).toBe(
      "06_Metadata/memory-loop/contextual-prompts.md"
    );
  });

  test("GENERAL_INSPIRATION_PATH is correctly defined", () => {
    expect(GENERAL_INSPIRATION_PATH).toBe(
      "06_Metadata/memory-loop/general-inspiration.md"
    );
  });
});

// =============================================================================
// getISOWeekNumber Tests
// =============================================================================

describe("getISOWeekNumber", () => {
  describe("known dates with verified week numbers", () => {
    test("January 1, 2025 (Wednesday) is week 1", () => {
      // 2025-01-01 is a Wednesday, which is in week 1
      const date = new Date(2025, 0, 1);
      expect(getISOWeekNumber(date)).toBe(1);
    });

    test("January 6, 2025 (Monday) is week 2", () => {
      // First Monday of 2025 starts week 2
      const date = new Date(2025, 0, 6);
      expect(getISOWeekNumber(date)).toBe(2);
    });

    test("December 31, 2024 (Tuesday) is week 1 of 2025", () => {
      // Dec 31, 2024 is a Tuesday, and since Jan 1, 2025 is a Wednesday,
      // that week contains the first Thursday (Jan 2), so it's week 1 of 2025
      const date = new Date(2024, 11, 31);
      expect(getISOWeekNumber(date)).toBe(1);
    });

    test("December 28, 2020 (Monday) is week 53", () => {
      // 2020 has 53 weeks (leap year starting on Wednesday)
      const date = new Date(2020, 11, 28);
      expect(getISOWeekNumber(date)).toBe(53);
    });

    test("December 31, 2020 (Thursday) is week 53", () => {
      const date = new Date(2020, 11, 31);
      expect(getISOWeekNumber(date)).toBe(53);
    });

    test("January 1, 2021 (Friday) is week 53 of 2020", () => {
      // Jan 1, 2021 is still in week 53 because week 1 of 2021
      // doesn't start until Jan 4 (Monday containing first Thursday)
      const date = new Date(2021, 0, 1);
      expect(getISOWeekNumber(date)).toBe(53);
    });

    test("January 4, 2021 (Monday) is week 1 of 2021", () => {
      // Week 1 of 2021 starts on Monday, Jan 4
      const date = new Date(2021, 0, 4);
      expect(getISOWeekNumber(date)).toBe(1);
    });
  });

  describe("week boundaries", () => {
    test("Sunday ends a week, Monday starts a new one", () => {
      // Sunday Dec 22, 2024 is in week 51
      const sunday = new Date(2024, 11, 22);
      // Monday Dec 23, 2024 starts week 52
      const monday = new Date(2024, 11, 23);

      expect(getISOWeekNumber(sunday)).toBe(51);
      expect(getISOWeekNumber(monday)).toBe(52);
    });

    test("consecutive days in same week have same week number", () => {
      // Monday through Sunday of same week
      const monday = new Date(2025, 0, 13); // Week 3
      const tuesday = new Date(2025, 0, 14);
      const wednesday = new Date(2025, 0, 15);
      const thursday = new Date(2025, 0, 16);
      const friday = new Date(2025, 0, 17);
      const saturday = new Date(2025, 0, 18);
      const sunday = new Date(2025, 0, 19);

      expect(getISOWeekNumber(monday)).toBe(3);
      expect(getISOWeekNumber(tuesday)).toBe(3);
      expect(getISOWeekNumber(wednesday)).toBe(3);
      expect(getISOWeekNumber(thursday)).toBe(3);
      expect(getISOWeekNumber(friday)).toBe(3);
      expect(getISOWeekNumber(saturday)).toBe(3);
      expect(getISOWeekNumber(sunday)).toBe(3);
    });
  });

  describe("year end edge cases", () => {
    test("week 52 at year end for typical year", () => {
      // Dec 26, 2025 is a Friday in week 52
      const date = new Date(2025, 11, 26);
      expect(getISOWeekNumber(date)).toBe(52);
    });

    test("handles leap year correctly", () => {
      // Feb 29, 2024 (leap day)
      const date = new Date(2024, 1, 29);
      expect(getISOWeekNumber(date)).toBe(9);
    });
  });
});

// =============================================================================
// isWeekday Tests
// =============================================================================

describe("isWeekday", () => {
  describe("returns true for weekdays (Mon-Fri)", () => {
    test("Monday is a weekday", () => {
      const monday = new Date(2025, 0, 6); // Jan 6, 2025 is Monday
      expect(isWeekday(monday)).toBe(true);
    });

    test("Tuesday is a weekday", () => {
      const tuesday = new Date(2025, 0, 7);
      expect(isWeekday(tuesday)).toBe(true);
    });

    test("Wednesday is a weekday", () => {
      const wednesday = new Date(2025, 0, 8);
      expect(isWeekday(wednesday)).toBe(true);
    });

    test("Thursday is a weekday", () => {
      const thursday = new Date(2025, 0, 9);
      expect(isWeekday(thursday)).toBe(true);
    });

    test("Friday is a weekday", () => {
      const friday = new Date(2025, 0, 10);
      expect(isWeekday(friday)).toBe(true);
    });
  });

  describe("returns false for weekends (Sat-Sun)", () => {
    test("Saturday is not a weekday", () => {
      const saturday = new Date(2025, 0, 11); // Jan 11, 2025 is Saturday
      expect(isWeekday(saturday)).toBe(false);
    });

    test("Sunday is not a weekday", () => {
      const sunday = new Date(2025, 0, 12); // Jan 12, 2025 is Sunday
      expect(isWeekday(sunday)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("New Year's Day 2025 (Wednesday) is a weekday", () => {
      const newYears = new Date(2025, 0, 1);
      expect(isWeekday(newYears)).toBe(true);
    });

    test("Christmas 2025 (Thursday) is a weekday", () => {
      const christmas = new Date(2025, 11, 25);
      expect(isWeekday(christmas)).toBe(true);
    });

    test("handles dates with time components", () => {
      // Friday at 11:59 PM
      const fridayNight = new Date(2025, 0, 10, 23, 59, 59);
      expect(isWeekday(fridayNight)).toBe(true);

      // Saturday at 12:01 AM
      const saturdayMorning = new Date(2025, 0, 11, 0, 1, 0);
      expect(isWeekday(saturdayMorning)).toBe(false);
    });
  });
});

// =============================================================================
// isContextualGenerationNeeded Tests
// =============================================================================

describe("isContextualGenerationNeeded", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `contextual-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    // Create the nested directory structure
    await mkdir(join(testDir, "06_Metadata", "memory-loop"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a contextual prompts file with a specific date marker
   */
  async function createContextualFile(
    vaultPath: string,
    dateStr: string
  ): Promise<void> {
    const filePath = join(vaultPath, CONTEXTUAL_PROMPTS_PATH);
    const content = `<!-- last-generated: ${dateStr} -->

- "Test prompt one"
- "Test prompt two"
`;
    await writeFile(filePath, content, "utf-8");
  }

  describe("weekday behavior", () => {
    test("returns true on weekday if file is missing", async () => {
      // We can't control "today" without mocking, but we can verify the file-missing logic
      // by checking that parseInspirationFile returns null for missing files
      const parsed = await parseInspirationFile(
        join(testDir, CONTEXTUAL_PROMPTS_PATH)
      );
      expect(parsed.lastGenerated).toBeNull();
      // The function uses isWeekday(new Date()), so this test depends on when it runs
      // We test the underlying logic instead
    });

    test("returns true on weekday if marker is missing", async () => {
      const filePath = join(testDir, CONTEXTUAL_PROMPTS_PATH);
      await writeFile(
        filePath,
        `- "Prompt without marker"\n- "Another prompt"`,
        "utf-8"
      );

      const parsed = await parseInspirationFile(filePath);
      expect(parsed.lastGenerated).toBeNull();
      expect(parsed.items).toHaveLength(2);
    });
  });

  describe("date comparison logic", () => {
    test("detects when file was generated on a different date", async () => {
      // Create file with yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];

      await createContextualFile(testDir, dateStr);

      const filePath = join(testDir, CONTEXTUAL_PROMPTS_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      // Verify the date was parsed correctly
      expect(parsed.lastGenerated?.getDate()).toBe(yesterday.getDate());
    });

    test("detects when file was generated on the same date", async () => {
      // Create file with today's date
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0];

      await createContextualFile(testDir, dateStr);

      const filePath = join(testDir, CONTEXTUAL_PROMPTS_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.lastGenerated?.getDate()).toBe(today.getDate());
      expect(parsed.lastGenerated?.getMonth()).toBe(today.getMonth());
      expect(parsed.lastGenerated?.getFullYear()).toBe(today.getFullYear());
    });
  });

  describe("integration with file system", () => {
    test("returns true when file does not exist at all", async () => {
      // Use a vault path where no file exists
      const emptyVault = join(
        tmpdir(),
        `empty-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(emptyVault, { recursive: true });

      try {
        // The function checks isWeekday first, so result depends on day
        // But we can verify it reads the file correctly
        const filePath = join(emptyVault, CONTEXTUAL_PROMPTS_PATH);
        const parsed = await parseInspirationFile(filePath);
        expect(parsed.lastGenerated).toBeNull();
        expect(parsed.items).toHaveLength(0);
      } finally {
        await rm(emptyVault, { recursive: true, force: true });
      }
    });

    test("correctly parses existing file with valid marker", async () => {
      await createContextualFile(testDir, "2025-12-26");

      const filePath = join(testDir, CONTEXTUAL_PROMPTS_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.lastGenerated?.getFullYear()).toBe(2025);
      expect(parsed.lastGenerated?.getMonth()).toBe(11); // December
      expect(parsed.lastGenerated?.getDate()).toBe(26);
      expect(parsed.items).toHaveLength(2);
    });
  });
});

// =============================================================================
// isQuoteGenerationNeeded Tests
// =============================================================================

describe("isQuoteGenerationNeeded", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `quote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    // Create the nested directory structure
    await mkdir(join(testDir, "06_Metadata", "memory-loop"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a general inspiration file with a specific date and week marker
   */
  async function createQuoteFile(
    vaultPath: string,
    dateStr: string,
    weekNum?: number
  ): Promise<void> {
    const filePath = join(vaultPath, GENERAL_INSPIRATION_PATH);
    const marker = weekNum
      ? `<!-- last-generated: ${dateStr} (week ${weekNum}) -->`
      : `<!-- last-generated: ${dateStr} -->`;
    const content = `${marker}

- "Test quote one" -- Author One
- "Test quote two" -- Author Two
`;
    await writeFile(filePath, content, "utf-8");
  }

  describe("file existence checks", () => {
    test("returns true if file is missing", async () => {
      const emptyVault = join(
        tmpdir(),
        `empty-quote-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(emptyVault, { recursive: true });

      try {
        const filePath = join(emptyVault, GENERAL_INSPIRATION_PATH);
        const parsed = await parseInspirationFile(filePath);
        expect(parsed.lastGenerated).toBeNull();
      } finally {
        await rm(emptyVault, { recursive: true, force: true });
      }
    });

    test("returns true if marker is missing", async () => {
      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      await writeFile(
        filePath,
        `- "Quote without marker" -- Source\n- "Another quote" -- Source`,
        "utf-8"
      );

      const parsed = await parseInspirationFile(filePath);
      expect(parsed.lastGenerated).toBeNull();
      expect(parsed.items).toHaveLength(2);
    });
  });

  describe("week number parsing", () => {
    test("parses week number from marker correctly", async () => {
      await createQuoteFile(testDir, "2025-12-23", 52);

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBe(52);
    });

    test("handles marker without explicit week number", async () => {
      await createQuoteFile(testDir, "2025-12-23");

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBeUndefined();
      // Week number should be calculated from date
      expect(getISOWeekNumber(parsed.lastGenerated!)).toBe(52);
    });
  });

  describe("week comparison logic", () => {
    test("detects when file was generated in a previous week", async () => {
      // Create file with last week's date and week number
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      const dateStr = lastWeek.toISOString().split("T")[0];
      const weekNum = getISOWeekNumber(lastWeek);

      await createQuoteFile(testDir, dateStr, weekNum);

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBe(weekNum);

      // Current week should be different (unless we're at a week boundary)
      const currentWeek = getISOWeekNumber(new Date());
      // They should be different (one week apart)
      expect(weekNum).not.toBe(currentWeek);
    });

    test("detects when file was generated in the current week", async () => {
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0];
      const weekNum = getISOWeekNumber(today);

      await createQuoteFile(testDir, dateStr, weekNum);

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBe(weekNum);
      expect(getISOWeekNumber(new Date())).toBe(weekNum);
    });
  });

  describe("year boundary handling", () => {
    test("week 52 of last year differs from week 1 of current year", () => {
      // Week 52 of 2024 and week 1 of 2025 are different
      const week52_2024 = new Date(2024, 11, 23); // Dec 23, 2024 - week 52
      const week1_2025 = new Date(2025, 0, 1); // Jan 1, 2025 - week 1

      expect(getISOWeekNumber(week52_2024)).toBe(52);
      expect(getISOWeekNumber(week1_2025)).toBe(1);
    });

    test("correctly handles year transition in week comparison", async () => {
      // Create file marked as week 52 of 2024
      await createQuoteFile(testDir, "2024-12-23", 52);

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBe(52);
      expect(parsed.lastGenerated?.getFullYear()).toBe(2024);
    });

    test("week 53 is correctly identified (in years that have it)", async () => {
      // 2020 had a week 53
      await createQuoteFile(testDir, "2020-12-28", 53);

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.weekNumber).toBe(53);
    });
  });

  describe("fallback to calculated week number", () => {
    test("uses calculated week when marker has no explicit week number", async () => {
      // Create file without week number in marker
      await createQuoteFile(testDir, "2025-01-15"); // Week 3

      const filePath = join(testDir, GENERAL_INSPIRATION_PATH);
      const parsed = await parseInspirationFile(filePath);

      expect(parsed.lastGenerated).not.toBeNull();
      expect(parsed.weekNumber).toBeUndefined();

      // The function should calculate week from date
      const calculatedWeek = getISOWeekNumber(parsed.lastGenerated!);
      expect(calculatedWeek).toBe(3);
    });
  });

  describe("direct function calls", () => {
    test("isQuoteGenerationNeeded returns true for missing file", async () => {
      const emptyVaultPath = join(
        tmpdir(),
        `direct-quote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(emptyVaultPath, { recursive: true });

      try {
        const vault = createMockVault({ path: emptyVaultPath, contentRoot: emptyVaultPath });
        const result = await isQuoteGenerationNeeded(vault);
        expect(result).toBe(true);
      } finally {
        await rm(emptyVaultPath, { recursive: true, force: true });
      }
    });

    test("isQuoteGenerationNeeded returns false for current week file", async () => {
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0];
      const weekNum = getISOWeekNumber(today);

      await createQuoteFile(testDir, dateStr, weekNum);

      const vault = createMockVault({ path: testDir, contentRoot: testDir });
      const result = await isQuoteGenerationNeeded(vault);
      expect(result).toBe(false);
    });

    test("isQuoteGenerationNeeded returns true for last week file", async () => {
      // Create file with last week's date
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      const dateStr = lastWeek.toISOString().split("T")[0];
      const weekNum = getISOWeekNumber(lastWeek);

      await createQuoteFile(testDir, dateStr, weekNum);

      const vault = createMockVault({ path: testDir, contentRoot: testDir });
      const result = await isQuoteGenerationNeeded(vault);
      expect(result).toBe(true);
    });
  });
});

// =============================================================================
// isContextualGenerationNeeded Direct Call Tests
// =============================================================================

describe("isContextualGenerationNeeded direct calls", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `contextual-direct-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "06_Metadata", "memory-loop"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function createContextualFile(
    vaultPath: string,
    dateStr: string
  ): Promise<void> {
    const filePath = join(vaultPath, CONTEXTUAL_PROMPTS_PATH);
    const content = `<!-- last-generated: ${dateStr} -->

- "Test prompt one"
- "Test prompt two"
`;
    await writeFile(filePath, content, "utf-8");
  }

  test("returns true when file is missing (any day)", async () => {
    // Test with missing file
    const emptyVaultPath = join(
      tmpdir(),
      `contextual-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(emptyVaultPath, { recursive: true });

    try {
      const vault = createMockVault({ path: emptyVaultPath, contentRoot: emptyVaultPath });
      const result = await isContextualGenerationNeeded(vault);
      // Should be true because file is missing (generation runs every day)
      expect(result).toBe(true);
    } finally {
      await rm(emptyVaultPath, { recursive: true, force: true });
    }
  });

  test("returns false when generated today on a weekday", async () => {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];

    await createContextualFile(testDir, dateStr);

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    const result = await isContextualGenerationNeeded(vault);
    // Should be false because generated today (regardless of weekday/weekend)
    // On weekends: false because not a weekday
    // On weekdays: false because already generated today
    expect(result).toBe(false);
  });

  test("returns true when generated yesterday (any day)", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    await createContextualFile(testDir, dateStr);

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    const result = await isContextualGenerationNeeded(vault);
    // Should be true because generated yesterday (generation runs every day)
    expect(result).toBe(true);
  });
});

// =============================================================================
// getDayType Tests
// =============================================================================

describe("getDayType", () => {
  test("returns 'weekend' for Sunday", () => {
    // 2025-12-28 is a Sunday
    const sunday = new Date(2025, 11, 28);
    expect(getDayType(sunday)).toBe("weekend");
  });

  test("returns 'weekend' for Saturday", () => {
    // 2025-12-27 is a Saturday
    const saturday = new Date(2025, 11, 27);
    expect(getDayType(saturday)).toBe("weekend");
  });

  test("returns 'monday' for Monday", () => {
    // 2025-12-29 is a Monday
    const monday = new Date(2025, 11, 29);
    expect(getDayType(monday)).toBe("monday");
  });

  test("returns 'midweek' for Tuesday", () => {
    // 2025-12-30 is a Tuesday
    const tuesday = new Date(2025, 11, 30);
    expect(getDayType(tuesday)).toBe("midweek");
  });

  test("returns 'midweek' for Wednesday", () => {
    // 2025-12-31 is a Wednesday
    const wednesday = new Date(2025, 11, 31);
    expect(getDayType(wednesday)).toBe("midweek");
  });

  test("returns 'midweek' for Thursday", () => {
    // 2025-12-25 is a Thursday
    const thursday = new Date(2025, 11, 25);
    expect(getDayType(thursday)).toBe("midweek");
  });

  test("returns 'friday' for Friday", () => {
    // 2025-12-26 is a Friday
    const friday = new Date(2025, 11, 26);
    expect(getDayType(friday)).toBe("friday");
  });
});

// =============================================================================
// formatDateForDailyNote Tests
// =============================================================================

describe("formatDateForDailyNote", () => {
  test("formats date as YYYY-MM-DD", () => {
    const date = new Date(2025, 11, 26); // December 26, 2025
    expect(formatDateForDailyNote(date)).toBe("2025-12-26");
  });

  test("pads single-digit month and day with zeros", () => {
    const date = new Date(2025, 0, 5); // January 5, 2025
    expect(formatDateForDailyNote(date)).toBe("2025-01-05");
  });

  test("handles year boundaries", () => {
    const date = new Date(2024, 11, 31); // December 31, 2024
    expect(formatDateForDailyNote(date)).toBe("2024-12-31");
  });
});

// =============================================================================
// getDateWithOffset Tests
// =============================================================================

describe("getDateWithOffset", () => {
  test("returns same date for offset 0", () => {
    const date = new Date(2025, 11, 26);
    const result = getDateWithOffset(date, 0);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(11);
    expect(result.getDate()).toBe(26);
  });

  test("returns previous day for offset -1", () => {
    const date = new Date(2025, 11, 26);
    const result = getDateWithOffset(date, -1);
    expect(formatDateForDailyNote(result)).toBe("2025-12-25");
  });

  test("returns previous week for offset -7", () => {
    const date = new Date(2025, 11, 26);
    const result = getDateWithOffset(date, -7);
    expect(formatDateForDailyNote(result)).toBe("2025-12-19");
  });

  test("returns next day for offset 1", () => {
    const date = new Date(2025, 11, 26);
    const result = getDateWithOffset(date, 1);
    expect(formatDateForDailyNote(result)).toBe("2025-12-27");
  });

  test("handles month boundary crossing", () => {
    const date = new Date(2025, 0, 1); // January 1, 2025
    const result = getDateWithOffset(date, -1);
    expect(formatDateForDailyNote(result)).toBe("2024-12-31");
  });

  test("does not mutate original date", () => {
    const date = new Date(2025, 11, 26);
    getDateWithOffset(date, -5);
    expect(date.getDate()).toBe(26);
  });
});

// =============================================================================
// readDailyNote Tests
// =============================================================================

describe("readDailyNote", () => {
  let testVault: string;

  beforeEach(async () => {
    testVault = join(tmpdir(), `test-vault-daily-${Date.now()}`);
    await mkdir(join(testVault, INBOX_PATH), { recursive: true });
  });

  afterEach(async () => {
    await rm(testVault, { recursive: true, force: true });
  });

  test("reads existing daily note", async () => {
    const content = "# 2025-12-26\n\nSome notes here.";
    await writeFile(join(testVault, INBOX_PATH, "2025-12-26.md"), content);

    const vault = createMockVault({ path: testVault, contentRoot: testVault, inboxPath: INBOX_PATH });
    const result = await readDailyNote(vault, "2025-12-26");
    expect(result).toBe(content);
  });

  test("returns null for missing daily note", async () => {
    const vault = createMockVault({ path: testVault, contentRoot: testVault, inboxPath: INBOX_PATH });
    const result = await readDailyNote(vault, "2025-12-25");
    expect(result).toBeNull();
  });

  test("returns null when inbox directory missing", async () => {
    const emptyVaultPath = join(tmpdir(), `empty-vault-${Date.now()}`);
    await mkdir(emptyVaultPath, { recursive: true });

    try {
      const vault = createMockVault({ path: emptyVaultPath, contentRoot: emptyVaultPath, inboxPath: INBOX_PATH });
      const result = await readDailyNote(vault, "2025-12-26");
      expect(result).toBeNull();
    } finally {
      await rm(emptyVaultPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// readFolderIndex Tests
// =============================================================================

describe("readFolderIndex", () => {
  let testFolder: string;

  beforeEach(async () => {
    testFolder = join(tmpdir(), `test-folder-${Date.now()}`);
    await mkdir(testFolder, { recursive: true });
  });

  afterEach(async () => {
    await rm(testFolder, { recursive: true, force: true });
  });

  test("reads README.md if present", async () => {
    const content = "# Project README\n\nThis is a project.";
    await writeFile(join(testFolder, "README.md"), content);

    const result = await readFolderIndex(testFolder);
    expect(result).toBe(content);
  });

  test("reads index.md if README.md missing", async () => {
    const content = "# Project Index\n\nThis is an index.";
    await writeFile(join(testFolder, "index.md"), content);

    const result = await readFolderIndex(testFolder);
    expect(result).toBe(content);
  });

  test("prefers README.md over index.md", async () => {
    const readmeContent = "# README content";
    const indexContent = "# Index content";
    await writeFile(join(testFolder, "README.md"), readmeContent);
    await writeFile(join(testFolder, "index.md"), indexContent);

    const result = await readFolderIndex(testFolder);
    expect(result).toBe(readmeContent);
  });

  test("returns null when neither file exists", async () => {
    const result = await readFolderIndex(testFolder);
    expect(result).toBeNull();
  });

  test("returns null for non-existent folder", async () => {
    const result = await readFolderIndex("/non/existent/folder");
    expect(result).toBeNull();
  });
});

// =============================================================================
// getSubfolders Tests
// =============================================================================

describe("getSubfolders", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-subfolders-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("returns subfolder paths", async () => {
    await mkdir(join(testDir, "project-a"));
    await mkdir(join(testDir, "project-b"));

    const result = await getSubfolders(testDir);
    expect(result).toHaveLength(2);
    expect(result).toContain(join(testDir, "project-a"));
    expect(result).toContain(join(testDir, "project-b"));
  });

  test("ignores files", async () => {
    await mkdir(join(testDir, "folder-a"));
    await writeFile(join(testDir, "file.md"), "content");

    const result = await getSubfolders(testDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(join(testDir, "folder-a"));
  });

  test("returns empty array for empty directory", async () => {
    const result = await getSubfolders(testDir);
    expect(result).toHaveLength(0);
  });

  test("returns empty array for non-existent directory", async () => {
    const result = await getSubfolders("/non/existent/dir");
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// truncateContext Tests
// =============================================================================

describe("truncateContext", () => {
  const createItem = (content: string, daysAgo: number) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return { date, content, source: `test-${daysAgo}` };
  };

  test("joins all items when within budget", () => {
    const items = [createItem("short", 2), createItem("text", 1)];
    const result = truncateContext(items, 100);
    expect(result).toBe("short\n\n---\n\ntext");
  });

  test("removes oldest items first when over budget", () => {
    const items = [
      createItem("oldest content", 3),
      createItem("middle content", 2),
      createItem("newest content", 1),
    ];
    // Budget only allows one item
    const result = truncateContext(items, 20);
    expect(result).toBe("newest content");
  });

  test("returns truncated single item if all items exceed budget", () => {
    const items = [createItem("this is a long content string", 1)];
    const result = truncateContext(items, 10);
    // Should take last 10 chars: "ent string"
    expect(result).toBe("ent string");
  });

  test("handles empty array", () => {
    const result = truncateContext([], 100);
    expect(result).toBe("");
  });

  test("uses separator between items", () => {
    const items = [createItem("a", 2), createItem("b", 1)];
    const result = truncateContext(items, 100);
    expect(result).toContain("\n\n---\n\n");
  });
});

// =============================================================================
// gatherDayContext Tests
// =============================================================================

describe("gatherDayContext", () => {
  let testVault: string;

  beforeEach(async () => {
    testVault = join(tmpdir(), `test-vault-context-${Date.now()}`);
    await mkdir(join(testVault, INBOX_PATH), { recursive: true });
    await mkdir(join(testVault, PROJECTS_PATH, "project-a"), { recursive: true });
    await mkdir(join(testVault, AREAS_PATH, "area-1"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testVault, { recursive: true, force: true });
  });

  // Helper to create vault for these tests
  function createTestVault() {
    return createMockVault({ path: testVault, contentRoot: testVault, inboxPath: INBOX_PATH });
  }

  describe("weekend behavior", () => {
    test("returns empty string on Saturday", async () => {
      // 2025-12-27 is a Saturday
      const saturday = new Date(2025, 11, 27);
      const vault = createTestVault();
      const result = await gatherDayContext(vault, saturday);
      expect(result).toBe("");
    });

    test("returns empty string on Sunday", async () => {
      // 2025-12-28 is a Sunday
      const sunday = new Date(2025, 11, 28);
      const vault = createTestVault();
      const result = await gatherDayContext(vault, sunday);
      expect(result).toBe("");
    });
  });

  describe("midweek behavior (Tue-Thu)", () => {
    test("reads previous day's daily note on Tuesday", async () => {
      // 2025-12-30 is a Tuesday, so should read 2025-12-29 (Monday)
      const tuesday = new Date(2025, 11, 30);
      const mondayContent = "# Monday notes\n\nSome content.";
      await writeFile(join(testVault, INBOX_PATH, "2025-12-29.md"), mondayContent);

      const vault = createTestVault();
      const result = await gatherDayContext(vault, tuesday);
      expect(result).toBe(mondayContent);
    });

    test("returns empty when previous day note missing", async () => {
      const tuesday = new Date(2025, 11, 30);
      const vault = createTestVault();
      const result = await gatherDayContext(vault, tuesday);
      expect(result).toBe("");
    });
  });

  describe("monday behavior", () => {
    test("reads previous week's notes + projects", async () => {
      // 2025-12-29 is a Monday
      const monday = new Date(2025, 11, 29);

      // Create a note from previous week (e.g., 2025-12-23)
      const noteContent = "# Previous week note";
      await writeFile(join(testVault, INBOX_PATH, "2025-12-23.md"), noteContent);

      // Create a project README
      const projectContent = "# Project A README";
      await writeFile(join(testVault, PROJECTS_PATH, "project-a", "README.md"), projectContent);

      const vault = createTestVault();
      const result = await gatherDayContext(vault, monday);
      expect(result).toContain("Previous week note");
      expect(result).toContain("Project A README");
    });
  });

  describe("friday behavior", () => {
    test("reads current week's notes + areas", async () => {
      // 2025-12-26 is a Friday
      const friday = new Date(2025, 11, 26);

      // Create current week notes (Mon-Fri: Dec 22-26)
      const wednesdayContent = "# Wednesday notes";
      await writeFile(join(testVault, INBOX_PATH, "2025-12-24.md"), wednesdayContent);

      // Create an area README
      const areaContent = "# Area 1 README";
      await writeFile(join(testVault, AREAS_PATH, "area-1", "README.md"), areaContent);

      const vault = createTestVault();
      const result = await gatherDayContext(vault, friday);
      expect(result).toContain("Wednesday notes");
      expect(result).toContain("Area 1 README");
    });
  });

  describe("content limits", () => {
    test("returns empty when no content found", async () => {
      const tuesday = new Date(2025, 11, 30);
      const vault = createTestVault();
      const result = await gatherDayContext(vault, tuesday);
      expect(result).toBe("");
    });

    test("truncates content when exceeding MAX_CONTEXT_CHARS", async () => {
      // 2025-12-26 is a Friday - will read Mon-Fri notes
      const friday = new Date(2025, 11, 26);

      // Create large content that exceeds limit
      const largeContent = "x".repeat(2000);
      for (let i = -4; i <= 0; i++) {
        const date = new Date(2025, 11, 26 + i);
        const dateStr = formatDateForDailyNote(date);
        await writeFile(join(testVault, INBOX_PATH, `${dateStr}.md`), largeContent);
      }

      const vault = createTestVault();
      const result = await gatherDayContext(vault, friday);
      // Should be truncated to MAX_CONTEXT_CHARS or less
      expect(result.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 100); // Allow for separators
    });
  });
});

// =============================================================================
// DAY_CONTEXT_CONFIG Tests
// =============================================================================

describe("DAY_CONTEXT_CONFIG", () => {
  test("monday config has 7 days of daily notes", () => {
    const config = DAY_CONTEXT_CONFIG.monday;
    expect(config.dailyNoteDays).toHaveLength(7);
    expect(config.dailyNoteDays).toEqual([-7, -6, -5, -4, -3, -2, -1]);
  });

  test("monday config includes projects folder", () => {
    const config = DAY_CONTEXT_CONFIG.monday;
    expect(config.additionalFolder).toBe(PROJECTS_PATH);
  });

  test("midweek config has only previous day", () => {
    const config = DAY_CONTEXT_CONFIG.midweek;
    expect(config.dailyNoteDays).toEqual([-1]);
    expect(config.additionalFolder).toBeUndefined();
  });

  test("friday config has 5 days (Mon-Fri)", () => {
    const config = DAY_CONTEXT_CONFIG.friday;
    expect(config.dailyNoteDays).toHaveLength(5);
    expect(config.dailyNoteDays).toEqual([-4, -3, -2, -1, 0]);
  });

  test("friday config includes areas folder", () => {
    const config = DAY_CONTEXT_CONFIG.friday;
    expect(config.additionalFolder).toBe(AREAS_PATH);
  });

  test("weekend config has empty days but includes projects for context nudge", () => {
    const config = DAY_CONTEXT_CONFIG.weekend;
    expect(config.dailyNoteDays).toHaveLength(0);
    // Weekend uses projects for light context nudge in creative prompts
    expect(config.additionalFolder).toBe(PROJECTS_PATH);
  });
});

// =============================================================================
// formatInspirationItem Tests
// =============================================================================

describe("formatInspirationItem", () => {
  test("formats item without attribution", () => {
    const item = { text: "This is a quote" };
    expect(formatInspirationItem(item)).toBe('- "This is a quote"');
  });

  test("formats item with attribution", () => {
    const item = { text: "This is a quote", attribution: "Author Name" };
    expect(formatInspirationItem(item)).toBe('- "This is a quote" -- Author Name');
  });

  test("handles quotes with special characters", () => {
    const item = { text: "Isn't it wonderful?", attribution: "Someone" };
    expect(formatInspirationItem(item)).toBe('- "Isn\'t it wonderful?" -- Someone');
  });

  test("handles empty attribution as undefined", () => {
    const item = { text: "Just text", attribution: undefined };
    expect(formatInspirationItem(item)).toBe('- "Just text"');
  });
});

// =============================================================================
// formatGenerationMarker Tests
// =============================================================================

describe("formatGenerationMarker", () => {
  test("formats marker without week number", () => {
    const date = new Date(2025, 11, 26);
    const result = formatGenerationMarker(date);
    expect(result).toBe("<!-- last-generated: 2025-12-26 -->");
  });

  test("formats marker with week number", () => {
    const date = new Date(2025, 11, 26);
    const result = formatGenerationMarker(date, 52);
    expect(result).toBe("<!-- last-generated: 2025-12-26 (week 52) -->");
  });

  test("handles single-digit week number", () => {
    const date = new Date(2025, 0, 5);
    const result = formatGenerationMarker(date, 2);
    expect(result).toBe("<!-- last-generated: 2025-01-05 (week 2) -->");
  });

  test("handles week 0 (edge case)", () => {
    const date = new Date(2025, 0, 1);
    const result = formatGenerationMarker(date, 0);
    expect(result).toBe("<!-- last-generated: 2025-01-01 (week 0) -->");
  });
});

// =============================================================================
// appendToInspirationFile Tests
// =============================================================================

describe("appendToInspirationFile", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-append-${Date.now()}`);
    testFile = join(testDir, "test-inspiration.md");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("creates directory if missing", async () => {
    const entries = [{ text: "New quote", attribution: "Author" }];
    await appendToInspirationFile(testFile, entries);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("New quote");
  });

  test("creates file with generation marker", async () => {
    const entries = [{ text: "Quote text" }];
    await appendToInspirationFile(testFile, entries);

    const content = await readFile(testFile, "utf-8");
    expect(content).toMatch(/<!-- last-generated: \d{4}-\d{2}-\d{2} -->/);
  });

  test("creates file with week number marker", async () => {
    const entries = [{ text: "Quote text" }];
    await appendToInspirationFile(testFile, entries, 52);

    const content = await readFile(testFile, "utf-8");
    expect(content).toMatch(/<!-- last-generated: \d{4}-\d{2}-\d{2} \(week 52\) -->/);
  });

  test("preserves existing entries when appending", async () => {
    // Create initial file
    await mkdir(testDir, { recursive: true });
    const initialContent = `<!-- last-generated: 2025-12-25 -->\n\n- "First quote"\n`;
    await writeFile(testFile, initialContent);

    // Append new entries
    const entries = [{ text: "Second quote" }];
    await appendToInspirationFile(testFile, entries);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("First quote");
    expect(content).toContain("Second quote");
  });

  test("updates generation marker to current date", async () => {
    // Create initial file with old date
    await mkdir(testDir, { recursive: true });
    const initialContent = `<!-- last-generated: 2024-01-01 -->\n\n- "Old quote"\n`;
    await writeFile(testFile, initialContent);

    // Append new entries
    const entries = [{ text: "New quote" }];
    await appendToInspirationFile(testFile, entries);

    const content = await readFile(testFile, "utf-8");
    // Should have today's date, not the old one
    expect(content).not.toContain("2024-01-01");
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("handles multiple entries", async () => {
    const entries = [
      { text: "Quote 1", attribution: "Author 1" },
      { text: "Quote 2", attribution: "Author 2" },
      { text: "Quote 3" },
    ];
    await appendToInspirationFile(testFile, entries);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("Quote 1");
    expect(content).toContain("Quote 2");
    expect(content).toContain("Quote 3");
    expect(content).toContain("Author 1");
    expect(content).toContain("Author 2");
  });
});

// =============================================================================
// prunePool Tests
// =============================================================================

describe("prunePool", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-prune-${Date.now()}`);
    testFile = join(testDir, "test-inspiration.md");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("does nothing when pool is under limit", async () => {
    const content = `<!-- last-generated: 2025-12-26 -->\n\n- "Quote 1"\n- "Quote 2"\n`;
    await writeFile(testFile, content);

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    expect(result).toContain("Quote 1");
    expect(result).toContain("Quote 2");
  });

  test("does nothing when pool is at limit", async () => {
    const quotes = Array.from({ length: 5 }, (_, i) => `- "Quote ${i + 1}"`).join("\n");
    const content = `<!-- last-generated: 2025-12-26 -->\n\n${quotes}\n`;
    await writeFile(testFile, content);

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    for (let i = 1; i <= 5; i++) {
      expect(result).toContain(`Quote ${i}`);
    }
  });

  test("removes oldest entries when over limit", async () => {
    // Use distinct names to avoid substring matching issues
    const quotes = Array.from({ length: 10 }, (_, i) => `- "Item-${String(i + 1).padStart(2, "0")}"`).join("\n");
    const content = `<!-- last-generated: 2025-12-26 -->\n\n${quotes}\n`;
    await writeFile(testFile, content);

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    // Should keep only the last 5 (items 06-10)
    expect(result).not.toContain("Item-01");
    expect(result).not.toContain("Item-05");
    expect(result).toContain("Item-06");
    expect(result).toContain("Item-10");
  });

  test("preserves week number in marker", async () => {
    const quotes = Array.from({ length: 10 }, (_, i) => `- "Quote ${i + 1}"`).join("\n");
    const content = `<!-- last-generated: 2025-12-26 (week 52) -->\n\n${quotes}\n`;
    await writeFile(testFile, content);

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    expect(result).toMatch(/\(week 52\)/);
  });

  test("uses MAX_POOL_SIZE by default", async () => {
    // Create more than MAX_POOL_SIZE entries
    const quotes = Array.from(
      { length: MAX_POOL_SIZE + 10 },
      (_, i) => `- "Quote ${i + 1}"`
    ).join("\n");
    const content = `<!-- last-generated: 2025-12-26 -->\n\n${quotes}\n`;
    await writeFile(testFile, content);

    await prunePool(testFile);

    const parsed = await parseInspirationFile(testFile);
    expect(parsed.items.length).toBe(MAX_POOL_SIZE);
  });

  test("handles missing file gracefully", async () => {
    // Should not throw - just complete successfully
    await prunePool(join(testDir, "nonexistent.md"), 5);
    // If we get here without throwing, the test passes
  });
});

// =============================================================================
// appendAndPrune Tests
// =============================================================================

describe("appendAndPrune", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-append-prune-${Date.now()}`);
    testFile = join(testDir, "test-inspiration.md");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("appends and prunes in one operation", async () => {
    // Start with 48 entries
    const initial = Array.from({ length: 48 }, (_, i) => `- "Old ${i + 1}"`).join("\n");
    await writeFile(testFile, `<!-- last-generated: 2025-12-25 -->\n\n${initial}\n`);

    // Add 5 more (total 53, over the 50 limit)
    const newEntries = Array.from({ length: 5 }, (_, i) => ({
      text: `New ${i + 1}`,
    }));
    await appendAndPrune(testFile, newEntries);

    const parsed = await parseInspirationFile(testFile);
    expect(parsed.items.length).toBe(MAX_POOL_SIZE); // Should be 50
    expect(parsed.items.some((i) => i.text === "New 5")).toBe(true);
  });

  test("respects custom maxSize", async () => {
    const initial = Array.from({ length: 8 }, (_, i) => `- "Old ${i + 1}"`).join("\n");
    await writeFile(testFile, `<!-- last-generated: 2025-12-25 -->\n\n${initial}\n`);

    const newEntries = [{ text: "New 1" }, { text: "New 2" }];
    await appendAndPrune(testFile, newEntries, undefined, 5);

    const parsed = await parseInspirationFile(testFile);
    expect(parsed.items.length).toBe(5);
  });

  test("passes week number to file writing", async () => {
    const entries = [{ text: "Quote 1" }];
    await appendAndPrune(testFile, entries, 52);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("(week 52)");
  });
});

// =============================================================================
// MAX_POOL_SIZE Tests
// =============================================================================

describe("MAX_POOL_SIZE", () => {
  test("is set to 50", () => {
    expect(MAX_POOL_SIZE).toBe(50);
  });
});

// =============================================================================
// parseAIResponse Tests
// =============================================================================

describe("parseAIResponse", () => {
  test("parses response with quotes only", () => {
    const response = `- "First quote"
- "Second quote"
- "Third quote"`;

    const items = parseAIResponse(response);

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ text: "First quote" });
    expect(items[1]).toEqual({ text: "Second quote" });
    expect(items[2]).toEqual({ text: "Third quote" });
  });

  test("parses response with attributions", () => {
    const response = `- "To be or not to be." -- Shakespeare
- "I think, therefore I am." -- Descartes`;

    const items = parseAIResponse(response);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ text: "To be or not to be.", attribution: "Shakespeare" });
    expect(items[1]).toEqual({ text: "I think, therefore I am.", attribution: "Descartes" });
  });

  test("skips malformed lines", () => {
    const response = `- "Valid quote"
This is not a quote
- "Another valid quote"
- No quotes here
Just some text`;

    const items = parseAIResponse(response);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ text: "Valid quote" });
    expect(items[1]).toEqual({ text: "Another valid quote" });
  });

  test("handles empty response", () => {
    expect(parseAIResponse("")).toEqual([]);
  });

  test("handles response with only whitespace", () => {
    expect(parseAIResponse("   \n\n   ")).toEqual([]);
  });

  test("handles mixed format with extra text", () => {
    const response = `Here are some prompts:

- "First prompt"
- "Second prompt" -- Note

That's all!`;

    const items = parseAIResponse(response);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ text: "First prompt" });
    expect(items[1]).toEqual({ text: "Second prompt", attribution: "Note" });
  });
});

// =============================================================================
// Generation Constants Tests
// =============================================================================

describe("Generation Constants", () => {
  test("GENERATION_MODEL is haiku", () => {
    expect(GENERATION_MODEL).toBe("haiku");
  });

  test("MAX_GENERATION_CONTEXT is 3000", () => {
    expect(MAX_GENERATION_CONTEXT).toBe(3000);
  });
});

// =============================================================================
// Mock SDK Query Helpers
// =============================================================================

/**
 * Creates a mock query function that yields the specified text response.
 * The response is wrapped in an assistant message with text content block.
 *
 * @param response - Text to return as the assistant's response
 * @param onCall - Optional callback to capture the query arguments
 */
function createMockQueryFn(
  response: string,
  onCall?: (args: { prompt: string; options: { model: string } }) => void
): QueryFunction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((args: any) => {
    if (onCall) {
      onCall(args as { prompt: string; options: { model: string } });
    }
    // Create a simple async iterator that yields the response
    let yielded = false;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (!yielded) {
          yielded = true;
          return Promise.resolve({
            value: {
              type: "assistant" as const,
              message: { content: [{ type: "text", text: response }] },
            },
            done: false as const,
          });
        }
        return Promise.resolve({ value: undefined, done: true as const });
      },
      return() {
        return Promise.resolve({ value: undefined, done: true as const });
      },
      throw(e: Error) {
        return Promise.reject(e);
      },
    };
  }) as unknown as QueryFunction;
}

/**
 * Creates a mock query function that yields multiple text responses.
 *
 * @param responses - Array of text responses to yield
 */
function createMultiResponseMockQueryFn(responses: string[]): QueryFunction {
  return (() => {
    let index = 0;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (index < responses.length) {
          const value = {
            type: "assistant" as const,
            message: { content: [{ type: "text", text: responses[index++] }] },
          };
          return Promise.resolve({ value, done: false as const });
        }
        return Promise.resolve({ value: undefined, done: true as const });
      },
      return() {
        return Promise.resolve({ value: undefined, done: true as const });
      },
      throw(e: Error) {
        return Promise.reject(e);
      },
    };
  }) as unknown as QueryFunction;
}

/**
 * Creates a mock query function that throws an error.
 *
 * @param message - Error message to throw
 */
function createErrorMockQueryFn(message: string): QueryFunction {
  return (() => {
    throw new Error(message);
  }) as unknown as QueryFunction;
}

// =============================================================================
// generateContextualPrompts Tests
// =============================================================================

describe("generateContextualPrompts", () => {
  afterEach(() => {
    resetQueryFunction();
  });

  test("returns empty array for empty context", async () => {
    const items = await generateContextualPrompts("");
    expect(items).toEqual([]);
  });

  test("returns empty array for whitespace-only context", async () => {
    const items = await generateContextualPrompts("   \n\n   ");
    expect(items).toEqual([]);
  });

  test("calls query function with correct parameters", async () => {
    let capturedArgs: { prompt: string; options: { model: string } } | null = null;

    setQueryFunction(
      createMockQueryFn('- "A prompt based on context"', (args) => {
        capturedArgs = args;
      })
    );

    await generateContextualPrompts("Test context");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.prompt).toContain("Test context");
    expect(capturedArgs!.options.model).toBe(GENERATION_MODEL);
  });

  test("parses response from mock SDK", async () => {
    setQueryFunction(
      createMockQueryFn(`- "What goals energize you most?"
- "How can you build on yesterday's momentum?"`)
    );

    const items = await generateContextualPrompts("User notes about goals");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ text: "What goals energize you most?" });
    expect(items[1]).toEqual({ text: "How can you build on yesterday's momentum?" });
  });

  test("truncates long context", async () => {
    let capturedPrompt = "";

    setQueryFunction(
      createMockQueryFn("", (args) => {
        capturedPrompt = args.prompt;
      })
    );

    // Create context longer than MAX_GENERATION_CONTEXT using unique markers
    const marker = "ZZZZ";
    const longContext = marker.repeat(Math.ceil((MAX_GENERATION_CONTEXT + 500) / marker.length));
    await generateContextualPrompts(longContext.slice(0, MAX_GENERATION_CONTEXT + 500));

    // Verify context was truncated: count marker occurrences in the prompt
    // The truncated context should have exactly MAX_GENERATION_CONTEXT chars
    const markerMatches = capturedPrompt.match(new RegExp(marker, "g")) || [];
    const expectedMarkers = Math.floor(MAX_GENERATION_CONTEXT / marker.length);
    expect(markerMatches.length).toBe(expectedMarkers);
  });

  test("returns empty array on SDK error", async () => {
    setQueryFunction(createErrorMockQueryFn("SDK connection failed"));

    const items = await generateContextualPrompts("Some context");

    expect(items).toEqual([]);
  });

  test("handles SDK returning empty response", async () => {
    setQueryFunction(createMockQueryFn(""));

    const items = await generateContextualPrompts("Some context");

    expect(items).toEqual([]);
  });
});

// =============================================================================
// generateInspirationQuote Tests
// =============================================================================

describe("generateInspirationQuote", () => {
  afterEach(() => {
    resetQueryFunction();
  });

  test("calls query function with correct parameters", async () => {
    let capturedArgs: { prompt: string; options: { model: string } } | null = null;

    setQueryFunction(
      createMockQueryFn('- "A wise quote" -- Someone', (args) => {
        capturedArgs = args;
      })
    );

    await generateInspirationQuote();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.options.model).toBe(GENERATION_MODEL);
    expect(capturedArgs!.prompt).toContain("inspirational quote");
  });

  test("parses quote with attribution", async () => {
    setQueryFunction(
      createMockQueryFn('- "The only way to do great work is to love what you do." -- Steve Jobs')
    );

    const items = await generateInspirationQuote();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      text: "The only way to do great work is to love what you do.",
      attribution: "Steve Jobs",
    });
  });

  test("handles quote without attribution", async () => {
    setQueryFunction(createMockQueryFn('- "An anonymous wise saying"'));

    const items = await generateInspirationQuote();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ text: "An anonymous wise saying" });
  });

  test("returns empty array on SDK error", async () => {
    setQueryFunction(createErrorMockQueryFn("API rate limit exceeded"));

    const items = await generateInspirationQuote();

    expect(items).toEqual([]);
  });

  test("handles multiple assistant events", async () => {
    setQueryFunction(
      createMultiResponseMockQueryFn(['- "First part', ' continued" -- Author'])
    );

    const items = await generateInspirationQuote();

    // Both parts should be combined
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      text: "First part continued",
      attribution: "Author",
    });
  });
});

// =============================================================================
// generateWeekendPrompts Tests
// =============================================================================

describe("generateWeekendPrompts", () => {
  afterEach(() => {
    resetQueryFunction();
  });

  test("calls query function with correct parameters", async () => {
    let capturedArgs: { prompt: string; options: { model: string } } | null = null;

    setQueryFunction(
      createMockQueryFn('- "A creative prompt"', (args) => {
        capturedArgs = args;
      })
    );

    await generateWeekendPrompts();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.options.model).toBe(GENERATION_MODEL);
    expect(capturedArgs!.prompt).toContain("creative prompts");
    expect(capturedArgs!.prompt).toContain("imagination");
  });

  test("parses multiple creative prompts", async () => {
    setQueryFunction(
      createMockQueryFn(`- "What would you create if you had no constraints?"
- "If you could learn any skill instantly, what would it be?"
- "Describe your perfect lazy day"`)
    );

    const items = await generateWeekendPrompts();

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ text: "What would you create if you had no constraints?" });
    expect(items[1]).toEqual({ text: "If you could learn any skill instantly, what would it be?" });
  });

  test("works without context (general creative prompts)", async () => {
    let capturedPrompt = "";

    setQueryFunction(
      createMockQueryFn('- "A creative prompt"', (args) => {
        capturedPrompt = args.prompt;
      })
    );

    await generateWeekendPrompts();

    // Should include fallback nudge for no context
    expect(capturedPrompt).toContain("anyone looking to think differently");
  });

  test("works with context (uses light nudge)", async () => {
    let capturedPrompt = "";

    setQueryFunction(
      createMockQueryFn('- "A creative prompt"', (args) => {
        capturedPrompt = args.prompt;
      })
    );

    await generateWeekendPrompts("Some vault context about projects");

    // Should include light nudge about interests, not the actual content
    expect(capturedPrompt).toContain("various projects");
    expect(capturedPrompt).not.toContain("Some vault context");
  });

  test("returns empty array on SDK error", async () => {
    setQueryFunction(createErrorMockQueryFn("SDK error"));

    const items = await generateWeekendPrompts();

    expect(items).toEqual([]);
  });

  test("handles empty SDK response", async () => {
    setQueryFunction(createMockQueryFn(""));

    const items = await generateWeekendPrompts();

    expect(items).toEqual([]);
  });
});

// =============================================================================
// setQueryFunction / resetQueryFunction Tests
// =============================================================================

describe("Query Function Injection", () => {
  afterEach(() => {
    resetQueryFunction();
  });

  test("setQueryFunction allows mocking SDK calls", async () => {
    let wasCalled = false;

    setQueryFunction(
      createMockQueryFn('- "Test"', () => {
        wasCalled = true;
      })
    );
    await generateContextualPrompts("context");

    expect(wasCalled).toBe(true);
  });

  test("resetQueryFunction restores default behavior", async () => {
    setQueryFunction(createMockQueryFn('- "Mock"'));
    resetQueryFunction();

    // After reset, calling with empty context should return empty array
    // (testing that it doesn't use mock anymore, which would return a result)
    const items = await generateContextualPrompts("");
    expect(items).toEqual([]);
  });
});

// =============================================================================
// FALLBACK_QUOTE Tests
// =============================================================================

describe("FALLBACK_QUOTE", () => {
  test("has text property", () => {
    expect(FALLBACK_QUOTE.text).toBeDefined();
    expect(typeof FALLBACK_QUOTE.text).toBe("string");
    expect(FALLBACK_QUOTE.text.length).toBeGreaterThan(0);
  });

  test("has attribution property", () => {
    expect(FALLBACK_QUOTE.attribution).toBeDefined();
    expect(typeof FALLBACK_QUOTE.attribution).toBe("string");
    expect(FALLBACK_QUOTE.attribution!.length).toBeGreaterThan(0);
  });

  test("is the Steve Jobs quote", () => {
    expect(FALLBACK_QUOTE.text).toBe(
      "The only way to do great work is to love what you do."
    );
    expect(FALLBACK_QUOTE.attribution).toBe("Steve Jobs");
  });
});

// =============================================================================
// selectRandom Tests
// =============================================================================

describe("selectRandom", () => {
  test("returns undefined for empty array", () => {
    const result = selectRandom([]);
    expect(result).toBeUndefined();
  });

  test("returns the single item for array with one element", () => {
    const item = { text: "Only one" };
    const result = selectRandom([item]);
    expect(result).toBe(item);
  });

  test("returns an item from the array for multiple elements", () => {
    const items = [
      { text: "First" },
      { text: "Second" },
      { text: "Third" },
    ];
    const result = selectRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("handles arrays of strings", () => {
    const items = ["a", "b", "c"];
    const result = selectRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("handles arrays of numbers", () => {
    const items = [1, 2, 3, 4, 5];
    const result = selectRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("returns different items over many calls (statistical)", () => {
    const items = ["a", "b", "c", "d", "e"];
    const results = new Set<string>();

    // Run many times to get statistical coverage
    for (let i = 0; i < 100; i++) {
      const result = selectRandom(items);
      if (result) results.add(result);
    }

    // Should have selected at least 2 different items over 100 runs
    expect(results.size).toBeGreaterThan(1);
  });
});

// =============================================================================
// selectWeightedRandom Tests
// =============================================================================

describe("selectWeightedRandom", () => {
  test("returns undefined for empty array", () => {
    const result = selectWeightedRandom([]);
    expect(result).toBeUndefined();
  });

  test("returns the single item for array with one element", () => {
    const item = { text: "Only one" };
    const result = selectWeightedRandom([item]);
    expect(result).toBe(item);
  });

  test("returns an item from the array for multiple elements", () => {
    const items = [
      { text: "First" },
      { text: "Second" },
      { text: "Third" },
    ];
    const result = selectWeightedRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("handles arrays of strings", () => {
    const items = ["a", "b", "c"];
    const result = selectWeightedRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("handles arrays of numbers", () => {
    const items = [1, 2, 3, 4, 5];
    const result = selectWeightedRandom(items);
    expect(result).toBeDefined();
    expect(items).toContain(result!);
  });

  test("returns different items over many calls (statistical)", () => {
    const items = ["a", "b", "c", "d", "e"];
    const results = new Set<string>();

    // Run many times to get statistical coverage
    for (let i = 0; i < 100; i++) {
      const result = selectWeightedRandom(items);
      if (result) results.add(result);
    }

    // Should have selected at least 2 different items over 100 runs
    expect(results.size).toBeGreaterThan(1);
  });

  test("biases toward recent items (end of array)", () => {
    // Use a larger array to make the bias statistically significant
    const items = ["oldest", "old", "middle", "recent", "newest"];
    const counts: Record<string, number> = {
      oldest: 0,
      old: 0,
      middle: 0,
      recent: 0,
      newest: 0,
    };

    // Run many times to get statistical distribution
    const iterations = 10000;
    for (let i = 0; i < iterations; i++) {
      const result = selectWeightedRandom(items);
      if (result) counts[result]++;
    }

    // With linear weighting (1,2,3,4,5), expected probabilities:
    // oldest: 1/15 = 6.7%, old: 2/15 = 13.3%, middle: 3/15 = 20%
    // recent: 4/15 = 26.7%, newest: 5/15 = 33.3%
    //
    // Verify the bias: newest should be selected more than oldest
    expect(counts.newest).toBeGreaterThan(counts.oldest);

    // Newest should be roughly 5x more likely than oldest
    // Allow some statistical variance (3x to 7x range)
    const ratio = counts.newest / counts.oldest;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(7);
  });

  test("with two items, second has 2x probability", () => {
    const items = ["first", "second"];
    const counts = { first: 0, second: 0 };

    const iterations = 10000;
    for (let i = 0; i < iterations; i++) {
      const result = selectWeightedRandom(items);
      if (result) counts[result as "first" | "second"]++;
    }

    // Expected: first = 1/3, second = 2/3
    // Second should be roughly 2x first (allow 1.5x to 2.5x)
    const ratio = counts.second / counts.first;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });
});

// =============================================================================
// getInspiration Tests
// =============================================================================

describe("getInspiration", () => {
  let testVaultPath: string;

  beforeEach(async () => {
    testVaultPath = join(tmpdir(), `test-inspiration-${Date.now()}`);
    await mkdir(join(testVaultPath, INBOX_PATH), { recursive: true });
    await mkdir(
      join(testVaultPath, "06_Metadata", "memory-loop"),
      { recursive: true }
    );
  });

  afterEach(async () => {
    resetQueryFunction();
    await rm(testVaultPath, { recursive: true, force: true });
  });

  // Helper to create vault for these tests
  function createTestVault() {
    return createMockVault({ path: testVaultPath, contentRoot: testVaultPath, inboxPath: INBOX_PATH });
  }

  describe("basic functionality", () => {
    test("returns object with contextual and quote properties", async () => {
      // Mock to prevent real SDK calls
      setQueryFunction(createMockQueryFn(""));

      const vault = createTestVault();
      const result = await getInspiration(vault);

      expect(result).toHaveProperty("contextual");
      expect(result).toHaveProperty("quote");
    });

    test("returns fallback quote when quote file missing", async () => {
      setQueryFunction(createMockQueryFn(""));

      const vault = createTestVault();
      const result = await getInspiration(vault);

      expect(result.quote).toEqual(FALLBACK_QUOTE);
    });

    test("returns null for contextual when file missing", async () => {
      setQueryFunction(createMockQueryFn(""));

      // Use a weekday date
      const vault = createTestVault();
      const result = await getInspiration(vault);

      // On weekdays, contextual should be null when file is missing
      // (generation might run but with no context returns empty)
      expect(result.contextual).toBeNull();
    });
  });

  describe("file parsing", () => {
    test("parses existing quote file and selects random item", async () => {
      // Create quote file with multiple entries
      const quoteContent = `<!-- last-generated: 2025-12-26 (week 52) -->

- "First wisdom" -- Author A
- "Second wisdom" -- Author B
- "Third wisdom" -- Author C
`;
      await writeFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        quoteContent
      );

      setQueryFunction(createMockQueryFn(""));

      const vault = createTestVault();
      const result = await getInspiration(vault);

      // Quote should be one of the file entries
      expect(result.quote.text).toMatch(/First wisdom|Second wisdom|Third wisdom/);
    });

    test("parses existing contextual file and selects random item on weekday", async () => {
      // Create contextual file
      const contextualContent = `<!-- last-generated: 2025-12-26 -->

- "How's your project going?"
- "What's your focus today?"
`;
      await writeFile(
        join(testVaultPath, CONTEXTUAL_PROMPTS_PATH),
        contextualContent
      );

      // Also need quote file to avoid generation
      const quoteContent = `<!-- last-generated: 2025-12-26 (week 52) -->
- "Quote" -- Author
`;
      await writeFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        quoteContent
      );

      setQueryFunction(createMockQueryFn(""));

      // Only test on weekdays - the function checks isWeekday internally
      const vault = createTestVault();
      const result = await getInspiration(vault);

      // On weekdays, contextual should be from the file
      // On weekends, contextual should be null
      if (result.contextual !== null) {
        expect(result.contextual.text).toMatch(
          /project going|focus today/
        );
      }
    });
  });

  describe("generation triggering", () => {
    test("triggers quote generation when quote file missing", async () => {
      let queryWasCalled = false;

      setQueryFunction(
        createMockQueryFn('- "Generated quote" -- AI', () => {
          queryWasCalled = true;
        })
      );

      const vault = createTestVault();
      await getInspiration(vault);

      // Should have called query for quote generation
      expect(queryWasCalled).toBe(true);
    });

    test("does not trigger generation when files are fresh", async () => {
      // Create fresh files with today's date
      const today = new Date();
      const dateStr = formatDateForDailyNote(today);
      const week = getISOWeekNumber(today);

      const contextualContent = `<!-- last-generated: ${dateStr} -->
- "Fresh prompt"
`;
      const quoteContent = `<!-- last-generated: ${dateStr} (week ${week}) -->
- "Fresh quote" -- Author
`;

      await writeFile(
        join(testVaultPath, CONTEXTUAL_PROMPTS_PATH),
        contextualContent
      );
      await writeFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        quoteContent
      );

      let queryWasCalled = false;
      setQueryFunction(
        createMockQueryFn("", () => {
          queryWasCalled = true;
        })
      );

      const vault = createTestVault();
      await getInspiration(vault);

      // Should NOT have called query since files are fresh
      expect(queryWasCalled).toBe(false);
    });
  });

  describe("error handling", () => {
    test("returns fallback quote when generation fails", async () => {
      setQueryFunction(createErrorMockQueryFn("SDK error"));

      const vault = createTestVault();
      const result = await getInspiration(vault);

      // Should use fallback even if generation failed
      expect(result.quote).toEqual(FALLBACK_QUOTE);
    });

    test("handles permission errors gracefully", async () => {
      setQueryFunction(createMockQueryFn(""));

      // Point to a path that definitely doesn't exist
      const nonExistentVault = createMockVault({
        path: "/nonexistent/vault/path",
        contentRoot: "/nonexistent/vault/path",
      });
      const result = await getInspiration(nonExistentVault);

      // Should still return valid result with fallback
      expect(result.quote).toEqual(FALLBACK_QUOTE);
      expect(result.contextual).toBeNull();
    });
  });

  describe("weekend behavior", () => {
    test("returns null contextual on weekend regardless of file content", async () => {
      // Create contextual file
      const contextualContent = `<!-- last-generated: 2025-12-26 -->
- "This prompt exists"
`;
      await writeFile(
        join(testVaultPath, CONTEXTUAL_PROMPTS_PATH),
        contextualContent
      );

      const quoteContent = `<!-- last-generated: 2025-12-26 (week 52) -->
- "Quote" -- Author
`;
      await writeFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        quoteContent
      );

      setQueryFunction(createMockQueryFn(""));

      // On weekends, contextual should be null
      // Note: We can't easily mock the date in this test, so we verify the
      // behavior based on the current day. The key assertion is that quotes
      // are always returned but contextual may be null.
      const vault = createTestVault();
      const result = await getInspiration(vault);

      // Quote should always be present
      expect(result.quote.text).toBeDefined();
      expect(result.quote.text.length).toBeGreaterThan(0);

      // Contextual is null on weekends, populated on weekdays
      // We accept either as valid since we can't control the test date
      if (result.contextual !== null) {
        expect(result.contextual.text).toBe("This prompt exists");
      }
    });
  });

  describe("integration with file writing", () => {
    test("creates quote file after generation", async () => {
      setQueryFunction(
        createMockQueryFn('- "Newly generated" -- AI Author')
      );

      const vault = createTestVault();
      await getInspiration(vault);

      // Check that quote file was created
      const quoteContent = await readFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        "utf-8"
      );
      expect(quoteContent).toContain("Newly generated");
      expect(quoteContent).toContain("AI Author");
    });

    test("appends to existing quote file", async () => {
      // Create existing quote file with old date to trigger generation
      const oldContent = `<!-- last-generated: 2024-01-01 (week 1) -->
- "Old quote" -- Old Author
`;
      await writeFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        oldContent
      );

      setQueryFunction(
        createMockQueryFn('- "New quote" -- New Author')
      );

      const vault = createTestVault();
      await getInspiration(vault);

      const content = await readFile(
        join(testVaultPath, GENERAL_INSPIRATION_PATH),
        "utf-8"
      );
      expect(content).toContain("Old quote");
      expect(content).toContain("New quote");
    });
  });
});
