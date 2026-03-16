/**
 * Browse commands: list files, read file
 */

import { daemonJson, daemonFetch, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeBrowse(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const pathParam = args.path ? `?path=${encodeURIComponent(args.path)}` : "";
  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/files${pathParam}`,
  );
  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeBrowseRead(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const filePath = args.path;

  const response = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/files/${filePath}`,
  );

  if (!response.ok) {
    const error: unknown = await response.json();
    return { data: error, exitCode: 1 };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data: unknown = await response.json();
    return { data, exitCode: EXIT_SUCCESS };
  }

  // Plain text content
  const text = await response.text();
  return { data: { content: text, path: filePath }, exitCode: EXIT_SUCCESS };
}
