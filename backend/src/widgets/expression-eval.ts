/**
 * Expression Evaluation
 *
 * Safe expression evaluation using expr-eval with custom functions and security validation.
 * Expressions can reference three namespaces:
 * - `this.*` - Current item's frontmatter fields
 * - `stats.*` - Collection-level statistics (from aggregators)
 * - `result.*` - Previously computed field values (for DAG-based dependencies)
 *
 * Spec Requirements:
 * - REQ-F-8: Per-item computed fields using a safe expression language
 * - REQ-F-11: Expression language supports: arithmetic, comparisons, conditionals, math functions
 * - REQ-F-30: Expression evaluation must timeout after 1 second per item
 * - REQ-NF-5: Expression language does not permit arbitrary code execution, file system access, or network calls
 *
 * Plan Reference:
 * - TD-1: Expression Language Selection (expr-eval)
 * - TD-4: Two-Phase Computation Model
 * - TD-6: Result Context Integration (DAG dependencies)
 * - TD-7: Per-Item vs Collection Context
 */

import { Parser, type Expression, type Value } from "expr-eval";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when an expression contains blocked keywords or patterns.
 * Used to prevent potential security vulnerabilities (REQ-NF-5).
 */
export class ExpressionSecurityError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly blockedKeyword?: string
  ) {
    super(message);
    this.name = "ExpressionSecurityError";
  }
}

/**
 * Error thrown when expression evaluation exceeds the timeout (REQ-F-30).
 */
export class ExpressionTimeoutError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly elapsedMs: number
  ) {
    super(message);
    this.name = "ExpressionTimeoutError";
  }
}

/**
 * Error thrown when expression parsing or evaluation fails.
 */
export class ExpressionEvaluationError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ExpressionEvaluationError";
  }
}

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Context passed to expression evaluation.
 *
 * Three namespaces are available to expressions:
 * - `this`: Current item's frontmatter fields (item-scope)
 * - `stats`: Collection-level statistics from aggregators (collection-scope)
 * - `result`: Previously computed field values for DAG-based cross-field references
 *
 * The `result` namespace enables fields to depend on other computed fields.
 * For example, `result.max_score` accesses the value computed by a field named `max_score`
 * that was evaluated earlier in the dependency order.
 *
 * When `result` is undefined (legacy callers), expressions referencing `result.*`
 * will return undefined, which is normalized to null by the evaluation pipeline.
 *
 * @see TD-6 (Result Context Integration) in the DAG dependency plan
 * @see TD-7 (Per-Item vs Collection Context) for scope distinctions
 */
export interface ExpressionContext {
  /** Current item's frontmatter fields (item-scope) */
  this: Record<string, unknown>;
  /** Collection-level statistics from aggregators */
  stats: Record<string, unknown>;
  /**
   * Previously computed field values from the DAG computation.
   * Optional for backward compatibility with existing callers.
   * - In item-scope expressions: contains per-item computed values
   * - In collection-scope contexts: contains aggregated values
   */
  result?: Record<string, unknown>;
  /**
   * Results from included widgets.
   * Maps widget name -> computed field values.
   * Enables cross-widget references: `included.WidgetName.fieldName`
   */
  included?: Record<string, Record<string, unknown>>;
}

/**
 * Options for expression evaluation.
 */
export interface EvaluateOptions {
  /** Timeout in milliseconds (default: 1000ms per REQ-F-30) */
  timeoutMs?: number;
}

// =============================================================================
// Block Expression Detection
// =============================================================================

/**
 * Check if an expression is a block expression (multi-line JavaScript-like syntax).
 * Block expressions start with '{' and end with '}' and can contain
 * variable declarations, conditionals, loops, and return statements.
 *
 * @param expression - The expression string to check
 * @returns true if the expression is a block expression
 */
