/**
 * Output formatting for CLI commands.
 *
 * JSON mode (default): machine-readable JSON.
 * Human mode (--human): tables, indented text, ANSI colors.
 */

import type { GlobalFlags, DaemonError } from "./types";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY === true;

function bold(text: string): string {
  return isTTY ? `\x1b[1m${text}\x1b[0m` : text;
}

function dim(text: string): string {
  return isTTY ? `\x1b[2m${text}\x1b[0m` : text;
}

function red(text: string): string {
  return isTTY ? `\x1b[31m${text}\x1b[0m` : text;
}

function green(text: string): string {
  return isTTY ? `\x1b[32m${text}\x1b[0m` : text;
}

function yellow(text: string): string {
  return isTTY ? `\x1b[33m${text}\x1b[0m` : text;
}

// ---------------------------------------------------------------------------
// Human formatters
// ---------------------------------------------------------------------------

function formatTable(
  headers: string[],
  rows: string[][],
): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  "),
  );

  return [bold(headerLine), separator, ...dataLines].join("\n");
}

function formatKeyValue(pairs: [string, string][]): string {
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([k, v]) => `${bold(k.padEnd(maxKey))}  ${v}`)
    .join("\n");
}

interface VaultItem {
  id: string;
  title: string;
  contentRoot?: string;
}

function formatVaultList(data: { vaults: VaultItem[] }): string {
  if (data.vaults.length === 0) {
    return dim("No vaults discovered.");
  }
  return formatTable(
    ["ID", "Title", "Content Root"],
    data.vaults.map((v) => [v.id, v.title, v.contentRoot ?? ""]),
  );
}

function formatVaultInfo(data: VaultItem & Record<string, unknown>): string {
  const pairs: [string, string][] = Object.entries(data).map(([k, v]) => [
    k,
    typeof v === "object" ? JSON.stringify(v) : String(v),
  ]);
  return formatKeyValue(pairs);
}

interface HealthData {
  status: string;
  uptime?: number;
  vaultCount?: number;
  schedulers?: Record<string, unknown>;
  [key: string]: unknown;
}

function formatHealth(data: HealthData): string {
  const statusColor =
    data.status === "ok" ? green : data.status === "degraded" ? yellow : red;
  const lines: string[] = [
    `${bold("Status")}  ${statusColor(data.status)}`,
  ];
  if (data.uptime !== undefined) {
    const mins = Math.floor(data.uptime / 60);
    const hours = Math.floor(mins / 60);
    const uptimeStr =
      hours > 0
        ? `${hours}h ${mins % 60}m`
        : `${mins}m ${Math.floor(data.uptime % 60)}s`;
    lines.push(`${bold("Uptime")}  ${uptimeStr}`);
  }
  if (data.vaultCount !== undefined) {
    lines.push(`${bold("Vaults")}  ${data.vaultCount}`);
  }
  if (data.schedulers) {
    lines.push(`${bold("Schedulers")}`);
    for (const [name, state] of Object.entries(data.schedulers)) {
      lines.push(`  ${name}: ${JSON.stringify(state)}`);
    }
  }
  return lines.join("\n");
}

interface FileEntry {
  name: string;
  type: string;
  path?: string;
}

function formatFileList(data: { entries?: FileEntry[] }): string {
  const entries = data.entries ?? [];
  if (entries.length === 0) {
    return dim("Empty directory.");
  }
  return entries
    .map((e) => {
      const prefix = e.type === "directory" ? "📁 " : "   ";
      return `${prefix}${e.name}`;
    })
    .join("\n");
}

interface SearchResult {
  path: string;
  matches?: { line?: number; content?: string }[];
}

function formatSearchResults(data: {
  results: SearchResult[];
  totalMatches?: number;
}): string {
  if (data.results.length === 0) {
    return dim("No results found.");
  }
  const lines: string[] = [];
  if (data.totalMatches !== undefined) {
    lines.push(dim(`${data.totalMatches} matches found`));
  }
  for (const r of data.results) {
    lines.push(bold(r.path));
    if (r.matches) {
      for (const m of r.matches) {
        const lineNum = m.line !== undefined ? dim(`${m.line}:`) : "";
        lines.push(`  ${lineNum} ${m.content ?? ""}`);
      }
    }
  }
  return lines.join("\n");
}

interface CardItem {
  id: string;
  question?: string;
  dueDate?: string;
  interval?: number;
}

function formatCardsDue(data: { cards: CardItem[] }): string {
  if (data.cards.length === 0) {
    return dim("No cards due for review.");
  }
  return formatTable(
    ["ID", "Question", "Due", "Interval"],
    data.cards.map((c) => [
      c.id,
      (c.question ?? "").slice(0, 50),
      c.dueDate ?? "",
      c.interval !== undefined ? `${c.interval}d` : "",
    ]),
  );
}

function formatConfig(data: Record<string, unknown>): string {
  const pairs: [string, string][] = Object.entries(data).map(([k, v]) => [
    k,
    typeof v === "object" ? JSON.stringify(v) : String(v),
  ]);
  return formatKeyValue(pairs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format command output for display.
 */
export function formatOutput(data: unknown, flags: GlobalFlags): string {
  if (!flags.human) {
    return JSON.stringify(data, null, 2);
  }

  // Dispatch to type-specific human formatters based on data shape
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    if ("vaults" in obj && Array.isArray(obj.vaults)) {
      return formatVaultList(obj as { vaults: VaultItem[] });
    }
    if ("status" in obj && typeof obj.status === "string") {
      return formatHealth(obj as HealthData);
    }
    if ("entries" in obj && Array.isArray(obj.entries)) {
      return formatFileList(obj as { entries: FileEntry[] });
    }
    if ("results" in obj && Array.isArray(obj.results)) {
      return formatSearchResults(
        obj as { results: SearchResult[]; totalMatches?: number },
      );
    }
    if ("cards" in obj && Array.isArray(obj.cards)) {
      return formatCardsDue(obj as { cards: CardItem[] });
    }
    if ("content" in obj && typeof obj.content === "string") {
      return obj.content as string;
    }
    if ("id" in obj && "title" in obj) {
      return formatVaultInfo(obj as VaultItem & Record<string, unknown>);
    }
    // Generic key-value for anything else
    return formatConfig(obj);
  }

  return String(data);
}

/**
 * Format an error for display.
 */
export function formatError(error: DaemonError, flags: GlobalFlags): string {
  if (!flags.human) {
    return JSON.stringify(error, null, 2);
  }
  const lines = [red(`Error: ${error.error}`)];
  if (error.detail) {
    lines.push(dim(error.detail));
  }
  return lines.join("\n");
}

/**
 * Format a streaming SSE event for display.
 */
export function formatStreamEvent(
  eventData: unknown,
  flags: GlobalFlags,
): string | null {
  if (!flags.human) {
    return JSON.stringify(eventData);
  }

  if (!eventData || typeof eventData !== "object") return null;

  const obj = eventData as Record<string, unknown>;
  const type = obj.type as string;

  switch (type) {
    case "text_delta":
      return (obj.text as string) ?? "";
    case "tool_use":
      return dim(`[tool: ${obj.name as string}]`);
    case "tool_result":
      return null; // Suppress in human mode
    case "error":
      return red(`Error: ${obj.error as string}`);
    case "response_end":
      return "\n"; // Final newline after response
    default:
      return null;
  }
}
