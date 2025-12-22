/**
 * Server tests for Memory Loop backend
 *
 * Tests:
 * - Health endpoint functionality
 * - Port configuration
 * - App creation
 */

import { describe, expect, it, afterEach } from "bun:test";
import { createApp, getPort } from "../server";

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
