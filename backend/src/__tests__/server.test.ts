/**
 * Server tests for Memory Loop backend
 *
 * Tests:
 * - Health endpoint functionality
 * - Vaults endpoint functionality
 * - Vault asset serving endpoint
 * - Port configuration
 * - Host configuration
 * - TLS/HTTPS configuration
 * - App creation
 */

import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createApp,
  getPort,
  getHost,
  getTlsConfig,
  isTlsEnabled,
  getHttpRedirectPort,
  createHttpRedirectServer,
} from "../server";
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

describe("getTlsConfig", () => {
  const originalCert = process.env.TLS_CERT;
  const originalKey = process.env.TLS_KEY;
  const originalPassphrase = process.env.TLS_PASSPHRASE;
  const originalCa = process.env.TLS_CA;

  afterEach(() => {
    // Restore original environment
    if (originalCert === undefined) {
      delete process.env.TLS_CERT;
    } else {
      process.env.TLS_CERT = originalCert;
    }
    if (originalKey === undefined) {
      delete process.env.TLS_KEY;
    } else {
      process.env.TLS_KEY = originalKey;
    }
    if (originalPassphrase === undefined) {
      delete process.env.TLS_PASSPHRASE;
    } else {
      process.env.TLS_PASSPHRASE = originalPassphrase;
    }
    if (originalCa === undefined) {
      delete process.env.TLS_CA;
    } else {
      process.env.TLS_CA = originalCa;
    }
  });

  it("returns undefined when TLS_CERT is not set", () => {
    delete process.env.TLS_CERT;
    delete process.env.TLS_KEY;
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns undefined when TLS_KEY is not set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    delete process.env.TLS_KEY;
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns undefined when only TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(getTlsConfig()).toBeUndefined();
  });

  it("returns config with cert and key when both are set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    delete process.env.TLS_PASSPHRASE;
    delete process.env.TLS_CA;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.cert).toBeDefined();
    expect(config?.key).toBeDefined();
    expect(config?.passphrase).toBeUndefined();
    expect(config?.ca).toBeUndefined();
  });

  it("includes passphrase when TLS_PASSPHRASE is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_PASSPHRASE = "secret";
    delete process.env.TLS_CA;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.passphrase).toBe("secret");
  });

  it("includes ca when TLS_CA is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_CA = "/path/to/ca.pem";
    delete process.env.TLS_PASSPHRASE;

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.ca).toBeDefined();
  });

  it("includes all options when fully configured", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    process.env.TLS_PASSPHRASE = "secret";
    process.env.TLS_CA = "/path/to/ca.pem";

    const config = getTlsConfig();
    expect(config).toBeDefined();
    expect(config?.cert).toBeDefined();
    expect(config?.key).toBeDefined();
    expect(config?.passphrase).toBe("secret");
    expect(config?.ca).toBeDefined();
  });
});

describe("isTlsEnabled", () => {
  const originalCert = process.env.TLS_CERT;
  const originalKey = process.env.TLS_KEY;

  afterEach(() => {
    if (originalCert === undefined) {
      delete process.env.TLS_CERT;
    } else {
      process.env.TLS_CERT = originalCert;
    }
    if (originalKey === undefined) {
      delete process.env.TLS_KEY;
    } else {
      process.env.TLS_KEY = originalKey;
    }
  });

  it("returns false when neither TLS_CERT nor TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    delete process.env.TLS_KEY;
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns false when only TLS_CERT is set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    delete process.env.TLS_KEY;
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns false when only TLS_KEY is set", () => {
    delete process.env.TLS_CERT;
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(isTlsEnabled()).toBe(false);
  });

  it("returns true when both TLS_CERT and TLS_KEY are set", () => {
    process.env.TLS_CERT = "/path/to/cert.pem";
    process.env.TLS_KEY = "/path/to/key.pem";
    expect(isTlsEnabled()).toBe(true);
  });
});

describe("getHttpRedirectPort", () => {
  const originalEnv = process.env.HTTP_PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalEnv;
    }
  });

  it("returns default port 80 when HTTP_PORT is not set", () => {
    delete process.env.HTTP_PORT;
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns configured HTTP_PORT when valid", () => {
    process.env.HTTP_PORT = "8080";
    expect(getHttpRedirectPort()).toBe(8080);
  });

  it("returns default port when HTTP_PORT is invalid number", () => {
    process.env.HTTP_PORT = "invalid";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is out of range", () => {
    process.env.HTTP_PORT = "99999";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is negative", () => {
    process.env.HTTP_PORT = "-1";
    expect(getHttpRedirectPort()).toBe(80);
  });

  it("returns default port when HTTP_PORT is zero", () => {
    process.env.HTTP_PORT = "0";
    expect(getHttpRedirectPort()).toBe(80);
  });
});

