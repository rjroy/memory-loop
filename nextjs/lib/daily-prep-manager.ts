/**
 * Daily Prep Manager
 *
 * Reads and parses daily prep files from the vault.
 * Daily prep files use YAML frontmatter for structured data
 * and markdown body for human-readable content.
 *
 * File path: {contentRoot}/{inboxPath}/daily-prep/YYYY-MM-DD.md
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultInfo } from "@/lib/schemas";
import { fileExists } from "./vault-manager";
import { createLogger } from "./logger";

const log = createLogger("DailyPrepManager");

/**
 * Subdirectory name within inbox for daily prep files.
 */
export const DAILY_PREP_DIR = "daily-prep";

/**
 * Valid energy levels for daily prep.
 */
export type EnergyLevel = "sharp" | "steady" | "low";

/**
 * Valid calendar density levels for daily prep.
 */
export type CalendarDensity = "clear" | "scattered" | "heavy";

/**
 * Valid assessment values for commitment items.
 */
export type AssessmentValue = "done" | "partial" | "blocked" | "skipped" | null;

/**
 * A single commitment item from daily prep.
 */
export interface CommitmentItem {
  /** The commitment text */
  text: string;
  /** Evening assessment (null if not yet assessed) */
  assessment: AssessmentValue;
  /** Optional note about the assessment */
  note?: string;
}

/**
 * Closure data from evening reflection.
 */
export interface ClosureData {
  /** When closure happened (ISO timestamp) */
  completed_at: string;
  /** Evening reflection prose */
  reflection: string;
}

/**
 * Parsed daily prep frontmatter.
 */
export interface DailyPrepFrontmatter {
  /** Date of the prep (YYYY-MM-DD) */
  date: string;
  /** Morning energy self-report */
  energy?: EnergyLevel;
  /** Meeting density self-report */
  calendar?: CalendarDensity;
  /** Commitment items */
  commitment?: CommitmentItem[];
  /** Evening closure data */
  closure?: ClosureData;
}

/**
 * Status response for daily prep endpoint.
 */
export interface DailyPrepStatus {
  /** Whether a daily prep file exists for today */
  exists: boolean;
  /** Commitment texts (if prep exists) */
  commitment?: string[];
  /** Energy level (if prep exists) */
  energy?: EnergyLevel;
  /** Calendar density (if prep exists) */
  calendar?: CalendarDensity;
}

/**
 * Formats a date as YYYY-MM-DD.
 *
 * @param date - Date to format
 * @returns Formatted date string
 */
export function formatDateAsYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Gets the directory path for daily prep files.
 *
 * @param vault - Vault info
 * @returns Absolute path to the daily-prep directory
 */
export function getDailyPrepDir(vault: VaultInfo): string {
  return join(vault.contentRoot, vault.inboxPath, DAILY_PREP_DIR);
}

/**
 * Gets the file path for a specific date's daily prep.
 *
 * @param vault - Vault info
 * @param date - Date for the prep file
 * @returns Absolute path to the daily prep file
 */
export function getDailyPrepFilePath(vault: VaultInfo, date: Date): string {
  const dateStr = formatDateAsYYYYMMDD(date);
  return join(getDailyPrepDir(vault), `${dateStr}.md`);
}

/**
 * Parses YAML frontmatter from markdown content.
 * Handles the subset of YAML we use (strings, arrays, nested objects).
 *
 * @param content - Full markdown file content
 * @returns Parsed frontmatter object, or null if no frontmatter
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  // Check for frontmatter delimiter
  if (!content.startsWith("---")) {
    return null;
  }

  // Find closing delimiter
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterContent = content.slice(4, endIndex).trim();
  if (!frontmatterContent) {
    return null;
  }

  try {
    return parseSimpleYaml(frontmatterContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to parse frontmatter: ${message}`);
    return null;
  }
}

/**
 * Simple YAML parser for our frontmatter subset.
 * Handles: strings, arrays, nested objects with indentation.
 *
 * @param yaml - YAML content to parse
 * @returns Parsed object
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Check for top-level key
    const keyMatch = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const [, key, value] = keyMatch;

    if (value) {
      // Simple key: value
      result[key] = parseYamlValue(value);
      i++;
    } else {
      // Key with nested content (array or object)
      const nestedLines: string[] = [];
      i++;

      // Collect indented lines
      while (i < lines.length) {
        const nextLine = lines[i];
        // Stop if we hit a non-indented line (except empty)
        if (nextLine.trim() && !nextLine.startsWith("  ") && !nextLine.startsWith("-")) {
          break;
        }
        nestedLines.push(nextLine);
        i++;
      }

      result[key] = parseNestedYaml(nestedLines);
    }
  }

  return result;
}

/**
 * Parses a simple YAML value (string, number, boolean, null).
 */
function parseYamlValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  // Handle quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Handle null
  if (trimmed === "null" || trimmed === "~") {
    return null;
  }

  // Handle boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Handle number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") {
    return num;
  }

  // Default to string
  return trimmed;
}

/**
 * Parses nested YAML content (arrays or objects).
 */
function parseNestedYaml(lines: string[]): unknown {
  // Check if it's an array (starts with -)
  const firstNonEmpty = lines.find((l) => l.trim());
  if (!firstNonEmpty) return null;

  if (firstNonEmpty.trim().startsWith("-")) {
    return parseYamlArray(lines);
  }

  // Otherwise parse as object
  return parseYamlObject(lines);
}

/**
 * Parses a YAML array.
 */
