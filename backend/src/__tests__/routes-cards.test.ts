/**
 * Spaced Repetition Card Routes Integration Tests
 *
 * Tests the spaced repetition card REST endpoints:
 * - GET /api/vaults/:vaultId/cards/due - Get cards due for review
 * - GET /api/vaults/:vaultId/cards/:cardId - Get full card details
 * - POST /api/vaults/:vaultId/cards/:cardId/review - Submit review response
 * - POST /api/vaults/:vaultId/cards/:cardId/archive - Archive a card
 *
 * Spec Requirements:
 * - REQ-F-17: Display question, allow reveal answer
 * - REQ-F-19: "Archive" action removes card from review queue
 * - REQ-F-26: SM-2 scheduling for cards
 *
 * @see .sdd/tasks/2026-01-21-spaced-repetition-tasks.md (TASK-004)
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { saveCard } from "../spaced-repetition/card-storage.js";
import type { Card } from "../spaced-repetition/card-schema.js";
import type { RestErrorResponse } from "../middleware/error-handler";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique test directory for vaults.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `routes-cards-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test vault with CLAUDE.md.
 */
async function createTestVault(testDir: string, vaultName: string): Promise<string> {
  const vaultPath = join(testDir, vaultName);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), `# ${vaultName}`);
  return vaultPath;
}

/**
 * Creates a test card with sensible defaults.
 */
function makeCard(overrides: Partial<Card["metadata"]> = {}, content?: Partial<Card["content"]>): Card {
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
      ...content,
    },
  };
}

// =============================================================================
// Card Routes Tests
// =============================================================================

