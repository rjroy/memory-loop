/**
 * Chat Route Proxy Tests
 *
 * Tests that the SSE proxy (getChatStream) handles daemon connection failure
 * gracefully (DaemonUnavailableError) and passes bytes through unchanged.
 *
 * Note: The daemon no longer wraps the stream in a {type:"snapshot"} event.
 * Raw turn events (session_ready, response_start, response_chunk, etc.) are
 * replayed directly. The proxy is byte-transparent — it does not inspect them.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { configureDaemonFetchForTesting } from "../fetch";
import type { FetchFn } from "../fetch";

let cleanupFetch: (() => void) | undefined;

afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
});

async function importStreamClient() {
  const { getChatStream } = await import("../sessions");
  return { getChatStream };
}

describe("SSE proxy error handling", () => {
  test("daemon connection failure throws DaemonUnavailableError", async () => {
    const failingFetch: FetchFn = async () => {
      throw new Error("Connection refused");
    };
    cleanupFetch = configureDaemonFetchForTesting(failingFetch);

    const { getChatStream } = await importStreamClient();

    try {
      await getChatStream("sess-123");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeTruthy();
      expect((err as Error).name).toBe("DaemonUnavailableError");
    }
  });

  test("daemon non-200 response is passed through", async () => {
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const { getChatStream } = await importStreamClient();
    const res = await getChatStream("sess-123");
    expect(res.status).toBe(500);
  });

  test("daemon SSE response body is passable to client (raw turn events, no snapshot wrapper)", async () => {
    // Phase 2 daemon emits raw turn events — no {type:"snapshot"} wrapper.
    const sseData = 'data: {"type":"session_ready","sessionId":"sess-123"}\n\ndata: {"type":"response_start"}\n\n';
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response(sseData, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
        },
      });
    });

    const { getChatStream } = await importStreamClient();
    const res = await getChatStream("sess-123");

    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();

    const text = await res.text();
    expect(text).toBe(sseData);
  });

  test("uses sessionId in path (not query string)", async () => {
    let capturedPath: string | undefined;
    cleanupFetch = configureDaemonFetchForTesting(async (path: string) => {
      capturedPath = path;
      return new Response("", { status: 200 });
    });

    const { getChatStream } = await importStreamClient();
    await getChatStream("sess-abc");

    expect(capturedPath).toBe("/session/sess-abc/chat");
    expect(capturedPath).not.toContain("?");
  });
});