function isBlockExpression(expression: string): boolean {
  const trimmed = expression.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

// =============================================================================
// Security Configuration
// =============================================================================

/**
 * Keywords blocked in expressions for security (REQ-NF-5).
 * These could potentially be used for code injection or accessing forbidden APIs.
 */
const BLOCKED_KEYWORDS = [
  // Module/import system
  "require",
  "import",
  "export",
  "module",

  // Global objects
  "process",
  "global",
  "globalThis",
  "window",
  "document",
  "self",

  // Code execution
  "eval",
  "Function",
  "constructor",
  "__proto__",
  "prototype",

  // Network access
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Request",
  "Response",

  // File system (Node.js)
  "fs",
  "readFile",
  "writeFile",
  "readFileSync",
  "writeFileSync",

  // Child process
  "exec",
  "spawn",
  "execSync",
  "spawnSync",
  "child_process",

  // Timing attacks / resource exhaustion
  "setTimeout",
  "setInterval",
  "setImmediate",
] as const;

/**
 * Regex patterns for additional security checks.
 * These catch variations that simple keyword matching might miss.
 */
const BLOCKED_PATTERNS = [
  // Property access on constructor chain
  /\bconstructor\s*\[/,
  /\["constructor"\]/,
  /\['constructor'\]/,

  // Prototype manipulation
  /\.__proto__\b/,
  /\["__proto__"\]/,
  /\['__proto__'\]/,
  /\bprototype\b/,

  // Template literal evaluation
  /`[^`]*\$\{/,
] as const;

// =============================================================================
// Parser Configuration
// =============================================================================

/**
 * Create a configured parser instance with restricted operators.
 * We disable operators that could be used for code injection while
 * keeping mathematical and comparison operators.
 */
function createParser(): Parser {
  const parser = new Parser({
    operators: {
      // Enable basic math
      add: true,
      subtract: true,
      multiply: true,
      divide: true,
      remainder: true,
      power: true,

      // Enable comparison
      comparison: true,

      // Enable logical operators
      logical: true,

      // Enable ternary for conditionals
      conditional: true,

      // Disable potentially dangerous operators
      in: false, // Can be used for object enumeration
      assignment: false, // No side effects
      fndef: false, // No function definitions

      // Enable useful features
      concatenate: true, // String concatenation is safe
      factorial: true,

      // Enable all math functions (they're unary operators in expr-eval)
      abs: true,
      ceil: true,
      floor: true,
      round: true,
      trunc: true,
      sqrt: true,
      cbrt: true,
      exp: true,
      expm1: true,
      log: true,
      log1p: true,
      log2: true,
      log10: true,
      ln: true,
      lg: true,
      sign: true,
      sin: true,
      cos: true,
      tan: true,
      asin: true,
      acos: true,
      atan: true,
      sinh: true,
      cosh: true,
      tanh: true,
      asinh: true,
      acosh: true,
      atanh: true,
      min: true,
      max: true,
      random: true,
      length: true,
    },
  });

  // Register custom functions on the parser instance
  // These override any built-in functions with the same name
  // Parser.functions is typed as `any` in the library
  const functions = parser.functions as Record<string, unknown>;
  Object.entries(customFunctions).forEach(([name, fn]) => {
    functions[name] = fn;
  });

  return parser;
}

// =============================================================================
// Custom Functions
// =============================================================================

/**
 * Custom functions available in expressions (REQ-F-11, TD-4).
 * These are injected into the evaluation context.
 *
 * Note: expr-eval has certain built-in unary operators (abs, round, ceil, floor, sqrt, log)
 * that only take one argument. We provide variants with different names that support
 * additional parameters.
 */
export const customFunctions = {
  /**
   * Round a number to specified decimal places.
   * Use this instead of the built-in round() when you need decimal precision.
   *
   * @param x - Number to round
   * @param decimals - Number of decimal places (default: 0)
   * @returns Rounded number, or null if x is not a number
   *
   * @example
   * roundTo(3.14159, 2) => 3.14
   * roundTo(7.5) => 8 (same as built-in round)
   */
  roundTo(x: unknown, decimals: unknown = 0): number | null {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    const d = typeof decimals === "number" && Number.isFinite(decimals) ? Math.floor(decimals) : 0;
    const factor = Math.pow(10, d);
    return Math.round(x * factor) / factor;
  },

  /**
   * Clamp a value to a range.
   * @param x - Value to clamp
   * @param minVal - Minimum value
   * @param maxVal - Maximum value
   * @returns Clamped value, or null if any argument is not a valid number
   */
  clamp(x: unknown, minVal: unknown, maxVal: unknown): number | null {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (typeof minVal !== "number" || !Number.isFinite(minVal)) return null;
    if (typeof maxVal !== "number" || !Number.isFinite(maxVal)) return null;
    return Math.min(Math.max(x, minVal), maxVal);
  },

  /**
   * Approximate the error function (erf) for a given number.
   * This implementation uses a numerical approximation.
   * @param x - The input value
   * @returns Approximate erf(x), or null if input is invalid
   */
  erf(x: unknown): number | null {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;

    // Abramowitz & Stegun 7.1.26 approximation
    const sign = x < 0 ? -1 : 1;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const absX = Math.abs(x);
    const t = 1 / (1 + p * absX);
    const y =
      1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);

    return sign * y;
  },

  /**
   * Compute z-score (standard score) for a value.
   * z-score = (value - mean) / stddev
   *
   * @param value - The value to normalize
   * @param mean - The population mean
   * @param stddev - The population standard deviation
   * @returns z-score, or null if stddev is 0 or arguments are invalid
   */
  zscore(value: unknown, mean: unknown, stddev: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (typeof mean !== "number" || !Number.isFinite(mean)) return null;
    if (typeof stddev !== "number" || !Number.isFinite(stddev)) return null;

    // Cannot divide by zero - return null instead of Infinity
    if (stddev === 0) return null;

    return (value - mean) / stddev;
  },

  /**
   * Use zscore to convert a value to a percentile (0-100).
   * Assumes a normal distribution.
   * @param value - The value to convert
   * @param mean - The population mean
   * @param stddev - The population standard deviation
   * @returns Percentile (0-100), or null if stddev is 0 or arguments are invalid
   */
  percentile(value: unknown, mean: unknown, stddev: unknown): number | null {
    const z = customFunctions.zscore(value, mean, stddev);
    if (z === null) return null;

    // Convert z-score to percentile using the cumulative distribution function (CDF)
    // for a standard normal distribution
    const e = customFunctions.erf(z / Math.SQRT2);
    if (e === null) return null;

    const percentile = 0.5 * (1 + e) * 100;
    return percentile;
  },

  /**
   * Use zscore to convert a value to a arbitrary score between 0 and maxScore.
   * Assumes a normal distribution.
   * @param value - The value to convert
   * @param mean - The population mean
   * @param stddev - The population standard deviation
   * @param maxScore - The maximum score (default: 100)
   * @returns Score between 0 and maxScore, or null if stddev is 0 or arguments are invalid
   */
  zscoreToScore(
    value: unknown,
    mean: unknown,
    stddev: unknown,
    maxScore: unknown = 100
  ): number | null {
    const percentile = customFunctions.percentile(value, mean, stddev);
    if (percentile === null) return null;

    if (typeof maxScore !== "number" || !Number.isFinite(maxScore) || maxScore < 0) {
      return null;
    }

    return (percentile / 100) * maxScore;
  },

  /**
   * Safe division that returns null instead of Infinity/NaN.
   * @param x - Numerator
   * @param y - Denominator
   * @returns x/y, or null if y is 0 or arguments are invalid
   */
  safeDivide(x: unknown, y: unknown): number | null {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (typeof y !== "number" || !Number.isFinite(y)) return null;
    if (y === 0) return null;
    return x / y;
  },

  /**
   * Check if a value is null or undefined.
   * Useful for conditional expressions.
   * @param x - Value to check
   * @returns true if x is null or undefined
   */
  isNull(x: unknown): boolean {
    return x === null || x === undefined;
  },

  /**
   * Return a default value if the first value is null/undefined.
   * @param x - Value to check
   * @param defaultVal - Value to return if x is null/undefined
   * @returns x if not null/undefined, otherwise defaultVal
   */
  coalesce(x: unknown, defaultVal: unknown): unknown {
    return x === null || x === undefined ? defaultVal : x;
  },


  /**
   * Split a string by a delimiter and convert parts to numbers.
   * Returns an array of numbers, skipping invalid parts.
   * @see https://en.wikipedia.org/wiki/Split_(computer_science)    
   * @param x String to split
   * @param delimiter Delimiter string (default: ",")
   * @returns Array of numbers, or null if input is invalid
   */
  splitNums(x: unknown, delimiter: unknown = ","): number[] | null {
    if (typeof x !== "string") return null;
    if (typeof delimiter !== "string" || delimiter.length === 0) return null;

    const parts = x.split(delimiter);
    const nums: number[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
        const num = Number(trimmed);

        if (typeof num === "number" && Number.isFinite(num)) {
          nums.push(num);
        }
    }

    return nums;
  },

  /**
   * Return the sum of an arbitrary number of values.
   * Skips non-numeric values.
   * @see https://en.wikipedia.org/wiki/Summation 
   * @param values - Values to sum
   * @returns Arithmetic sum
   */
  sum(...values: unknown[]): number {
    let total = 0;
    
    // If values[0] is an array, use its elements instead (variadic vs array input)
    if (values.length === 1 && Array.isArray(values[0])) {
      values = values[0];
    }

    for (const val of values) {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        continue;
      }
      total += val;
    }

    return total;
  },

  /**
   * Return the product of an arbitrary number of values.
   * Skips non-numeric values.
   * If no valid numeric values are provided, returns 0.
   * @see https://en.wikipedia.org/wiki/Product_(mathematics)
    
   * @param values - Values to compute product for
   * @returns Arithmetic product
   */
  product(...values: unknown[]): number {
    let result = 1;
    let hasValid = false;

    // If values[0] is an array, use its elements instead (variadic vs array input)
    if (values.length === 1 && Array.isArray(values[0])) {
      values = values[0];
    }

    for (const val of values) {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        continue;
      }
      result *= val;
      hasValid = true;
    }

    return hasValid ? result : 0;
  },

  /**
   * Return the arithmetic mean of an arbitrary number of values.
   * Skips non-numeric values.
   * @see https://en.wikipedia.org/wiki/Arithmetic_mean
   * @param values - Values to compute mean for
   * @returns Arithmetic mean
   */
  mean(...values: unknown[]): number | null {
    let sum = 0;
    let n = 0;

    // If values[0] is an array, use its elements instead (variadic vs array input)
    if (values.length === 1 && Array.isArray(values[0])) {
      values = values[0];
    }

    for (const val of values) {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        continue;
      }
      sum += val;
      n += 1;
    }

    if (n === 0) return null;
    return sum / n;
  },

  /**
   * Return the harmonic mean of an arbitrary number of values.
   * Skips non-numeric and zero values.
   1 / H = (1/n) * Σ (1/xi)
   * @see https://en.wikipedia.org/wiki/Harmonic_mean
   * @param values - Values to compute harmonic mean for
   * @returns Harmonic mean
   */
  harmonicMean(...values: unknown[]): number | null {
    let n = 0;
    let denomSum = 0;

    // If values[0] is an array, use its elements instead (variadic vs array input)
    if (values.length === 1 && Array.isArray(values[0])) {
      values = values[0];
    }

    for (const val of values) {
      if (typeof val !== "number" || !Number.isFinite(val) || val === 0) {
        continue;
      }
      denomSum += 1 / val;
      n += 1;
    }
    
    if (n === 0 || denomSum === 0) return null;
    return n / denomSum;
  },

  /**
   * Scale a value to the 0-1 range based on min/max bounds.
   * @param x - Value to normalize
   * @param minVal - Minimum of the range
   * @param maxVal - Maximum of the range
   * @returns Normalized value (0-1), or null if arguments are invalid or min equals max
   *
   * @example
   * normalize(8, 1, 10) => 0.778 (approximately)
   * normalize(5, 0, 10) => 0.5
   */
  normalize(x: unknown, minVal: unknown, maxVal: unknown): number | null {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (typeof minVal !== "number" || !Number.isFinite(minVal)) return null;
    if (typeof maxVal !== "number" || !Number.isFinite(maxVal)) return null;
    if (maxVal === minVal) return null; // Avoid division by zero
    return (x - minVal) / (maxVal - minVal);
  },

  /**
   * Linear interpolation between two values.
   * @param a - Start value
   * @param b - End value
   * @param t - Interpolation factor (0 = a, 1 = b, 0.5 = midpoint)
   * @returns Interpolated value, or null if arguments are invalid
   *
   * @example
   * lerp(0, 100, 0.5) => 50
   * lerp(10, 20, 0.25) => 12.5
   */
  lerp(a: unknown, b: unknown, t: unknown): number | null {
    if (typeof a !== "number" || !Number.isFinite(a)) return null;
    if (typeof b !== "number" || !Number.isFinite(b)) return null;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    return a + (b - a) * t;
  },

  /**
   * Return the weighted mean of values with corresponding weights.
   * Skips non-numeric values and weights.
   * Negative weights are treated as their absolute values, but will reduce the total weighted sum.
   * @see https://en.wikipedia.org/wiki/Weighted_arithmetic_mean
   * @param values - Values to compute weighted mean for
   * @param weights - Corresponding weights
   * @returns Weighted mean
   */
  weightedMean(values: unknown[], weights: unknown[]): number | null {
    if (!Array.isArray(values) || !Array.isArray(weights) || values.length !== weights.length) {
      return null;
    }

    let weightedSum = 0;
    let weightTotal = 0;

    const length = Math.min(values.length, weights.length);

    for (let i = 0; i < length; i++) {
      const val = values[i];
      const weight = weights[i];

      if (
        typeof val !== "number" ||
        !Number.isFinite(val) ||
        typeof weight !== "number" ||
        !Number.isFinite(weight)
      ) {
        continue;
      }

      weightedSum += val * weight;
      weightTotal += Math.abs(weight);
    }

    if (weightTotal === 0) return null;
    return weightedSum / weightTotal;
  },
};

