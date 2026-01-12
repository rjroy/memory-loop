/**
 * Frontmatter Parsing
 *
 * Extracts YAML frontmatter from markdown files and provides dot-notation
 * field access for widget computations.
 *
 * Spec Requirements:
 * - REQ-F-6: Field extraction from YAML frontmatter by dot-notation paths (e.g., `bgg.play_count`)
 * - REQ-F-28: Missing fields return null (not error)
 *
 * Plan Reference:
 * - TD-9: Frontmatter Parsing decision
 */

import matter from "gray-matter";
import { get } from "lodash-es";

/**
 * Error thrown when frontmatter parsing fails due to invalid YAML.
 */
export class FrontmatterParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

/**
 * Result of parsing frontmatter from content.
 */
export interface FrontmatterResult {
  /** Parsed frontmatter data as key-value pairs */
  data: Record<string, unknown>;
  /** Content after the frontmatter block */
  content: string;
}

/**
 * Parses YAML frontmatter from markdown content.
 *
 * @param content - Raw markdown content with optional frontmatter
 * @returns Parsed frontmatter data and remaining content
 * @throws FrontmatterParseError if YAML is malformed
 *
 * @example
 * ```ts
 * const { data, content } = parseFrontmatter(`---
 * title: My Note
 * tags: [a, b]
 * ---
 * # Content here`);
 * // data = { title: "My Note", tags: ["a", "b"] }
 * // content = "# Content here"
 * ```
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  try {
    const result = matter(content);
    return {
      data: result.data as Record<string, unknown>,
      content: result.content,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FrontmatterParseError(`Failed to parse frontmatter: ${message}`, error);
  }
}

/**
 * Extracts a single field from frontmatter using dot-notation path.
 *
 * Returns null for missing fields, including when a parent in the path
 * is missing. This supports REQ-F-28: missing fields in aggregations
 * should be treated as null.
 *
 * @param content - Raw markdown content with frontmatter
 * @param fieldPath - Dot-notation path (e.g., "bgg.play_count", "tags.0")
 * @returns Field value or null if not found
 * @throws FrontmatterParseError if YAML is malformed
 *
 * @example
 * ```ts
 * const content = `---
 * bgg:
 *   play_count: 42
 *   rating: 8.5
 * tags: [strategy, euro]
 * ---`;
 *
 * extractField(content, "bgg.play_count");  // 42
 * extractField(content, "bgg.rating");      // 8.5
 * extractField(content, "tags.0");          // "strategy"
 * extractField(content, "missing");         // null
 * extractField(content, "bgg.missing");     // null
 * extractField(content, "deep.nested.path"); // null (parent missing)
 * ```
 */
export function extractField(content: string, fieldPath: string): unknown {
  const { data } = parseFrontmatter(content);
  const value = get(data, fieldPath);
  // lodash get returns undefined for missing paths; normalize to null
  return value === undefined ? null : value;
}

/**
 * Extracts multiple fields from frontmatter in a single parse operation.
 *
 * More efficient than calling extractField multiple times when you need
 * several values from the same content, as it only parses once.
 *
 * @param content - Raw markdown content with frontmatter
 * @param fieldPaths - Array of dot-notation paths
 * @returns Map of field paths to their values (null if missing)
 * @throws FrontmatterParseError if YAML is malformed
 *
 * @example
 * ```ts
 * const content = `---
 * bgg:
 *   play_count: 42
 *   rating: 8.5
 * status: owned
 * ---`;
 *
 * const fields = extractFields(content, ["bgg.play_count", "status", "missing"]);
 * // Map {
 * //   "bgg.play_count" => 42,
 * //   "status" => "owned",
 * //   "missing" => null
 * // }
 * ```
 */
export function extractFields(
  content: string,
  fieldPaths: string[]
): Map<string, unknown> {
  const { data } = parseFrontmatter(content);
  const result = new Map<string, unknown>();

  for (const fieldPath of fieldPaths) {
    const value = get(data, fieldPath);
    result.set(fieldPath, value === undefined ? null : value);
  }

  return result;
}

/**
 * Checks if content has frontmatter (starts with ---).
 *
 * Useful for quick checks before attempting to parse.
 *
 * @param content - Raw content to check
 * @returns True if content appears to have frontmatter
 */
export function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith("---");
}
