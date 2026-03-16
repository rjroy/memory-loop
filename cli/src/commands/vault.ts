/**
 * Vault commands: list, info, create
 */

import { daemonJson, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeVaultList(): Promise<CommandResult> {
  const data = await daemonJson("/vaults");
  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeVaultInfo(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const data = await daemonJson(`/vaults/${encodeURIComponent(vaultId)}`);
  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeVaultCreate(
  args: Record<string, string>,
): Promise<CommandResult> {
  const data = await daemonJson("/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: args.title }),
  });
  return { data, exitCode: EXIT_SUCCESS };
}