/*
 * Built-in expr-eval operators and functions (no need to define):
 *
 * Unary operators (single argument, used as: func(x)):
 *   - abs, round, floor, ceil, trunc, sqrt, cbrt
 *   - sin, cos, tan, asin, acos, atan
 *   - sinh, cosh, tanh, asinh, acosh, atanh
 *   - log, log2, log10, ln, lg, exp, expm1, log1p
 *   - sign, length
 *
 * Multi-argument functions (use as: func(a, b)):
 *   - min(a, b, ...), max(a, b, ...)
 *   - pow(base, exp), atan2(y, x), hypot(a, b)
 *   - roundTo(x, decimals) - rounds to decimal places
 *
 * Constants:
 *   - PI, E, true, false
 */

// =============================================================================
// Security Validation
// =============================================================================

/**
 * Validate an expression string for security issues (REQ-NF-5).
 * Checks for blocked keywords and patterns that could enable code injection.
 *
 * @param expression - The expression string to validate
 * @throws ExpressionSecurityError if blocked content is found
 */
export function validateExpressionSecurity(expression: string): void {
  // Check for blocked keywords
  for (const keyword of BLOCKED_KEYWORDS) {
    // Use word boundary matching to avoid false positives
    // e.g., "import" in "important" should not trigger
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(expression)) {
      throw new ExpressionSecurityError(
        `Expression contains blocked keyword: "${keyword}"`,
        expression,
        keyword
      );
    }
  }

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new ExpressionSecurityError(
        `Expression contains blocked pattern: ${pattern.source}`,
        expression,
        pattern.source
      );
    }
  }

  // Check for object literal injection attempts
  // e.g., { constructor: ... } or expressions that try to create objects
  if (/\{[^}]*:/.test(expression)) {
    throw new ExpressionSecurityError(
      "Expression contains object literal syntax which is not allowed",
      expression,
      "object literal"
    );
  }
}

