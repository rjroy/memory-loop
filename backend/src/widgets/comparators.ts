/**
 * Similarity Comparators
 *
 * Functions for computing similarity between items using various methods.
 * Comparators handle null/undefined values and support a registry pattern
 * for extensibility per TD-14.
 *
 * Spec Requirements:
 * - REQ-F-12: Similarity widgets define dimensions with field, weight, and method
 * - REQ-F-13: Similarity methods: jaccard (set overlap), proximity (numeric distance),
 *             cosine (vector similarity)
 * - REQ-NF-4: Extensibility - new comparator types can be added without architectural changes
 *
 * Plan Reference:
 * - TD-14: Extensibility Architecture (Comparator registry)
 *
 * Similarity Score Range:
 * All comparators return a value in [0, 1]:
 * - 0 = completely dissimilar
 * - 1 = identical
 */

import type { DimensionConfig } from "./schemas";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Comparator function signature.
 * Takes two values and returns a similarity score between 0 and 1.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @param options - Optional configuration for the comparison
 * @returns Similarity score in [0, 1], where 1 means identical
 */
export type Comparator = (a: unknown, b: unknown, options?: ComparatorOptions) => number;

/**
 * Options for comparator functions.
 * Different comparators may use different options.
 */
export interface ComparatorOptions {
  /** Minimum value for proximity normalization */
  min?: number;
  /** Maximum value for proximity normalization */
  max?: number;
}

/**
 * Item data type for weighted similarity computation.
 * Maps field paths to their values.
 */
export type ItemData = Record<string, unknown>;

/**
 * Result of a weighted similarity computation.
 */
export interface WeightedSimilarityResult {
  /** Overall weighted similarity score in [0, 1] */
  score: number;
  /** Individual dimension scores for debugging/display */
  dimensions: DimensionScore[];
}

/**
 * Score for a single dimension in weighted similarity.
 */
export interface DimensionScore {
  field: string;
  method: string;
  weight: number;
  score: number;
  /** Whether this dimension was skipped due to null values */
  skipped: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Converts a value to an array for set-based comparisons.
 * - Arrays are returned as-is
 * - Single values become a single-element array
 * - Null/undefined become empty arrays
 */
function toArray(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

/**
 * Converts a value to a number for numeric comparisons.
 * Returns null if the value cannot be converted.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Converts a value to a number array for vector comparisons.
 * Returns null if the value cannot be converted to a valid vector.
 */
function toNumberArray(value: unknown): number[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    const num = toNumber(value);
    return num !== null ? [num] : null;
  }
  const numbers: number[] = [];
  for (const item of value) {
    const num = toNumber(item);
    if (num === null) {
      return null; // Invalid vector if any element is not a number
    }
    numbers.push(num);
  }
  return numbers.length > 0 ? numbers : null;
}

/**
 * Gets the magnitude (Euclidean norm) of a vector.
 */
function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}

/**
 * Gets the dot product of two vectors.
 * Assumes vectors have the same length.
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// =============================================================================
// Comparator Functions
// =============================================================================

/**
 * Computes Jaccard similarity between two sets.
 *
 * Jaccard similarity = |A ∩ B| / |A ∪ B|
 *
 * This measures the overlap between two sets:
 * - 1.0 when sets are identical (same elements)
 * - 0.0 when sets are completely disjoint (no common elements)
 * - 0.0 when both sets are empty (no overlap possible)
 *
 * Values are compared using strict equality after JSON serialization
 * to handle objects and arrays consistently.
 *
 * @param a - First set (can be array or single value)
 * @param b - Second set (can be array or single value)
 * @returns Jaccard similarity score in [0, 1]
 *
 * @example
 * ```ts
 * jaccardSimilarity(["strategy", "eurogame"], ["strategy", "card"]); // 0.333
 * jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"]); // 1.0
 * jaccardSimilarity(["x"], ["y"]); // 0.0
 * jaccardSimilarity([], []); // 0.0
 * ```
 */