describe("Spaced Repetition Card REST Routes", () => {
  let testDir: string;
  let app: ReturnType<typeof createApp>;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    testDir = await createTestDir();
    process.env.VAULTS_DIR = testDir;
    app = createApp();
  });

  afterEach(async () => {
    // Restore original env
    if (originalVaultsDir === undefined) {
      delete process.env.VAULTS_DIR;
    } else {
      process.env.VAULTS_DIR = originalVaultsDir;
    }

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // GET /cards/due Tests (REQ-F-17)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/cards/due", () => {
    test("returns due cards with question preview", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      // Create cards: two due, one not due
      const cardDue1 = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440001",
        next_review: "2026-01-23",
      });
      const cardDue2 = makeCard(
        {
          id: "550e8400-e29b-41d4-a716-446655440002",
          next_review: "2026-01-20",
        },
        { question: "What is 2+2?", answer: "4" }
      );
      const cardNotDue = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440003",
        next_review: "2099-12-31",
      });

      await saveCard(vault, cardDue1);
      await saveCard(vault, cardDue2);
      await saveCard(vault, cardNotDue);

      const req = new Request("http://localhost/api/vaults/test-vault/cards/due");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        cards: Array<{ id: string; question: string; next_review: string }>;
        count: number;
      };

      expect(json.count).toBe(2);
      expect(json.cards).toHaveLength(2);

      // Verify card preview structure (no answer)
      const card1 = json.cards.find((c) => c.id === "550e8400-e29b-41d4-a716-446655440001");
      expect(card1).toBeDefined();
      expect(card1?.question).toBe("What is the capital of France?");
      expect(card1?.next_review).toBe("2026-01-23");
      // Answer should NOT be included in due cards response
      expect((card1 as unknown as Record<string, unknown>).answer).toBeUndefined();

      // Verify not due card is not included
      const notDueCard = json.cards.find((c) => c.id === "550e8400-e29b-41d4-a716-446655440003");
      expect(notDueCard).toBeUndefined();
    });

    test("returns empty array when no cards exist", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/cards/due");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { cards: unknown[]; count: number };
      expect(json.cards).toEqual([]);
      expect(json.count).toBe(0);
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request("http://localhost/api/vaults/nonexistent/cards/due");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });

    test("returns 400 for invalid vault ID format", async () => {
      const req = new Request("http://localhost/api/vaults/..evil/cards/due");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // GET /cards/:cardId Tests (REQ-F-17)
  // ===========================================================================

  describe("GET /api/vaults/:vaultId/cards/:cardId", () => {
    test("returns full card details with answer", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard(
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          source_file: "notes/history.md",
        },
        { question: "What is the capital of France?", answer: "Paris" }
      );
      await saveCard(vault, card);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        id: string;
        question: string;
        answer: string;
        ease_factor: number;
        interval: number;
        repetitions: number;
        last_reviewed: string | null;
        next_review: string;
        source_file?: string;
      };

      expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(json.question).toBe("What is the capital of France?");
      expect(json.answer).toBe("Paris");
      expect(json.ease_factor).toBe(2.5);
      expect(json.interval).toBe(0);
      expect(json.repetitions).toBe(0);
      expect(json.last_reviewed).toBeNull();
      expect(json.next_review).toBe("2026-01-23");
      expect(json.source_file).toBe("notes/history.md");
    });

    test("returns 404 for non-existent card", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440099"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 for invalid card ID format", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request("http://localhost/api/vaults/test-vault/cards/not-a-uuid");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("UUID");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/cards/550e8400-e29b-41d4-a716-446655440000"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // POST /cards/:cardId/review Tests (REQ-F-26)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/cards/:cardId/review", () => {
    test("submits review and returns updated schedule", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440000",
        next_review: "2026-01-23",
        interval: 0,
        repetitions: 0,
        ease_factor: 2.5,
      });
      await saveCard(vault, card);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "good" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        id: string;
        next_review: string;
        interval: number;
        ease_factor: number;
      };

      expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      // After first "good" response, interval should be 1 day
      expect(json.interval).toBe(1);
      // Ease factor unchanged for "good"
      expect(json.ease_factor).toBe(2.5);
      // next_review should be set (exact date depends on actual today)
      expect(json.next_review).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("handles 'again' response (resets interval)", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440000",
        next_review: "2026-01-23",
        interval: 6,
        repetitions: 3,
        ease_factor: 2.5,
      });
      await saveCard(vault, card);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "again" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        interval: number;
        ease_factor: number;
      };

      // "again" resets interval to 1
      expect(json.interval).toBe(1);
      // Ease factor decreases by 0.2 (min 1.3)
      expect(json.ease_factor).toBe(2.3);
    });

    test("handles all valid response values", async () => {
      const responses = ["again", "hard", "good", "easy"];

      for (const response of responses) {
        await createTestVault(testDir, "test-vault");

        const vault = {
          contentRoot: join(testDir, "test-vault"),
          metadataPath: "06_Metadata/memory-loop",
        };

        const card = makeCard({
          id: "550e8400-e29b-41d4-a716-446655440000",
        });
        await saveCard(vault, card);

        const req = new Request(
          "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response }),
          }
        );
        const res = await app.fetch(req);

        expect(res.status).toBe(200);

        // Clean up for next iteration
        await rm(join(testDir, "test-vault"), { recursive: true, force: true });
      }
    });

    test("returns 400 for invalid response value", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      await saveCard(vault, card);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "invalid" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("invalid");
    });

    test("returns 400 for missing response field", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("response");
    });

    test("returns 400 for invalid JSON body", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Invalid JSON");
    });

    test("returns 404 for non-existent card", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440099/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "good" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 for invalid card ID format", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/not-a-uuid/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: "good" }),
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // POST /cards/:cardId/archive Tests (REQ-F-19, REQ-F-21)
  // ===========================================================================

  describe("POST /api/vaults/:vaultId/cards/:cardId/archive", () => {
    test("archives card successfully", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      await saveCard(vault, card);

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/archive",
        {
          method: "POST",
        }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const json = (await res.json()) as { id: string; archived: boolean };
      expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(json.archived).toBe(true);

      // Verify card is no longer in active cards
      const cardsDir = join(vault.contentRoot, vault.metadataPath, "cards");
      const activeCards = await readdir(cardsDir).catch(() => []);
      const hasActiveCard = activeCards.some(
        (f) => f === "550e8400-e29b-41d4-a716-446655440000.md"
      );
      expect(hasActiveCard).toBe(false);

      // Verify card is in archive
      const archiveDir = join(cardsDir, "archive");
      const archivedCards = await readdir(archiveDir);
      const hasArchivedCard = archivedCards.some(
        (f) => f === "550e8400-e29b-41d4-a716-446655440000.md"
      );
      expect(hasArchivedCard).toBe(true);
    });

    test("archived card no longer appears in due cards", async () => {
      await createTestVault(testDir, "test-vault");

      const vault = {
        contentRoot: join(testDir, "test-vault"),
        metadataPath: "06_Metadata/memory-loop",
      };

      const card = makeCard({
        id: "550e8400-e29b-41d4-a716-446655440000",
        next_review: "2026-01-23",
      });
      await saveCard(vault, card);

      // Archive the card
      const archiveReq = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440000/archive",
        { method: "POST" }
      );
      await app.fetch(archiveReq);

      // Check due cards
      const dueReq = new Request("http://localhost/api/vaults/test-vault/cards/due");
      const dueRes = await app.fetch(dueReq);

      expect(dueRes.status).toBe(200);

      const json = (await dueRes.json()) as { cards: Array<{ id: string }>; count: number };
      expect(json.count).toBe(0);
      expect(json.cards).toEqual([]);
    });

    test("returns 404 for non-existent card", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440099/archive",
        { method: "POST" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    test("returns 400 for invalid card ID format", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/not-a-uuid/archive",
        { method: "POST" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 404 for non-existent vault", async () => {
      const req = new Request(
        "http://localhost/api/vaults/nonexistent/cards/550e8400-e29b-41d4-a716-446655440000/archive",
        { method: "POST" }
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VAULT_NOT_FOUND");
    });
  });

  // ===========================================================================
  // Error Response Format Tests
  // ===========================================================================

  describe("Error Response Format", () => {
    test("error responses match RestErrorResponse schema", async () => {
      // Use invalid vault ID to trigger validation error
      const req = new Request("http://localhost/api/vaults/..evil/cards/due");
      const res = await app.fetch(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as RestErrorResponse;

      // Verify exact structure
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });

    test("card not found error has correct format", async () => {
      await createTestVault(testDir, "test-vault");

      const req = new Request(
        "http://localhost/api/vaults/test-vault/cards/550e8400-e29b-41d4-a716-446655440099"
      );
      const res = await app.fetch(req);

      expect(res.status).toBe(404);

      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });
  });
});