/**
 * Validate a block expression string for security issues (REQ-NF-5).
 * Similar to validateExpressionSecurity but allows block syntax.
 *
 * Block expressions legitimately use { } for their body, so we skip
 * the object literal check. We still check for blocked keywords and
 * dangerous patterns like prototype manipulation.
 *
 * @param expression - The block expression string to validate
 * @throws ExpressionSecurityError if blocked content is found
 */
function validateBlockExpressionSecurity(expression: string): void {
  // Check for blocked keywords
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(expression)) {
      throw new ExpressionSecurityError(
        `Block expression contains blocked keyword: "${keyword}"`,
        expression,
        keyword
      );
    }
  }

  // Check for blocked patterns (prototype manipulation, etc.)
  // Note: We use all patterns here since they don't conflict with block syntax
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      throw new ExpressionSecurityError(
        `Block expression contains blocked pattern: ${pattern.source}`,
        expression,
        pattern.source
      );
    }
  }
}

// =============================================================================
// Context Flattening
// =============================================================================

/**
 * Flatten nested context objects for expr-eval.
 * Converts { this: { rating: 5 }, stats: { rating_mean: 4 }, result: { max_score: 10 } }
 * into an object where expressions can access this.rating, stats.rating_mean, or result.max_score.
 *
 * This allows expressions to use:
 * - `this.rating` for item frontmatter
 * - `stats.rating_mean` for collection statistics
 * - `result.max_score` for previously computed field values (DAG dependencies)
 *
 * Custom functions are registered on the Parser instance, not in the context.
 *
 * Note: We cast to Value because expr-eval's type definitions are incomplete.
 * The library actually accepts nested objects, but the types only declare
 * a simpler Value type.
 *
 * When context.result is undefined (legacy callers), we provide an empty object
 * so that result.* references return undefined (normalized to null) rather than
 * throwing an error.
 */
