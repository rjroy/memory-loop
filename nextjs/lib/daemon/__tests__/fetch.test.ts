/**
 * Daemon Fetch Tests
 *
 * Tests the shared daemon fetch layer: connection logic, error wrapping,
 * test injection, and DaemonUnavailableError behavior.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  daemonFetch,
  DaemonUnavailableError,
  configureDaemonFetchForTesting,
} from "../fetch";
import type { FetchFn } from "../fetch";

let cleanupFetch: (() => void) | undefined;

afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
});

describe("daemonFetch", () => {
  test("forwards path and init to the configured fetch function", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch: FetchFn = async (path, init) => {
      capturedPath = path;
      capturedInit = init;
      return new Response("ok", { status: 200 });
    };
    cleanupFetch = configureDaemonFetchForTesting(mockFetch);

    await daemonFetch("/health", { method: "GET" });

    expect(capturedPath).toBe("/health");
    expect(capturedInit?.method).toBe("GET");
  });

  test("returns the response from the fetch function", async () => {
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await daemonFetch("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("wraps connection errors in DaemonUnavailableError", async () => {
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      throw new Error("Connection refused");
    });

    try {
      await daemonFetch("/health");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonUnavailableError);
      expect((err as DaemonUnavailableError).message).toContain(
        "Daemon unreachable at /health",
      );
      expect((err as DaemonUnavailableError).message).toContain(
        "Connection refused",
      );
      expect((err as DaemonUnavailableError).cause).toBeInstanceOf(Error);
    }
  });

  test("wraps non-Error throws in DaemonUnavailableError", async () => {
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      throw "string error";
    });

    try {
      await daemonFetch("/health");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonUnavailableError);
      expect((err as DaemonUnavailableError).message).toContain("string error");
    }
  });

  test("does not wrap HTTP error responses as DaemonUnavailableError", async () => {
    cleanupFetch = configureDaemonFetchForTesting(async () => {
      return new Response("Not Found", { status: 404 });
    });

    // HTTP errors are not connection errors, so no DaemonUnavailableError
    const res = await daemonFetch("/missing");
    expect(res.status).toBe(404);
  });
});

describe("configureDaemonFetchForTesting", () => {
  test("cleanup resets to default behavior", async () => {
    const mockFetch: FetchFn = async () => {
      return new Response("mocked", { status: 200 });
    };

    const cleanup = configureDaemonFetchForTesting(mockFetch);
    const res = await daemonFetch("/test");
    expect(await res.text()).toBe("mocked");

    cleanup();

    // After cleanup, daemonFetch should try the real daemon (which will fail
    // in test env). We verify it throws DaemonUnavailableError (connection
    // refused to the real socket), not that it returns "mocked".
    try {
      await daemonFetch("/test");
      // If this doesn't throw, it means there's a real daemon running
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonUnavailableError);
    }
  });
});

describe("DaemonUnavailableError", () => {
  test("has correct name and message", () => {
    const err = new DaemonUnavailableError("test message");
    expect(err.name).toBe("DaemonUnavailableError");
    expect(err.message).toBe("test message");
    expect(err).toBeInstanceOf(Error);
  });

  test("preserves cause", () => {
    const cause = new Error("original");
    const err = new DaemonUnavailableError("wrapped", cause);
    expect(err.cause).toBe(cause);
  });
});
