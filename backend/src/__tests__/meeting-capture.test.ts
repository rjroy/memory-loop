/**
 * Meeting Capture Tests
 *
 * Unit tests for meeting note creation, file management, and capture routing.
 * Uses filesystem mocking with temp directories to test all scenarios.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo } from "@memory-loop/shared";
import {
  slugifyTitle,
  getMeetingFilename,
  generateMeetingFrontmatter,
  generateMeetingTemplate,
  getMeetingsDirectory,
  startMeeting,
  captureToMeeting,
  stopMeeting,
  toMeetingState,
  countMeetingEntries,
  MeetingCaptureError,
  type ActiveMeeting,
} from "../meeting-capture";

// =============================================================================
// Title Slugification Tests
// =============================================================================

describe("slugifyTitle", () => {
  test("converts to lowercase", () => {
    expect(slugifyTitle("Q3 Planning")).toBe("q3-planning");
  });

  test("replaces spaces with hyphens", () => {
    expect(slugifyTitle("Team Sync Meeting")).toBe("team-sync-meeting");
  });

  test("removes special characters", () => {
    expect(slugifyTitle("Design Review (v2)")).toBe("design-review-v2");
  });

  test("collapses multiple hyphens", () => {
    expect(slugifyTitle("A -- B")).toBe("a-b");
  });

  test("removes leading and trailing hyphens", () => {
    expect(slugifyTitle("  Meeting  ")).toBe("meeting");
  });

  test("handles unicode characters", () => {
    expect(slugifyTitle("Café Planning")).toBe("caf-planning");
  });

  test("handles empty string", () => {
    expect(slugifyTitle("")).toBe("");
  });

  test("handles only special characters", () => {
    expect(slugifyTitle("!@#$%")).toBe("");
  });

  test("preserves numbers", () => {
    expect(slugifyTitle("Sprint 42 Retro")).toBe("sprint-42-retro");
  });
});

// =============================================================================
// Filename Generation Tests
// =============================================================================

describe("getMeetingFilename", () => {
  test("generates filename with date prefix and title slug", () => {
    const date = new Date(2026, 0, 15); // January 15, 2026
    expect(getMeetingFilename("Q3 Planning", date)).toBe(
      "2026-01-15-q3-planning.md"
    );
  });

  test("handles special characters in title", () => {
    const date = new Date(2026, 0, 15);
    expect(getMeetingFilename("Design (v2) Review!", date)).toBe(
      "2026-01-15-design-v2-review.md"
    );
  });

  test("uses current date when not provided", () => {
    const filename = getMeetingFilename("Test Meeting");
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(filename).toContain(dateStr);
    expect(filename).toContain("test-meeting.md");
  });
});

// =============================================================================
// Frontmatter Generation Tests
// =============================================================================

describe("generateMeetingFrontmatter", () => {
  test("generates valid YAML frontmatter with date", () => {
    const date = new Date(2026, 0, 15);
    const frontmatter = generateMeetingFrontmatter("Q3 Planning", date);
    expect(frontmatter).toContain("---\n");
    expect(frontmatter).toContain("date: 2026-01-15");
  });

  test("includes title in frontmatter", () => {
    const date = new Date(2026, 0, 15);
    const frontmatter = generateMeetingFrontmatter("Q3 Planning", date);
    expect(frontmatter).toContain('title: "Q3 Planning"');
  });

  test("escapes quotes in title", () => {
    const date = new Date(2026, 0, 15);
    const frontmatter = generateMeetingFrontmatter('Review "Design"', date);
    expect(frontmatter).toContain('title: "Review \\"Design\\""');
  });

  test("includes empty attendees array", () => {
    const date = new Date(2026, 0, 15);
    const frontmatter = generateMeetingFrontmatter("Test", date);
    expect(frontmatter).toContain("attendees: []");
  });

  test("ends with closing delimiter and blank line", () => {
    const date = new Date(2026, 0, 15);
    const frontmatter = generateMeetingFrontmatter("Test", date);
    expect(frontmatter).toMatch(/---\n\n$/);
  });
});

// =============================================================================
// Template Generation Tests
// =============================================================================

describe("generateMeetingTemplate", () => {
  test("includes frontmatter", () => {
    const date = new Date(2026, 0, 15);
    const template = generateMeetingTemplate("Q3 Planning", date);
    expect(template).toContain("---");
    expect(template).toContain("date: 2026-01-15");
  });

  test("includes h1 heading with title", () => {
    const date = new Date(2026, 0, 15);
    const template = generateMeetingTemplate("Q3 Planning", date);
    expect(template).toContain("# Q3 Planning");
  });

  test("includes ## Capture section", () => {
    const date = new Date(2026, 0, 15);
    const template = generateMeetingTemplate("Q3 Planning", date);
    expect(template).toContain("## Capture");
  });

  test("has correct structure", () => {
    const date = new Date(2026, 0, 15);
    const template = generateMeetingTemplate("Test", date);
    expect(template).toBe(`---
date: 2026-01-15
title: "Test"
attendees: []
---

# Test

## Capture

`);
  });
});

// =============================================================================
// Meetings Directory Tests
// =============================================================================

describe("getMeetingsDirectory", () => {
  test("returns path within inbox", () => {
    const vault: VaultInfo = {
      id: "test",
      name: "Test",
      path: "/vaults/test",
      hasClaudeMd: true,
      contentRoot: "/vaults/test",
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };
    const dir = getMeetingsDirectory(vault);
    expect(dir).toBe("/vaults/test/00_Inbox/meetings");
  });

  test("handles custom inbox path", () => {
    const vault: VaultInfo = {
      id: "test",
      name: "Test",
      path: "/vaults/custom",
      hasClaudeMd: true,
      contentRoot: "/vaults/custom",
      inboxPath: "Custom/Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };
    const dir = getMeetingsDirectory(vault);
    expect(dir).toBe("/vaults/custom/Custom/Inbox/meetings");
  });
});

// =============================================================================
// MeetingCaptureError Tests
// =============================================================================

describe("MeetingCaptureError", () => {
  test("has correct name property", () => {
    const error = new MeetingCaptureError("Test message");
    expect(error.name).toBe("MeetingCaptureError");
  });

  test("is instance of Error", () => {
    const error = new MeetingCaptureError("Test message");
    expect(error).toBeInstanceOf(Error);
  });

  test("preserves error message", () => {
    const error = new MeetingCaptureError("Custom error message");
    expect(error.message).toBe("Custom error message");
  });
});

// =============================================================================
// toMeetingState Tests
// =============================================================================

describe("toMeetingState", () => {
  test("returns inactive state when meeting is null", () => {
    const state = toMeetingState(null);
    expect(state).toEqual({ isActive: false });
  });

  test("returns active state with meeting info", () => {
    const meeting: ActiveMeeting = {
      title: "Q3 Planning",
      filePath: "/vaults/test/00_Inbox/meetings/2026-01-15-q3-planning.md",
      relativePath: "00_Inbox/meetings/2026-01-15-q3-planning.md",
      startedAt: "2026-01-15T10:00:00.000Z",
      entryCount: 5,
    };
    const state = toMeetingState(meeting);
    expect(state.isActive).toBe(true);
    expect(state.title).toBe("Q3 Planning");
    expect(state.filePath).toBe("00_Inbox/meetings/2026-01-15-q3-planning.md");
    expect(state.startedAt).toBe("2026-01-15T10:00:00.000Z");
  });
});

// =============================================================================
// countMeetingEntries Tests
// =============================================================================

describe("countMeetingEntries", () => {
  test("counts entries in capture section", () => {
    const content = `---
date: 2026-01-15
title: "Test"
attendees: []
---

# Test

## Capture

- [10:00] First entry
- [10:15] Second entry
- [10:30] Third entry
`;
    expect(countMeetingEntries(content)).toBe(3);
  });

  test("returns 0 for empty capture section", () => {
    const content = `---
date: 2026-01-15
title: "Test"
attendees: []
---

# Test

## Capture

`;
    expect(countMeetingEntries(content)).toBe(0);
  });

  test("returns 0 for missing capture section", () => {
    const content = `---
date: 2026-01-15
title: "Test"
attendees: []
---

# Test

Some content without capture section.
`;
    expect(countMeetingEntries(content)).toBe(0);
  });

  test("ignores entries outside capture section", () => {
    const content = `---
date: 2026-01-15
title: "Test"
attendees: []
---

# Test

## Capture

- [10:00] Captured entry

## Other Section

- [11:00] Not a capture
`;
    expect(countMeetingEntries(content)).toBe(1);
  });

  test("handles CRLF line endings", () => {
    const content =
      "---\r\ndate: 2026-01-15\r\ntitle: \"Test\"\r\nattendees: []\r\n---\r\n\r\n# Test\r\n\r\n## Capture\r\n\r\n- [10:00] Entry\r\n";
    expect(countMeetingEntries(content)).toBe(1);
  });
});

// =============================================================================
// Integration Tests with Real Filesystem
// =============================================================================

describe("startMeeting Integration", () => {
  let testDir: string;
  let vault: VaultInfo;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `meeting-capture-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      contentRoot: testDir,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates meetings directory if not exists", async () => {
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, "Test Meeting", date);

    expect(result.success).toBe(true);
    const meetingsDir = join(testDir, "00_Inbox", "meetings");
    const { stat } = await import("node:fs/promises");
    const stats = await stat(meetingsDir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("creates meeting file with template", async () => {
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, "Q3 Planning", date);

    expect(result.success).toBe(true);
    expect(result.meeting).toBeDefined();

    const filePath = result.meeting!.filePath;
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain('title: "Q3 Planning"');
    expect(content).toContain("# Q3 Planning");
    expect(content).toContain("## Capture");
  });

  test("returns meeting state with correct paths", async () => {
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, "Test Meeting", date);

    expect(result.success).toBe(true);
    const meeting = result.meeting!;
    expect(meeting.title).toBe("Test Meeting");
    expect(meeting.relativePath).toBe(
      "00_Inbox/meetings/2026-01-15-test-meeting.md"
    );
    expect(meeting.entryCount).toBe(0);
    expect(meeting.startedAt).toBe(date.toISOString());
  });

  test("returns error for empty title", async () => {
    const result = await startMeeting(vault, "", new Date());
    expect(result.success).toBe(false);
    expect(result.error).toContain("title is required");
  });

  test("returns error for whitespace-only title", async () => {
    const result = await startMeeting(vault, "   ", new Date());
    expect(result.success).toBe(false);
    expect(result.error).toContain("title is required");
  });

  test("returns error if meeting file already exists", async () => {
    const date = new Date(2026, 0, 15, 10, 0);

    // Create first meeting
    const result1 = await startMeeting(vault, "Test Meeting", date);
    expect(result1.success).toBe(true);

    // Try to create another with same title on same day
    const result2 = await startMeeting(vault, "Test Meeting", date);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("already exists");
  });

  test("trims whitespace from title", async () => {
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, "  Test Meeting  ", date);

    expect(result.success).toBe(true);
    expect(result.meeting!.title).toBe("Test Meeting");
  });
});

describe("captureToMeeting Integration", () => {
  let testDir: string;
  let vault: VaultInfo;
  let meeting: ActiveMeeting;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `meeting-capture-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      contentRoot: testDir,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };

    // Start a meeting to get active meeting state
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, "Test Meeting", date);
    meeting = result.meeting!;
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("appends capture with timestamp", async () => {
    const date = new Date(2026, 0, 15, 10, 30);
    const result = await captureToMeeting(meeting, "First thought", date);

    expect(result.success).toBe(true);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain("- [10:30] First thought");
  });

  test("increments entry count", async () => {
    const date = new Date(2026, 0, 15, 10, 30);
    expect(meeting.entryCount).toBe(0);

    await captureToMeeting(meeting, "First", date);
    expect(meeting.entryCount).toBe(1);

    await captureToMeeting(meeting, "Second", date);
    expect(meeting.entryCount).toBe(2);
  });

  test("preserves previous captures", async () => {
    await captureToMeeting(meeting, "First", new Date(2026, 0, 15, 10, 0));
    await captureToMeeting(meeting, "Second", new Date(2026, 0, 15, 10, 15));
    await captureToMeeting(meeting, "Third", new Date(2026, 0, 15, 10, 30));

    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain("- [10:00] First");
    expect(content).toContain("- [10:15] Second");
    expect(content).toContain("- [10:30] Third");
  });

  test("returns error for empty text", async () => {
    const result = await captureToMeeting(meeting, "", new Date());
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty text");
  });

  test("returns error for whitespace-only text", async () => {
    const result = await captureToMeeting(meeting, "   ", new Date());
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty text");
  });

  test("handles special characters in text", async () => {
    const date = new Date(2026, 0, 15, 10, 30);
    const text = "Check [[linked note]] and #tags";
    const result = await captureToMeeting(meeting, text, date);

    expect(result.success).toBe(true);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain(text);
  });

  test("handles unicode in text", async () => {
    const date = new Date(2026, 0, 15, 10, 30);
    const text = "Meeting notes 📝 and ☕ break";
    const result = await captureToMeeting(meeting, text, date);

    expect(result.success).toBe(true);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain(text);
  });

  test("handles multiline text", async () => {
    const date = new Date(2026, 0, 15, 10, 30);
    const text = "Line one\nLine two\nLine three";
    const result = await captureToMeeting(meeting, text, date);

    expect(result.success).toBe(true);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain(text);
  });

  test("returns error if file was deleted", async () => {
    // Delete the meeting file
    await rm(meeting.filePath);

    const result = await captureToMeeting(meeting, "Test", new Date());
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read");
  });
});

describe("stopMeeting Integration", () => {
  let testDir: string;
  let vault: VaultInfo;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `meeting-capture-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      contentRoot: testDir,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns file content", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Test Meeting", startDate);
    const meeting = startResult.meeting!;

    // Add some captures
    await captureToMeeting(meeting, "First note", new Date(2026, 0, 15, 10, 5));
    await captureToMeeting(
      meeting,
      "Second note",
      new Date(2026, 0, 15, 10, 10)
    );

    const result = await stopMeeting(meeting);

    expect(result.success).toBe(true);
    expect(result.content).toContain('title: "Test Meeting"');
    expect(result.content).toContain("- [10:05] First note");
    expect(result.content).toContain("- [10:10] Second note");
  });

  test("returns entry count", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Test Meeting", startDate);
    const meeting = startResult.meeting!;

    await captureToMeeting(meeting, "Note 1", new Date());
    await captureToMeeting(meeting, "Note 2", new Date());
    await captureToMeeting(meeting, "Note 3", new Date());

    const result = await stopMeeting(meeting);

    expect(result.success).toBe(true);
    expect(result.entryCount).toBe(3);
  });

  test("returns relative file path", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Test Meeting", startDate);
    const meeting = startResult.meeting!;

    const result = await stopMeeting(meeting);

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(
      "00_Inbox/meetings/2026-01-15-test-meeting.md"
    );
  });

  test("returns error if file was deleted", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Test Meeting", startDate);
    const meeting = startResult.meeting!;

    // Delete the file
    await rm(meeting.filePath);

    const result = await stopMeeting(meeting);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read");
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
      `meeting-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    vault = {
      id: "test-vault",
      name: "Test Vault",
      path: testDir,
      hasClaudeMd: true,
      contentRoot: testDir,
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 1,
      badges: [],
      order: 999999,
    cardsEnabled: true,
      viMode: false,
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("handles very long meeting title", async () => {
    const longTitle = "A".repeat(200);
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, longTitle, date);

    expect(result.success).toBe(true);
    expect(result.meeting!.title).toBe(longTitle);
  });

  test("handles midnight meeting start", async () => {
    const date = new Date(2026, 0, 15, 0, 0);
    const result = await startMeeting(vault, "Midnight Meeting", date);

    expect(result.success).toBe(true);
    const content = await readFile(result.meeting!.filePath, "utf-8");
    expect(content).toContain("date: 2026-01-15");
  });

  test("handles 23:59 capture", async () => {
    const startDate = new Date(2026, 0, 15, 23, 0);
    const startResult = await startMeeting(vault, "Late Meeting", startDate);
    const meeting = startResult.meeting!;

    const captureDate = new Date(2026, 0, 15, 23, 59);
    await captureToMeeting(meeting, "Late night thought", captureDate);

    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain("- [23:59] Late night thought");
  });

  test("handles meeting title with quotes", async () => {
    const date = new Date(2026, 0, 15, 10, 0);
    const result = await startMeeting(vault, 'Review "Design" Document', date);

    expect(result.success).toBe(true);
    const content = await readFile(result.meeting!.filePath, "utf-8");
    expect(content).toContain('title: "Review \\"Design\\" Document"');
  });

  test("handles multiple meetings on different days", async () => {
    const date1 = new Date(2026, 0, 15, 10, 0);
    const date2 = new Date(2026, 0, 16, 10, 0);

    const result1 = await startMeeting(vault, "Same Title", date1);
    const result2 = await startMeeting(vault, "Same Title", date2);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.meeting!.filePath).not.toBe(result2.meeting!.filePath);
  });

  test("handles very long capture text", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Test", startDate);
    const meeting = startResult.meeting!;

    const longText = "A".repeat(10000);
    const result = await captureToMeeting(meeting, longText, new Date());

    expect(result.success).toBe(true);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain(longText);
  });

  test("handles many captures in one meeting", async () => {
    const startDate = new Date(2026, 0, 15, 10, 0);
    const startResult = await startMeeting(vault, "Marathon Meeting", startDate);
    const meeting = startResult.meeting!;

    // Add 50 captures
    for (let i = 0; i < 50; i++) {
      const captureDate = new Date(2026, 0, 15, 10, i);
      await captureToMeeting(meeting, `Note ${i + 1}`, captureDate);
    }

    expect(meeting.entryCount).toBe(50);
    const content = await readFile(meeting.filePath, "utf-8");
    expect(content).toContain("- [10:00] Note 1");
    expect(content).toContain("- [10:49] Note 50");
  });
});
