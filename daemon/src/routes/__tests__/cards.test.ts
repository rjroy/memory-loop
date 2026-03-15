/**
 * Card Route Tests
 *
 * Tests for vault-scoped card endpoints: due, detail, review, archive.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server";
import { initVaultCache, resetCache } from "../../vault/vault-cache";

let app: ReturnType<typeof createApp>;
let tempDir: string;
let vaultDir: string;
let vaultId: string;

beforeEach(async () => {
  const startTime = Date.now();
  app = createApp(startTime);
  tempDir = await mkdtemp(join(tmpdir(), "card-route-test-"));
  resetCache();

  // Create a minimal vault for testing
  vaultDir = join(tempDir, "test-vault");
  await mkdir(vaultDir, { recursive: true });
  await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

  // Set env and discover vaults
  process.env.VAULTS_DIR = tempDir;
  await initVaultCache();

  // Get the vault ID from the cache
  const vaultsResponse = await app.request("/vaults");
  const vaultsBody = await vaultsResponse.json() as { vaults: Array<{ id: string }> };
  vaultId = vaultsBody.vaults[0]?.id ?? "test-vault";
});

afterEach(async () => {
  resetCache();
  delete process.env.VAULTS_DIR;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /vaults/:id/cards/due
// ---------------------------------------------------------------------------

describe("GET /vaults/:id/cards/due", () => {
  test("returns empty list when no cards exist", async () => {
    const response = await app.request(`/vaults/${vaultId}/cards/due`);
    expect(response.status).toBe(200);

    const body = await response.json() as { cards: unknown[]; count: number };
    expect(body.cards).toEqual([]);
    expect(body.count).toBe(0);
  });

  test("returns 404 for unknown vault", async () => {
    const response = await app.request("/vaults/nonexistent/cards/due");
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /vaults/:id/cards/:cardId
// ---------------------------------------------------------------------------

describe("GET /vaults/:id/cards/:cardId", () => {
  test("returns 400 for invalid card ID format", async () => {
    const response = await app.request(`/vaults/${vaultId}/cards/not-a-uuid`);
    expect(response.status).toBe(400);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 404 for nonexistent card", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/00000000-0000-0000-0000-000000000000`
    );
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /vaults/:id/cards/:cardId/review
// ---------------------------------------------------------------------------

describe("POST /vaults/:id/cards/:cardId/review", () => {
  const cardId = "00000000-0000-0000-0000-000000000000";

  test("rejects invalid JSON", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/${cardId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      },
    );
    expect(response.status).toBe(400);
  });

  test("rejects missing response field", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/${cardId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(400);
  });

  test("rejects invalid response value", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/${cardId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "invalid" }),
      },
    );
    expect(response.status).toBe(400);

    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("again, hard, good, easy");
  });

  test("rejects invalid card ID format", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/bad-id/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "good" }),
      },
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /vaults/:id/cards/:cardId/archive
// ---------------------------------------------------------------------------

describe("POST /vaults/:id/cards/:cardId/archive", () => {
  test("returns 404 for nonexistent card", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/00000000-0000-0000-0000-000000000000/archive`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });

  test("rejects invalid card ID format", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/bad-id/archive`,
      { method: "POST" },
    );
    expect(response.status).toBe(400);
  });
});
