/**
 * SDK Provider
 *
 * Centralized management for Claude Agent SDK query function.
 * Provides a fail-safe pattern where:
 * - Production: Must call initializeSdkProvider() at startup
 * - Tests: Must call configureSdkForTesting() with a mock
 * - Without initialization: Throws SdkNotInitializedError (not real API calls)
 *
 * This prevents accidental API calls in tests by requiring explicit configuration.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

export type QueryFunction = typeof query;

let _queryFn: QueryFunction | null = null;
let _initialized = false;

/**
 * Error thrown when SDK is used without initialization.
 * This is a safety net to prevent accidental real API calls in tests.
 */
export class SdkNotInitializedError extends Error {
  constructor() {
    super(
      "SDK not initialized. Call initializeSdkProvider() at startup, " +
        "or configureSdkForTesting() in tests."
    );
    this.name = "SdkNotInitializedError";
  }
}

/**
 * Initialize with real SDK (call once at server startup).
 * Throws if already initialized to prevent accidental re-initialization.
 */
export function initializeSdkProvider(): void {
  if (_initialized) {
    throw new Error("SDK provider already initialized");
  }
  _queryFn = query;
  _initialized = true;
}

/**
 * Configure with mock for testing. Returns cleanup function.
 * Call the returned function in afterEach to reset state.
 *
 * @param mockFn - Mock query function for testing
 * @returns Cleanup function to call in afterEach
 */
export function configureSdkForTesting(mockFn: QueryFunction): () => void {
  _queryFn = mockFn;
  _initialized = true;

  return () => {
    _queryFn = null;
    _initialized = false;
  };
}

/**
 * Get the SDK query function.
 * Throws SdkNotInitializedError if not initialized, preventing accidental API calls.
 */
export function getSdkQuery(): QueryFunction {
  if (!_initialized || _queryFn === null) {
    throw new SdkNotInitializedError();
  }
  return _queryFn;
}

/**
 * Reset for testing isolation. Only use in test cleanup.
 * Does not throw if not initialized (safe for afterEach cleanup).
 */
export function _resetForTesting(): void {
  _queryFn = null;
  _initialized = false;
}
