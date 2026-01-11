/**
 * Collection Aggregators
 *
 * Functions for computing collection-level statistics from arrays of values.
 * Aggregators handle null/undefined values per REQ-F-28 and support a registry
 * pattern for extensibility per TD-14.
 *
 * Spec Requirements:
 * - REQ-F-7: Collection-level aggregations: sum, avg, count, min, max, stddev
 * - REQ-F-28: When frontmatter field missing from a file, treat as null and skip
 *             in aggregations; include in count but not in sum/avg
 * - REQ-NF-4: Extensibility - new aggregation types can be added without architectural changes
 *
 * Plan Reference:
 * - TD-11: Null Value Handling in Aggregations
 * - TD-14: Extensibility Architecture
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Input type for aggregation functions.
 * Values can be numbers, null (explicit), or undefined (missing field).
 */
export type AggregatorInput = (number | null | undefined)[];

/**
 * Result type for aggregation functions.
 * Returns a number when computation is possible, null when not (e.g., empty array for avg).
 */
export type AggregatorResult = number | null;

/**
 * Aggregator function signature.
 * Takes an array of potentially null values and returns a computed result.
 */
export type Aggregator = (values: AggregatorInput) => AggregatorResult;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Filters out null and undefined values from an array, returning only valid numbers.
 * This is used by all aggregators except count (which includes nulls per REQ-F-28).
 */
function filterValidNumbers(values: AggregatorInput): number[] {
  return values.filter((v): v is number => v !== null && v !== undefined);
}

// =============================================================================
// Aggregation Functions
// =============================================================================

/**
 * Computes the sum of valid numbers in the array.
 *
 * Null/undefined values are skipped (REQ-F-28).
 * Returns 0 for empty arrays (no values to sum).
 *
 * @param values - Array of numbers (may include null/undefined)
 * @returns Sum of valid numbers, or 0 if no valid numbers
 */
export function sum(values: AggregatorInput): number {
  const valid = filterValidNumbers(values);
  return valid.reduce((acc, v) => acc + v, 0);
}

/**
 * Computes the arithmetic mean (average) of valid numbers.
 *
 * Null/undefined values are skipped (REQ-F-28).
 * Returns null for empty arrays or arrays with no valid numbers
 * (division by zero is not meaningful).
 *
 * @param values - Array of numbers (may include null/undefined)
 * @returns Mean of valid numbers, or null if no valid numbers
 */
export function avg(values: AggregatorInput): AggregatorResult {
  const valid = filterValidNumbers(values);
  if (valid.length === 0) return null;
  return sum(valid) / valid.length;
}

/**
 * Counts the total number of items in the array.
 *
 * Includes null/undefined values in the count (REQ-F-28).
 * This reflects collection size, not data availability.
 *
 * @param values - Array of any values
 * @returns Total count of items (including nulls)
 */
export function count(values: unknown[]): number {
  return values.length;
}

/**
 * Finds the minimum value among valid numbers.
 *
 * Null/undefined values are skipped (REQ-F-28).
 * Returns null for empty arrays or arrays with no valid numbers.
 *
 * @param values - Array of numbers (may include null/undefined)
 * @returns Minimum value, or null if no valid numbers
 */
export function min(values: AggregatorInput): AggregatorResult {
  const valid = filterValidNumbers(values);
  if (valid.length === 0) return null;
  return Math.min(...valid);
}

/**
 * Finds the maximum value among valid numbers.
 *
 * Null/undefined values are skipped (REQ-F-28).
 * Returns null for empty arrays or arrays with no valid numbers.
 *
 * @param values - Array of numbers (may include null/undefined)
 * @returns Maximum value, or null if no valid numbers
 */
export function max(values: AggregatorInput): AggregatorResult {
  const valid = filterValidNumbers(values);
  if (valid.length === 0) return null;
  return Math.max(...valid);
}

/**
 * Computes the population standard deviation of valid numbers.
 *
 * Uses the population formula: sqrt(sum((x - mean)^2) / N)
 * This is appropriate for collection-level statistics where we have the full population.
 *
 * Null/undefined values are skipped (REQ-F-28).
 * Returns null for:
 * - Empty arrays (no data)
 * - Arrays with no valid numbers (all null/undefined)
 * - Arrays with only one valid number (stddev of single value is 0, but we return null
 *   to indicate insufficient data for meaningful deviation analysis)
 *
 * Note: Returning null for single-value arrays is a design choice. A single value
 * technically has stddev of 0, but this provides no useful information and could
 * mislead users into thinking there's no variation when really there's no comparison.
 *
 * @param values - Array of numbers (may include null/undefined)
 * @returns Population standard deviation, or null if insufficient valid numbers
 */
export function stddev(values: AggregatorInput): AggregatorResult {
  const valid = filterValidNumbers(values);
  // Need at least 2 values for meaningful standard deviation
  if (valid.length < 2) return null;

  const mean = sum(valid) / valid.length;
  const squaredDiffs = valid.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / valid.length;
  return Math.sqrt(variance);
}

// =============================================================================
// Aggregator Registry
// =============================================================================

/**
 * Registry of available aggregation functions.
 * New aggregators can be added via registerAggregator() (TD-14).
 */
const aggregatorRegistry = new Map<string, Aggregator>([
  ["sum", sum],
  ["avg", avg],
  ["count", count as Aggregator],
  ["min", min],
  ["max", max],
  ["stddev", stddev],
]);

/**
 * Retrieves an aggregator function by name.
 *
 * @param name - Name of the aggregator (e.g., "sum", "avg")
 * @returns The aggregator function, or undefined if not found
 *
 * @example
 * ```ts
 * const sumFn = getAggregator("sum");
 * if (sumFn) {
 *   const result = sumFn([1, 2, 3, null, 4]);  // 10
 * }
 * ```
 */
export function getAggregator(name: string): Aggregator | undefined {
  return aggregatorRegistry.get(name);
}

/**
 * Registers a custom aggregator function.
 *
 * Allows extending the aggregation capabilities without modifying core code (REQ-NF-4).
 * Will overwrite an existing aggregator with the same name.
 *
 * @param name - Name for the aggregator
 * @param fn - Aggregator function
 *
 * @example
 * ```ts
 * // Add a median aggregator
 * registerAggregator("median", (values) => {
 *   const valid = values.filter((v): v is number => v !== null && v !== undefined);
 *   if (valid.length === 0) return null;
 *   valid.sort((a, b) => a - b);
 *   const mid = Math.floor(valid.length / 2);
 *   return valid.length % 2 !== 0
 *     ? valid[mid]
 *     : (valid[mid - 1] + valid[mid]) / 2;
 * });
 * ```
 */
export function registerAggregator(name: string, fn: Aggregator): void {
  aggregatorRegistry.set(name, fn);
}

/**
 * Returns a list of all registered aggregator names.
 *
 * Useful for validation and documentation.
 *
 * @returns Array of aggregator names
 */
export function listAggregators(): string[] {
  return Array.from(aggregatorRegistry.keys());
}

/**
 * Checks if an aggregator with the given name exists.
 *
 * @param name - Name to check
 * @returns True if the aggregator exists
 */
export function hasAggregator(name: string): boolean {
  return aggregatorRegistry.has(name);
}