function parseYamlArray(lines: string[]): unknown[] {
  const result: unknown[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Array item start
    const itemMatch = line.match(/^\s*-\s*(.*)$/);
    if (!itemMatch) {
      i++;
      continue;
    }

    const firstValue = itemMatch[1].trim();

    // Check if it's a simple value or an object
    if (firstValue && !firstValue.includes(":")) {
      // Simple value
      result.push(parseYamlValue(firstValue));
      i++;
    } else if (firstValue && firstValue.includes(":")) {
      // Inline object on same line as dash
      const objMatch = firstValue.match(/^([a-z_]+):\s*(.*)$/);
      if (objMatch) {
        const obj: Record<string, unknown> = {};
        obj[objMatch[1]] = parseYamlValue(objMatch[2]);

        // Collect additional indented properties
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          const propMatch = nextLine.match(/^\s{4,}([a-z_]+):\s*(.*)$/);
          if (!propMatch) break;
          obj[propMatch[1]] = parseYamlValue(propMatch[2]);
          i++;
        }

        result.push(obj);
      } else {
        i++;
      }
    } else {
      // Object spanning multiple lines
      const obj: Record<string, unknown> = {};
      i++;

      while (i < lines.length) {
        const nextLine = lines[i];
        // Stop at next array item or end of indent
        if (nextLine.trim().startsWith("-") || (!nextLine.trim() && i + 1 < lines.length && lines[i + 1].trim().startsWith("-"))) {
          break;
        }

        const propMatch = nextLine.match(/^\s+([a-z_]+):\s*(.*)$/);
        if (propMatch) {
          obj[propMatch[1]] = parseYamlValue(propMatch[2]);
        }
        i++;
      }

      if (Object.keys(obj).length > 0) {
        result.push(obj);
      }
    }
  }

  return result;
}

/**
 * Parses a YAML object.
 */
function parseYamlObject(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of lines) {
    if (!line.trim()) continue;

    const match = line.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (match) {
      result[match[1]] = parseYamlValue(match[2]);
    }
  }

  return result;
}

/**
 * Validates and extracts daily prep data from parsed frontmatter.
 *
 * @param fm - Parsed frontmatter object
 * @returns Validated daily prep frontmatter
 */
function validateFrontmatter(fm: Record<string, unknown>): DailyPrepFrontmatter | null {
  // Date is required
  if (typeof fm.date !== "string") {
    return null;
  }

  const result: DailyPrepFrontmatter = {
    date: fm.date,
  };

  // Validate energy
  if (fm.energy && typeof fm.energy === "string") {
    if (["sharp", "steady", "low"].includes(fm.energy)) {
      result.energy = fm.energy as EnergyLevel;
    }
  }

  // Validate calendar
  if (fm.calendar && typeof fm.calendar === "string") {
    if (["clear", "scattered", "heavy"].includes(fm.calendar)) {
      result.calendar = fm.calendar as CalendarDensity;
    }
  }

  // Validate commitment array
  if (Array.isArray(fm.commitment)) {
    const items: CommitmentItem[] = [];
    for (const item of fm.commitment) {
      if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).text === "string") {
        const ci: CommitmentItem = {
          text: (item as Record<string, unknown>).text as string,
          assessment: null,
        };

        // Validate assessment
        const assessmentValue = (item as Record<string, unknown>).assessment;
        if (typeof assessmentValue === "string" && ["done", "partial", "blocked", "skipped"].includes(assessmentValue)) {
          ci.assessment = assessmentValue as AssessmentValue;
        }

        // Optional note
        if (typeof (item as Record<string, unknown>).note === "string") {
          ci.note = (item as Record<string, unknown>).note as string;
        }

        items.push(ci);
      }
    }
    if (items.length > 0) {
      result.commitment = items;
    }
  }

  // Validate closure
  if (typeof fm.closure === "object" && fm.closure !== null) {
    const closure = fm.closure as Record<string, unknown>;
    if (typeof closure.completed_at === "string" && typeof closure.reflection === "string") {
      result.closure = {
        completed_at: closure.completed_at,
        reflection: closure.reflection,
      };
    }
  }

  return result;
}

/**
 * Reads and parses a daily prep file.
 *
 * @param vault - Vault info
 * @param date - Date of the prep file
 * @returns Parsed frontmatter, or null if file doesn't exist or is invalid
 */
export async function readDailyPrep(
  vault: VaultInfo,
  date: Date
): Promise<DailyPrepFrontmatter | null> {
  const filePath = getDailyPrepFilePath(vault, date);

  if (!(await fileExists(filePath))) {
    log.debug(`Daily prep file not found: ${filePath}`);
    return null;
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const fm = parseFrontmatter(content);

    if (!fm) {
      log.warn(`No frontmatter found in daily prep file: ${filePath}`);
      return null;
    }

    const validated = validateFrontmatter(fm);
    if (!validated) {
      log.warn(`Invalid frontmatter in daily prep file: ${filePath}`);
      return null;
    }

    return validated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to read daily prep file: ${filePath}: ${message}`);
    return null;
  }
}

/**
 * Gets the daily prep status for today.
 *
 * @param vault - Vault info
 * @param today - Today's date (defaults to now)
 * @returns Daily prep status for display
 */
export async function getDailyPrepStatus(
  vault: VaultInfo,
  today: Date = new Date()
): Promise<DailyPrepStatus> {
  const prep = await readDailyPrep(vault, today);

  if (!prep) {
    return { exists: false };
  }

  const status: DailyPrepStatus = {
    exists: true,
  };

  if (prep.energy) {
    status.energy = prep.energy;
  }

  if (prep.calendar) {
    status.calendar = prep.calendar;
  }

  if (prep.commitment && prep.commitment.length > 0) {
    status.commitment = prep.commitment.map((c) => c.text);
  }

  return status;
}