export function jaccardSimilarity(a: unknown, b: unknown): number {
  const setA = toArray(a);
  const setB = toArray(b);

  // Empty sets have no overlap
  if (setA.length === 0 && setB.length === 0) {
    return 0;
  }

  // Convert to string keys for consistent comparison
  const keysA = new Set(setA.map((v) => JSON.stringify(v)));
  const keysB = new Set(setB.map((v) => JSON.stringify(v)));

  // Count intersection
  let intersection = 0;
  for (const key of keysA) {
    if (keysB.has(key)) {
      intersection++;
    }
  }

  // Union = A + B - intersection
  const union = keysA.size + keysB.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Computes proximity similarity between two numeric values.
 *
 * Uses the formula: 1 / (1 + normalized_distance)
 *
 * Where normalized_distance = |a - b| / range when min/max are provided,
 * or |a - b| when they are not.
 *
 * This measures how close two numbers are:
 * - 1.0 when values are identical
 * - Approaches 0 as values diverge
 * - Returns 0 when either value is null/undefined
 *
 * @param a - First numeric value
 * @param b - Second numeric value
 * @param options - Optional min/max for normalization
 * @returns Proximity similarity score in [0, 1]
 *
 * @example
 * ```ts
 * proximitySimilarity(5, 5); // 1.0 (identical)
 * proximitySimilarity(0, 10, { min: 0, max: 100 }); // 0.909 (close)
 * proximitySimilarity(0, 100, { min: 0, max: 100 }); // 0.5 (max distance)
 * proximitySimilarity(null, 5); // 0 (null value)
 * ```
 */
export function proximitySimilarity(
  a: unknown,
  b: unknown,
  options?: ComparatorOptions
): number {
  const numA = toNumber(a);
  const numB = toNumber(b);

  // Null values cannot be compared
  if (numA === null || numB === null) {
    return 0;
  }

  // Identical values are maximally similar
  if (numA === numB) {
    return 1;
  }

  const distance = Math.abs(numA - numB);

  // Normalize distance if range is provided
  if (options?.min !== undefined && options?.max !== undefined) {
    const range = options.max - options.min;
    if (range <= 0) {
      // Invalid range, fall back to unnormalized
      return 1 / (1 + distance);
    }
    const normalizedDistance = distance / range;
    return 1 / (1 + normalizedDistance);
  }

  return 1 / (1 + distance);
}

/**
 * Computes cosine similarity between two vectors.
 *
 * Cosine similarity = (A · B) / (|A| * |B|)
 *
 * This measures the angle between two vectors:
 * - 1.0 when vectors point in the same direction
 * - 0.0 when vectors are orthogonal (perpendicular)
 * - 0.0 when either vector is zero (no direction)
 *
 * Vectors must have the same dimensionality. If lengths differ,
 * the shorter vector is padded with zeros.
 *
 * @param a - First vector (array of numbers)
 * @param b - Second vector (array of numbers)
 * @returns Cosine similarity score in [0, 1]
 *
 * @example
 * ```ts
 * cosineSimilarity([1, 0], [1, 0]); // 1.0 (same direction)
 * cosineSimilarity([1, 0], [0, 1]); // 0.0 (perpendicular)
 * cosineSimilarity([1, 2, 3], [2, 4, 6]); // 1.0 (same direction, different magnitude)
 * cosineSimilarity([0, 0], [1, 1]); // 0.0 (zero vector)
 * ```
 */
export function cosineSimilarity(a: unknown, b: unknown): number {
  const vecA = toNumberArray(a);
  const vecB = toNumberArray(b);

  // Null or invalid vectors cannot be compared
  if (vecA === null || vecB === null) {
    return 0;
  }

  // Ensure vectors have the same length by padding with zeros.
  // Safe to mutate vecA/vecB because toNumberArray always returns fresh arrays.
  const maxLen = Math.max(vecA.length, vecB.length);
  while (vecA.length < maxLen) vecA.push(0);
  while (vecB.length < maxLen) vecB.push(0);

  const magA = magnitude(vecA);
  const magB = magnitude(vecB);

  // Zero vectors have no direction
  if (magA === 0 || magB === 0) {
    return 0;
  }

  const dot = dotProduct(vecA, vecB);
  const similarity = dot / (magA * magB);

  // Clamp to [0, 1] to handle floating point errors
  // Note: Cosine similarity can be negative for opposite directions,
  // but we're treating similarity as [0, 1] per spec, so we clamp
  return Math.max(0, Math.min(1, similarity));
}

// =============================================================================
// Comparator Registry
// =============================================================================

/**
 * Registry of available comparator functions.
 * New comparators can be added via registerComparator() (TD-14).
 */
const comparatorRegistry = new Map<string, Comparator>([
  ["jaccard", jaccardSimilarity],
  ["proximity", proximitySimilarity],
  ["cosine", cosineSimilarity],
]);

/**
 * Retrieves a comparator function by name.
 *
 * @param name - Name of the comparator (e.g., "jaccard", "proximity", "cosine")
 * @returns The comparator function, or undefined if not found
 *
 * @example
 * ```ts
 * const jaccard = getComparator("jaccard");
 * if (jaccard) {
 *   const score = jaccard(["a", "b"], ["b", "c"]);  // 0.333
 * }
 * ```
 */
export function getComparator(name: string): Comparator | undefined {
  return comparatorRegistry.get(name);
}

/**
 * Registers a custom comparator function.
 *
 * Allows extending the similarity capabilities without modifying core code (REQ-NF-4).
 * Will overwrite an existing comparator with the same name.
 *
 * @param name - Name for the comparator
 * @param fn - Comparator function
 *
 * @example
 * ```ts
 * // Add a dice coefficient comparator
 * registerComparator("dice", (a, b) => {
 *   const setA = new Set(toArray(a).map(v => JSON.stringify(v)));
 *   const setB = new Set(toArray(b).map(v => JSON.stringify(v)));
 *   let intersection = 0;
 *   for (const key of setA) if (setB.has(key)) intersection++;
 *   return (2 * intersection) / (setA.size + setB.size);
 * });
 * ```
 */
export function registerComparator(name: string, fn: Comparator): void {
  comparatorRegistry.set(name, fn);
}

/**
 * Returns a list of all registered comparator names.
 *
 * Useful for validation and documentation.
 *
 * @returns Array of comparator names
 */
export function listComparators(): string[] {
  return Array.from(comparatorRegistry.keys());
}

/**
 * Checks if a comparator with the given name exists.
 *
 * @param name - Name to check
 * @returns True if the comparator exists
 */
export function hasComparator(name: string): boolean {
  return comparatorRegistry.has(name);
}

// =============================================================================
// Weighted Similarity Computation
// =============================================================================

/**
 * Gets a field value from an item using dot-notation path.
 *
 * @param item - Item data object
 * @param path - Dot-notation field path (e.g., "bgg.mechanics")
 * @returns The field value, or undefined if not found
 */
function getFieldValue(item: ItemData, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = item;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Computes weighted similarity between two items across multiple dimensions.
 *
 * Each dimension specifies:
 * - field: The frontmatter field path to compare
 * - weight: How much this dimension contributes to overall similarity
 * - method: Which comparator to use (jaccard, proximity, cosine)
 *
 * Weights are normalized so they sum to 1.0. Dimensions with null values
 * on either item are skipped, and their weights are redistributed.
 *
 * @param itemA - First item's frontmatter data
 * @param itemB - Second item's frontmatter data
 * @param dimensions - Array of dimension configurations
 * @returns Weighted similarity result with overall score and per-dimension breakdown
 *
 * @example
 * ```ts
 * const result = computeWeightedSimilarity(
 *   { tags: ["strategy", "eurogame"], rating: 8.5 },
 *   { tags: ["strategy", "card"], rating: 7.5 },
 *   [
 *     { field: "tags", weight: 0.7, method: "jaccard" },
 *     { field: "rating", weight: 0.3, method: "proximity" },
 *   ]
 * );
 * // result.score = 0.7 * 0.333 + 0.3 * 0.5 = 0.383
 * ```
 */
export function computeWeightedSimilarity(
  itemA: ItemData,
  itemB: ItemData,
  dimensions: DimensionConfig[]
): WeightedSimilarityResult {
  const dimensionScores: DimensionScore[] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const dim of dimensions) {
    const valueA = getFieldValue(itemA, dim.field);
    const valueB = getFieldValue(itemB, dim.field);

    // Check if either value is null/undefined
    const aIsNull = valueA === null || valueA === undefined;
    const bIsNull = valueB === null || valueB === undefined;

    if (aIsNull || bIsNull) {
      // Skip this dimension
      dimensionScores.push({
        field: dim.field,
        method: dim.method,
        weight: dim.weight,
        score: 0,
        skipped: true,
      });
      continue;
    }

    // Get the comparator
    const comparator = getComparator(dim.method);
    if (!comparator) {
      // Unknown method, skip
      dimensionScores.push({
        field: dim.field,
        method: dim.method,
        weight: dim.weight,
        score: 0,
        skipped: true,
      });
      continue;
    }

    // Compute similarity for this dimension
    const score = comparator(valueA, valueB);

    dimensionScores.push({
      field: dim.field,
      method: dim.method,
      weight: dim.weight,
      score,
      skipped: false,
    });

    totalWeight += dim.weight;
    weightedSum += dim.weight * score;
  }

  // Normalize by total weight of non-skipped dimensions
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    score: overallScore,
    dimensions: dimensionScores,
  };
}
