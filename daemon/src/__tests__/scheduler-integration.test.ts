/**
 * Scheduler Integration Test
 *
 * End-to-end test validating the scheduler subsystems work through
 * the daemon HTTP layer. Tests extraction status/trigger, memory CRUD,
 * extraction prompt management, card operations, and card-generator config.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { initVaultCache, resetCache } from "../vault/vault-cache";
import { resetManagerState } from "../extraction/extraction-manager";
import { resetSchedulerState } from "../spaced-repetition/card-discovery-scheduler";

let app: ReturnType<typeof createApp>;
let tempDir: string;
let vaultId: string;

beforeEach(async () => {
  const startTime = Date.now();
  app = createApp(startTime);
  tempDir = await mkdtemp(join(tmpdir(), "scheduler-integration-test-"));
  resetCache();
  resetManagerState();
  resetSchedulerState();

  // Create a minimal vault
  const vaultDir = join(tempDir, "test-vault");
  await mkdir(vaultDir, { recursive: true });
  await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

  process.env.VAULTS_DIR = tempDir;
  await initVaultCache();

  const vaultsResponse = await app.request("/vaults");
  const vaultsBody = await vaultsResponse.json() as { vaults: Array<{ id: string }> };
  vaultId = vaultsBody.vaults[0]?.id ?? "test-vault";
});

afterEach(async () => {
  resetCache();
  resetManagerState();
  resetSchedulerState();
  delete process.env.VAULTS_DIR;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Health endpoint reports scheduler status
// ---------------------------------------------------------------------------

describe("Health endpoint with schedulers", () => {
  test("reports scheduler status in health response", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");

    const schedulers = body.schedulers as Record<string, { status: string }>;
    expect(schedulers.extraction.status).toBe("idle");
    expect(schedulers.cardDiscovery.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Extraction endpoints
// ---------------------------------------------------------------------------

describe("Extraction endpoints", () => {
  test("GET /config/extraction/status returns scheduler info", async () => {
    const response = await app.request("/config/extraction/status");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.schedulerRunning).toBe("boolean");
    expect(typeof body.extractionRunning).toBe("boolean");
    expect(typeof body.schedule).toBe("string");
  });

  test("POST /config/extraction/trigger returns status", async () => {
    const response = await app.request("/config/extraction/trigger", {
      method: "POST",
    });

    const body = await response.json() as { status: string };
    expect(typeof body.status).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Memory endpoints
// ---------------------------------------------------------------------------

describe("Memory endpoints", () => {
  test("GET /config/memory returns content shape", async () => {
    const response = await app.request("/config/memory");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.content).toBe("string");
    expect(typeof body.exists).toBe("boolean");
    expect(typeof body.sizeBytes).toBe("number");
  });

  test("PUT /config/memory validates input", async () => {
    const response = await app.request("/config/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Extraction prompt endpoints
// ---------------------------------------------------------------------------

describe("Extraction prompt endpoints", () => {
  test("GET /config/extraction-prompt returns prompt content", async () => {
    const response = await app.request("/config/extraction-prompt");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.content).toBe("string");
    expect(body.content).toBeTruthy();
    expect(typeof body.isOverride).toBe("boolean");
  });

  test("PUT /config/extraction-prompt rejects missing content", async () => {
    const response = await app.request("/config/extraction-prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Card endpoints (vault-scoped)
// ---------------------------------------------------------------------------

describe("Card endpoints", () => {
  test("GET /vaults/:id/cards/due returns empty list for new vault", async () => {
    const response = await app.request(`/vaults/${vaultId}/cards/due`);
    expect(response.status).toBe(200);

    const body = await response.json() as { cards: unknown[]; count: number };
    expect(body.cards).toEqual([]);
    expect(body.count).toBe(0);
  });

  test("GET /vaults/:id/cards/:cardId returns 404 for nonexistent card", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/00000000-0000-0000-0000-000000000000`,
    );
    expect(response.status).toBe(404);
  });

  test("POST /vaults/:id/cards/:cardId/review validates response", async () => {
    const response = await app.request(
      `/vaults/${vaultId}/cards/00000000-0000-0000-0000-000000000000/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "invalid" }),
      },
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Card generator config endpoints
// ---------------------------------------------------------------------------

describe("Card generator config endpoints", () => {
  test("GET /config/card-generator returns config shape", async () => {
    const response = await app.request("/config/card-generator");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.requirements).toBe("string");
    expect(typeof body.isOverride).toBe("boolean");
    expect(typeof body.weeklyByteLimit).toBe("number");
    expect(typeof body.weeklyBytesUsed).toBe("number");
  });

  test("GET /config/card-generator/status returns idle", async () => {
    const response = await app.request("/config/card-generator/status");
    expect(response.status).toBe(200);

    const body = await response.json() as { status: string };
    expect(body.status).toBe("idle");
  });

  test("POST /config/card-generator/trigger returns status", async () => {
    const response = await app.request("/config/card-generator/trigger", {
      method: "POST",
    });

    const body = await response.json() as { status: string };
    expect(typeof body.status).toBe("string");
  });
});
