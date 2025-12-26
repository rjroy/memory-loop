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
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseGenerationMarker,
  parseInspirationLine,
  parseInspirationFile,
  parseInspirationContent,
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
