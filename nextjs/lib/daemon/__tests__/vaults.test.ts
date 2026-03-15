/**
 * Daemon Vault Client Tests
 *
 * Tests the vault client facade with mocked daemon-fetch.
 * Verifies correct URLs, methods, body serialization, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { configureDaemonFetchForTesting } from "../fetch";
import type { FetchFn } from "../fetch";

import {
  discoverVaults,
  getVaultById,
  createVault,
  loadVaultConfig,
  saveVaultConfig,
  savePinnedAssets,
  loadSlashCommands,
  saveSlashCommands,
  getVaultsDir,
} from "../vaults";

let cleanupFetch: (() => void) | undefined;
let lastRequest: { path: string; init?: RequestInit } | null = null;

function mockFetch(responseBody: unknown, status = 200): FetchFn {
  return async (path: string, init?: RequestInit) => {
    lastRequest = { path, init };
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

beforeEach(() => {
  lastRequest = null;
});

afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
});

describe("discoverVaults", () => {
  test("GETs /vaults and returns vault list", async () => {
    const vaults = [{ id: "v1", name: "Vault 1", path: "/v1" }];
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ vaults }),
    );

    const result = await discoverVaults();
    expect(lastRequest?.path).toBe("/vaults");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");
  });

  test("returns empty array on error", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "fail" }, 500),
    );

    const result = await discoverVaults();
    expect(result).toEqual([]);
  });
});

describe("getVaultById", () => {
  test("GETs /vaults/:id", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ id: "v1", name: "Test" }),
    );

    const result = await getVaultById("v1");
    expect(lastRequest?.path).toBe("/vaults/v1");
    expect(result?.id).toBe("v1");
  });

  test("returns null on 404", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "not found" }, 404),
    );

    const result = await getVaultById("missing");
    expect(result).toBeNull();
  });
});

describe("createVault", () => {
  test("POSTs title to /vaults", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ id: "new-vault", name: "New Vault" }),
    );

    const result = await createVault("New Vault");
    expect(lastRequest?.path).toBe("/vaults");
    expect(lastRequest?.init?.method).toBe("POST");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.title).toBe("New Vault");
    expect(result.id).toBe("new-vault");
  });
});

describe("loadVaultConfig", () => {
  test("GETs /vaults/:id/config using vault path basename", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ systemPrompt: "test" }),
    );

    const result = await loadVaultConfig("/vaults/my-vault");
    expect(lastRequest?.path).toBe("/vaults/my-vault/config");
    expect(result).toEqual({ systemPrompt: "test" });
  });

  test("returns empty object on error", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "fail" }, 500),
    );

    const result = await loadVaultConfig("/vaults/v1");
    expect(result).toEqual({});
  });
});

describe("saveVaultConfig", () => {
  test("PUTs config to /vaults/:id/config", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    const result = await saveVaultConfig("/vaults/v1", { systemPrompt: "new" });
    expect(lastRequest?.path).toBe("/vaults/v1/config");
    expect(lastRequest?.init?.method).toBe("PUT");
    expect(result).toEqual({ success: true });
  });

  test("returns error on failure", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "bad config" }, 400),
    );

    const result = await saveVaultConfig("/vaults/v1", {});
    expect(result).toEqual({ success: false, error: "bad config" });
  });
});

describe("savePinnedAssets", () => {
  test("PUTs paths to /vaults/:id/config/pinned-assets", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await savePinnedAssets("/vaults/v1", ["a.md", "b.md"]);
    expect(lastRequest?.path).toBe("/vaults/v1/config/pinned-assets");
    expect(lastRequest?.init?.method).toBe("PUT");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.paths).toEqual(["a.md", "b.md"]);
  });
});

describe("loadSlashCommands", () => {
  test("GETs /vaults/:id/config/slash-commands", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ commands: [{ name: "test", prompt: "p" }] }),
    );

    const result = await loadSlashCommands("/vaults/v1");
    expect(lastRequest?.path).toBe("/vaults/v1/config/slash-commands");
    expect(result).toHaveLength(1);
  });

  test("returns undefined on error", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "fail" }, 500),
    );

    const result = await loadSlashCommands("/vaults/v1");
    expect(result).toBeUndefined();
  });

  test("returns undefined when commands are null", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ commands: null }),
    );

    const result = await loadSlashCommands("/vaults/v1");
    expect(result).toBeUndefined();
  });
});

describe("saveSlashCommands", () => {
  test("PUTs commands to /vaults/:id/config/slash-commands", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await saveSlashCommands("/vaults/v1", [{ name: "cmd", prompt: "p" }]);
    expect(lastRequest?.path).toBe("/vaults/v1/config/slash-commands");
    expect(lastRequest?.init?.method).toBe("PUT");
  });
});

describe("getVaultsDir", () => {
  test("reads VAULTS_DIR from environment", () => {
    const original = process.env.VAULTS_DIR;
    try {
      process.env.VAULTS_DIR = "/custom/vaults";
      expect(getVaultsDir()).toBe("/custom/vaults");
    } finally {
      if (original !== undefined) {
        process.env.VAULTS_DIR = original;
      } else {
        delete process.env.VAULTS_DIR;
      }
    }
  });
});
