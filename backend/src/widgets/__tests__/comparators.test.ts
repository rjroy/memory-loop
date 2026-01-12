/**
 * Comparators Unit Tests
 *
 * Comprehensive tests for similarity computation functions.
 * Covers REQ-F-12 (dimensions with field, weight, method),
 * REQ-F-13 (jaccard, proximity, cosine methods),
 * and TD-14 (extensibility via registry).
 */

import { describe, test, expect } from "bun:test";
import {
  jaccardSimilarity,
  proximitySimilarity,
  cosineSimilarity,
  getComparator,
  registerComparator,
  listComparators,
  hasComparator,
  computeWeightedSimilarity,
  type ItemData,
} from "../comparators";
import type { DimensionConfig } from "../schemas";

// =============================================================================
// jaccardSimilarity() Tests
// =============================================================================

describe("jaccardSimilarity", () => {
  describe("with identical sets", () => {
    test("returns 1 for identical arrays", () => {
      expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    });

    test("returns 1 for identical single elements", () => {
      expect(jaccardSimilarity("tag", "tag")).toBe(1);
    });

    test("returns 1 for identical numeric arrays", () => {
      expect(jaccardSimilarity([1, 2, 3], [1, 2, 3])).toBe(1);
    });

    test("handles different element order", () => {
      expect(jaccardSimilarity(["c", "a", "b"], ["a", "b", "c"])).toBe(1);
    });
  });

  describe("with overlapping sets", () => {
    test("computes correct overlap ratio", () => {
      // Intersection: {b}, Union: {a, b, c}
      const result = jaccardSimilarity(["a", "b"], ["b", "c"]);
      expect(result).toBeCloseTo(1 / 3, 5);
    });

    test("handles partial overlap", () => {
      // Intersection: {a, b}, Union: {a, b, c, d}
      const result = jaccardSimilarity(["a", "b", "c"], ["a", "b", "d"]);
      expect(result).toBe(0.5);
    });

    test("handles 2/3 overlap", () => {
      // Intersection: {a, b}, Union: {a, b, c}
      const result = jaccardSimilarity(["a", "b"], ["a", "b", "c"]);
      expect(result).toBeCloseTo(2 / 3, 5);
    });

    test("handles string tags", () => {
      // Intersection: {strategy}, Union: {strategy, eurogame, card}
      const result = jaccardSimilarity(
        ["strategy", "eurogame"],
        ["strategy", "card"]
      );
      expect(result).toBeCloseTo(1 / 3, 5);
    });
  });

  describe("with disjoint sets", () => {
    test("returns 0 for completely different arrays", () => {
      expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0);
    });

    test("returns 0 for different single elements", () => {
      expect(jaccardSimilarity("x", "y")).toBe(0);
    });

    test("returns 0 for different numeric arrays", () => {
      expect(jaccardSimilarity([1, 2], [3, 4])).toBe(0);
    });
  });

  describe("with empty sets", () => {
    test("returns 0 for both empty arrays", () => {
      expect(jaccardSimilarity([], [])).toBe(0);
    });

    test("returns 0 for one empty array", () => {
      expect(jaccardSimilarity(["a", "b"], [])).toBe(0);
      expect(jaccardSimilarity([], ["a", "b"])).toBe(0);
    });

    test("returns 0 for null values", () => {
      expect(jaccardSimilarity(null, ["a"])).toBe(0);
      expect(jaccardSimilarity(["a"], null)).toBe(0);
      expect(jaccardSimilarity(null, null)).toBe(0);
    });

    test("returns 0 for undefined values", () => {
      expect(jaccardSimilarity(undefined, ["a"])).toBe(0);
      expect(jaccardSimilarity(["a"], undefined)).toBe(0);
      expect(jaccardSimilarity(undefined, undefined)).toBe(0);
    });
  });

  describe("single value vs array", () => {
    test("treats single value as set of 1", () => {
      // Intersection: {a}, Union: {a, b, c}
      const result = jaccardSimilarity("a", ["a", "b", "c"]);
      expect(result).toBeCloseTo(1 / 3, 5);
    });

    test("treats single value match as 1", () => {
      expect(jaccardSimilarity("x", ["x"])).toBe(1);
    });

    test("treats single value non-match as 0", () => {
      expect(jaccardSimilarity("x", ["y"])).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("handles duplicate elements in arrays", () => {
      // Sets: {a, b} vs {a, b} - duplicates removed
      expect(jaccardSimilarity(["a", "a", "b"], ["a", "b", "b"])).toBe(1);
    });

    test("handles mixed types in arrays", () => {
      // {1, "1"} vs {1} - different types are different elements
      expect(jaccardSimilarity([1, "1"], [1])).toBeCloseTo(1 / 2, 5);
    });

    test("handles nested objects", () => {
      // Objects are compared by JSON serialization
      const obj1 = { type: "mechanic", name: "worker-placement" };
      const obj2 = { type: "mechanic", name: "worker-placement" };
      expect(jaccardSimilarity([obj1], [obj2])).toBe(1);
    });

    test("handles large sets efficiently", () => {
      const setA = Array.from({ length: 100 }, (_, i) => `item${i}`);
      const setB = Array.from({ length: 100 }, (_, i) => `item${i + 50}`);
      // 50 common elements, 150 total unique
      const result = jaccardSimilarity(setA, setB);
      expect(result).toBeCloseTo(50 / 150, 5);
    });
  });

  describe("real-world scenarios", () => {
    test("board game mechanics comparison", () => {
      const gameA = ["worker-placement", "engine-building", "drafting"];
      const gameB = ["worker-placement", "area-control", "drafting"];
      // Intersection: 2, Union: 4
      expect(jaccardSimilarity(gameA, gameB)).toBe(0.5);
    });

    test("recipe ingredient comparison", () => {
      const recipeA = ["flour", "eggs", "sugar", "butter"];
      const recipeB = ["flour", "eggs", "milk", "butter"];
      // Intersection: 3, Union: 5
      expect(jaccardSimilarity(recipeA, recipeB)).toBe(0.6);
    });
  });
});

// =============================================================================
// proximitySimilarity() Tests
// =============================================================================

describe("proximitySimilarity", () => {
  describe("with identical values", () => {
    test("returns 1 for identical integers", () => {
      expect(proximitySimilarity(5, 5)).toBe(1);
    });

    test("returns 1 for identical floats", () => {
      expect(proximitySimilarity(3.14159, 3.14159)).toBe(1);
    });

    test("returns 1 for zero", () => {
      expect(proximitySimilarity(0, 0)).toBe(1);
    });

    test("returns 1 for negative identical values", () => {
      expect(proximitySimilarity(-10, -10)).toBe(1);
    });
  });

  describe("with different values (unnormalized)", () => {
    test("computes correct similarity for close values", () => {
      // 1 / (1 + |5 - 6|) = 1 / 2 = 0.5
      expect(proximitySimilarity(5, 6)).toBe(0.5);
    });

    test("computes correct similarity for distant values", () => {
      // 1 / (1 + |0 - 10|) = 1 / 11 ≈ 0.0909
      expect(proximitySimilarity(0, 10)).toBeCloseTo(1 / 11, 5);
    });

    test("handles negative distances", () => {
      // 1 / (1 + |-5 - 5|) = 1 / 11
      expect(proximitySimilarity(-5, 5)).toBeCloseTo(1 / 11, 5);
    });

    test("is symmetric", () => {
      expect(proximitySimilarity(3, 7)).toBe(proximitySimilarity(7, 3));
    });
  });

  describe("with normalized range", () => {
    test("computes correct similarity for normalized values", () => {
      // Distance: 10, Range: 100, Normalized: 0.1
      // 1 / (1 + 0.1) = 1 / 1.1 ≈ 0.909
      const result = proximitySimilarity(0, 10, { min: 0, max: 100 });
      expect(result).toBeCloseTo(1 / 1.1, 3);
    });

    test("returns 0.5 for maximum distance", () => {
      // Distance: 100, Range: 100, Normalized: 1.0
      // 1 / (1 + 1) = 0.5
      expect(proximitySimilarity(0, 100, { min: 0, max: 100 })).toBe(0.5);
    });

    test("handles non-zero min", () => {
      // Values: 10, 20, Range: 50-100 = 50, Distance: 10
      // Normalized distance: 10/50 = 0.2
      // 1 / (1 + 0.2) = 1 / 1.2 ≈ 0.833
      const result = proximitySimilarity(60, 70, { min: 50, max: 100 });
      expect(result).toBeCloseTo(1 / 1.2, 3);
    });

    test("handles identical values with range", () => {
      expect(proximitySimilarity(50, 50, { min: 0, max: 100 })).toBe(1);
    });

    test("falls back for invalid range (min >= max)", () => {
      // Invalid range, uses unnormalized
      expect(proximitySimilarity(5, 6, { min: 100, max: 100 })).toBe(0.5);
      expect(proximitySimilarity(5, 6, { min: 100, max: 50 })).toBe(0.5);
    });
  });

  describe("with null/undefined values", () => {
    test("returns 0 for null values", () => {
      expect(proximitySimilarity(null, 5)).toBe(0);
      expect(proximitySimilarity(5, null)).toBe(0);
      expect(proximitySimilarity(null, null)).toBe(0);
    });

    test("returns 0 for undefined values", () => {
      expect(proximitySimilarity(undefined, 5)).toBe(0);
      expect(proximitySimilarity(5, undefined)).toBe(0);
      expect(proximitySimilarity(undefined, undefined)).toBe(0);
    });

    test("returns 0 for NaN values", () => {
      expect(proximitySimilarity(NaN, 5)).toBe(0);
      expect(proximitySimilarity(5, NaN)).toBe(0);
    });
  });

  describe("string to number conversion", () => {
    test("converts numeric strings", () => {
      expect(proximitySimilarity("5", "5")).toBe(1);
      expect(proximitySimilarity("5", 5)).toBe(1);
      expect(proximitySimilarity("3.14", 3.14)).toBe(1);
    });

    test("returns 0 for non-numeric strings", () => {
      expect(proximitySimilarity("abc", 5)).toBe(0);
      expect(proximitySimilarity(5, "xyz")).toBe(0);
    });
  });

  describe("real-world scenarios", () => {
    test("board game rating comparison", () => {
      // BGG ratings typically 1-10
      const result = proximitySimilarity(7.5, 8.0, { min: 1, max: 10 });
      // Distance: 0.5, Range: 9, Normalized: 0.0556
      // 1 / (1 + 0.0556) ≈ 0.947
      expect(result).toBeCloseTo(0.947, 2);
    });

    test("play count comparison", () => {
      // Games with similar play counts
      const result = proximitySimilarity(15, 20, { min: 0, max: 100 });
      // Distance: 5, Range: 100, Normalized: 0.05
      // 1 / (1 + 0.05) ≈ 0.952
      expect(result).toBeCloseTo(0.952, 2);
    });

    test("price comparison", () => {
      const result = proximitySimilarity(29.99, 39.99, { min: 0, max: 200 });
      // Distance: 10, Range: 200, Normalized: 0.05
      expect(result).toBeCloseTo(0.952, 2);
    });
  });
});

// =============================================================================
// cosineSimilarity() Tests
// =============================================================================

describe("cosineSimilarity", () => {
  describe("with identical vectors", () => {
    test("returns 1 for identical vectors", () => {
      expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    });

    test("returns 1 for scaled identical directions", () => {
      expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    });

    test("handles negative identical directions", () => {
      // Same direction, both negative
      expect(cosineSimilarity([-1, -2], [-2, -4])).toBeCloseTo(1, 5);
    });
  });

  describe("with orthogonal vectors", () => {
    test("returns 0 for perpendicular 2D vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    test("returns 0 for perpendicular 3D vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
    });
  });

  describe("with opposite vectors", () => {
    test("returns 0 for opposite directions (clamped)", () => {
      // Opposite vectors have cosine = -1, but we clamp to [0, 1]
      expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    });

    test("clamps negative similarity to 0", () => {
      expect(cosineSimilarity([1, 2], [-1, -2])).toBe(0);
    });
  });

  describe("with zero vectors", () => {
    test("returns 0 for zero vector", () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
      expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
    });

    test("returns 0 for both zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
    });
  });

  describe("with null/undefined values", () => {
    test("returns 0 for null values", () => {
      expect(cosineSimilarity(null, [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], null)).toBe(0);
    });

    test("returns 0 for undefined values", () => {
      expect(cosineSimilarity(undefined, [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], undefined)).toBe(0);
    });

    test("returns 0 for empty arrays", () => {
      expect(cosineSimilarity([], [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], [])).toBe(0);
    });
  });

  describe("with different length vectors", () => {
    test("pads shorter vector with zeros", () => {
      // [1, 0] vs [1, 1] - first padded to [1, 0]
      // Actually [1] vs [1, 1] should pad [1] to [1, 0]
      const result = cosineSimilarity([1], [1, 1]);
      // [1, 0] · [1, 1] = 1
      // |[1, 0]| = 1, |[1, 1]| = sqrt(2)
      // cos = 1 / sqrt(2) ≈ 0.707
      expect(result).toBeCloseTo(1 / Math.sqrt(2), 5);
    });

    test("handles significantly different lengths", () => {
      const result = cosineSimilarity([1, 0, 0, 0, 0], [1, 1]);
      // [1, 0, 0, 0, 0] vs [1, 1, 0, 0, 0]
      // dot = 1, |a| = 1, |b| = sqrt(2)
      expect(result).toBeCloseTo(1 / Math.sqrt(2), 5);
    });
  });

  describe("single value as vector", () => {
    test("treats single number as 1D vector", () => {
      expect(cosineSimilarity(5, 5)).toBe(1);
      expect(cosineSimilarity(5, 10)).toBe(1); // Same direction
      expect(cosineSimilarity(5, -5)).toBe(0); // Opposite direction (clamped)
    });
  });

  describe("with invalid vectors", () => {
    test("returns 0 for non-numeric array elements", () => {
      expect(cosineSimilarity(["a", "b"], [1, 2])).toBe(0);
      expect(cosineSimilarity([1, "b"], [1, 2])).toBe(0);
    });

    test("returns 0 for mixed valid/invalid", () => {
      expect(cosineSimilarity([1, 2], [1, "x"])).toBe(0);
    });
  });

  describe("real-world scenarios", () => {
    test("user preference vectors", () => {
      // User ratings across categories: [strategy, party, family]
      const userA = [5, 2, 3];
      const userB = [4, 1, 4];
      // dot = 20 + 2 + 12 = 34
      // |a| = sqrt(38), |b| = sqrt(33)
      const result = cosineSimilarity(userA, userB);
      expect(result).toBeCloseTo(34 / (Math.sqrt(38) * Math.sqrt(33)), 5);
    });

    test("feature vectors for ML", () => {
      const vecA = [0.8, 0.2, 0.5, 0.1];
      const vecB = [0.7, 0.3, 0.4, 0.2];
      const result = cosineSimilarity(vecA, vecB);
      // High similarity expected
      expect(result).toBeGreaterThan(0.9);
    });
  });
});

