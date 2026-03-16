/**
 * Config commands: get, set
 */

import { daemonJson, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeConfigGet(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/config`,
  );
  return { data, exitCode: EXIT_SUCCESS };
}

/**
 * Expand dot-notation key into a nested object.
 * "discussion.model" -> { discussion: { model: value } }
 */
function expandDotNotation(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.length === 1) {
    return { [key]: value };
  }

  // Build nested structure from right to left
  let current: Record<string, unknown> = { [parts[parts.length - 1]]: value };
  for (let i = parts.length - 2; i >= 0; i--) {
    current = { [parts[i]]: current };
  }
  return current;
}

/**
 * Parse a string value into its appropriate type.
 */
function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  // Try JSON for arrays/objects
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function executeConfigSet(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const parsed = parseValue(args.value);
  const body = expandDotNotation(args.key, parsed);

  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { data, exitCode: EXIT_SUCCESS };
}