function flattenContext(context: ExpressionContext): Value {
  // The expr-eval library accepts nested objects, but the type definitions
  // are incomplete. We cast through unknown to satisfy TypeScript.
  return {
    this: context.this,
    stats: context.stats,
    result: context.result ?? {},
    included: context.included ?? {},
  } as unknown as Value;
}

// =============================================================================
// Expression Evaluation
// =============================================================================

/** Default timeout in milliseconds (REQ-F-30) */
const DEFAULT_TIMEOUT_MS = 1000;

/**
 * Parse and evaluate an expression with the given context.
 *
 * @param expression - The expression string to evaluate
 * @param context - Context containing `this` (current item), `stats` (collection stats),
 *                  and optionally `result` (previously computed field values)
 * @param options - Evaluation options (timeout, etc.)
 * @returns The evaluation result, or null if the result is undefined/NaN/Infinity
 * @throws ExpressionSecurityError if expression contains blocked content
 * @throws ExpressionTimeoutError if evaluation exceeds timeout
 * @throws ExpressionEvaluationError if parsing or evaluation fails
 *
 * @example
 * ```ts
 * // Basic example with this and stats
 * const result = evaluateExpression(
 *   "zscore(this.rating, stats.rating_mean, stats.rating_stddev)",
 *   {
 *     this: { rating: 8.5 },
 *     stats: { rating_mean: 7.0, rating_stddev: 1.5 }
 *   }
 * );
 * // result = 1.0
 *
 * // Example with result context for cross-field dependencies
 * const normalized = evaluateExpression(
 *   "this.score / result.max_score",
 *   {
 *     this: { score: 85 },
 *     stats: {},
 *     result: { max_score: 100 }
 *   }
 * );
 * // normalized = 0.85
 * ```
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): unknown {
  // Check if this is a block expression and delegate to block evaluator
  if (isBlockExpression(expression)) {
    return evaluateBlockExpression(expression, context, options);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = performance.now();

  // Security validation first (REQ-NF-5)
  validateExpressionSecurity(expression);

  // Check timeout after security validation
  const afterSecurityCheck = performance.now();
  if (afterSecurityCheck - startTime > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Expression validation exceeded ${timeoutMs}ms timeout`,
      expression,
      afterSecurityCheck - startTime
    );
  }

  // Parse the expression
  const parser = createParser();
  let parsedExpr: Expression;

  try {
    parsedExpr = parser.parse(expression);
  } catch (error) {
    throw new ExpressionEvaluationError(
      `Failed to parse expression: ${error instanceof Error ? error.message : String(error)}`,
      expression,
      error
    );
  }

  // Check timeout after parsing
  const afterParsing = performance.now();
  if (afterParsing - startTime > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Expression parsing exceeded ${timeoutMs}ms timeout`,
      expression,
      afterParsing - startTime
    );
  }

  // Flatten context and evaluate
  const flatContext = flattenContext(context);

  let result: unknown;
  try {
    result = parsedExpr.evaluate(flatContext);
  } catch (error) {
    throw new ExpressionEvaluationError(
      `Failed to evaluate expression: ${error instanceof Error ? error.message : String(error)}`,
      expression,
      error
    );
  }

  // Check timeout after evaluation
  const elapsed = performance.now() - startTime;
  if (elapsed > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Expression evaluation exceeded ${timeoutMs}ms timeout`,
      expression,
      elapsed
    );
  }

  // Normalize the result
  return normalizeResult(result);
}

/**
 * Normalize an evaluation result.
 * Converts undefined, NaN, and Infinity to null for consistent handling.
 */
