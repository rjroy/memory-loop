/**
 * Fuzzy Matcher
 *
 * Custom fuzzy subsequence matching algorithm for file name search.
 * Designed to find files in Obsidian vaults using fuzzy matching with
 * intelligent scoring to prioritize relevant results.
 *
 * Scoring factors (per TD-1):
 * - Consecutive character bonus: +3 per consecutive match
 * - Start position penalty: -0.1 per character from start
 * - Word boundary bonus: +2 when match starts at word boundary
 *
 * @see .sdd/plans/2026-01-07-recall-search-plan.md (TD-1)
 */

import type { FileSearchResult } from "@memory-loop/shared";

// =============================================================================
// Types
// =============================================================================

/**
 * Input file for fuzzy matching.
 * Represents a file in the vault with its name and path.
 */
export interface FuzzyMatchFile {
  /** File name only (without path, with extension) */
  name: string;
  /** Relative path from content root */
  path: string;
}

/**
 * Options for fuzzy search.
 */
export interface FuzzySearchOptions {
  /** Maximum number of results to return (default: 50) */
  limit?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Bonus points for each consecutive character match */
const CONSECUTIVE_BONUS = 3;

/** Penalty per character distance from start of file name */
const START_POSITION_PENALTY = 0.1;

/** Bonus points when match occurs at a word boundary */
const WORD_BOUNDARY_BONUS = 2;

/** Characters that define word boundaries (match after these is a word start) */
const WORD_BOUNDARY_CHARS = new Set(["/", "-", "_", " ", "."]);

/** Default maximum results to return */
const DEFAULT_LIMIT = 50;

// =============================================================================
// Core Algorithm
// =============================================================================

/**
 * Checks if a character position is at a word boundary.
 * A position is at a word boundary if:
 * - It's the first character (position 0)
 * - The previous character is a word boundary character
 *
 * @param text - The text being searched
 * @param position - The position to check
 * @returns True if the position is at a word boundary
 */
function isWordBoundary(text: string, position: number): boolean {
  if (position === 0) {
    return true;
  }
  const prevChar = text[position - 1];
  return WORD_BOUNDARY_CHARS.has(prevChar);
}

/**
 * Finds all character positions where query characters match in the target.
 * Uses greedy left-to-right scan to find the first valid subsequence.
 *
 * @param query - The search query (already lowercase)
 * @param target - The target string to search (already lowercase)
 * @returns Array of match positions, or null if no subsequence match
 */
function findSubsequenceMatch(query: string, target: string): number[] | null {
  const positions: number[] = [];
  let queryIndex = 0;

  for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex++) {
    if (target[targetIndex] === query[queryIndex]) {
      positions.push(targetIndex);
      queryIndex++;
    }
  }

  // Return positions only if we matched all query characters
  return queryIndex === query.length ? positions : null;
}

/**
 * Calculates the match score based on match positions.
 *
 * Scoring factors:
 * - Base score: 1 point per matched character
 * - Consecutive bonus: +3 per consecutive match (after the first)
 * - Start position penalty: -0.1 per character from start to first match
 * - Word boundary bonus: +2 when first match or any match is at word boundary
 *
 * @param target - The target string (original case)
 * @param positions - Array of match positions
 * @returns The calculated score
 */
function calculateScore(target: string, positions: number[]): number {
  if (positions.length === 0) {
    return 0;
  }

  const targetLower = target.toLowerCase();
  let score = positions.length; // Base: 1 point per match

  // Start position penalty: penalize matches that start later in the string
  score -= positions[0] * START_POSITION_PENALTY;

  // Process each match position
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];

    // Consecutive bonus: if this match immediately follows the previous
    if (i > 0 && pos === positions[i - 1] + 1) {
      score += CONSECUTIVE_BONUS;
    }

    // Word boundary bonus: if match is at a word boundary
    if (isWordBoundary(targetLower, pos)) {
      score += WORD_BOUNDARY_BONUS;
    }
  }

  return score;
}

/**
 * Performs fuzzy matching on a single file.
 *
 * @param query - The search query (already lowercase)
 * @param file - The file to match against
 * @returns FileSearchResult if match found, null otherwise
 */
function matchFile(query: string, file: FuzzyMatchFile): FileSearchResult | null {
  const nameLower = file.name.toLowerCase();
  const positions = findSubsequenceMatch(query, nameLower);

  if (positions === null) {
    return null;
  }

  const score = calculateScore(file.name, positions);

  return {
    path: file.path,
    name: file.name,
    score,
    matchPositions: positions,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Searches files by fuzzy matching against file names.
 *
 * The algorithm:
 * 1. Normalizes query to lowercase
 * 2. Finds all files where query is a subsequence of the file name
 * 3. Scores each match based on consecutive matches, start position, and word boundaries
 * 4. Returns top results sorted by score descending
 *
 * @param query - The search query string
 * @param files - Array of files to search
 * @param options - Search options (limit)
 * @returns Array of FileSearchResult sorted by score descending
 *
 * @example
 * ```typescript
 * const files = [
 *   { name: "foobar.md", path: "notes/foobar.md" },
 *   { name: "f_o_o.md", path: "notes/f_o_o.md" },
 * ];
 * const results = fuzzySearchFiles("foo", files);
 * // foobar.md ranks higher due to consecutive matches
 * ```
 */
export function fuzzySearchFiles(
  query: string,
  files: FuzzyMatchFile[],
  options: FuzzySearchOptions = {}
): FileSearchResult[] {
  const { limit = DEFAULT_LIMIT } = options;

  // Handle empty query: return empty results
  if (!query || query.trim() === "") {
    return [];
  }

  // Normalize query to lowercase
  const queryLower = query.toLowerCase();

  // Match all files and collect results
  const results: FileSearchResult[] = [];

  for (const file of files) {
    const result = matchFile(queryLower, file);
    if (result !== null) {
      results.push(result);
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Return top results up to limit
  return results.slice(0, limit);
}

/**
 * Escapes special regex characters in a string.
 * Used to safely search for strings that might contain regex metacharacters.
 *
 * This function is exposed for use in content search but isn't needed for
 * fuzzy file name matching (which doesn't use regex).
 *
 * @param str - String to escape
 * @returns String with regex special characters escaped
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
