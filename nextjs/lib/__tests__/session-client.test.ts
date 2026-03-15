/**
 * Session Client Tests
 *
 * Tests the session-client facade with mocked daemon-fetch.
 * Verifies correct URLs, methods, body serialization, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { configureDaemonFetchForTesting } from "../daemon-fetch";
import type { FetchFn } from "../daemon-fetch";

// Import session-client functions under test
import {
  sendMessage,
  getChatStream,
  abortProcessing,
  respondToPermission,
  respondToAnswer,
  clearSession,
  getSessionState,
  lookupSession,
  runSetup,
  getInspiration,
  initSession,
  deleteSessionById,
} from "../session-client";

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

describe("sendMessage", () => {
  test("POSTs to /session/chat/send with body", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess-123" }),
    );

    const result = await sendMessage({
      vaultId: "v1",
      vaultPath: "/vaults/v1",
      prompt: "Hello",
    });

    expect(lastRequest?.path).toBe("/session/chat/send");
    expect(lastRequest?.init?.method).toBe("POST");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.vaultId).toBe("v1");
    expect(body.prompt).toBe("Hello");
    expect(result.sessionId).toBe("sess-123");
  });

  test("throws on non-200 response with error details", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch(
        { error: { code: "ALREADY_PROCESSING", message: "Busy" } },
        409,
      ),
    );

    try {
      await sendMessage({
        vaultId: "v1",
        vaultPath: "/vaults/v1",
        prompt: "Hello",
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("Busy");
      expect((err as Record<string, unknown>).code).toBe("ALREADY_PROCESSING");
      expect((err as Record<string, unknown>).status).toBe(409);
    }
  });
});

describe("getChatStream", () => {
  test("GETs /session/chat/stream", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ type: "snapshot" }),
    );

    const res = await getChatStream();
    expect(lastRequest?.path).toBe("/session/chat/stream");
    expect(res.status).toBe(200);
  });
});

describe("abortProcessing", () => {
  test("POSTs sessionId to /session/chat/abort", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await abortProcessing("sess-123");
    expect(lastRequest?.path).toBe("/session/chat/abort");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.sessionId).toBe("sess-123");
  });
});

describe("respondToPermission", () => {
  test("POSTs to /session/chat/permission", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await respondToPermission("sess-123", "tool-1", true);
    expect(lastRequest?.path).toBe("/session/chat/permission");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.sessionId).toBe("sess-123");
    expect(body.toolUseId).toBe("tool-1");
    expect(body.allowed).toBe(true);
  });
});

describe("respondToAnswer", () => {
  test("POSTs to /session/chat/answer", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await respondToAnswer("sess-123", "tool-1", { q1: "a1" });
    expect(lastRequest?.path).toBe("/session/chat/answer");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.answers).toEqual({ q1: "a1" });
  });
});

describe("clearSession", () => {
  test("POSTs to /session/clear", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await clearSession();
    expect(lastRequest?.path).toBe("/session/clear");
    expect(lastRequest?.init?.method).toBe("POST");
  });
});

describe("getSessionState", () => {
  test("GETs /session/state", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: null, isProcessing: false }),
    );

    const state = await getSessionState();
    expect(lastRequest?.path).toBe("/session/state");
    expect(state.isProcessing).toBe(false);
  });
});

describe("lookupSession", () => {
  test("GETs /session/lookup/:vaultId", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess-456" }),
    );

    const id = await lookupSession("vault1");
    expect(lastRequest?.path).toBe("/session/lookup/vault1");
    expect(id).toBe("sess-456");
  });

  test("returns null when sessionId is null", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: null }),
    );

    const id = await lookupSession("vault1");
    expect(id).toBeNull();
  });

  test("returns null on error", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ error: "not found" }, 404),
    );

    const id = await lookupSession("missing");
    expect(id).toBeNull();
  });
});

describe("runSetup", () => {
  test("POSTs vaultId to /config/setup", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await runSetup("vault1");
    expect(lastRequest?.path).toBe("/config/setup");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.vaultId).toBe("vault1");
  });
});

describe("getInspiration", () => {
  test("GETs /inspiration with vaultId query", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ contextual: null, quote: { text: "test", attribution: "test" } }),
    );

    const result = await getInspiration("vault1");
    expect(lastRequest?.path).toBe("/inspiration?vaultId=vault1");
    expect(result.quote).toBeTruthy();
  });
});

describe("initSession", () => {
  test("POSTs to /session/init/:vaultId", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "", vaultId: "v1", messages: [] }),
    );

    await initSession("v1");
    expect(lastRequest?.path).toBe("/session/init/v1");
    expect(lastRequest?.init?.method).toBe("POST");
  });

  test("includes sessionId in body when provided", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess-123", vaultId: "v1", messages: [] }),
    );

    await initSession("v1", "sess-123");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.sessionId).toBe("sess-123");
  });
});

describe("deleteSessionById", () => {
  test("DELETEs /session/:vaultId/:sessionId", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true, deleted: true }),
    );

    const result = await deleteSessionById("v1", "sess-123");
    expect(lastRequest?.path).toBe("/session/v1/sess-123");
    expect(lastRequest?.init?.method).toBe("DELETE");
    expect(result.deleted).toBe(true);
  });
});
