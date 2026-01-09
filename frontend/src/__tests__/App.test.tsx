/**
 * Tests for version watermark global
 *
 * Tests that the __APP_VERSION__ global is defined and has expected format.
 * The version watermark display is tested indirectly through integration tests.
 */

import { describe, it, expect } from "bun:test";

describe("version watermark", () => {
  it("__APP_VERSION__ is defined", () => {
    expect(typeof __APP_VERSION__).toBe("string");
  });

  it("__APP_VERSION__ has expected test value", () => {
    // The test setup defines this as "test-abc123"
    expect(__APP_VERSION__).toBe("test-abc123");
  });

  it("__APP_VERSION__ is not empty", () => {
    expect(__APP_VERSION__.length).toBeGreaterThan(0);
  });
});
