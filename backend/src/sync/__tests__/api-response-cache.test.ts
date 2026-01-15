/**
 * Tests for API Response Cache
 *
 * Tests cover:
 * - Basic get/set operations
 * - Cache key generation (connector:id format)
 * - Clear operation for full sync
 * - Cache statistics
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ApiResponseCache, createApiResponseCache } from "../api-response-cache.js";
import type { ApiResponse } from "../connector-interface.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const SAMPLE_RESPONSE: ApiResponse = {
  id: "123",
  data: {
    name: "Test Game",
    rating: 7.5,
    mechanics: ["Worker Placement", "Deck Building"],
  },
};

const ANOTHER_RESPONSE: ApiResponse = {
  id: "456",
  data: {
    name: "Another Game",
    rating: 8.0,
    mechanics: ["Area Control"],
  },
};

// =============================================================================
// Test Suite
// =============================================================================

describe("ApiResponseCache", () => {
  let cache: ApiResponseCache;

  beforeEach(() => {
    cache = new ApiResponseCache();
  });

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  describe("get and set", () => {
    it("should return undefined for uncached entries", () => {
      const result = cache.get("bgg", "123");
      expect(result).toBeUndefined();
    });

    it("should store and retrieve a response", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      const result = cache.get("bgg", "123");
      expect(result).toEqual(SAMPLE_RESPONSE);
    });

    it("should differentiate by connector", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("books", "123", ANOTHER_RESPONSE);

      expect(cache.get("bgg", "123")).toEqual(SAMPLE_RESPONSE);
      expect(cache.get("books", "123")).toEqual(ANOTHER_RESPONSE);
    });

    it("should differentiate by id", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("bgg", "456", ANOTHER_RESPONSE);

      expect(cache.get("bgg", "123")).toEqual(SAMPLE_RESPONSE);
      expect(cache.get("bgg", "456")).toEqual(ANOTHER_RESPONSE);
    });

    it("should overwrite existing entries", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("bgg", "123", ANOTHER_RESPONSE);

      expect(cache.get("bgg", "123")).toEqual(ANOTHER_RESPONSE);
    });
  });

  // ===========================================================================
  // Has Method
  // ===========================================================================

  describe("has", () => {
    it("should return false for uncached entries", () => {
      expect(cache.has("bgg", "123")).toBe(false);
    });

    it("should return true for cached entries", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      expect(cache.has("bgg", "123")).toBe(true);
    });

    it("should return false for different connector", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      expect(cache.has("books", "123")).toBe(false);
    });

    it("should return false for different id", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      expect(cache.has("bgg", "456")).toBe(false);
    });
  });

  // ===========================================================================
  // Clear Operation
  // ===========================================================================

  describe("clear", () => {
    it("should clear all cached entries", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("bgg", "456", ANOTHER_RESPONSE);
      cache.set("books", "789", SAMPLE_RESPONSE);

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get("bgg", "123")).toBeUndefined();
      expect(cache.get("bgg", "456")).toBeUndefined();
      expect(cache.get("books", "789")).toBeUndefined();
    });

    it("should allow new entries after clear", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.clear();
      cache.set("bgg", "456", ANOTHER_RESPONSE);

      expect(cache.size).toBe(1);
      expect(cache.get("bgg", "456")).toEqual(ANOTHER_RESPONSE);
    });
  });

  // ===========================================================================
  // Size Property
  // ===========================================================================

  describe("size", () => {
    it("should be 0 for empty cache", () => {
      expect(cache.size).toBe(0);
    });

    it("should reflect number of entries", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      expect(cache.size).toBe(1);

      cache.set("bgg", "456", ANOTHER_RESPONSE);
      expect(cache.size).toBe(2);
    });

    it("should not increase when overwriting", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("bgg", "123", ANOTHER_RESPONSE);
      expect(cache.size).toBe(1);
    });
  });

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe("getStats", () => {
    it("should return empty stats for empty cache", () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });

    it("should return all cache keys", () => {
      cache.set("bgg", "123", SAMPLE_RESPONSE);
      cache.set("books", "456", ANOTHER_RESPONSE);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain("bgg:123");
      expect(stats.keys).toContain("books:456");
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createApiResponseCache", () => {
  it("should create an ApiResponseCache instance", () => {
    const cache = createApiResponseCache();
    expect(cache).toBeInstanceOf(ApiResponseCache);
  });

  it("should create independent instances", () => {
    const cache1 = createApiResponseCache();
    const cache2 = createApiResponseCache();

    cache1.set("bgg", "123", SAMPLE_RESPONSE);

    expect(cache1.has("bgg", "123")).toBe(true);
    expect(cache2.has("bgg", "123")).toBe(false);
  });
});
