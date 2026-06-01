/**
 * Tests for browser-safe UUID generation.
 *
 * The key behavior is the non-secure-context fallback: `crypto.randomUUID` is
 * undefined when the app is served over plain HTTP on a LAN IP, and the helper
 * must still produce a valid v4 UUID from `crypto.getRandomValues`.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { randomUUID } from "../uuid";

const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  const original = crypto.randomUUID;

  afterEach(() => {
    // Restore the real implementation after any per-test override.
    (crypto as { randomUUID: typeof crypto.randomUUID }).randomUUID = original;
  });

  it("returns a valid v4 UUID using crypto.randomUUID when available", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(randomUUID()).toMatch(V4_UUID);
  });

  it("falls back to getRandomValues when randomUUID is undefined (non-secure context)", () => {
    // Simulate an http://LAN-IP context where randomUUID is not defined.
    (crypto as { randomUUID?: typeof crypto.randomUUID }).randomUUID =
      undefined as unknown as typeof crypto.randomUUID;

    const id = randomUUID();
    expect(id).toMatch(V4_UUID);
  });

  it("produces distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomUUID()));
    expect(ids.size).toBe(100);
  });
});
