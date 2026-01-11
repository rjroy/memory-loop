/**
 * Aggregators Unit Tests
 *
 * Comprehensive tests for collection-level aggregation functions.
 * Covers REQ-F-7 (aggregation operations), REQ-F-28 (null handling),
 * and TD-14 (extensibility via registry).
 */

import { describe, test, expect } from "bun:test";
import {
  sum,
  avg,
  count,
  min,
  max,
  stddev,
  getAggregator,
  registerAggregator,
  listAggregators,
  hasAggregator,
  type AggregatorInput,
} from "../aggregators";

// =============================================================================
// sum() Tests
// =============================================================================

describe("sum", () => {
  describe("with valid numbers only", () => {
    test("sums positive integers", () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
    });

    test("sums floating point numbers", () => {
      expect(sum([1.5, 2.5, 3.0])).toBe(7);
    });

    test("sums negative numbers", () => {
      expect(sum([-1, -2, -3])).toBe(-6);
    });

    test("sums mixed positive and negative", () => {
      expect(sum([10, -5, 3, -2])).toBe(6);
    });

    test("returns single value for single-element array", () => {
      expect(sum([42])).toBe(42);
    });

    test("handles large numbers", () => {
      expect(sum([1000000, 2000000, 3000000])).toBe(6000000);
    });

    test("handles small decimals", () => {
      const result = sum([0.1, 0.2, 0.3]);
      expect(result).toBeCloseTo(0.6, 10);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("skips null values", () => {
      expect(sum([1, null, 2, null, 3])).toBe(6);
    });

    test("skips undefined values", () => {
      expect(sum([1, undefined, 2, undefined, 3])).toBe(6);
    });

    test("skips mixed null and undefined", () => {
      expect(sum([1, null, 2, undefined, 3, null])).toBe(6);
    });

    test("returns 0 for array of only nulls", () => {
      expect(sum([null, null, null])).toBe(0);
    });

    test("returns 0 for array of only undefined", () => {
      expect(sum([undefined, undefined])).toBe(0);
    });

    test("returns valid number sum when nulls present", () => {
      expect(sum([null, 10, null, 20, null])).toBe(30);
    });
  });

  describe("with empty array", () => {
    test("returns 0 for empty array", () => {
      expect(sum([])).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("handles zero values", () => {
      expect(sum([0, 0, 0])).toBe(0);
    });

    test("handles mix of zeros and nulls", () => {
      expect(sum([0, null, 0, undefined, 0])).toBe(0);
    });

    test("handles zeros with other numbers", () => {
      expect(sum([0, 5, 0, 10])).toBe(15);
    });
  });
});

// =============================================================================
// avg() Tests
// =============================================================================

describe("avg", () => {
  describe("with valid numbers only", () => {
    test("computes average of integers", () => {
      expect(avg([2, 4, 6, 8, 10])).toBe(6);
    });

    test("computes average of floating point", () => {
      expect(avg([1.0, 2.0, 3.0])).toBe(2);
    });

    test("returns exact value for single element", () => {
      expect(avg([42])).toBe(42);
    });

    test("handles negative numbers", () => {
      expect(avg([-10, 0, 10])).toBe(0);
    });

    test("returns fractional average", () => {
      expect(avg([1, 2, 3, 4])).toBe(2.5);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("skips null values in calculation", () => {
      // Average of [2, 4, 6] = 4, ignoring nulls
      expect(avg([2, null, 4, null, 6])).toBe(4);
    });

    test("skips undefined values in calculation", () => {
      expect(avg([10, undefined, 20, undefined, 30])).toBe(20);
    });

    test("correctly counts only valid values", () => {
      // [100, 200] average = 150, not considering nulls in denominator
      expect(avg([null, 100, null, 200, null])).toBe(150);
    });

    test("returns null for array of only nulls", () => {
      expect(avg([null, null, null])).toBeNull();
    });

    test("returns null for array of only undefined", () => {
      expect(avg([undefined, undefined])).toBeNull();
    });

    test("returns null for mixed nulls and undefined only", () => {
      expect(avg([null, undefined, null])).toBeNull();
    });
  });

  describe("with empty array", () => {
    test("returns null for empty array", () => {
      expect(avg([])).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles all zeros", () => {
      expect(avg([0, 0, 0])).toBe(0);
    });

    test("handles zeros with nulls", () => {
      expect(avg([0, null, 0])).toBe(0);
    });

    test("handles large numbers", () => {
      expect(avg([1000000, 2000000])).toBe(1500000);
    });
  });
});

// =============================================================================
// count() Tests (REQ-F-28: includes nulls)
// =============================================================================

describe("count", () => {
  describe("with valid values", () => {
    test("counts integers", () => {
      expect(count([1, 2, 3, 4, 5])).toBe(5);
    });

    test("counts single element", () => {
      expect(count([42])).toBe(1);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("includes null values in count", () => {
      expect(count([1, null, 2, null, 3])).toBe(5);
    });

    test("includes undefined values in count", () => {
      expect(count([1, undefined, 2, undefined, 3])).toBe(5);
    });

    test("counts array of only nulls", () => {
      expect(count([null, null, null])).toBe(3);
    });

    test("counts array of only undefined", () => {
      expect(count([undefined, undefined])).toBe(2);
    });

    test("counts mixed nulls and undefined", () => {
      expect(count([null, undefined, null, undefined])).toBe(4);
    });

    test("counts values mixed with nulls", () => {
      // This is the key REQ-F-28 behavior: count reflects collection size
      expect(count([10, null, 20, null, null])).toBe(5);
    });
  });

  describe("with empty array", () => {
    test("returns 0 for empty array", () => {
      expect(count([])).toBe(0);
    });
  });

  describe("with non-numeric types", () => {
    test("counts strings", () => {
      expect(count(["a", "b", "c"])).toBe(3);
    });

    test("counts objects", () => {
      expect(count([{ a: 1 }, { b: 2 }])).toBe(2);
    });

    test("counts mixed types", () => {
      expect(count([1, "two", null, { three: 3 }])).toBe(4);
    });
  });
});

// =============================================================================
// min() Tests
// =============================================================================

describe("min", () => {
  describe("with valid numbers only", () => {
    test("finds minimum of positive integers", () => {
      expect(min([5, 2, 8, 1, 9])).toBe(1);
    });

    test("finds minimum of negative numbers", () => {
      expect(min([-5, -2, -8, -1])).toBe(-8);
    });

    test("finds minimum with mixed signs", () => {
      expect(min([10, -5, 3, -2, 0])).toBe(-5);
    });

    test("returns single value for single-element array", () => {
      expect(min([42])).toBe(42);
    });

    test("finds minimum with floating point", () => {
      expect(min([3.14, 2.71, 1.41])).toBe(1.41);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("skips null values", () => {
      expect(min([5, null, 2, null, 8])).toBe(2);
    });

    test("skips undefined values", () => {
      expect(min([5, undefined, 2, undefined, 8])).toBe(2);
    });

    test("finds min among non-null values", () => {
      expect(min([null, 100, null, 50, null])).toBe(50);
    });

    test("returns null for array of only nulls", () => {
      expect(min([null, null, null])).toBeNull();
    });

    test("returns null for array of only undefined", () => {
      expect(min([undefined, undefined])).toBeNull();
    });
  });

  describe("with empty array", () => {
    test("returns null for empty array", () => {
      expect(min([])).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles all same values", () => {
      expect(min([5, 5, 5])).toBe(5);
    });

    test("handles zero as minimum", () => {
      expect(min([0, 1, 2])).toBe(0);
    });

    test("handles negative zero", () => {
      // Math.min returns -0 when both -0 and 0 are present
      // -0 and 0 are equal for practical purposes (== and === both return true)
      const result = min([-0, 0, 1]);
      expect(result === 0).toBe(true);
    });
  });
});

// =============================================================================
// max() Tests
// =============================================================================

describe("max", () => {
  describe("with valid numbers only", () => {
    test("finds maximum of positive integers", () => {
      expect(max([5, 2, 8, 1, 9])).toBe(9);
    });

    test("finds maximum of negative numbers", () => {
      expect(max([-5, -2, -8, -1])).toBe(-1);
    });

    test("finds maximum with mixed signs", () => {
      expect(max([10, -5, 3, -2, 0])).toBe(10);
    });

    test("returns single value for single-element array", () => {
      expect(max([42])).toBe(42);
    });

    test("finds maximum with floating point", () => {
      expect(max([3.14, 2.71, 1.41])).toBe(3.14);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("skips null values", () => {
      expect(max([5, null, 2, null, 8])).toBe(8);
    });

    test("skips undefined values", () => {
      expect(max([5, undefined, 2, undefined, 8])).toBe(8);
    });

    test("finds max among non-null values", () => {
      expect(max([null, 100, null, 50, null])).toBe(100);
    });

    test("returns null for array of only nulls", () => {
      expect(max([null, null, null])).toBeNull();
    });

    test("returns null for array of only undefined", () => {
      expect(max([undefined, undefined])).toBeNull();
    });
  });

  describe("with empty array", () => {
    test("returns null for empty array", () => {
      expect(max([])).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles all same values", () => {
      expect(max([5, 5, 5])).toBe(5);
    });

    test("handles zero as maximum", () => {
      expect(max([-3, -2, 0])).toBe(0);
    });
  });
});

// =============================================================================
// stddev() Tests
// =============================================================================

describe("stddev", () => {
  describe("with valid numbers only", () => {
    test("computes population standard deviation", () => {
      // Values: [2, 4, 4, 4, 5, 5, 7, 9]
      // Mean: 5
      // Population stddev: sqrt(4) = 2
      expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    });

    test("computes stddev for simple case", () => {
      // Values: [1, 2, 3]
      // Mean: 2
      // Variance: ((1-2)^2 + (2-2)^2 + (3-2)^2) / 3 = (1 + 0 + 1) / 3 = 2/3
      // StdDev: sqrt(2/3) ≈ 0.8165
      const result = stddev([1, 2, 3]);
      expect(result).toBeCloseTo(0.8165, 3);
    });

    test("returns 0 for identical values", () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });

    test("handles negative numbers", () => {
      // Values: [-2, 0, 2]
      // Mean: 0
      // Variance: (4 + 0 + 4) / 3 = 8/3
      // StdDev: sqrt(8/3) ≈ 1.633
      const result = stddev([-2, 0, 2]);
      expect(result).toBeCloseTo(1.633, 3);
    });

    test("handles floating point numbers", () => {
      // Values: [1.0, 2.0, 3.0] - same as integer case
      const result = stddev([1.0, 2.0, 3.0]);
      expect(result).toBeCloseTo(0.8165, 3);
    });
  });

  describe("with null/undefined values (REQ-F-28)", () => {
    test("skips null values in calculation", () => {
      // Only valid values: [1, 2, 3]
      const result = stddev([1, null, 2, null, 3]);
      expect(result).toBeCloseTo(0.8165, 3);
    });

    test("skips undefined values in calculation", () => {
      const result = stddev([1, undefined, 2, undefined, 3]);
      expect(result).toBeCloseTo(0.8165, 3);
    });

    test("returns null for array of only nulls", () => {
      expect(stddev([null, null, null])).toBeNull();
    });

    test("returns null for array of only undefined", () => {
      expect(stddev([undefined, undefined])).toBeNull();
    });
  });

  describe("with empty array", () => {
    test("returns null for empty array", () => {
      expect(stddev([])).toBeNull();
    });
  });

  describe("with single value", () => {
    test("returns null for single valid value", () => {
      // Design choice: stddev of single value is null (insufficient data)
      expect(stddev([42])).toBeNull();
    });

    test("returns null when only one value after filtering nulls", () => {
      expect(stddev([null, 42, null])).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles two identical values", () => {
      expect(stddev([5, 5])).toBe(0);
    });

    test("handles two different values", () => {
      // Values: [0, 10]
      // Mean: 5
      // Variance: (25 + 25) / 2 = 25
      // StdDev: 5
      expect(stddev([0, 10])).toBe(5);
    });

    test("handles large spread", () => {
      // Values: [0, 100]
      // Mean: 50
      // Variance: (2500 + 2500) / 2 = 2500
      // StdDev: 50
      expect(stddev([0, 100])).toBe(50);
    });

    test("handles all zeros", () => {
      expect(stddev([0, 0, 0])).toBe(0);
    });

    test("handles mixed zeros with other values", () => {
      // Values: [0, 0, 6]
      // Mean: 2
      // Variance: (4 + 4 + 16) / 3 = 8
      // StdDev: sqrt(8) ≈ 2.828
      const result = stddev([0, 0, 6]);
      expect(result).toBeCloseTo(2.828, 3);
    });
  });

  describe("real-world scenarios", () => {
    test("board game ratings distribution", () => {
      // Sample BGG ratings: 6.5, 7.0, 7.5, 8.0, 8.5
      const ratings = [6.5, 7.0, 7.5, 8.0, 8.5];
      // Mean: 7.5
      // Variance: (1 + 0.25 + 0 + 0.25 + 1) / 5 = 0.5
      // StdDev: sqrt(0.5) ≈ 0.707
      const result = stddev(ratings);
      expect(result).toBeCloseTo(0.707, 3);
    });

    test("play counts with missing data", () => {
      // Some games have play counts, some don't
      const playCounts: AggregatorInput = [10, null, 5, undefined, 15, 20, null];
      // Valid values: [10, 5, 15, 20]
      // Mean: 12.5
      // Variance: (6.25 + 56.25 + 6.25 + 56.25) / 4 = 31.25
      // StdDev: sqrt(31.25) ≈ 5.59
      const result = stddev(playCounts);
      expect(result).toBeCloseTo(5.59, 2);
    });
  });
});

// =============================================================================
// Registry Tests (TD-14: Extensibility)
// =============================================================================

describe("Aggregator Registry", () => {
  describe("getAggregator", () => {
    test("returns sum aggregator", () => {
      const fn = getAggregator("sum");
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toBe(6);
    });

    test("returns avg aggregator", () => {
      const fn = getAggregator("avg");
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toBe(2);
    });

    test("returns count aggregator", () => {
      const fn = getAggregator("count");
      expect(fn).toBeDefined();
      expect(fn!([1, null, 2])).toBe(3);
    });

    test("returns min aggregator", () => {
      const fn = getAggregator("min");
      expect(fn).toBeDefined();
      expect(fn!([3, 1, 2])).toBe(1);
    });

    test("returns max aggregator", () => {
      const fn = getAggregator("max");
      expect(fn).toBeDefined();
      expect(fn!([1, 3, 2])).toBe(3);
    });

    test("returns stddev aggregator", () => {
      const fn = getAggregator("stddev");
      expect(fn).toBeDefined();
      expect(fn!([5, 5, 5])).toBe(0);
    });

    test("returns undefined for unknown aggregator", () => {
      expect(getAggregator("nonexistent")).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      expect(getAggregator("")).toBeUndefined();
    });
  });

  describe("registerAggregator", () => {
    test("registers a custom aggregator", () => {
      // Register a median aggregator
      registerAggregator("median", (values: AggregatorInput) => {
        const valid = values.filter((v): v is number => v !== null && v !== undefined);
        if (valid.length === 0) return null;
        valid.sort((a, b) => a - b);
        const mid = Math.floor(valid.length / 2);
        return valid.length % 2 !== 0
          ? valid[mid]
          : (valid[mid - 1] + valid[mid]) / 2;
      });

      const median = getAggregator("median");
      expect(median).toBeDefined();
      expect(median!([1, 3, 2])).toBe(2);
      expect(median!([1, 2, 3, 4])).toBe(2.5);
      expect(median!([null, 5, null])).toBe(5);
    });

    test("can overwrite existing aggregator", () => {
      // Save original
      const original = getAggregator("sum");

      // Override with a different implementation
      registerAggregator("sum", (values) => {
        const valid = values.filter((v): v is number => v !== null && v !== undefined);
        return valid.length * 1000; // Silly example
      });

      const overridden = getAggregator("sum");
      expect(overridden!([1, 2, 3])).toBe(3000);

      // Restore original for other tests
      registerAggregator("sum", original!);
    });

    test("registers aggregator with null handling", () => {
      registerAggregator("nullCount", (values) => {
        return values.filter((v) => v === null || v === undefined).length;
      });

      const nullCount = getAggregator("nullCount");
      expect(nullCount).toBeDefined();
      expect(nullCount!([1, null, 2, undefined, 3])).toBe(2);
      expect(nullCount!([1, 2, 3])).toBe(0);
    });
  });

  describe("listAggregators", () => {
    test("returns all registered aggregator names", () => {
      const names = listAggregators();
      expect(names).toContain("sum");
      expect(names).toContain("avg");
      expect(names).toContain("count");
      expect(names).toContain("min");
      expect(names).toContain("max");
      expect(names).toContain("stddev");
    });

    test("includes custom registered aggregators", () => {
      registerAggregator("custom_test", () => 0);
      const names = listAggregators();
      expect(names).toContain("custom_test");
    });

    test("returns array (not iterator)", () => {
      const names = listAggregators();
      expect(Array.isArray(names)).toBe(true);
    });
  });

  describe("hasAggregator", () => {
    test("returns true for existing aggregators", () => {
      expect(hasAggregator("sum")).toBe(true);
      expect(hasAggregator("avg")).toBe(true);
      expect(hasAggregator("count")).toBe(true);
      expect(hasAggregator("min")).toBe(true);
      expect(hasAggregator("max")).toBe(true);
      expect(hasAggregator("stddev")).toBe(true);
    });

    test("returns false for non-existent aggregator", () => {
      expect(hasAggregator("nonexistent")).toBe(false);
    });

    test("returns false for empty string", () => {
      expect(hasAggregator("")).toBe(false);
    });

    test("reflects newly registered aggregators", () => {
      expect(hasAggregator("new_agg")).toBe(false);
      registerAggregator("new_agg", () => 0);
      expect(hasAggregator("new_agg")).toBe(true);
    });
  });
});

// =============================================================================
// Integration/Combination Tests
// =============================================================================

describe("Aggregator Combinations", () => {
  test("all aggregators handle same input consistently", () => {
    const input: AggregatorInput = [10, null, 20, undefined, 30, null];

    // Valid values: [10, 20, 30]
    expect(sum(input)).toBe(60);
    expect(avg(input)).toBe(20);
    expect(count(input)).toBe(6); // Includes nulls
    expect(min(input)).toBe(10);
    expect(max(input)).toBe(30);

    // stddev of [10, 20, 30]: mean=20, variance=(100+0+100)/3=66.67, stddev=8.165
    const sd = stddev(input);
    expect(sd).toBeCloseTo(8.165, 3);
  });

  test("all aggregators handle empty array", () => {
    const empty: AggregatorInput = [];

    expect(sum(empty)).toBe(0);
    expect(avg(empty)).toBeNull();
    expect(count(empty)).toBe(0);
    expect(min(empty)).toBeNull();
    expect(max(empty)).toBeNull();
    expect(stddev(empty)).toBeNull();
  });

  test("all aggregators handle all-null array", () => {
    const allNulls: AggregatorInput = [null, null, null];

    expect(sum(allNulls)).toBe(0);
    expect(avg(allNulls)).toBeNull();
    expect(count(allNulls)).toBe(3); // REQ-F-28: count includes nulls
    expect(min(allNulls)).toBeNull();
    expect(max(allNulls)).toBeNull();
    expect(stddev(allNulls)).toBeNull();
  });

  test("registry lookup produces same results as direct call", () => {
    const input: AggregatorInput = [5, null, 10, 15];

    expect(getAggregator("sum")!(input)).toBe(sum(input));
    expect(getAggregator("avg")!(input)).toBe(avg(input));
    expect(getAggregator("count")!(input)).toBe(count(input));
    expect(getAggregator("min")!(input)).toBe(min(input));
    expect(getAggregator("max")!(input)).toBe(max(input));
    expect(getAggregator("stddev")!(input)).toBe(stddev(input));
  });
});

// =============================================================================
// Real-World Scenario Tests
// =============================================================================

describe("Real-World Scenarios", () => {
  describe("Board Game Collection Stats", () => {
    test("computes collection statistics with missing ratings", () => {
      // Some games rated, some not yet
      const ratings: AggregatorInput = [8.5, 7.2, null, 9.0, undefined, 6.8, 7.5];

      // Valid: [8.5, 7.2, 9.0, 6.8, 7.5] = 5 values
      expect(count(ratings)).toBe(7); // Total games in collection
      expect(sum(ratings)).toBeCloseTo(39, 1);
      expect(avg(ratings)).toBeCloseTo(7.8, 1);
      expect(min(ratings)).toBe(6.8);
      expect(max(ratings)).toBe(9.0);
    });

    test("computes play count statistics", () => {
      // Play counts for games (0 is valid, null means untracked)
      const playCounts: AggregatorInput = [23, 5, 0, null, 42, 1, null, 15];

      // Valid: [23, 5, 0, 42, 1, 15] = 6 values
      expect(count(playCounts)).toBe(8); // Total games
      expect(sum(playCounts)).toBe(86); // Total plays
      expect(avg(playCounts)).toBeCloseTo(14.33, 2); // Average per tracked game
      expect(min(playCounts)).toBe(0); // Unplayed but tracked
      expect(max(playCounts)).toBe(42); // Most played
    });
  });

  describe("Recipe Collection Stats", () => {
    test("computes difficulty ratings", () => {
      // Difficulty on 1-5 scale, some recipes unrated
      const difficulties: AggregatorInput = [3, 4, null, 2, 5, null, 3, 4, null];

      expect(count(difficulties)).toBe(9); // Total recipes
      expect(avg(difficulties)).toBeCloseTo(3.5, 1);
      expect(min(difficulties)).toBe(2);
      expect(max(difficulties)).toBe(5);
    });

    test("computes prep time statistics with missing data", () => {
      const prepTimes: AggregatorInput = [15, 30, null, 45, 60, undefined, 20];

      expect(sum(prepTimes)).toBe(170);
      expect(avg(prepTimes)).toBe(34);
      expect(min(prepTimes)).toBe(15);
      expect(max(prepTimes)).toBe(60);
    });
  });

  describe("Financial Data", () => {
    test("handles transaction amounts with some missing", () => {
      const amounts: AggregatorInput = [
        100.50,
        null,
        -25.00, // refund
        200.00,
        undefined,
        50.25,
      ];

      expect(sum(amounts)).toBeCloseTo(325.75, 2);
      expect(avg(amounts)).toBeCloseTo(81.44, 2);
      expect(min(amounts)).toBe(-25.00);
      expect(max(amounts)).toBe(200.00);
    });
  });
});

// =============================================================================
// Type Safety Tests
// =============================================================================

describe("Type Safety", () => {
  test("sum returns number (not null)", () => {
    const result: number = sum([1, 2, 3]);
    expect(typeof result).toBe("number");
  });

  test("avg can return null", () => {
    const result: number | null = avg([]);
    expect(result).toBeNull();
  });

  test("count always returns number", () => {
    const result: number = count([null, null]);
    expect(typeof result).toBe("number");
  });

  test("min/max can return null", () => {
    const minResult: number | null = min([]);
    const maxResult: number | null = max([]);
    expect(minResult).toBeNull();
    expect(maxResult).toBeNull();
  });

  test("stddev can return null", () => {
    const result: number | null = stddev([42]);
    expect(result).toBeNull();
  });
});
