/**
 * Inspiration Manager Tests
 *
 * Unit tests for inspiration file parsing, generation, and selection.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMockVault } from "./test-helpers.js";
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
  type DayType,
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
  selectRandom,
  selectWeightedRandom,
  getInspiration,
  FALLBACK_QUOTE,
  CONTEXTUAL_PROMPTS_PATH,
  GENERAL_INSPIRATION_PATH,
  MAX_POOL_SIZE,
  INBOX_PATH,
  PROJECTS_PATH,
  AREAS_PATH,
  DAY_CONTEXT_CONFIG,
  GENERATION_MODEL,
  MAX_GENERATION_CONTEXT,
} from "../inspiration-manager.js";
import {
  configureSdkForTesting,
  _resetForTesting,
  type QueryFunction,
} from "../sdk-provider.js";

// =============================================================================
// Test Utilities
// =============================================================================

/** Creates a unique temp directory for test isolation */
async function createTestDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Creates a contextual prompts file with specified date */
async function writeContextualFile(
  vaultPath: string,
  dateStr: string
): Promise<void> {
  const filePath = join(vaultPath, CONTEXTUAL_PROMPTS_PATH);
  await mkdir(join(vaultPath, "06_Metadata", "memory-loop"), { recursive: true });
  await writeFile(
    filePath,
    `<!-- last-generated: ${dateStr} -->\n\n- "Test prompt one"\n- "Test prompt two"\n`,
    "utf-8"
  );
}

/** Creates a quote file with specified date and optional week number */
async function writeQuoteFile(
  vaultPath: string,
  dateStr: string,
  weekNum?: number
): Promise<void> {
  const filePath = join(vaultPath, GENERAL_INSPIRATION_PATH);
  await mkdir(join(vaultPath, "06_Metadata", "memory-loop"), { recursive: true });
  const marker = weekNum
    ? `<!-- last-generated: ${dateStr} (week ${weekNum}) -->`
    : `<!-- last-generated: ${dateStr} -->`;
  await writeFile(
    filePath,
    `${marker}\n\n- "Test quote one" -- Author One\n- "Test quote two" -- Author Two\n`,
    "utf-8"
  );
}