function normalizeResult(result: unknown): unknown {
  if (result === undefined) return null;
  if (typeof result === "number") {
    if (!Number.isFinite(result)) return null;
  }
  return result;
}

// =============================================================================
// Block Expression Evaluation
// =============================================================================

/**
 * Evaluate a block expression with JavaScript-like syntax.
 *
 * Block expressions allow more complex logic than simple expr-eval expressions:
 * - Variable declarations (var, let, const)
 * - Conditionals (if/else)
 * - Array methods and operations
 * - Return statements
 *
 * The same context namespaces are available:
 * - `this.*` - Current item's frontmatter fields (accessed as `this.fieldName`)
 * - `stats.*` - Collection-level statistics
 * - `result.*` - Previously computed field values
 * - `included.*` - Results from included widgets
 * - All custom functions (splitNums, sum, mean, etc.)
 *
 * Security: Block expressions are sandboxed to prevent access to Node.js/browser
 * globals. Dangerous keywords and patterns are blocked before evaluation.
 *
 * @param expression - Block expression starting with '{' and ending with '}'
 * @param context - Context containing this, stats, result, included
 * @param options - Evaluation options (timeout, etc.)
 * @returns The value from the return statement, or null if no return
 * @throws ExpressionSecurityError if blocked content is found
 * @throws ExpressionTimeoutError if evaluation exceeds timeout
 * @throws ExpressionEvaluationError if parsing or evaluation fails
 *
 * @example
 * ```ts
 * const result = evaluateBlockExpression(
 *   `{
 *     var nums = splitNums(this.dimensions, 'x');
 *     if (nums.length !== 3) return null;
 *     return product(nums);
 *   }`,
 *   { this: { dimensions: "10x20x30" }, stats: {} }
 * );
 * // result = 6000
 * ```
 */
