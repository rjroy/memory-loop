/**
 * Session Client Tests
 *
 * Tests the session-client facade with mocked daemon-fetch.
 * Verifies correct URLs, methods, body serialization, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { configureDaemonFetchForTesting } from "../fetch";
import type { FetchFn } from "../fetch";

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
} from "../sessions";

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
  test("POSTs to /session/:sessionId/chat with body (no sessionId in body)", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess-123" }),
    );

    const result = await sendMessage({
      vaultId: "v1",
      vaultPath: "/vaults/v1",
      sessionId: "sess-123",
      prompt: "Hello",
    });

    expect(lastRequest?.path).toBe("/session/sess-123/chat");
    expect(lastRequest?.init?.method).toBe("POST");
    const body = JSON.parse(lastRequest?.init?.body as string);
    expect(body.vaultId).toBe("v1");
    expect(body.prompt).toBe("Hello");
    // sessionId must NOT be in the body (it is in the path)
    expect(body.sessionId).toBeUndefined();
    expect(result.sessionId).toBe("sess-123");
  });

  test("throws on 409 with ALREADY_PROCESSING code", async () => {
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
        sessionId: "sess-123",
        prompt: "Hello",
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toBe("Busy");
      expect((err as Record<string, unknown>).code).toBe("ALREADY_PROCESSING");
      expect((err as Record<string, unknown>).status).toBe(409);
    }
  });

  test("URL-encodes sessionId in path", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess/with/slashes" }),
    );

    await sendMessage({
      vaultId: "v1",
      vaultPath: "/vaults/v1",
      sessionId: "sess/with/slashes",
      prompt: "Hello",
    });

    expect(lastRequest?.path).toBe("/session/sess%2Fwith%2Fslashes/chat");
  });
});

describe("getChatStream", () => {
  test("GETs /session/:sessionId/chat (sessionId in path, no query string)", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({}),
    );

    const res = await getChatStream("sess-123");
    expect(lastRequest?.path).toBe("/session/sess-123/chat");
    expect(res.status).toBe(200);
  });
});

describe("abortProcessing", () => {
  test("POSTs to /session/:sessionId/abort (no body)", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await abortProcessing("sess-123");
    expect(lastRequest?.path).toBe("/session/sess-123/abort");
    expect(lastRequest?.init?.method).toBe("POST");
    // No body expected
    expect(lastRequest?.init?.body).toBeUndefined();
  });
});

describe("respondToPermission", () => {
  test("POSTs to /session/:sessionId/permission with toolUseId and allowed in body", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await respondToPermission("sess-123", "tool-1", true);
    expect(lastRequest?.path).toBe("/session/sess-123/permission");
    const body = JSON.parse(lastRequest?.init?.body as string);
    // sessionId must NOT be in the body (it is in the path)
    expect(body.sessionId).toBeUndefined();
    expect(body.toolUseId).toBe("tool-1");
    expect(body.allowed).toBe(true);
  });
});

describe("respondToAnswer", () => {
  test("POSTs to /session/:sessionId/answer with toolUseId and answers in body", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await respondToAnswer("sess-123", "tool-1", { q1: "a1" });
    expect(lastRequest?.path).toBe("/session/sess-123/answer");
    const body = JSON.parse(lastRequest?.init?.body as string);
    // sessionId must NOT be in the body (it is in the path)
    expect(body.sessionId).toBeUndefined();
    expect(body.toolUseId).toBe("tool-1");
    expect(body.answers).toEqual({ q1: "a1" });
  });
});

describe("clearSession", () => {
  test("POSTs to /session/:sessionId/clear", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true }),
    );

    await clearSession("sess-123");
    expect(lastRequest?.path).toBe("/session/sess-123/clear");
    expect(lastRequest?.init?.method).toBe("POST");
  });
});

describe("getSessionState", () => {
  test("GETs /session/:sessionId/state", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ sessionId: "sess-123", isProcessing: false }),
    );

    const state = await getSessionState("sess-123");
    expect(lastRequest?.path).toBe("/session/sess-123/state");
    expect(state.isProcessing).toBe(false);
  });
});

describe("lookupSession", () => {
  test("GETs /session/lookup/:vaultId (unchanged)", async () => {
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
  test("POSTs to /session/init/:vaultId (unchanged)", async () => {
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
  test("DELETEs /session/:vaultId/:sessionId (unchanged)", async () => {
    cleanupFetch = configureDaemonFetchForTesting(
      mockFetch({ success: true, deleted: true }),
    );

    const result = await deleteSessionById("v1", "sess-123");
    expect(lastRequest?.path).toBe("/session/v1/sess-123");
    expect(lastRequest?.init?.method).toBe("DELETE");
    expect(result.deleted).toBe(true);
  });
});