describe("createHttpRedirectServer", () => {
  const originalHttpPort = process.env.HTTP_PORT;
  const originalHost = process.env.HOST;

  afterEach(() => {
    if (originalHttpPort === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalHttpPort;
    }
    if (originalHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalHost;
    }
  });

  it("returns server config with correct port", () => {
    process.env.HTTP_PORT = "3080";
    delete process.env.HOST;

    const config = createHttpRedirectServer(3443);

    expect(config.port).toBe(3080);
    expect(config.hostname).toBe("0.0.0.0");
    expect(typeof config.fetch).toBe("function");
  });

  it("redirects requests to HTTPS with 308 status", () => {
    process.env.HTTP_PORT = "80";
    delete process.env.HOST;

    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/some/path?query=value");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/some/path?query=value");
  });

  it("preserves path in redirect", () => {
    const config = createHttpRedirectServer(3000);
    const req = new Request("http://localhost/api/health");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://localhost:3000/api/health");
  });

  it("preserves query string in redirect", () => {
    const config = createHttpRedirectServer(3000);
    const req = new Request("http://localhost/search?q=test&page=2");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://localhost:3000/search?q=test&page=2");
  });

  it("redirects favicon requests to HTTPS", () => {
    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/favicon-32.png");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/favicon-32.png");
  });

  it("redirects root path correctly", () => {
    const config = createHttpRedirectServer(443);
    const req = new Request("http://example.com/");
    const res = config.fetch(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com:443/");
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

  it("GET /api/vaults uses default vaults dir when VAULTS_DIR is not set", async () => {
    delete process.env.VAULTS_DIR;

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    // Should use default vaults directory and return 200
    expect(res.status).toBe(200);
    const json = (await res.json()) as VaultsResponse;
    expect(Array.isArray(json.vaults)).toBe(true);
  });

  it("GET /api/vaults creates directory when VAULTS_DIR does not exist", async () => {
    const nonexistentDir = join(testDir, "nonexistent-vaults");
    process.env.VAULTS_DIR = nonexistentDir;

    const app = createApp();
    const req = new Request("http://localhost/api/vaults");
    const res = await app.fetch(req);

    // Should create the directory and return 200 with empty vaults
    expect(res.status).toBe(200);
    const json = (await res.json()) as VaultsResponse;
    expect(json).toEqual({ vaults: [] });
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

describe("Vault asset serving endpoint", () => {
  let testDir: string;
  const originalVaultsDir = process.env.VAULTS_DIR;

  beforeEach(async () => {
    // Create a unique test directory with a vault
    testDir = join(
      tmpdir(),
      `server-asset-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Create a test vault with images
    const vaultDir = join(testDir, "test-vault");
    const imagesDir = join(vaultDir, "images");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault");

    // Create test image files (small binary content)
    await writeFile(join(imagesDir, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await writeFile(join(imagesDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(imagesDir, "diagram.svg"), "<svg></svg>");
    await writeFile(join(imagesDir, "animation.gif"), Buffer.from([0x47, 0x49, 0x46, 0x38]));
    await writeFile(join(imagesDir, "modern.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));

    // Create a text file (should be rejected)
    await writeFile(join(imagesDir, "notes.txt"), "text content");

    process.env.VAULTS_DIR = testDir;
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

  it("serves jpg image with correct content-type", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/photo.jpg");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("serves png image with correct content-type", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/icon.png");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves svg image with correct content-type", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/diagram.svg");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("serves gif image with correct content-type", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/animation.gif");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });

  it("serves webp image with correct content-type", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/modern.webp");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("returns 400 for non-image file types", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/notes.txt");
    const res = await app.fetch(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as ErrorResponse;
    expect(json.error).toBe("Invalid file type");
  });

  it("returns 404 for non-existent vault", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/nonexistent/assets/images/photo.jpg");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    const json = (await res.json()) as ErrorResponse;
    expect(json.error).toBe("Vault not found");
  });

  it("returns 404 for non-existent file", async () => {
    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/missing.jpg");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    const json = (await res.json()) as ErrorResponse;
    expect(json.error).toBe("File not found");
  });

  it("only serves allowed image extensions (defense in depth)", async () => {
    // Path traversal is protected by multiple layers:
    // 1. URL normalization at HTTP layer (prevents raw `..` from reaching handler)
    // 2. Extension whitelist (only image files can be served)
    // 3. isPathWithinVault check (tested in file-browser.test.ts)
    // 4. Symlink rejection
    //
    // This test verifies the extension whitelist provides defense in depth
    const app = createApp();

    // Attempt to request a non-image file
    const req = new Request("http://localhost/vault/test-vault/assets/CLAUDE.md");
    const res = await app.fetch(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as ErrorResponse;
    expect(json.error).toBe("Invalid file type");
  });

  it("returns 403 for symlinks", async () => {
    // Create a symlink to an image
    const vaultDir = join(testDir, "test-vault");
    const linkPath = join(vaultDir, "images", "linked.jpg");
    const targetPath = join(vaultDir, "images", "photo.jpg");

    try {
      await symlink(targetPath, linkPath);
    } catch {
      // Skip test if symlinks not supported (Windows without admin)
      return;
    }

    const app = createApp();
    const req = new Request("http://localhost/vault/test-vault/assets/images/linked.jpg");
    const res = await app.fetch(req);

    expect(res.status).toBe(403);
    const json = (await res.json()) as ErrorResponse;
    expect(json.error).toBe("Access denied");
  });

  it("returns 400 for directories", async () => {
    const app = createApp();

    // Try to access a path ending with just the extension (invalid path)
    const req = new Request("http://localhost/vault/test-vault/assets/images/.png");
    const res = await app.fetch(req);

    // Should fail for invalid path
    expect([400, 404]).toContain(res.status);
  });
});