function evaluateBlockExpression(
  expression: string,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): unknown {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = performance.now();

  // Security validation for block expressions
  validateBlockExpressionSecurity(expression);

  // Check timeout after security validation
  const afterSecurityCheck = performance.now();
  if (afterSecurityCheck - startTime > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Block expression validation exceeded ${timeoutMs}ms timeout`,
      expression,
      afterSecurityCheck - startTime
    );
  }

  // Extract the block body (remove outer braces)
  const trimmed = expression.trim();
  const blockBody = trimmed.slice(1, -1);

  // Build parameter names for the function
  // Custom functions are passed as individual parameters
  const customFunctionNames = Object.keys(customFunctions);
  const functionParams = ["stats", "result", "included", ...customFunctionNames];

  // Build the function body with:
  // 1. Strict mode for better security
  // 2. Shadowed dangerous globals to prevent escape
  // Note: We cannot shadow reserved keywords like 'import', 'export', 'eval'
  // as variable names in strict mode. These are already blocked by keyword validation.
  const shadowedGlobals = [
    "require",
    "module",
    "exports",
    "process",
    "global",
    "globalThis",
    "window",
    "document",
    "self",
    "Function",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "fs",
    "child_process",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "clearTimeout",
    "clearInterval",
  ];

  const shadowDeclarations = shadowedGlobals
    .map((g) => `const ${g} = undefined;`)
    .join("\n    ");

  const functionBody = `
    "use strict";
    ${shadowDeclarations}
    ${blockBody}
  `;

  // Create the function
  // Security note: We use Function constructor intentionally for block expression
  // evaluation. Security is enforced through keyword blocking, pattern validation,
  // and global shadowing above.
  let fn: (...args: unknown[]) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional for block expression evaluation
    fn = new Function(...functionParams, functionBody) as (...args: unknown[]) => unknown;
  } catch (error) {
    throw new ExpressionEvaluationError(
      `Failed to parse block expression: ${error instanceof Error ? error.message : String(error)}`,
      expression,
      error
    );
  }

  // Check timeout after parsing
  const afterParsing = performance.now();
  if (afterParsing - startTime > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Block expression parsing exceeded ${timeoutMs}ms timeout`,
      expression,
      afterParsing - startTime
    );
  }

  // Build the arguments array in the same order as functionParams
  const customFunctionValues = customFunctionNames.map(
    (name) => customFunctions[name as keyof typeof customFunctions]
  );
  const args = [
    context.stats,
    context.result ?? {},
    context.included ?? {},
    ...customFunctionValues,
  ];

  // Execute the function with context.this as the 'this' value
  let result: unknown;
  try {
    result = fn.call(context.this, ...args);
  } catch (error) {
    throw new ExpressionEvaluationError(
      `Failed to evaluate block expression: ${error instanceof Error ? error.message : String(error)}`,
      expression,
      error
    );
  }

  // Check timeout after evaluation
  const elapsed = performance.now() - startTime;
  if (elapsed > timeoutMs) {
    throw new ExpressionTimeoutError(
      `Block expression evaluation exceeded ${timeoutMs}ms timeout`,
      expression,
      elapsed
    );
  }

  return normalizeResult(result);
}

// =============================================================================
// Batch Evaluation
// =============================================================================

/**
 * Result of batch expression evaluation.
 */
export interface BatchEvaluationResult {
  /** The evaluation result (null if failed) */
  value: unknown;
  /** Error message if evaluation failed */
  error?: string;
  /** Whether the evaluation succeeded */
  success: boolean;
}

