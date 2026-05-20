/**
 * Mock Mode End-to-End Tests
 *
 * Verifies that the daemon operates correctly with MOCK_SDK=true,
 * producing mock responses through the full pipeline without real API calls.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../server";
import { resetController } from "../session-controller";
import {
  configurePiSessionForTesting,
  _resetPiSessionForTesting,
  type PiSessionOptions,
  type PiSessionResult,
} from "../pi-session-factory";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { isMockMode } from "../mock-sdk";

let cleanupSession: (() => void) | undefined;
const startTime = Date.now();

const originalMockSdk = process.env.MOCK_SDK;

beforeEach(() => {
  // Inject a no-op session factory to prevent real pi-agent calls
  const mockSession: (opts: PiSessionOptions) => Promise<PiSessionResult> = async () => {
    const session = {
      messages: [],
      prompt: async () => {},
      abort: () => {},
      subscribe: () => () => {},
      bindExtensions: async () => {},
      modelRegistry: { find: () => undefined },
      setModel: async () => {},
      sessionFile: undefined,
    } as unknown as AgentSession;
    return { session, jsonlPath: null };
  };
  cleanupSession = configurePiSessionForTesting(mockSession);
  resetController();
});

afterEach(() => {
  cleanupSession?.();
  _resetPiSessionForTesting();
  resetController();

  if (originalMockSdk !== undefined) {
    process.env.MOCK_SDK = originalMockSdk;
  } else {
    delete process.env.MOCK_SDK;
  }
});

function parseSSEEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data) {
        try {
          events.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
          // skip
        }
      }
    }
  }
  return events;
}

describe("mock mode detection", () => {
  test("isMockMode returns true when MOCK_SDK=true", () => {
    process.env.MOCK_SDK = "true";
    expect(isMockMode()).toBe(true);
  });

  test("isMockMode returns false when MOCK_SDK is unset", () => {
    delete process.env.MOCK_SDK;
    expect(isMockMode()).toBe(false);
  });

  test("isMockMode returns false when MOCK_SDK=false", () => {
    process.env.MOCK_SDK = "false";
    expect(isMockMode()).toBe(false);
  });
});

describe("mock mode API surface", () => {
  test("health endpoint responds in mock mode", async () => {
    process.env.MOCK_SDK = "true";
    const app = createApp(startTime);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  test("session state returns idle in mock mode", async () => {
    process.env.MOCK_SDK = "true";
    const app = createApp(startTime);
    const res = await app.request("/session/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string | null; isStreaming: boolean };
    expect(body.isStreaming).toBe(false);
    expect(body.sessionId).toBeNull();
  });

  test("SSE stream returns snapshot in mock mode", async () => {
    process.env.MOCK_SDK = "true";
    const app = createApp(startTime);
    const res = await app.request("/session/chat/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toHaveProperty("type", "snapshot");
  });

  test("clear session succeeds in mock mode", async () => {
    process.env.MOCK_SDK = "true";
    const app = createApp(startTime);
    const res = await app.request("/session/clear", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test("chat send validates request body in mock mode", async () => {
    process.env.MOCK_SDK = "true";
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
});
