/**
 * Daily Prep Manager Tests
 *
 * Tests for reading and parsing daily prep files.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VaultInfo } from "@/lib/schemas";
import {
  formatDateAsYYYYMMDD,
  getDailyPrepDir,
  getDailyPrepFilePath,
  parseFrontmatter,
  readDailyPrep,
  getDailyPrepStatus,
  DAILY_PREP_DIR,
} from "../daily-prep-manager";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `daily-prep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

function createTestVault(testDir: string, inboxPath = "00_Inbox"): VaultInfo {
  return {
    id: "test-vault",
    name: "Test Vault",
    path: testDir,
    hasClaudeMd: true,
    contentRoot: testDir,
    inboxPath,
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: true,
    discussionModel: "opus",
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    recentCaptures: 5,
    recentDiscussions: 5,
    badges: [],
    order: 0,
    cardsEnabled: true,
    viMode: false,
  };
}

// =============================================================================
// formatDateAsYYYYMMDD Tests
// =============================================================================

describe("formatDateAsYYYYMMDD", () => {
  test("formats date correctly", () => {
    const date = new Date(2026, 1, 2); // Feb 2, 2026
    expect(formatDateAsYYYYMMDD(date)).toBe("2026-02-02");
  });

  test("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDateAsYYYYMMDD(date)).toBe("2026-01-05");
  });

  test("handles December correctly", () => {
    const date = new Date(2026, 11, 31); // Dec 31, 2026
    expect(formatDateAsYYYYMMDD(date)).toBe("2026-12-31");
  });
});

// =============================================================================
// Path Helper Tests
// =============================================================================

describe("getDailyPrepDir", () => {
  test("returns correct path with default inbox", () => {
    const vault = createTestVault("/vault");
    expect(getDailyPrepDir(vault)).toBe(`/vault/00_Inbox/${DAILY_PREP_DIR}`);
  });

  test("returns correct path with custom inbox", () => {
    const vault = createTestVault("/vault", "Inbox");
    expect(getDailyPrepDir(vault)).toBe(`/vault/Inbox/${DAILY_PREP_DIR}`);
  });
});

describe("getDailyPrepFilePath", () => {
  test("returns correct file path", () => {
    const vault = createTestVault("/vault");
    const date = new Date(2026, 1, 2);
    expect(getDailyPrepFilePath(vault, date)).toBe(
      `/vault/00_Inbox/${DAILY_PREP_DIR}/2026-02-02.md`
    );
  });
});

// =============================================================================
// parseFrontmatter Tests
// =============================================================================

describe("parseFrontmatter", () => {
  test("parses simple key-value pairs", () => {
    const content = `---
date: 2026-02-02
energy: steady
calendar: scattered
---

# Content`;

    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm?.date).toBe("2026-02-02");
    expect(fm?.energy).toBe("steady");
    expect(fm?.calendar).toBe("scattered");
  });

  test("parses array of objects", () => {
    const content = `---
date: 2026-02-02
commitment:
  - text: Review PR
    assessment: done
  - text: Write spec
    assessment: partial
    note: Only got halfway
---`;

    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(Array.isArray(fm?.commitment)).toBe(true);
    expect(fm?.commitment).toHaveLength(2);

    const items = fm?.commitment as Array<{ text: string; assessment: string; note?: string }>;
    expect(items[0].text).toBe("Review PR");
    expect(items[0].assessment).toBe("done");
    expect(items[1].text).toBe("Write spec");
    expect(items[1].assessment).toBe("partial");
    expect(items[1].note).toBe("Only got halfway");
  });

  test("parses nested closure object", () => {
    const content = `---
date: 2026-02-02
closure:
  completed_at: "2026-02-02T17:30:00Z"
  reflection: Good day overall
---`;

    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(fm?.closure).toBeDefined();

    const closure = fm?.closure as { completed_at: string; reflection: string };
    expect(closure.completed_at).toBe("2026-02-02T17:30:00Z");
    expect(closure.reflection).toBe("Good day overall");
  });

  test("returns null when no frontmatter", () => {
    const content = `# Just Content

No frontmatter here.`;

    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null when frontmatter not closed", () => {
    const content = `---
date: 2026-02-02

# Missing closing delimiter`;

    expect(parseFrontmatter(content)).toBeNull();
  });

  test("handles quoted strings", () => {
    const content = `---
date: "2026-02-02"
note: 'single quotes work too'
---`;

    const fm = parseFrontmatter(content);
    expect(fm?.date).toBe("2026-02-02");
    expect(fm?.note).toBe("single quotes work too");
  });

  test("handles null values", () => {
    const content = `---
date: 2026-02-02
assessment: null
---`;

    const fm = parseFrontmatter(content);
    expect(fm?.assessment).toBeNull();
  });

  test("handles boolean values", () => {
    const content = `---
active: true
archived: false
---`;

    const fm = parseFrontmatter(content);
    expect(fm?.active).toBe(true);
    expect(fm?.archived).toBe(false);
  });
});

// =============================================================================
// readDailyPrep Tests
// =============================================================================

describe("readDailyPrep", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns null when file does not exist", async () => {
    const vault = createTestVault(testDir);
    const result = await readDailyPrep(vault, new Date(2026, 1, 2));
    expect(result).toBeNull();
  });

  test("reads and parses valid daily prep file", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    const content = `---
date: 2026-02-02
energy: sharp
calendar: clear
commitment:
  - text: Review Roman's PR
    assessment: done
  - text: Write ADR
    assessment: null
---

# Daily Prep: 2026-02-02

Content here.`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const result = await readDailyPrep(vault, new Date(2026, 1, 2));

    expect(result).not.toBeNull();
    expect(result?.date).toBe("2026-02-02");
    expect(result?.energy).toBe("sharp");
    expect(result?.calendar).toBe("clear");
    expect(result?.commitment).toHaveLength(2);
    expect(result?.commitment?.[0].text).toBe("Review Roman's PR");
    expect(result?.commitment?.[0].assessment).toBe("done");
    expect(result?.commitment?.[1].assessment).toBeNull();
  });

  test("returns null for file without date in frontmatter", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    const content = `---
energy: sharp
---

Missing date field.`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const result = await readDailyPrep(vault, new Date(2026, 1, 2));
    expect(result).toBeNull();
  });

  test("validates energy values", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    // Invalid energy value should be ignored
    const content = `---
date: 2026-02-02
energy: invalid
---`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const result = await readDailyPrep(vault, new Date(2026, 1, 2));
    expect(result).not.toBeNull();
    expect(result?.energy).toBeUndefined();
  });

  test("validates calendar values", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    // Invalid calendar value should be ignored
    const content = `---
date: 2026-02-02
calendar: invalid
---`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const result = await readDailyPrep(vault, new Date(2026, 1, 2));
    expect(result).not.toBeNull();
    expect(result?.calendar).toBeUndefined();
  });
});

// =============================================================================
// getDailyPrepStatus Tests
// =============================================================================

describe("getDailyPrepStatus", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns exists:false when no prep file", async () => {
    const vault = createTestVault(testDir);
    const status = await getDailyPrepStatus(vault, new Date(2026, 1, 2));

    expect(status.exists).toBe(false);
    expect(status.commitment).toBeUndefined();
    expect(status.energy).toBeUndefined();
    expect(status.calendar).toBeUndefined();
  });

  test("returns full status when prep file exists", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    const content = `---
date: 2026-02-02
energy: steady
calendar: scattered
commitment:
  - text: Review PR
    assessment: done
  - text: Write spec
    assessment: null
---`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const status = await getDailyPrepStatus(vault, new Date(2026, 1, 2));

    expect(status.exists).toBe(true);
    expect(status.energy).toBe("steady");
    expect(status.calendar).toBe("scattered");
    expect(status.commitment).toEqual(["Review PR", "Write spec"]);
  });

  test("returns status without optional fields", async () => {
    const vault = createTestVault(testDir);
    const prepDir = join(testDir, "00_Inbox", DAILY_PREP_DIR);
    await mkdir(prepDir, { recursive: true });

    // Minimal valid prep file
    const content = `---
date: 2026-02-02
---`;

    await writeFile(join(prepDir, "2026-02-02.md"), content);

    const status = await getDailyPrepStatus(vault, new Date(2026, 1, 2));

    expect(status.exists).toBe(true);
    expect(status.commitment).toBeUndefined();
    expect(status.energy).toBeUndefined();
    expect(status.calendar).toBeUndefined();
  });
});
