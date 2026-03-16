/**
 * Vault API Integration Test
 *
 * End-to-end test that validates the vault API works through the HTTP layer.
 * Uses temp directories with fixture vaults for isolation.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server";
import { initVaultCache, resetCache } from "../vault";

const startTime = Date.now();
const app = createApp(startTime);
let testVaultsDir: string;

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(path, init);
}

async function createFixtureVault(name: string, claudeMdContent: string, config?: Record<string, unknown>): Promise<void> {
  const vaultPath = join(testVaultsDir, name);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "CLAUDE.md"), claudeMdContent, "utf-8");
  if (config) {
    await writeFile(join(vaultPath, ".memory-loop.json"), JSON.stringify(config, null, 2), "utf-8");
  }
}

describe("Vault API Integration", () => {
  beforeAll(async () => {
    testVaultsDir = join(
      tmpdir(),
      `vault-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testVaultsDir, { recursive: true });

    // Set env so vault-manager uses our test directory
    process.env.VAULTS_DIR = testVaultsDir;

    // Create two fixture vaults
    await createFixtureVault("work-notes", "# Work Notes\n\nDaily work journal.\n");
    await createFixtureVault("personal", "# Personal - My Life\n\nPersonal notes.\n", {
      title: "Personal Vault",
      subtitle: "My Notes",
      order: 1,
    });

    // Initialize cache with fixture vaults
    await initVaultCache();
  });

  afterAll(async () => {
    resetCache();
    delete process.env.VAULTS_DIR;
    try {
      await rm(testVaultsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // =========================================================================
  // GET /vaults
  // =========================================================================

  test("GET /vaults returns both fixture vaults", async () => {
    const res = await request("GET", "/vaults");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { vaults: Array<{ id: string; name: string }> };
    expect(body.vaults).toHaveLength(2);

    const ids = body.vaults.map((v) => v.id);
    expect(ids).toContain("work-notes");
    expect(ids).toContain("personal");
  });

  test("GET /vaults returns vaults sorted by order then name", async () => {
    const res = await request("GET", "/vaults");
    const body = (await res.json()) as { vaults: Array<{ id: string; order: number }> };

    // personal has order=1, work-notes has default order (999)
    expect(body.vaults[0].id).toBe("personal");
    expect(body.vaults[1].id).toBe("work-notes");
  });

  // =========================================================================
  // GET /vaults/:id
  // =========================================================================

  test("GET /vaults/:id returns the correct vault", async () => {
    const res = await request("GET", "/vaults/work-notes");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; name: string; path: string };
    expect(body.id).toBe("work-notes");
    expect(body.name).toBe("Work Notes");
    expect(body.path).toBe(join(testVaultsDir, "work-notes"));
  });

  test("GET /vaults/:id returns 404 for nonexistent vault", async () => {
    const res = await request("GET", "/vaults/nonexistent");
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("VAULT_NOT_FOUND");
  });

  test("GET /vaults/:id returns config-overridden title", async () => {
    const res = await request("GET", "/vaults/personal");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; name: string; subtitle: string };
    expect(body.name).toBe("Personal Vault");
    expect(body.subtitle).toBe("My Notes");
  });

  // =========================================================================
  // POST /vaults
  // =========================================================================

  test("POST /vaults creates a new vault", async () => {
    const res = await request("POST", "/vaults", { title: "Test Vault" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe("Test Vault");
    expect(body.id).toBe("test-vault");
  });

  test("GET /vaults returns three vaults after creation", async () => {
    const res = await request("GET", "/vaults");
    const body = (await res.json()) as { vaults: Array<{ id: string }> };
    expect(body.vaults.length).toBeGreaterThanOrEqual(3);

    const ids = body.vaults.map((v) => v.id);
    expect(ids).toContain("test-vault");
  });

  test("POST /vaults with empty title returns 400", async () => {
    const res = await request("POST", "/vaults", { title: "" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_TITLE");
  });

  test("POST /vaults without title returns 400", async () => {
    const res = await request("POST", "/vaults", {});
    expect(res.status).toBe(400);
  });

  // =========================================================================
  // GET/PUT /vaults/:id/config
  // =========================================================================

  test("GET /vaults/:id/config returns vault config", async () => {
    const res = await request("GET", "/vaults/personal/config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { title: string; subtitle: string };
    expect(body.title).toBe("Personal Vault");
    expect(body.subtitle).toBe("My Notes");
  });

  test("GET /vaults/:id/config returns {} for unconfigured vault", async () => {
    const res = await request("GET", "/vaults/work-notes/config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).length).toBe(0);
  });

  test("PUT /vaults/:id/config updates config", async () => {
    const res = await request("PUT", "/vaults/work-notes/config", {
      title: "Updated Work Notes",
      discussionModel: "sonnet",
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { title: string; discussionModel: string };
    expect(body.title).toBe("Updated Work Notes");
    expect(body.discussionModel).toBe("sonnet");
  });

  test("GET /vaults/:id/config reflects PUT changes", async () => {
    const res = await request("GET", "/vaults/work-notes/config");
    const body = (await res.json()) as { title: string; discussionModel: string };
    expect(body.title).toBe("Updated Work Notes");
    expect(body.discussionModel).toBe("sonnet");
  });

  test("PUT /vaults/:id/config returns 404 for nonexistent vault", async () => {
    const res = await request("PUT", "/vaults/nonexistent/config", { title: "Nope" });
    expect(res.status).toBe(404);
  });

  // =========================================================================
  // GET/PUT /vaults/:id/config/slash-commands
  // =========================================================================

  test("GET /vaults/:id/config/slash-commands returns null when no cache", async () => {
    const res = await request("GET", "/vaults/work-notes/config/slash-commands");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { commands: null };
    expect(body.commands).toBeNull();
  });

  test("PUT /vaults/:id/config/slash-commands saves commands", async () => {
    const commands = [
      { name: "/commit", description: "Create a commit" },
      { name: "/review", description: "Review code", argumentHint: "file" },
    ];
    const res = await request("PUT", "/vaults/work-notes/config/slash-commands", { commands });
    expect(res.status).toBe(200);
  });

  test("GET /vaults/:id/config/slash-commands returns saved commands", async () => {
    const res = await request("GET", "/vaults/work-notes/config/slash-commands");
    const body = (await res.json()) as { commands: Array<{ name: string; description: string }> };
    expect(body.commands).toHaveLength(2);
    expect(body.commands[0].name).toBe("/commit");
    expect(body.commands[1].name).toBe("/review");
  });

  // =========================================================================
  // GET /health (vault count)
  // =========================================================================

  test("GET /health shows accurate vault count", async () => {
    const res = await request("GET", "/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { vaults: number };
    expect(body.vaults).toBeGreaterThanOrEqual(3);
  });

  // =========================================================================
  // GET /vaults/help
  // =========================================================================

  test("GET /vaults/help returns vault endpoint discovery", async () => {
    const res = await request("GET", "/vaults/help");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { resource: string; endpoints: Array<{ path: string }> };
    expect(body.resource).toBe("vaults");
    expect(body.endpoints.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // GET /help (includes vault endpoints)
  // =========================================================================

  test("GET /help includes vault endpoints", async () => {
    const res = await request("GET", "/help");
    const body = (await res.json()) as { endpoints: Array<{ path: string }> };

    const vaultEndpoints = body.endpoints.filter((e) => e.path.startsWith("/vaults"));
    expect(vaultEndpoints.length).toBeGreaterThan(0);
  });
});
