/**
 * Note Capture Tests
 *
 * Unit tests for daily note creation, template generation, and text appending.
 * Uses filesystem mocking with temp directories to test all scenarios.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo } from "@memory-loop/shared";
import {
  formatDateForFilename,
  formatTimeForTimestamp,
  getDailyNoteFilename,
  generateDailyNoteTemplate,
  formatCaptureEntry,
  findCaptureSection,
  appendToCaptureSection,
  captureToDaily,
  NoteCaptureError,
  normalizeLineEndings,
} from "../note-capture";

// =============================================================================
// Date Formatting Tests
// =============================================================================

describe("formatDateForFilename", () => {
  test("formats date as YYYY-MM-DD", () => {
    const date = new Date(2025, 11, 22); // December 22, 2025
    expect(formatDateForFilename(date)).toBe("2025-12-22");
  });

  test("pads single-digit months with zero", () => {
    const date = new Date(2025, 0, 15); // January 15, 2025
    expect(formatDateForFilename(date)).toBe("2025-01-15");
  });

  test("pads single-digit days with zero", () => {
    const date = new Date(2025, 5, 5); // June 5, 2025
    expect(formatDateForFilename(date)).toBe("2025-06-05");
  });

  test("handles year boundary correctly", () => {
    const date = new Date(2024, 11, 31); // December 31, 2024
    expect(formatDateForFilename(date)).toBe("2024-12-31");
  });

  test("handles first day of year", () => {
    const date = new Date(2025, 0, 1); // January 1, 2025
    expect(formatDateForFilename(date)).toBe("2025-01-01");
  });
});

describe("formatTimeForTimestamp", () => {
  test("formats time as HH:MM", () => {
    const date = new Date(2025, 11, 22, 14, 30); // 2:30 PM
    expect(formatTimeForTimestamp(date)).toBe("14:30");
  });

  test("pads single-digit hours with zero", () => {
    const date = new Date(2025, 11, 22, 8, 45);
    expect(formatTimeForTimestamp(date)).toBe("08:45");
  });

  test("pads single-digit minutes with zero", () => {
    const date = new Date(2025, 11, 22, 12, 5);
    expect(formatTimeForTimestamp(date)).toBe("12:05");
  });

  test("handles midnight", () => {
    const date = new Date(2025, 11, 22, 0, 0);
    expect(formatTimeForTimestamp(date)).toBe("00:00");
  });

  test("handles 23:59", () => {
    const date = new Date(2025, 11, 22, 23, 59);
    expect(formatTimeForTimestamp(date)).toBe("23:59");
  });
});

describe("getDailyNoteFilename", () => {
  test("returns filename with .md extension", () => {
    const date = new Date(2025, 11, 22);
    expect(getDailyNoteFilename(date)).toBe("2025-12-22.md");
  });

  test("uses current date when no date provided", () => {
    const now = new Date();
    const filename = getDailyNoteFilename();
    const expected = `${formatDateForFilename(now)}.md`;
    expect(filename).toBe(expected);
  });
});

// =============================================================================
// Template Generation Tests
// =============================================================================

describe("generateDailyNoteTemplate", () => {
  test("generates template with date heading", () => {
    const date = new Date(2025, 11, 22);
    const template = generateDailyNoteTemplate(date);
    expect(template).toContain("# 2025-12-22");
  });

  test("generates template with Capture section", () => {
    const date = new Date(2025, 11, 22);
    const template = generateDailyNoteTemplate(date);
    expect(template).toContain("## Capture");
  });

  test("template has correct structure", () => {
    const date = new Date(2025, 11, 22);
    const template = generateDailyNoteTemplate(date);
    expect(template).toBe("# 2025-12-22\n\n## Capture\n\n");
  });

  test("uses current date when no date provided", () => {
    const now = new Date();
    const template = generateDailyNoteTemplate();
    const dateStr = formatDateForFilename(now);
    expect(template).toContain(`# ${dateStr}`);
  });
});

// =============================================================================
// Capture Entry Formatting Tests
// =============================================================================

describe("formatCaptureEntry", () => {
  test("formats entry with timestamp prefix", () => {
    const date = new Date(2025, 11, 22, 14, 30);
    const entry = formatCaptureEntry("My thought", date);
    expect(entry).toBe("- [14:30] My thought\n");
  });

  test("preserves text verbatim", () => {
    const date = new Date(2025, 11, 22, 9, 15);
    const text = "Remember to call mom about the holiday plans";
    const entry = formatCaptureEntry(text, date);
    expect(entry).toContain(text);
  });

  test("includes newline at end", () => {
    const date = new Date(2025, 11, 22, 12, 0);
    const entry = formatCaptureEntry("Test", date);
    expect(entry.endsWith("\n")).toBe(true);
  });

  test("handles text with special characters", () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const text = "Check [[linked note]] and #tags";
    const entry = formatCaptureEntry(text, date);
    expect(entry).toBe("- [10:00] Check [[linked note]] and #tags\n");
  });

  test("handles multi-line text", () => {
    const date = new Date(2025, 11, 22, 15, 45);
    const text = "Line one\nLine two";
    const entry = formatCaptureEntry(text, date);
    expect(entry).toBe("- [15:45] Line one\nLine two\n");
  });

  test("handles unicode", () => {
    const date = new Date(2025, 11, 22, 8, 0);
    const text = "Meeting notes \u{1F4DD}";
    const entry = formatCaptureEntry(text, date);
    expect(entry).toContain("\u{1F4DD}");
  });
});

// =============================================================================
// Capture Section Finding Tests
// =============================================================================

describe("findCaptureSection", () => {
  test("finds existing ## Capture section", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- existing item\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(true);
  });

  test("returns correct insert position after ## Capture", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(true);
    // Should insert at end of content (after the blank line following ## Capture)
    expect(result.insertPosition).toBe(content.length);
  });

  test("returns not found for missing section", () => {
    const content = "# 2025-12-22\n\n## Notes\n\nSome content\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(false);
  });

  test("handles ## Capture with existing items", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- [08:00] First item\n- [09:00] Second item\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(true);
    // Insert position should be at end of section (after existing items)
    expect(result.insertPosition).toBe(content.length);
  });

  test("handles empty content", () => {
    const result = findCaptureSection("");
    expect(result.found).toBe(false);
    expect(result.insertPosition).toBe(0);
  });

  test("ignores ### Capture (wrong level)", () => {
    const content = "# 2025-12-22\n\n### Capture\n\nContent\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(false);
  });

  test("handles ## Capture with trailing whitespace", () => {
    const content = "# 2025-12-22\n\n## Capture  \n\n";
    const result = findCaptureSection(content);
    // The trim should handle trailing whitespace
    expect(result.found).toBe(true);
  });

  test("finds end of section before next ## heading", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- Item 1\n\n## Footer\n\nFooter content.\n";
    const result = findCaptureSection(content);
    expect(result.found).toBe(true);
    // Insert position should be before ## Footer
    const footerIndex = content.indexOf("## Footer");
    expect(result.insertPosition).toBe(footerIndex);
  });
});

// =============================================================================
// Line Ending Normalization Tests
// =============================================================================

describe("normalizeLineEndings", () => {
  test("converts CRLF to LF", () => {
    const content = "Line 1\r\nLine 2\r\n";
    expect(normalizeLineEndings(content)).toBe("Line 1\nLine 2\n");
  });

  test("preserves LF-only content", () => {
    const content = "Line 1\nLine 2\n";
    expect(normalizeLineEndings(content)).toBe("Line 1\nLine 2\n");
  });

  test("handles mixed line endings", () => {
    const content = "Line 1\r\nLine 2\nLine 3\r\n";
    expect(normalizeLineEndings(content)).toBe("Line 1\nLine 2\nLine 3\n");
  });

  test("handles empty string", () => {
    expect(normalizeLineEndings("")).toBe("");
  });

  test("handles content without line endings", () => {
    const content = "Single line";
    expect(normalizeLineEndings(content)).toBe("Single line");
  });
});

// =============================================================================
// Append to Capture Section Tests
// =============================================================================

describe("appendToCaptureSection", () => {
  test("appends to existing ## Capture section", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n";
    const entry = "- [10:00] New thought\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toBe("# 2025-12-22\n\n## Capture\n\n- [10:00] New thought\n");
  });

  test("creates ## Capture section if missing", () => {
    const content = "# 2025-12-22\n\nSome notes here.\n";
    const entry = "- [10:00] New thought\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toContain("## Capture\n\n- [10:00] New thought\n");
  });

  test("preserves existing items when appending", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- [08:00] Earlier thought\n";
    const entry = "- [10:00] Later thought\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toContain("- [08:00] Earlier thought");
    expect(result).toContain("- [10:00] Later thought");
  });

  test("preserves content before ## Capture", () => {
    const content = "# 2025-12-22\n\n## Summary\n\nMy summary.\n\n## Capture\n\n";
    const entry = "- [10:00] Thought\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toContain("## Summary\n\nMy summary.");
  });

  test("preserves content after existing captures", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- [08:00] Old item\n\n## Footer\n\nFooter content.\n";
    const entry = "- [10:00] New item\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toContain("## Footer\n\nFooter content.");
  });

  test("handles content without trailing newline", () => {
    const content = "# 2025-12-22\n\nNotes";
    const entry = "- [10:00] Thought\n";
    const result = appendToCaptureSection(content, entry);
    expect(result).toContain("## Capture");
    expect(result).toContain("- [10:00] Thought");
  });

  test("new item appears after existing items (chronological order)", () => {
    const content = "# 2025-12-22\n\n## Capture\n\n- [08:00] First\n";
    const entry = "- [10:00] Second\n";
    const result = appendToCaptureSection(content, entry);
    // New items should be appended at the end of the capture section (chronological)
    const newItemIndex = result.indexOf("- [10:00] Second");
    const oldItemIndex = result.indexOf("- [08:00] First");
    expect(newItemIndex).toBeGreaterThan(oldItemIndex);
  });
});

// =============================================================================
// NoteCaptureError Tests
// =============================================================================

describe("NoteCaptureError", () => {
  test("has correct name property", () => {
    const error = new NoteCaptureError("Test message");
    expect(error.name).toBe("NoteCaptureError");
  });

  test("is instance of Error", () => {
    const error = new NoteCaptureError("Test message");
    expect(error).toBeInstanceOf(Error);
  });

  test("preserves error message", () => {
    const error = new NoteCaptureError("Custom error message");
    expect(error.message).toBe("Custom error message");
  });
});

// =============================================================================
// Integration Tests with Real Filesystem
// =============================================================================

describe("captureToDaily Integration", () => {
  let testDir: string;
  let vault: VaultInfo;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `note-capture-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Create vault structure
    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      inboxPath: "00_Inbox",
    };
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates inbox directory if not exists", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test thought", date);

    expect(result.success).toBe(true);
    const inboxPath = join(testDir, "00_Inbox");
    const { stat } = await import("node:fs/promises");
    const stats = await stat(inboxPath);
    expect(stats.isDirectory()).toBe(true);
  });

  test("creates daily note with template if not exists", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test thought", date);

    expect(result.success).toBe(true);
    const notePath = join(testDir, "00_Inbox", "2025-12-22.md");
    const content = await readFile(notePath, "utf-8");
    expect(content).toContain("# 2025-12-22");
    expect(content).toContain("## Capture");
  });

  test("appends capture with timestamp to new note", async () => {
    const date = new Date(2025, 11, 22, 14, 30);
    const result = await captureToDaily(vault, "My thought", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("- [14:30] My thought");
  });

  test("appends to existing daily note", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    // Create existing note
    const notePath = join(inboxPath, "2025-12-22.md");
    await writeFile(notePath, "# 2025-12-22\n\n## Capture\n\n- [08:00] Earlier\n");

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Later thought", date);

    expect(result.success).toBe(true);
    const content = await readFile(notePath, "utf-8");
    expect(content).toContain("- [08:00] Earlier");
    expect(content).toContain("- [10:00] Later thought");
  });

  test("preserves existing content", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    // Create note with extra sections
    const notePath = join(inboxPath, "2025-12-22.md");
    const originalContent =
      "# 2025-12-22\n\n## Summary\n\nImportant notes.\n\n## Capture\n\n- [08:00] Item\n\n## Footer\n\nMore content.\n";
    await writeFile(notePath, originalContent);

    const date = new Date(2025, 11, 22, 12, 0);
    await captureToDaily(vault, "New item", date);

    const content = await readFile(notePath, "utf-8");
    expect(content).toContain("## Summary\n\nImportant notes.");
    expect(content).toContain("## Footer\n\nMore content.");
  });

  test("returns success result with timestamp", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test", date);

    expect(result.success).toBe(true);
    expect(result.timestamp).toBe(date.toISOString());
    expect(result.notePath).toContain("2025-12-22.md");
    expect(result.error).toBeUndefined();
  });

  test("returns failure for empty text", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "", date);

    expect(result.success).toBe(false);
    expect(result.error).toContain("empty text");
  });

  test("returns failure for whitespace-only text", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "   \n\t  ", date);

    expect(result.success).toBe(false);
    expect(result.error).toContain("empty text");
  });

  test("preserves text verbatim (REQ-F-15)", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    // Text with leading/trailing spaces should be preserved exactly
    const result = await captureToDaily(vault, "  My thought  ", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    // Original text including spaces is preserved verbatim
    expect(content).toContain("- [10:00]   My thought  ");
  });

  test("handles multiple captures in one day", async () => {
    const dates = [
      new Date(2025, 11, 22, 8, 0),
      new Date(2025, 11, 22, 12, 0),
      new Date(2025, 11, 22, 18, 0),
    ];
    const thoughts = ["Morning thought", "Lunch thought", "Evening thought"];

    for (let i = 0; i < dates.length; i++) {
      const result = await captureToDaily(vault, thoughts[i], dates[i]);
      expect(result.success).toBe(true);
    }

    const notePath = join(testDir, "00_Inbox", "2025-12-22.md");
    const content = await readFile(notePath, "utf-8");

    expect(content).toContain("- [08:00] Morning thought");
    expect(content).toContain("- [12:00] Lunch thought");
    expect(content).toContain("- [18:00] Evening thought");
  });

  test("preserves text verbatim (special characters)", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const text = "Check [[meeting notes]] and review #project-alpha tasks";
    const result = await captureToDaily(vault, text, date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain(text);
  });

  test("preserves text verbatim (unicode)", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const text = "Remember: \u{1F4DD} meeting and \u{2615} break";
    const result = await captureToDaily(vault, text, date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain(text);
  });

  test("handles existing note without ## Capture section", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    // Create note without Capture section
    const notePath = join(inboxPath, "2025-12-22.md");
    await writeFile(notePath, "# 2025-12-22\n\n## Notes\n\nSome notes.\n");

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "New capture", date);

    expect(result.success).toBe(true);
    const content = await readFile(notePath, "utf-8");
    expect(content).toContain("## Notes\n\nSome notes.");
    expect(content).toContain("## Capture\n\n- [10:00] New capture");
  });

  test("uses custom inbox path from vault", async () => {
    const customVault: VaultInfo = {
      ...vault,
      inboxPath: "Custom/Inbox/Path",
    };

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(customVault, "Test", date);

    expect(result.success).toBe(true);
    expect(result.notePath).toContain("Custom/Inbox/Path");
  });

  test("uses current date/time when not provided", async () => {
    const beforeCapture = new Date();
    const result = await captureToDaily(vault, "Test thought");
    const afterCapture = new Date();

    expect(result.success).toBe(true);

    // Timestamp should be between before and after
    const captureTime = new Date(result.timestamp);
    expect(captureTime.getTime()).toBeGreaterThanOrEqual(beforeCapture.getTime());
    expect(captureTime.getTime()).toBeLessThanOrEqual(afterCapture.getTime());
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string;
  let vault: VaultInfo;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `note-capture-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      inboxPath: "00_Inbox",
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("handles very long text", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const longText = "A".repeat(10000);
    const result = await captureToDaily(vault, longText, date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain(longText);
  });

  test("handles text with newlines", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const multilineText = "Line 1\nLine 2\nLine 3";
    const result = await captureToDaily(vault, multilineText, date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain(multilineText);
  });

  test("handles text with markdown syntax", async () => {
    const date = new Date(2025, 11, 22, 10, 0);
    const markdownText = "**bold** and _italic_ and `code`";
    const result = await captureToDaily(vault, markdownText, date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain(markdownText);
  });

  test("handles Windows line endings in existing content", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    const notePath = join(inboxPath, "2025-12-22.md");
    await writeFile(notePath, "# 2025-12-22\r\n\r\n## Capture\r\n\r\n");

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("- [10:00] Test");
  });

  test("handles leap year date", async () => {
    const date = new Date(2024, 1, 29, 10, 0); // Feb 29, 2024 (leap year)
    const result = await captureToDaily(vault, "Leap day thought", date);

    expect(result.success).toBe(true);
    expect(result.notePath).toContain("2024-02-29.md");
  });

  test("handles midnight captures", async () => {
    const date = new Date(2025, 11, 22, 0, 0);
    const result = await captureToDaily(vault, "Midnight thought", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("- [00:00] Midnight thought");
  });

  test("handles 23:59 captures", async () => {
    const date = new Date(2025, 11, 22, 23, 59);
    const result = await captureToDaily(vault, "Late night thought", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("- [23:59] Late night thought");
  });

  test("handles existing note with only heading", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    const notePath = join(inboxPath, "2025-12-22.md");
    await writeFile(notePath, "# 2025-12-22\n");

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("# 2025-12-22");
    expect(content).toContain("## Capture");
    expect(content).toContain("- [10:00] Test");
  });

  test("handles empty existing file", async () => {
    const inboxPath = join(testDir, "00_Inbox");
    await mkdir(inboxPath, { recursive: true });

    const notePath = join(inboxPath, "2025-12-22.md");
    await writeFile(notePath, "");

    const date = new Date(2025, 11, 22, 10, 0);
    const result = await captureToDaily(vault, "Test", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.notePath, "utf-8");
    expect(content).toContain("## Capture");
    expect(content).toContain("- [10:00] Test");
  });
});
