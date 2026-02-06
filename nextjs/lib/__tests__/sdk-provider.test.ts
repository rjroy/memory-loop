/**
 * SDK Provider Tests
 *
 * Tests for the centralized SDK provider module.
 * Verifies fail-safe behavior where uninitialized SDK throws rather than
 * making real API calls.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  initializeSdkProvider,
  configureSdkForTesting,
  getSdkQuery,
  _resetForTesting,
  SdkNotInitializedError,
} from "../sdk-provider";

// Always clean up after each test
afterEach(() => {
  _resetForTesting();
});

describe("SdkNotInitializedError", () => {
  test("has correct name", () => {
    const error = new SdkNotInitializedError();
    expect(error.name).toBe("SdkNotInitializedError");
  });

  test("has informative message", () => {
    const error = new SdkNotInitializedError();
    expect(error.message).toContain("initializeSdkProvider");
    expect(error.message).toContain("configureSdkForTesting");
  });

  test("is instance of Error", () => {
    const error = new SdkNotInitializedError();
    expect(error).toBeInstanceOf(Error);
  });
});

describe("getSdkQuery", () => {
  test("throws SdkNotInitializedError when not initialized", () => {
    expect(() => getSdkQuery()).toThrow(SdkNotInitializedError);
  });

  test("returns query function after initializeSdkProvider", () => {
    initializeSdkProvider();
    const query = getSdkQuery();
    expect(typeof query).toBe("function");
  });

  test("returns mock function after configureSdkForTesting", () => {
    const mockFn = (() => {}) as never;
    configureSdkForTesting(mockFn);
    expect(getSdkQuery()).toBe(mockFn);
  });
});

describe("initializeSdkProvider", () => {
  test("is idempotent (safe to call multiple times)", () => {
    initializeSdkProvider();
    expect(() => initializeSdkProvider()).not.toThrow();
  });

  test("allows getSdkQuery after initialization", () => {
    initializeSdkProvider();
    expect(() => getSdkQuery()).not.toThrow();
  });
});

describe("configureSdkForTesting", () => {
  test("returns cleanup function", () => {
    const cleanup = configureSdkForTesting((() => {}) as never);
    expect(typeof cleanup).toBe("function");
  });

  test("cleanup function resets state", () => {
    const cleanup = configureSdkForTesting((() => {}) as never);
    cleanup();
    expect(() => getSdkQuery()).toThrow(SdkNotInitializedError);
  });

  test("allows multiple configurations (for test isolation)", () => {
    const mock1 = (() => "mock1") as never;
    const mock2 = (() => "mock2") as never;

    configureSdkForTesting(mock1);
    expect(getSdkQuery()).toBe(mock1);

    // Can reconfigure without calling cleanup
    configureSdkForTesting(mock2);
    expect(getSdkQuery()).toBe(mock2);
  });
});

describe("_resetForTesting", () => {
  test("does not throw when not initialized", () => {
    expect(() => _resetForTesting()).not.toThrow();
  });

  test("resets after initializeSdkProvider", () => {
    initializeSdkProvider();
    _resetForTesting();
    expect(() => getSdkQuery()).toThrow(SdkNotInitializedError);
  });

  test("allows re-initialization after reset", () => {
    initializeSdkProvider();
    _resetForTesting();
    expect(() => initializeSdkProvider()).not.toThrow();
  });
});

describe("Fail-safe behavior", () => {
  test("uninitialized SDK throws, not makes API calls", () => {
    // This is the key safety guarantee: without initialization,
    // getSdkQuery() throws rather than returning the real SDK.
    // If the real SDK was returned, calling it would hit the API.
    try {
      getSdkQuery();
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SdkNotInitializedError);
      // NOT an SDK error from a real API call
      expect(error).not.toHaveProperty("status");
    }
  });
});