/**
 * Evaluate an expression against multiple items (batch evaluation).
 * Useful for computing per-item fields across a collection.
 *
 * @param expression - The expression string to evaluate
 * @param items - Array of items (each becomes `this` in context)
 * @param stats - Collection statistics (available as `stats` in context)
 * @param options - Evaluation options
 * @returns Array of results, one per item
 *
 * @example
 * ```ts
 * const results = evaluateBatch(
 *   "this.rating / stats.rating_max * 100",
 *   [{ rating: 8 }, { rating: 6 }, { rating: 10 }],
 *   { rating_max: 10 }
 * );
 * // results = [
 * //   { value: 80, success: true },
 * //   { value: 60, success: true },
 * //   { value: 100, success: true }
 * // ]
 * ```
 */
export function evaluateBatch(
  expression: string,
  items: Record<string, unknown>[],
  stats: Record<string, unknown>,
  options: EvaluateOptions = {}
): BatchEvaluationResult[] {
  // For block expressions, delegate to evaluateExpression for each item
  // (block expressions use Function constructor, not expr-eval parser)
  if (isBlockExpression(expression)) {
    // Pre-validate security for block expressions (same as simple expressions)
    validateBlockExpressionSecurity(expression);

    return items.map((item) => {
      try {
        const context: ExpressionContext = { this: item, stats };
        const value = evaluateBlockExpression(expression, context, options);
        return { value, success: true };
      } catch (error) {
        return {
          value: null,
          error: error instanceof Error ? error.message : String(error),
          success: false,
        };
      }
    });
  }

  // Pre-validate expression once for security
  validateExpressionSecurity(expression);

  // Parse expression once for efficiency
  const parser = createParser();
  let parsedExpr: Expression;

  try {
    parsedExpr = parser.parse(expression);
  } catch (error) {
    // If parsing fails, return error for all items
    const errorMessage = `Failed to parse expression: ${error instanceof Error ? error.message : String(error)}`;
    return items.map(() => ({
      value: null,
      error: errorMessage,
      success: false,
    }));
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return items.map((item) => {
    const startTime = performance.now();

    try {
      const context: ExpressionContext = {
        this: item,
        stats,
      };
      const flatContext = flattenContext(context);

      // parsedExpr.evaluate returns `any` according to library types
      const result: unknown = parsedExpr.evaluate(flatContext);
      const elapsed = performance.now() - startTime;

      if (elapsed > timeoutMs) {
        return {
          value: null,
          error: `Evaluation exceeded ${timeoutMs}ms timeout`,
          success: false,
        };
      }

      return {
        value: normalizeResult(result),
        success: true,
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  });
}

// =============================================================================
// Expression Validation (for config validation)
// =============================================================================

/**
 * Validate an expression without evaluating it.
 * Useful for config validation to catch syntax errors early.
 *
 * @param expression - The expression string to validate
 * @returns Object with valid flag and optional error message
 */
export function validateExpression(expression: string): { valid: boolean; error?: string } {
  try {
    // Handle block expressions separately
    if (isBlockExpression(expression)) {
      // Check block security
      validateBlockExpressionSecurity(expression);

      // Try to parse by creating a function (without executing it)
      const trimmed = expression.trim();
      const blockBody = trimmed.slice(1, -1);
      const customFunctionNames = Object.keys(customFunctions);
      const functionParams = ["stats", "result", "included", ...customFunctionNames];
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional for block validation
      new Function(...functionParams, `"use strict"; ${blockBody}`);

      return { valid: true };
    }

    // Check security for simple expressions
    validateExpressionSecurity(expression);

    // Try to parse
    const parser = createParser();
    parser.parse(expression);

    return { valid: true };
  } catch (error) {
    if (error instanceof ExpressionSecurityError) {
      return { valid: false, error: error.message };
    }
    return {
      valid: false,
      error: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get the list of variables used in an expression.
 * Useful for dependency analysis.
 *
 * @param expression - The expression string to analyze
 * @returns Array of variable names, or null if parsing fails
 */
export function getExpressionVariables(expression: string): string[] | null {
  try {
    // Block expressions don't support variable extraction
    // (would require JavaScript static analysis)
    if (isBlockExpression(expression)) {
      return null;
    }

    validateExpressionSecurity(expression);
    const parser = createParser();
    const parsed = parser.parse(expression);
    return parsed.variables();
  } catch {
    return null;
  }
}

