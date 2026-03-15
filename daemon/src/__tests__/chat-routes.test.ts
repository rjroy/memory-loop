/**
 * Chat Routes Integration Tests
 *
 * Tests the daemon's session/chat API surface via Hono's test request method.
 * Uses a mock SDK to avoid real API calls.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../server";
import { resetController } from "../session-controller";
import { configureSdkForTesting, _resetForTesting } from "../sdk-provider";
import { discoverVaults } from "../vault/vault-manager";

let cleanupSdk: (() => void) | undefined;
const startTime = Date.now();

// Set up test environment
const originalVaultsDir = process.env.VAULTS_DIR;
const originalMockSdk = process.env.MOCK_SDK;

beforeEach(async () => {
  // Configure mock SDK
  const mockQuery = (async () => ({
    content: [{ type: "text" as const, text: "Mock response" }],
    model: "test",
    id: "msg_test",
    role: "assistant" as const,
    stop_reason: "end_turn",
    type: "message" as const,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  })) as never;
  cleanupSdk = configureSdkForTesting(mockQuery);

  // Reset controller state
  resetController();
});

afterEach(() => {
  cleanupSdk?.();
  _resetForTesting();
  resetController();

  // Restore env
  if (originalVaultsDir !== undefined) {
    process.env.VAULTS_DIR = originalVaultsDir;
  } else {
    delete process.env.VAULTS_DIR;
  }
  if (originalMockSdk !== undefined) {
    process.env.MOCK_SDK = originalMockSdk;
  } else {
    delete process.env.MOCK_SDK;
  }
});

describe("POST /session/chat/send", () => {
  test("returns 400 for invalid JSON", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/send", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  test("returns 400 for missing required fields", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/send", {
      method: "POST",
      body: JSON.stringify({ vaultId: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for empty prompt", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/send", {
      method: "POST",
      body: JSON.stringify({
        vaultId: "test",
        vaultPath: "/tmp/test",
        prompt: "",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /session/chat/stream", () => {
  test("returns SSE with snapshot event", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Read first event
    const text = await res.text();
    expect(text).toContain("data:");
    // Should contain a snapshot event (isProcessing: false since no active processing)
    expect(text).toContain('"type":"snapshot"');
  });
});

describe("POST /session/chat/abort", () => {
  test("returns 400 for invalid JSON", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/abort", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 for session mismatch", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/abort", {
      method: "POST",
      body: JSON.stringify({ sessionId: "wrong-session" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /session/chat/permission", () => {
  test("returns 400 for missing fields", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/permission", {
      method: "POST",
      body: JSON.stringify({ sessionId: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 for session mismatch", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/permission", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "wrong",
        toolUseId: "tool-1",
        allowed: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /session/chat/answer", () => {
  test("returns 400 for missing fields", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/answer", {
      method: "POST",
      body: JSON.stringify({ sessionId: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 for session mismatch", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/chat/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "wrong",
        toolUseId: "tool-1",
        answers: { q1: "a1" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /session/clear", () => {
  test("returns success", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/clear", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe("GET /session/state", () => {
  test("returns session state", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string | null; isStreaming: boolean };
    expect(body).toHaveProperty("sessionId");
    expect(body).toHaveProperty("isStreaming");
    expect(body.isStreaming).toBe(false);
  });
});

describe("GET /session/lookup/:vaultId", () => {
  test("returns 404 for unknown vault", async () => {
    const app = createApp(startTime);
    const res = await app.request("/session/lookup/nonexistent");
    expect(res.status).toBe(404);
  });
});
