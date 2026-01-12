/**
 * Expression Evaluation
 *
 * Safe expression evaluation using expr-eval with custom functions and security validation.
 * Expressions can reference frontmatter fields via `this.*` and collection stats via `stats.*`.
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
 * - `this`: Current item's frontmatter fields
 * - `stats`: Collection-level statistics (from Phase 1 computation)
 */
export interface ExpressionContext {
  this: Record<string, unknown>;
  stats: Record<string, unknown>;
}

/**
 * Options for expression evaluation.
 */
export interface EvaluateOptions {
  /** Timeout in milliseconds (default: 1000ms per REQ-F-30) */
  timeoutMs?: number;
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

// =============================================================================
// Context Flattening
// =============================================================================

/**
 * Flatten nested context objects for expr-eval.
 * Converts { this: { rating: 5 }, stats: { rating_mean: 4 } }
 * into { this: { rating: 5 }, stats: { rating_mean: 4 } }
 *
 * This allows expressions to use this.rating or stats.rating_mean syntax.
 * Custom functions are registered on the Parser instance, not in the context.
 *
 * Note: We cast to Value because expr-eval's type definitions are incomplete.
 * The library actually accepts nested objects, but the types only declare
 * a simpler Value type.
 */
function flattenContext(context: ExpressionContext): Value {
  // The expr-eval library accepts nested objects, but the type definitions
  // are incomplete. We cast through unknown to satisfy TypeScript.
  return {
    this: context.this,
    stats: context.stats,
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
 * @param context - Context containing `this` (current item) and `stats` (collection stats)
 * @param options - Evaluation options (timeout, etc.)
 * @returns The evaluation result, or null if the result is undefined/NaN/Infinity
 * @throws ExpressionSecurityError if expression contains blocked content
 * @throws ExpressionTimeoutError if evaluation exceeds timeout
 * @throws ExpressionEvaluationError if parsing or evaluation fails
 *
 * @example
 * ```ts
 * const result = evaluateExpression(
 *   "zscore(this.rating, stats.rating_mean, stats.rating_stddev)",
 *   {
 *     this: { rating: 8.5 },
 *     stats: { rating_mean: 7.0, rating_stddev: 1.5 }
 *   }
 * );
 * // result = 1.0
 * ```
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): unknown {
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
    // Check security
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
    validateExpressionSecurity(expression);
    const parser = createParser();
    const parsed = parser.parse(expression);
    return parsed.variables();
  } catch {
    return null;
  }
}