// =============================================================================
// Registry Tests (TD-14: Extensibility)
// =============================================================================

describe("Comparator Registry", () => {
  describe("getComparator", () => {
    test("returns jaccard comparator", () => {
      const fn = getComparator("jaccard");
      expect(fn).toBeDefined();
      expect(fn!(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 5);
    });

    test("returns proximity comparator", () => {
      const fn = getComparator("proximity");
      expect(fn).toBeDefined();
      expect(fn!(5, 5)).toBe(1);
    });

    test("returns cosine comparator", () => {
      const fn = getComparator("cosine");
      expect(fn).toBeDefined();
      expect(fn!([1, 0], [1, 0])).toBe(1);
    });

    test("returns undefined for unknown comparator", () => {
      expect(getComparator("nonexistent")).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      expect(getComparator("")).toBeUndefined();
    });
  });

  describe("registerComparator", () => {
    test("registers a custom comparator", () => {
      // Register a dice coefficient comparator
      registerComparator("dice", (a, b) => {
        const arrA = Array.isArray(a) ? a : a != null ? [a] : [];
        const arrB = Array.isArray(b) ? b : b != null ? [b] : [];
        const setA = new Set(arrA.map((v) => JSON.stringify(v)));
        const setB = new Set(arrB.map((v) => JSON.stringify(v)));
        let intersection = 0;
        for (const key of setA) if (setB.has(key)) intersection++;
        const denominator = setA.size + setB.size;
        return denominator === 0 ? 0 : (2 * intersection) / denominator;
      });

      const dice = getComparator("dice");
      expect(dice).toBeDefined();
      // Dice coefficient: 2 * |A ∩ B| / (|A| + |B|)
      // {a, b} ∩ {b, c} = {b}, |A| = 2, |B| = 2
      // 2 * 1 / 4 = 0.5
      expect(dice!(["a", "b"], ["b", "c"])).toBe(0.5);
    });

    test("can overwrite existing comparator", () => {
      const original = getComparator("jaccard");

      // Override with a constant
      registerComparator("jaccard", () => 0.42);
      expect(getComparator("jaccard")!([], [])).toBe(0.42);

      // Restore original
      registerComparator("jaccard", original!);
    });
  });

  describe("listComparators", () => {
    test("returns all registered comparator names", () => {
      const names = listComparators();
      expect(names).toContain("jaccard");
      expect(names).toContain("proximity");
      expect(names).toContain("cosine");
    });

    test("includes custom registered comparators", () => {
      registerComparator("custom_comp", () => 0);
      const names = listComparators();
      expect(names).toContain("custom_comp");
    });

    test("returns array (not iterator)", () => {
      const names = listComparators();
      expect(Array.isArray(names)).toBe(true);
    });
  });

  describe("hasComparator", () => {
    test("returns true for existing comparators", () => {
      expect(hasComparator("jaccard")).toBe(true);
      expect(hasComparator("proximity")).toBe(true);
      expect(hasComparator("cosine")).toBe(true);
    });

    test("returns false for non-existent comparator", () => {
      expect(hasComparator("nonexistent")).toBe(false);
    });

    test("returns false for empty string", () => {
      expect(hasComparator("")).toBe(false);
    });

    test("reflects newly registered comparators", () => {
      expect(hasComparator("new_comp")).toBe(false);
      registerComparator("new_comp", () => 0);
      expect(hasComparator("new_comp")).toBe(true);
    });
  });
});

// =============================================================================
// computeWeightedSimilarity() Tests
// =============================================================================

describe("computeWeightedSimilarity", () => {
  describe("single dimension", () => {
    test("computes jaccard similarity for tags", () => {
      const itemA: ItemData = { tags: ["strategy", "eurogame"] };
      const itemB: ItemData = { tags: ["strategy", "card"] };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 1.0, method: "jaccard" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBeCloseTo(1 / 3, 5);
      expect(result.dimensions).toHaveLength(1);
      expect(result.dimensions[0].skipped).toBe(false);
    });

    test("computes proximity similarity for rating", () => {
      const itemA: ItemData = { rating: 8 };
      const itemB: ItemData = { rating: 7 };
      const dimensions: DimensionConfig[] = [
        { field: "rating", weight: 1.0, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(0.5); // 1 / (1 + 1)
    });

    test("computes cosine similarity for vectors", () => {
      const itemA: ItemData = { features: [1, 0] };
      const itemB: ItemData = { features: [1, 0] };
      const dimensions: DimensionConfig[] = [
        { field: "features", weight: 1.0, method: "cosine" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1);
    });
  });

  describe("multiple dimensions with weights", () => {
    test("combines scores with equal weights", () => {
      const itemA: ItemData = { tags: ["a", "b"], rating: 10 };
      const itemB: ItemData = { tags: ["a", "b"], rating: 10 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.5, method: "jaccard" },
        { field: "rating", weight: 0.5, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1); // Both identical
    });

    test("weights affect final score", () => {
      const itemA: ItemData = { tags: ["a"], rating: 10 };
      const itemB: ItemData = { tags: ["b"], rating: 10 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.3, method: "jaccard" }, // 0 similarity
        { field: "rating", weight: 0.7, method: "proximity" }, // 1 similarity
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      // (0.3 * 0 + 0.7 * 1) / 1.0 = 0.7
      expect(result.score).toBeCloseTo(0.7, 5);
    });

    test("normalizes unequal weights", () => {
      const itemA: ItemData = { tags: ["a", "b"], rating: 5 };
      const itemB: ItemData = { tags: ["a", "b"], rating: 5 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 2.0, method: "jaccard" },
        { field: "rating", weight: 3.0, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      // Both are 1, so weighted sum / total weight = 5 / 5 = 1
      expect(result.score).toBe(1);
    });
  });

  describe("nested field paths", () => {
    test("accesses nested fields with dot notation", () => {
      const itemA: ItemData = { bgg: { rating: 8, mechanics: ["dice"] } };
      const itemB: ItemData = { bgg: { rating: 8, mechanics: ["dice"] } };
      const dimensions: DimensionConfig[] = [
        { field: "bgg.rating", weight: 0.5, method: "proximity" },
        { field: "bgg.mechanics", weight: 0.5, method: "jaccard" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1);
    });

    test("handles deeply nested fields", () => {
      const itemA: ItemData = { a: { b: { c: { d: 10 } } } };
      const itemB: ItemData = { a: { b: { c: { d: 10 } } } };
      const dimensions: DimensionConfig[] = [
        { field: "a.b.c.d", weight: 1.0, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1);
    });
  });

  describe("null/undefined handling", () => {
    test("skips dimension when itemA field is null", () => {
      const itemA: ItemData = { tags: null, rating: 8 };
      const itemB: ItemData = { tags: ["a"], rating: 8 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.5, method: "jaccard" },
        { field: "rating", weight: 0.5, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      // Only rating is computed, weight redistributed
      expect(result.score).toBe(1);
      expect(result.dimensions[0].skipped).toBe(true);
      expect(result.dimensions[1].skipped).toBe(false);
    });

    test("skips dimension when itemB field is undefined", () => {
      const itemA: ItemData = { tags: ["a"], rating: 8 };
      const itemB: ItemData = { rating: 8 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.5, method: "jaccard" },
        { field: "rating", weight: 0.5, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1);
      expect(result.dimensions[0].skipped).toBe(true);
    });

    test("skips dimension when field path does not exist", () => {
      const itemA: ItemData = { rating: 8 };
      const itemB: ItemData = { rating: 8 };
      const dimensions: DimensionConfig[] = [
        { field: "nonexistent.field", weight: 0.5, method: "jaccard" },
        { field: "rating", weight: 0.5, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1);
      expect(result.dimensions[0].skipped).toBe(true);
    });

    test("returns 0 when all dimensions are skipped", () => {
      const itemA: ItemData = { other: 1 };
      const itemB: ItemData = { another: 2 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.5, method: "jaccard" },
        { field: "rating", weight: 0.5, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(0);
      expect(result.dimensions.every((d) => d.skipped)).toBe(true);
    });
  });

  describe("unknown method handling", () => {
    test("skips dimension with unknown method", () => {
      const itemA: ItemData = { rating: 8, tags: ["a"] };
      const itemB: ItemData = { rating: 8, tags: ["a"] };
      const dimensions: DimensionConfig[] = [
        { field: "rating", weight: 0.5, method: "unknown" as "proximity" },
        { field: "tags", weight: 0.5, method: "jaccard" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);
      expect(result.score).toBe(1); // Only jaccard computed
      expect(result.dimensions[0].skipped).toBe(true);
    });
  });

  describe("empty dimensions", () => {
    test("returns 0 for empty dimensions array", () => {
      const itemA: ItemData = { rating: 8 };
      const itemB: ItemData = { rating: 8 };

      const result = computeWeightedSimilarity(itemA, itemB, []);
      expect(result.score).toBe(0);
      expect(result.dimensions).toHaveLength(0);
    });
  });

  describe("dimension score details", () => {
    test("includes all dimension information in result", () => {
      const itemA: ItemData = { tags: ["a", "b"], rating: 8 };
      const itemB: ItemData = { tags: ["a", "c"], rating: 6 };
      const dimensions: DimensionConfig[] = [
        { field: "tags", weight: 0.6, method: "jaccard" },
        { field: "rating", weight: 0.4, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(itemA, itemB, dimensions);

      expect(result.dimensions).toHaveLength(2);

      expect(result.dimensions[0].field).toBe("tags");
      expect(result.dimensions[0].method).toBe("jaccard");
      expect(result.dimensions[0].weight).toBe(0.6);
      expect(result.dimensions[0].score).toBeCloseTo(1 / 3, 5);
      expect(result.dimensions[0].skipped).toBe(false);

      expect(result.dimensions[1].field).toBe("rating");
      expect(result.dimensions[1].method).toBe("proximity");
      expect(result.dimensions[1].weight).toBe(0.4);
      expect(result.dimensions[1].score).toBeCloseTo(1 / 3, 5); // 1/(1+2)
      expect(result.dimensions[1].skipped).toBe(false);
    });
  });

  describe("real-world scenarios", () => {
    test("board game similarity computation", () => {
      const wingspan: ItemData = {
        mechanics: ["engine-building", "hand-management", "set-collection"],
        players: { min: 1, max: 5 },
        weight: 2.5,
        rating: 8.1,
      };
      const everdell: ItemData = {
        mechanics: ["worker-placement", "hand-management", "tableau-building"],
        players: { min: 1, max: 4 },
        weight: 2.8,
        rating: 7.9,
      };
      const dimensions: DimensionConfig[] = [
        { field: "mechanics", weight: 0.4, method: "jaccard" },
        { field: "weight", weight: 0.3, method: "proximity" },
        { field: "rating", weight: 0.3, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(wingspan, everdell, dimensions);

      // mechanics: 1/5 = 0.2 (hand-management shared)
      // weight: 1/(1+0.3) ≈ 0.769
      // rating: 1/(1+0.2) ≈ 0.833
      // weighted: (0.4*0.2 + 0.3*0.769 + 0.3*0.833) / 1.0 ≈ 0.561
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.score).toBeLessThan(0.7);
    });

    test("recipe similarity with missing fields", () => {
      const pasta: ItemData = {
        ingredients: ["pasta", "tomatoes", "garlic", "olive-oil"],
        cuisine: "italian",
        prepTime: 30,
      };
      const risotto: ItemData = {
        ingredients: ["rice", "broth", "parmesan", "olive-oil"],
        cuisine: "italian",
        // prepTime missing
      };
      const dimensions: DimensionConfig[] = [
        { field: "ingredients", weight: 0.4, method: "jaccard" },
        { field: "cuisine", weight: 0.3, method: "jaccard" },
        { field: "prepTime", weight: 0.3, method: "proximity" },
      ];

      const result = computeWeightedSimilarity(pasta, risotto, dimensions);

      // prepTime should be skipped
      expect(result.dimensions[2].skipped).toBe(true);

      // ingredients: 1/7 (olive-oil shared)
      // cuisine: 1 (identical)
      // Score should reflect redistribution of weights
      expect(result.dimensions[0].skipped).toBe(false);
      expect(result.dimensions[1].skipped).toBe(false);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Comparator Integration", () => {
  test("all comparators return values in [0, 1]", () => {
    const testCases = [
      { a: ["x"], b: ["y"], method: "jaccard" },
      { a: 0, b: 1000, method: "proximity" },
      { a: [1, 0], b: [-1, 0], method: "cosine" },
      { a: null, b: [1], method: "jaccard" },
      { a: [], b: [], method: "jaccard" },
    ];

    for (const tc of testCases) {
      const fn = getComparator(tc.method)!;
      const score = fn(tc.a, tc.b);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  test("identical items always return 1", () => {
    const item: ItemData = {
      tags: ["a", "b", "c"],
      rating: 8.5,
      features: [1, 2, 3],
    };
    const dimensions: DimensionConfig[] = [
      { field: "tags", weight: 0.33, method: "jaccard" },
      { field: "rating", weight: 0.33, method: "proximity" },
      { field: "features", weight: 0.34, method: "cosine" },
    ];

    const result = computeWeightedSimilarity(item, item, dimensions);
    expect(result.score).toBeCloseTo(1, 5);
  });

  test("registry lookup produces same results as direct call", () => {
    const arrA = ["a", "b", "c"];
    const arrB = ["b", "c", "d"];

    expect(getComparator("jaccard")!(arrA, arrB)).toBe(
      jaccardSimilarity(arrA, arrB)
    );

    expect(getComparator("proximity")!(5, 10)).toBe(proximitySimilarity(5, 10));

    expect(getComparator("cosine")!([1, 2], [2, 4])).toBe(
      cosineSimilarity([1, 2], [2, 4])
    );
  });
});

// =============================================================================
// Type Safety Tests
// =============================================================================

describe("Type Safety", () => {
  test("comparators accept unknown types", () => {
    // These should compile and not throw
    expect(() => jaccardSimilarity("string", 123)).not.toThrow();
    expect(() => proximitySimilarity([], {})).not.toThrow();
    expect(() => cosineSimilarity("not-array", null)).not.toThrow();
  });

  test("weighted similarity returns proper structure", () => {
    const result = computeWeightedSimilarity(
      { a: 1 },
      { a: 2 },
      [{ field: "a", weight: 1, method: "proximity" }]
    );

    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.dimensions)).toBe(true);
    expect(typeof result.dimensions[0].field).toBe("string");
    expect(typeof result.dimensions[0].method).toBe("string");
    expect(typeof result.dimensions[0].weight).toBe("number");
    expect(typeof result.dimensions[0].score).toBe("number");
    expect(typeof result.dimensions[0].skipped).toBe("boolean");
  });
});