/** Creates a mock query function that yields a single response */
function createMockQueryFn(
  response: string,
  onCall?: (args: { prompt: string; options: { model: string } }) => void
): QueryFunction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((args: any) => {
    if (onCall) onCall(args as { prompt: string; options: { model: string } });
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

/** Creates a mock query function that throws an error */
function createErrorMockQueryFn(message: string): QueryFunction {
  return (() => {
    throw new Error(message);
  }) as unknown as QueryFunction;
}

/** Creates a mock query function with multiple sequential responses */
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

// =============================================================================
// parseGenerationMarker Tests
// =============================================================================

describe("parseGenerationMarker", () => {
  test("parses date-only marker", () => {
    const result = parseGenerationMarker("<!-- last-generated: 2025-12-26 -->");
    expect(result.date?.toISOString().slice(0, 10)).toBe("2025-12-26");
    expect(result.weekNumber).toBeUndefined();
  });

  test("parses marker with week number", () => {
    const result = parseGenerationMarker(
      "<!-- last-generated: 2025-12-23 (week 52) -->"
    );
    expect(result.date?.toISOString().slice(0, 10)).toBe("2025-12-23");
    expect(result.weekNumber).toBe(52);
  });

  test("handles extra whitespace", () => {
    const result = parseGenerationMarker(
      "<!--  last-generated:  2025-12-26  (week  52)  -->"
    );
    expect(result.date).not.toBeNull();
    expect(result.weekNumber).toBe(52);
  });

  const invalidMarkers = [
    ["malformed marker", "<!-- generated: 2025-12-26 -->"],
    ["non-marker line", '- "This is a quote" -- Source'],
    ["empty string", ""],
    ["partial marker", "<!-- last-generated: -->"],
    ["invalid date", "<!-- last-generated: 2025-12 -->"],
    ["unclosed comment", "<!-- last-generated: 2025-12-26"],
  ];

  test.each(invalidMarkers)("returns null for %s", (_, input) => {
    const result = parseGenerationMarker(input);
    expect(result.date).toBeNull();
  });
});

// =============================================================================
// parseInspirationLine Tests
// =============================================================================

describe("parseInspirationLine", () => {
  describe("valid lines", () => {
    const validCases: Array<[string, string, string | undefined]> = [
      ['- "Quote text" -- Source', "Quote text", "Source"],
      ['- "Quote only"', "Quote only", undefined],
      [
        '- "Complex attribution" -- Marcus Aurelius, Meditations',
        "Complex attribution",
        "Marcus Aurelius, Meditations",
      ],
      ['- "千里之行，始于足下" -- 老子', "千里之行，始于足下", "老子"],
      ['- "Start with gratitude 🙏" -- Wisdom', "Start with gratitude 🙏", "Wisdom"],
      [
        '- "The path — though unclear — leads forward." -- Wisdom',
        "The path — though unclear — leads forward.",
        "Wisdom",
      ],
      ['-   "Quote text"   --   Source', "Quote text", "Source"],
    ];

    test.each(validCases)(
      "parses: %s",
      (input, expectedText, expectedAttribution) => {
        const result = parseInspirationLine(input);
        expect(result).not.toBeNull();
        expect(result?.text).toBe(expectedText);
        expect(result?.attribution).toBe(expectedAttribution);
      }
    );
  });

  describe("invalid lines", () => {
    const invalidCases = [
      ['empty quotes', '- ""'],
      ['whitespace-only quotes', '- "   "'],
      ["missing dash prefix", '"Quote text" -- Source'],
      ["missing quotes", "- Quote text -- Source"],
      ["numbered list", '1. "Quote text" -- Source'],
      ["empty string", ""],
      ["just dash", "-"],
      ["unclosed quote", '- "Quote without closing quote'],
      ["generation marker", "<!-- last-generated: 2025-12-26 -->"],
      ["leading whitespace", '  - "Quote text" -- Source'],
    ];

    test.each(invalidCases)("returns null for %s", (_, input) => {
      expect(parseInspirationLine(input)).toBeNull();
    });
  });

  test("handles very long quote text", () => {
    const longText = "A".repeat(1000);
    const result = parseInspirationLine(`- "${longText}" -- Long Source`);
    expect(result?.text.length).toBe(1000);
  });
});

// =============================================================================
// parseInspirationContent Tests
// =============================================================================

describe("parseInspirationContent", () => {
  test("parses file with marker and entries", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Quote one" -- Source One
- "Quote two" -- Source Two
- "Quote without source"
`;
    const result = parseInspirationContent(content);

    expect(result.lastGenerated?.getDate()).toBe(26);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].attribution).toBe("Source One");
    expect(result.items[2].attribution).toBeUndefined();
  });

  test("parses file with week number marker", () => {
    const content = `<!-- last-generated: 2025-12-23 (week 52) -->

- "Weekly quote" -- Weekly Source
`;
    const result = parseInspirationContent(content);

    expect(result.weekNumber).toBe(52);
    expect(result.items).toHaveLength(1);
  });

  test("skips invalid lines while parsing valid ones", () => {
    const content = `<!-- last-generated: 2025-12-26 -->

- "Valid quote one" -- Source
This is an invalid line
- "Valid quote two"
1. Numbered item that should be skipped
- "Valid quote three" -- Final Source
`;
    const result = parseInspirationContent(content);

    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.text)).toEqual([
      "Valid quote one",
      "Valid quote two",
      "Valid quote three",
    ]);
  });

  test("returns empty for empty or whitespace content", () => {
    expect(parseInspirationContent("").items).toHaveLength(0);
    expect(parseInspirationContent("   \n\n   \t\n  ").items).toHaveLength(0);
  });

  test("handles Windows line endings", () => {
    const content =
      "<!-- last-generated: 2025-12-26 -->\r\n\r\n" +
      '- "Quote with CRLF" -- Source\r\n';
    const result = parseInspirationContent(content);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items[0].text).toBe("Quote with CRLF");
  });

  test("uses first marker when multiple present", () => {
    const content = `<!-- last-generated: 2025-12-26 -->
- "First" -- Source
<!-- last-generated: 2025-01-01 -->
- "Second" -- Source
`;
    const result = parseInspirationContent(content);
    expect(result.lastGenerated?.getDate()).toBe(26);
  });
});

// =============================================================================
// parseInspirationFile Tests
// =============================================================================

describe("parseInspirationFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir("inspiration-file");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("parses valid file", async () => {
    const filePath = join(testDir, "quotes.md");
    await writeFile(
      filePath,
      `<!-- last-generated: 2025-12-26 -->

- "First quote" -- Source One
- "Second quote"
`,
      "utf-8"
    );

    const result = await parseInspirationFile(filePath);

    expect(result.lastGenerated).not.toBeNull();
    expect(result.items).toHaveLength(2);
  });

  test("returns empty for missing file", async () => {
    const result = await parseInspirationFile(join(testDir, "nonexistent.md"));
    expect(result.lastGenerated).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  test("returns empty for empty file", async () => {
    const filePath = join(testDir, "empty.md");
    await writeFile(filePath, "", "utf-8");

    const result = await parseInspirationFile(filePath);
    expect(result.items).toHaveLength(0);
  });

  test("handles UTF-8 content", async () => {
    const filePath = join(testDir, "utf8.md");
    await writeFile(
      filePath,
      `<!-- last-generated: 2025-12-26 -->

- "Carpe diem! 🌅" -- Horace
- "千里之行，始于足下" -- 老子
`,
      "utf-8"
    );

    const result = await parseInspirationFile(filePath);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].text).toBe("Carpe diem! 🌅");
    expect(result.items[1].attribution).toBe("老子");
  });

  test("handles large file efficiently", async () => {
    const filePath = join(testDir, "large.md");
    let content = "<!-- last-generated: 2025-12-26 -->\n\n";
    for (let i = 0; i < 100; i++) {
      content += `- "Quote number ${i}" -- Source ${i}\n`;
    }
    await writeFile(filePath, content, "utf-8");

    const result = await parseInspirationFile(filePath);
    expect(result.items).toHaveLength(100);
  });
});

// =============================================================================
// Date and Week Functions Tests
// =============================================================================

describe("getISOWeekNumber", () => {
  const weekCases: Array<[string, Date, number]> = [
    ["Jan 1, 2025 (Wed)", new Date(2025, 0, 1), 1],
    ["Jan 6, 2025 (Mon)", new Date(2025, 0, 6), 2],
    ["Dec 31, 2024 (Tue)", new Date(2024, 11, 31), 1],
    ["Dec 28, 2020 (Mon)", new Date(2020, 11, 28), 53],
    ["Jan 1, 2021 (Fri)", new Date(2021, 0, 1), 53],
    ["Jan 4, 2021 (Mon)", new Date(2021, 0, 4), 1],
  ];

  test.each(weekCases)("%s is week %i", (_, date, expectedWeek) => {
    expect(getISOWeekNumber(date)).toBe(expectedWeek);
  });

  test("consecutive days in same week have same week number", () => {
    for (let i = 0; i < 7; i++) {
      const day = new Date(2025, 0, 13 + i); // Week of Jan 13, 2025 (week 3)
      expect(getISOWeekNumber(day)).toBe(3);
    }
  });
});

describe("isWeekday", () => {
  test("returns true for Mon-Fri", () => {
    for (let i = 6; i <= 10; i++) {
      // Jan 6-10, 2025 is Mon-Fri
      expect(isWeekday(new Date(2025, 0, i))).toBe(true);
    }
  });

  test("returns false for Sat-Sun", () => {
    expect(isWeekday(new Date(2025, 0, 11))).toBe(false); // Saturday
    expect(isWeekday(new Date(2025, 0, 12))).toBe(false); // Sunday
  });
});

describe("getDayType", () => {
  const dayTypeCases: Array<[string, Date, DayType]> = [
    ["Saturday", new Date(2025, 11, 27), "weekend"],
    ["Sunday", new Date(2025, 11, 28), "weekend"],
    ["Monday", new Date(2025, 11, 29), "monday"],
    ["Tuesday", new Date(2025, 11, 30), "midweek"],
    ["Wednesday", new Date(2025, 11, 31), "midweek"],
    ["Thursday", new Date(2025, 11, 25), "midweek"],
    ["Friday", new Date(2025, 11, 26), "friday"],
  ];

  test.each(dayTypeCases)("%s returns %s", (_, date, expected) => {
    expect(getDayType(date)).toBe(expected);
  });
});

describe("formatDateForDailyNote", () => {
  test("formats as YYYY-MM-DD with zero padding", () => {
    expect(formatDateForDailyNote(new Date(2025, 11, 26))).toBe("2025-12-26");
    expect(formatDateForDailyNote(new Date(2025, 0, 5))).toBe("2025-01-05");
  });
});

describe("getDateWithOffset", () => {
  test("returns correct offset dates", () => {
    const base = new Date(2025, 11, 26);
    expect(formatDateForDailyNote(getDateWithOffset(base, 0))).toBe("2025-12-26");
    expect(formatDateForDailyNote(getDateWithOffset(base, -1))).toBe("2025-12-25");
    expect(formatDateForDailyNote(getDateWithOffset(base, -7))).toBe("2025-12-19");
    expect(formatDateForDailyNote(getDateWithOffset(base, 1))).toBe("2025-12-27");
  });

  test("handles month boundary", () => {
    const date = new Date(2025, 0, 1);
    expect(formatDateForDailyNote(getDateWithOffset(date, -1))).toBe("2024-12-31");
  });

  test("does not mutate original date", () => {
    const date = new Date(2025, 11, 26);
    getDateWithOffset(date, -5);
    expect(date.getDate()).toBe(26);
  });
});

// =============================================================================
// File Reading Tests
// =============================================================================

describe("readDailyNote", () => {
  let testVault: string;

  beforeEach(async () => {
    testVault = await createTestDir("vault-daily");
    await mkdir(join(testVault, INBOX_PATH), { recursive: true });
  });

  afterEach(async () => {
    await rm(testVault, { recursive: true, force: true }).catch(() => {});
  });

  test("reads existing daily note", async () => {
    const content = "# 2025-12-26\n\nSome notes here.";
    await writeFile(join(testVault, INBOX_PATH, "2025-12-26.md"), content);

    const vault = createMockVault({
      path: testVault,
      contentRoot: testVault,
      inboxPath: INBOX_PATH,
    });
    const result = await readDailyNote(vault, "2025-12-26");
    expect(result).toBe(content);
  });

  test("returns null for missing note", async () => {
    const vault = createMockVault({
      path: testVault,
      contentRoot: testVault,
      inboxPath: INBOX_PATH,
    });
    expect(await readDailyNote(vault, "2025-12-25")).toBeNull();
  });
});

describe("readFolderIndex", () => {
  let testFolder: string;

  beforeEach(async () => {
    testFolder = await createTestDir("folder-index");
  });

  afterEach(async () => {
    await rm(testFolder, { recursive: true, force: true }).catch(() => {});
  });

  test("reads README.md if present", async () => {
    await writeFile(join(testFolder, "README.md"), "# README content");
    expect(await readFolderIndex(testFolder)).toBe("# README content");
  });

  test("reads index.md if README.md missing", async () => {
    await writeFile(join(testFolder, "index.md"), "# Index content");
    expect(await readFolderIndex(testFolder)).toBe("# Index content");
  });

  test("prefers README.md over index.md", async () => {
    await writeFile(join(testFolder, "README.md"), "# README");
    await writeFile(join(testFolder, "index.md"), "# Index");
    expect(await readFolderIndex(testFolder)).toBe("# README");
  });

  test("returns null when neither exists", async () => {
    expect(await readFolderIndex(testFolder)).toBeNull();
  });
});

describe("getSubfolders", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir("subfolders");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns subfolder paths, ignoring files", async () => {
    await mkdir(join(testDir, "folder-a"));
    await mkdir(join(testDir, "folder-b"));
    await writeFile(join(testDir, "file.md"), "content");

    const result = await getSubfolders(testDir);
    expect(result).toHaveLength(2);
    expect(result).toContain(join(testDir, "folder-a"));
  });

  test("returns empty for empty or missing directory", async () => {
    expect(await getSubfolders(testDir)).toHaveLength(0);
    expect(await getSubfolders("/non/existent/dir")).toHaveLength(0);
  });
});

// =============================================================================
// Context Gathering Tests
// =============================================================================

describe("truncateContext", () => {
  const createItem = (content: string, daysAgo: number) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return { date, content, source: `test-${daysAgo}` };
  };

  test("joins items within budget", () => {
    const items = [createItem("short", 2), createItem("text", 1)];
    expect(truncateContext(items, 100)).toBe("short\n\n---\n\ntext");
  });

  test("removes oldest items first when over budget", () => {
    const items = [
      createItem("oldest content", 3),
      createItem("middle content", 2),
      createItem("newest content", 1),
    ];
    expect(truncateContext(items, 20)).toBe("newest content");
  });

  test("handles empty array", () => {
    expect(truncateContext([], 100)).toBe("");
  });
});

describe("gatherDayContext", () => {
  let testVault: string;

  beforeEach(async () => {
    testVault = await createTestDir("vault-context");
    await mkdir(join(testVault, INBOX_PATH), { recursive: true });
    await mkdir(join(testVault, PROJECTS_PATH, "project-a"), { recursive: true });
    await mkdir(join(testVault, AREAS_PATH, "area-1"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testVault, { recursive: true, force: true }).catch(() => {});
  });

  function createTestVaultInfo() {
    return createMockVault({
      path: testVault,
      contentRoot: testVault,
      inboxPath: INBOX_PATH,
    });
  }

  test("returns empty string on weekend", async () => {
    const saturday = new Date(2025, 11, 27);
    expect(await gatherDayContext(createTestVaultInfo(), saturday)).toBe("");
  });

  test("reads previous day on midweek", async () => {
    const tuesday = new Date(2025, 11, 30);
    await writeFile(
      join(testVault, INBOX_PATH, "2025-12-29.md"),
      "Monday notes"
    );

    const result = await gatherDayContext(createTestVaultInfo(), tuesday);
    expect(result).toBe("Monday notes");
  });

  test("reads previous week + projects on Monday", async () => {
    const monday = new Date(2025, 11, 29);
    await writeFile(
      join(testVault, INBOX_PATH, "2025-12-23.md"),
      "Previous week note"
    );
    await writeFile(
      join(testVault, PROJECTS_PATH, "project-a", "README.md"),
      "Project README"
    );

    const result = await gatherDayContext(createTestVaultInfo(), monday);
    expect(result).toContain("Previous week note");
    expect(result).toContain("Project README");
  });
});

describe("DAY_CONTEXT_CONFIG", () => {
  test("monday has 7 days of notes + projects", () => {
    expect(DAY_CONTEXT_CONFIG.monday.dailyNoteDays).toEqual([
      -7, -6, -5, -4, -3, -2, -1,
    ]);
    expect(DAY_CONTEXT_CONFIG.monday.additionalFolder).toBe(PROJECTS_PATH);
  });

  test("midweek has only previous day", () => {
    expect(DAY_CONTEXT_CONFIG.midweek.dailyNoteDays).toEqual([-1]);
    expect(DAY_CONTEXT_CONFIG.midweek.additionalFolder).toBeUndefined();
  });

  test("friday has Mon-Fri + areas", () => {
    expect(DAY_CONTEXT_CONFIG.friday.dailyNoteDays).toEqual([-4, -3, -2, -1, 0]);
    expect(DAY_CONTEXT_CONFIG.friday.additionalFolder).toBe(AREAS_PATH);
  });

  test("weekend has no notes but projects for context", () => {
    expect(DAY_CONTEXT_CONFIG.weekend.dailyNoteDays).toHaveLength(0);
    expect(DAY_CONTEXT_CONFIG.weekend.additionalFolder).toBe(PROJECTS_PATH);
  });
});

// =============================================================================
// Generation Needed Tests
// =============================================================================

describe("isContextualGenerationNeeded", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir("contextual-gen");
    await mkdir(join(testDir, "06_Metadata", "memory-loop"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns true when file missing", async () => {
    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isContextualGenerationNeeded(vault)).toBe(true);
  });

  test("returns false when generated today", async () => {
    const today = new Date().toISOString().split("T")[0];
    await writeContextualFile(testDir, today);

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isContextualGenerationNeeded(vault)).toBe(false);
  });

  test("returns true when generated yesterday", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await writeContextualFile(testDir, yesterday.toISOString().split("T")[0]);

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isContextualGenerationNeeded(vault)).toBe(true);
  });
});

describe("isQuoteGenerationNeeded", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir("quote-gen");
    await mkdir(join(testDir, "06_Metadata", "memory-loop"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns true when file missing", async () => {
    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isQuoteGenerationNeeded(vault)).toBe(true);
  });

  test("returns false for current week file", async () => {
    const today = new Date();
    await writeQuoteFile(
      testDir,
      today.toISOString().split("T")[0],
      getISOWeekNumber(today)
    );

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isQuoteGenerationNeeded(vault)).toBe(false);
  });

  test("returns true for last week file", async () => {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    await writeQuoteFile(
      testDir,
      lastWeek.toISOString().split("T")[0],
      getISOWeekNumber(lastWeek)
    );

    const vault = createMockVault({ path: testDir, contentRoot: testDir });
    expect(await isQuoteGenerationNeeded(vault)).toBe(true);
  });
});

// =============================================================================
// Formatting Tests
// =============================================================================

describe("formatInspirationItem", () => {
  test("formats with and without attribution", () => {
    expect(formatInspirationItem({ text: "Quote" })).toBe('- "Quote"');
    expect(formatInspirationItem({ text: "Quote", attribution: "Author" })).toBe(
      '- "Quote" -- Author'
    );
  });
});

describe("formatGenerationMarker", () => {
  test("formats with and without week number", () => {
    const date = new Date(2025, 11, 26);
    expect(formatGenerationMarker(date)).toBe(
      "<!-- last-generated: 2025-12-26 -->"
    );
    expect(formatGenerationMarker(date, 52)).toBe(
      "<!-- last-generated: 2025-12-26 (week 52) -->"
    );
  });
});

// =============================================================================
// File Writing Tests
// =============================================================================

describe("appendToInspirationFile", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await createTestDir("append");
    testFile = join(testDir, "test-inspiration.md");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("creates file with marker and entries", async () => {
    await appendToInspirationFile(testFile, [
      { text: "New quote", attribution: "Author" },
    ]);

    const content = await readFile(testFile, "utf-8");
    expect(content).toMatch(/<!-- last-generated: \d{4}-\d{2}-\d{2} -->/);
    expect(content).toContain("New quote");
  });

  test("preserves existing entries", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(
      testFile,
      `<!-- last-generated: 2025-12-25 -->\n\n- "First"\n`
    );

    await appendToInspirationFile(testFile, [{ text: "Second" }]);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("First");
    expect(content).toContain("Second");
  });

  test("includes week number when specified", async () => {
    await appendToInspirationFile(testFile, [{ text: "Quote" }], 52);

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("(week 52)");
  });
});

describe("prunePool", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await createTestDir("prune");
    testFile = join(testDir, "test-inspiration.md");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("does nothing when under limit", async () => {
    await writeFile(
      testFile,
      `<!-- last-generated: 2025-12-26 -->\n\n- "Quote 1"\n- "Quote 2"\n`
    );

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    expect(result).toContain("Quote 1");
    expect(result).toContain("Quote 2");
  });

  test("removes oldest entries when over limit", async () => {
    const quotes = Array.from(
      { length: 10 },
      (_, i) => `- "Item-${String(i + 1).padStart(2, "0")}"`
    ).join("\n");
    await writeFile(testFile, `<!-- last-generated: 2025-12-26 -->\n\n${quotes}\n`);

    await prunePool(testFile, 5);

    const result = await readFile(testFile, "utf-8");
    expect(result).not.toContain("Item-01");
    expect(result).toContain("Item-06");
    expect(result).toContain("Item-10");
  });

  test("handles missing file gracefully", async () => {
    await prunePool(join(testDir, "nonexistent.md"), 5);
    // No error thrown = success
  });
});

describe("appendAndPrune", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await createTestDir("append-prune");
    testFile = join(testDir, "test-inspiration.md");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("appends and prunes in one operation", async () => {
    const initial = Array.from({ length: 48 }, (_, i) => `- "Old ${i + 1}"`).join(
      "\n"
    );
    await writeFile(
      testFile,
      `<!-- last-generated: 2025-12-25 -->\n\n${initial}\n`
    );

    const newEntries = Array.from({ length: 5 }, (_, i) => ({
      text: `New ${i + 1}`,
    }));
    await appendAndPrune(testFile, newEntries);

    const parsed = await parseInspirationFile(testFile);
    expect(parsed.items.length).toBe(MAX_POOL_SIZE);
    expect(parsed.items.some((i) => i.text === "New 5")).toBe(true);
  });
});

// =============================================================================
// AI Response Parsing Tests
// =============================================================================

describe("parseAIResponse", () => {
  test("parses valid lines, skips invalid", () => {
    const response = `- "First quote"
This is not a quote
- "Second quote" -- Author`;

    const items = parseAIResponse(response);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ text: "First quote" });
    expect(items[1]).toEqual({ text: "Second quote", attribution: "Author" });
  });

  test("handles empty response", () => {
    expect(parseAIResponse("")).toEqual([]);
    expect(parseAIResponse("   \n\n   ")).toEqual([]);
  });
});

// =============================================================================
// SDK Generation Tests
// =============================================================================

describe("generateContextualPrompts", () => {
  afterEach(() => _resetForTesting());

  test("returns empty for empty context", async () => {
    expect(await generateContextualPrompts("")).toEqual([]);
  });

  test("calls SDK with correct model and parses response", async () => {
    let capturedArgs: { prompt: string; options: { model: string } } | null =
      null;

    configureSdkForTesting(
      createMockQueryFn(
        '- "What energizes you?"\n- "Build on momentum?"',
        (args) => {
          capturedArgs = args;
        }
      )
    );

    const items = await generateContextualPrompts("Test context");

    expect(capturedArgs!.options.model).toBe(GENERATION_MODEL);
    expect(capturedArgs!.prompt).toContain("Test context");
    expect(items).toHaveLength(2);
  });

  test("truncates long context", async () => {
    let capturedPrompt = "";
    configureSdkForTesting(
      createMockQueryFn("", (args) => {
        capturedPrompt = args.prompt;
      })
    );

    const marker = "ZZZZ";
    const longContext = marker.repeat(
      Math.ceil((MAX_GENERATION_CONTEXT + 500) / marker.length)
    );
    await generateContextualPrompts(longContext.slice(0, MAX_GENERATION_CONTEXT + 500));

    const markerMatches = capturedPrompt.match(new RegExp(marker, "g")) || [];
    expect(markerMatches.length).toBe(Math.floor(MAX_GENERATION_CONTEXT / marker.length));
  });

  test("returns empty on SDK error", async () => {
    configureSdkForTesting(createErrorMockQueryFn("SDK error"));
    expect(await generateContextualPrompts("context")).toEqual([]);
  });
});

describe("generateInspirationQuote", () => {
  afterEach(() => _resetForTesting());

  test("parses quote with attribution", async () => {
    configureSdkForTesting(
      createMockQueryFn('- "Great work comes from love." -- Steve Jobs')
    );

    const items = await generateInspirationQuote();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      text: "Great work comes from love.",
      attribution: "Steve Jobs",
    });
  });

  test("handles multiple response events", async () => {
    configureSdkForTesting(
      createMultiResponseMockQueryFn(['- "First part', ' continued" -- Author'])
    );

    const items = await generateInspirationQuote();

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("First part continued");
  });

  test("returns empty on SDK error", async () => {
    configureSdkForTesting(createErrorMockQueryFn("API error"));
    expect(await generateInspirationQuote()).toEqual([]);
  });
});

describe("generateWeekendPrompts", () => {
  afterEach(() => _resetForTesting());

  test("generates creative prompts with correct model", async () => {
    let capturedArgs: { prompt: string; options: { model: string } } | null =
      null;

    configureSdkForTesting(
      createMockQueryFn('- "What would you create?"', (args) => {
        capturedArgs = args;
      })
    );

    const items = await generateWeekendPrompts();

    expect(capturedArgs!.options.model).toBe(GENERATION_MODEL);
    expect(capturedArgs!.prompt).toContain("creative prompts");
    expect(items).toHaveLength(1);
  });

  test("uses light context nudge when context provided", async () => {
    let capturedPrompt = "";
    configureSdkForTesting(
      createMockQueryFn("", (args) => {
        capturedPrompt = args.prompt;
      })
    );

    await generateWeekendPrompts("Some vault context");

    expect(capturedPrompt).toContain("various projects");
    expect(capturedPrompt).not.toContain("Some vault context");
  });
});

// =============================================================================
// Random Selection Tests
// =============================================================================

describe("selectRandom", () => {
  test("returns undefined for empty array", () => {
    expect(selectRandom([])).toBeUndefined();
  });

  test("returns the item for single-element array", () => {
    const item = { text: "Only" };
    expect(selectRandom([item])).toBe(item);
  });

  test("returns item from array (statistical)", () => {
    const items = ["a", "b", "c", "d", "e"];
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = selectRandom(items);
      if (result) results.add(result);
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("selectWeightedRandom", () => {
  test("returns undefined for empty array", () => {
    expect(selectWeightedRandom([])).toBeUndefined();
  });

  test("returns item from array", () => {
    const items = [{ text: "First" }, { text: "Second" }];
    expect(items).toContain(selectWeightedRandom(items)!);
  });

  test("biases toward recent items (end of array)", () => {
    const items = ["oldest", "old", "middle", "recent", "newest"];
    const counts: Record<string, number> = Object.fromEntries(
      items.map((i) => [i, 0])
    );

    for (let i = 0; i < 10000; i++) {
      const result = selectWeightedRandom(items);
      if (result) counts[result]++;
    }

    // With linear weighting, newest should be ~5x more likely than oldest
    const ratio = counts.newest / counts.oldest;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(7);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("Constants", () => {
  test("file paths are correct", () => {
    expect(CONTEXTUAL_PROMPTS_PATH).toBe(
      "06_Metadata/memory-loop/contextual-prompts.md"
    );
    expect(GENERAL_INSPIRATION_PATH).toBe(
      "06_Metadata/memory-loop/general-inspiration.md"
    );
  });

  test("pool and generation limits", () => {
    expect(MAX_POOL_SIZE).toBe(50);
    expect(GENERATION_MODEL).toBe("haiku");
    expect(MAX_GENERATION_CONTEXT).toBe(3000);
  });

  test("FALLBACK_QUOTE is the Steve Jobs quote", () => {
    expect(FALLBACK_QUOTE.text).toBe(
      "The only way to do great work is to love what you do."
    );
    expect(FALLBACK_QUOTE.attribution).toBe("Steve Jobs");
  });
});

// =============================================================================
// getInspiration Integration Tests
// =============================================================================

describe("getInspiration", () => {
  let testVaultPath: string;

  beforeEach(async () => {
    testVaultPath = await createTestDir("inspiration-integration");
    await mkdir(join(testVaultPath, INBOX_PATH), { recursive: true });
    await mkdir(join(testVaultPath, "06_Metadata", "memory-loop"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    _resetForTesting();
    await rm(testVaultPath, { recursive: true, force: true }).catch(() => {});
  });

  function createTestVaultInfo() {
    return createMockVault({
      path: testVaultPath,
      contentRoot: testVaultPath,
      inboxPath: INBOX_PATH,
    });
  }

  test("returns fallback quote when file missing", async () => {
    configureSdkForTesting(createMockQueryFn(""));

    const result = await getInspiration(createTestVaultInfo());

    expect(result.quote).toEqual(FALLBACK_QUOTE);
  });

  test("selects from existing quote file", async () => {
    await writeFile(
      join(testVaultPath, GENERAL_INSPIRATION_PATH),
      `<!-- last-generated: 2025-12-26 (week 52) -->

- "First wisdom" -- Author A
- "Second wisdom" -- Author B
`
    );
    configureSdkForTesting(createMockQueryFn(""));

    const result = await getInspiration(createTestVaultInfo());

    expect(result.quote.text).toMatch(/First wisdom|Second wisdom/);
  });

  test("triggers generation when file missing", async () => {
    let queryWasCalled = false;
    configureSdkForTesting(
      createMockQueryFn('- "Generated quote" -- AI', () => {
        queryWasCalled = true;
      })
    );

    await getInspiration(createTestVaultInfo());

    expect(queryWasCalled).toBe(true);
  });

  test("does not trigger generation when files fresh", async () => {
    const today = new Date();
    const dateStr = formatDateForDailyNote(today);
    const week = getISOWeekNumber(today);

    await writeFile(
      join(testVaultPath, CONTEXTUAL_PROMPTS_PATH),
      `<!-- last-generated: ${dateStr} -->\n- "Fresh prompt"\n`
    );
    await writeFile(
      join(testVaultPath, GENERAL_INSPIRATION_PATH),
      `<!-- last-generated: ${dateStr} (week ${week}) -->\n- "Fresh quote" -- Author\n`
    );

    let queryWasCalled = false;
    configureSdkForTesting(
      createMockQueryFn("", () => {
        queryWasCalled = true;
      })
    );

    await getInspiration(createTestVaultInfo());

    expect(queryWasCalled).toBe(false);
  });

  test("handles errors gracefully", async () => {
    configureSdkForTesting(createErrorMockQueryFn("SDK error"));

    const result = await getInspiration(createTestVaultInfo());

    expect(result.quote).toEqual(FALLBACK_QUOTE);
  });

  test("writes generated quote to file", async () => {
    configureSdkForTesting(
      createMockQueryFn('- "Newly generated" -- AI Author')
    );

    await getInspiration(createTestVaultInfo());

    const content = await readFile(
      join(testVaultPath, GENERAL_INSPIRATION_PATH),
      "utf-8"
    );
    expect(content).toContain("Newly generated");
  });
});
