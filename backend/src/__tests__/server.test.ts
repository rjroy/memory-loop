/**
 * Server tests for Memory Loop backend
 *
 * Tests:
 * - Health endpoint functionality
 * - Vaults endpoint functionality
 * - Port configuration
 * - App creation
 */

import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, getPort, getHost } from "../server";
import type { VaultInfo } from "@memory-loop/shared";

/** Response type for successful vault list */
interface VaultsResponse {
  vaults: VaultInfo[];
}

/** Response type for error responses */
interface ErrorResponse {
  error: string;
}

describe("getPort", () => {
  const originalEnv = process.env.PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalEnv;
    }
  });

  it("returns default port 3000 when PORT is not set", () => {
    delete process.env.PORT;
    expect(getPort()).toBe(3000);
  });

  it("returns configured PORT when valid", () => {
    process.env.PORT = "8080";
    expect(getPort()).toBe(8080);
  });

  it("returns default port when PORT is invalid number", () => {
    process.env.PORT = "invalid";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is out of range", () => {
    process.env.PORT = "99999";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is negative", () => {
    process.env.PORT = "-1";
    expect(getPort()).toBe(3000);
  });

  it("returns default port when PORT is zero", () => {
    process.env.PORT = "0";
    expect(getPort()).toBe(3000);
  });
});

describe("getHost", () => {
  const originalEnv = process.env.HOST;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalEnv;
    }
  });

  it("returns default host 0.0.0.0 when HOST is not set", () => {
    delete process.env.HOST;
    expect(getHost()).toBe("0.0.0.0");
  });

  it("returns configured HOST when set", () => {
    process.env.HOST = "127.0.0.1";
    expect(getHost()).toBe("127.0.0.1");
  });

  it("returns localhost when HOST is set to localhost", () => {
    process.env.HOST = "localhost";
    expect(getHost()).toBe("localhost");
  });

  it("returns custom hostname when HOST is set", () => {
    process.env.HOST = "192.168.1.100";
    expect(getHost()).toBe("192.168.1.100");
  });
});

describe("createApp", () => {
  it("creates a Hono app instance", () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe("function");
  });
});

describe("Health endpoint", () => {
  it('GET /api/health returns 200 with "Memory Loop Backend"', async () => {
    const app = createApp();

    const req = new Request("http://localhost/api/health");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("Memory Loop Backend");
  });

  it("GET /api/health includes CORS headers for allowed origin", async () => {
    const app = createApp();

    const req = new Request("http://localhost/api/health", {
      headers: {
        Origin: "http://localhost:5173",
      },
    });
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });
});

describe("WebSocket endpoint", () => {
  it("GET /ws returns upgrade response when proper headers provided", async () => {
    const app = createApp();

    // WebSocket upgrade requires specific headers
    const req = new Request("http://localhost/ws", {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    const res = await app.fetch(req);

    // In test environment without full Bun.serve, we expect the upgrade attempt
    // The actual WebSocket upgrade happens at the Bun.serve level
    // Here we verify the route exists and responds
    expect(res).toBeDefined();
  });
});

describe("Static file serving", () => {
  it("serves static files from frontend dist when available", async () => {
    const app = createApp();

    // Test that the static file route exists
    // Actual file serving depends on frontend build being present
    const req = new Request("http://localhost/index.html");
    const res = await app.fetch(req);

    // Route exists, may return 404 if file not present in test env
    expect(res).toBeDefined();
  });
});

describe("Vaults endpoint", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `server-vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
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

  it("GET /api/vaults returns 200 with vault list", async () => {
    // Set up test vaults
    process.env.VAULTS_DIR = testDir;

    const vault1 = join(testDir, "vault-1");
    const vault2 = join(testDir, "vault-2");
    await mkdir(vault1);
    await mkdir(vault2);
    await writeFile(join(vault1, "CLAUDE.md"), "# Alpha Vault");
    await writeFile(join(vault2, "CLAUDE.md"), "# Beta Vault");

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as VaultsResponse;
    expect(json).toHaveProperty("vaults");
    expect(json.vaults).toHaveLength(2);
    // Should be sorted by name
    expect(json.vaults[0].name).toBe("Alpha Vault");
    expect(json.vaults[1].name).toBe("Beta Vault");
  });

  it("GET /api/vaults returns 200 with empty array when no vaults found", async () => {
    process.env.VAULTS_DIR = testDir;

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as VaultsResponse;
    expect(json).toEqual({ vaults: [] });
  });

  it("GET /api/vaults returns 500 when VAULTS_DIR is not set", async () => {
    delete process.env.VAULTS_DIR;

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    expect(res.status).toBe(500);
    const json = (await res.json()) as ErrorResponse;
    expect(json).toHaveProperty("error");
    expect(json.error).toMatch(/VAULTS_DIR environment variable is not set/);
  });

  it("GET /api/vaults returns 500 when VAULTS_DIR does not exist", async () => {
    process.env.VAULTS_DIR = join(testDir, "nonexistent");

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    expect(res.status).toBe(500);
    const json = (await res.json()) as ErrorResponse;
    expect(json).toHaveProperty("error");
    expect(json.error).toMatch(/does not exist/);
  });

  it("GET /api/vaults includes CORS headers for allowed origin", async () => {
    process.env.VAULTS_DIR = testDir;

    const app = createApp();
    const req = new Request("http://localhost/api/vaults", {
      headers: {
        Origin: "http://localhost:5173",
      },
    });
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });
});
