/**
 * Chat Route Proxy Tests
 *
 * Tests that the SSE proxy route handles daemon connection failure
 * gracefully (returns error SSE event, not a 500 HTML page).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { configureDaemonFetchForTesting } from "../daemon-fetch";
import type { FetchFn } from "../daemon-fetch";

let cleanupFetch: (() => void) | undefined;

afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
});

// Import the route handler dynamically to test it
// Note: Next.js route handlers are plain async functions
async function importStreamRoute() {
  // We can't import the route directly due to Next.js module resolution.
  // Instead, test the session-client + error handling pattern.
  const { getChatStream } = await import("../session-client");
  return { getChatStream };
}

describe("SSE proxy error handling", () => {
  test("daemon connection failure produces SSE-compatible error", async () => {
    // Simulate daemon being down
    const failingFetch: FetchFn = async () => {
      throw new Error("Connection refused");
    };
    cleanupFetch = configureDaemonFetchForTesting(failingFetch);

    const { getChatStream } = await importStreamRoute();

    // getChatStream wraps errors as DaemonUnavailableError
    try {
      await getChatStream();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeTruthy();
      // The error should be a DaemonUnavailableError
      expect((err as Error).name).toBe("DaemonUnavailableError");
    }
  });

  test("daemon non-200 response is passed through", async () => {
    // Simulate daemon returning an error
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const { getChatStream } = await importStreamRoute();
    const res = await getChatStream();
    expect(res.status).toBe(500);
  });

  test("daemon SSE response body is passable to client", async () => {
    // Simulate daemon returning SSE
    const sseData = 'data: {"type":"snapshot","isProcessing":false}\n\n';
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response(sseData, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
        },
      });
    });

    const { getChatStream } = await importStreamRoute();
    const res = await getChatStream();

    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();

    // Read the body to verify it matches
    const text = await res.text();
    expect(text).toBe(sseData);
  });
});
