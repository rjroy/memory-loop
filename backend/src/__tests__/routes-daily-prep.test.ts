/**
 * Daily Prep REST Routes Integration Tests
 *
 * Tests the daily prep REST endpoint:
 * - GET /api/vaults/:vaultId/daily-prep/today - Get today's prep status
 */

import { describe, expect, test, beforeEach, afterEach, jest, setSystemTime } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import type { RestErrorResponse } from "../middleware/error-handler";
import { DAILY_PREP_DIR, type DailyPrepStatus } from "../daily-prep-manager";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `routes-daily-prep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

async function createTestVault(
  testDir: string,
  vaultName: string,
  files: Record<string, string> = {}
): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}`);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(vaultPath, filename);
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir !== vaultPath) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content);
  }

  return vaultPath;
}

// =============================================================================
// Daily Prep Routes Tests
// =============================================================================

describe("Daily Prep REST Routes", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    jest.useFakeTimers();
    setSystemTime(new Date("2026-02-02T12:00:00.000Z"));

    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    app = createApp();
  });

  afterEach(async () => {
    jest.useRealTimers();

    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // GET /api/vaults/:vaultId/daily-prep/today Tests
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/daily-prep/today", () => {
    test("returns exists:false when no prep file exists", async () => {
      await createTestVault(testDir, "test-vault", {});

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      expect(json.exists).toBe(false);
      expect(json.commitment).toBeUndefined();
      expect(json.energy).toBeUndefined();
      expect(json.calendar).toBeUndefined();
    });

    test("returns full status when prep file exists", async () => {
      const prepContent = `---
date: 2026-02-02
energy: sharp
calendar: clear
commitment:
  - text: Review Roman's PR
    assessment: done
  - text: Write ADR
    assessment: null
---

# Daily Prep: 2026-02-02`;

      await createTestVault(testDir, "test-vault", {
        [`00_Inbox/${DAILY_PREP_DIR}/2026-02-02.md`]: prepContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      expect(json.exists).toBe(true);
      expect(json.energy).toBe("sharp");
      expect(json.calendar).toBe("clear");
      expect(json.commitment).toEqual(["Review Roman's PR", "Write ADR"]);
    });

    test("returns status without optional fields", async () => {
      const prepContent = `---
date: 2026-02-02
---`;

      await createTestVault(testDir, "test-vault", {
        [`00_Inbox/${DAILY_PREP_DIR}/2026-02-02.md`]: prepContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      expect(json.exists).toBe(true);
      expect(json.commitment).toBeUndefined();
      expect(json.energy).toBeUndefined();
      expect(json.calendar).toBeUndefined();
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("returns 400 for invalid vault ID format", async () => {
      const req = new Request("http://localhost/api/vaults/..evil/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("handles custom inbox path from config", async () => {
      const prepContent = `---
date: 2026-02-02
energy: steady
---`;

      // Create vault with custom inbox config
      await createTestVault(testDir, "test-vault", {
        ".memory-loop.json": JSON.stringify({ inboxPath: "Inbox" }),
        [`Inbox/${DAILY_PREP_DIR}/2026-02-02.md`]: prepContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      expect(json.exists).toBe(true);
      expect(json.energy).toBe("steady");
    });

    test("returns exists:false for yesterday's prep file", async () => {
      // Create prep file for yesterday (2026-02-01), but we're checking today (2026-02-02)
      const prepContent = `---
date: 2026-02-01
energy: sharp
---`;

      await createTestVault(testDir, "test-vault", {
        [`00_Inbox/${DAILY_PREP_DIR}/2026-02-01.md`]: prepContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      expect(json.exists).toBe(false);
    });

    test("handles malformed frontmatter gracefully", async () => {
      // File exists but has invalid frontmatter
      const prepContent = `---
not valid yaml: [
---

Content`;

      await createTestVault(testDir, "test-vault", {
        [`00_Inbox/${DAILY_PREP_DIR}/2026-02-02.md`]: prepContent,
      });

      const req = new Request("http://localhost/api/vaults/test-vault/daily-prep/today");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as DailyPrepStatus;
      // Should return exists:false when frontmatter can't be parsed
      expect(json.exists).toBe(false);
    });
  });
});
