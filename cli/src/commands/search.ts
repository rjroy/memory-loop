/**
 * Search command: full-text content search
 */

import { daemonJson, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeSearch(
  args: Record<string, string>,
  flags: Record<string, unknown>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const query = encodeURIComponent(args.query);
  const limitValue = flags.limit;
  const limit =
    limitValue !== undefined
      ? `&limit=${typeof limitValue === "string" ? limitValue : JSON.stringify(limitValue)}`
      : "";
  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/search/content?q=${query}${limit}`,
  );
  return { data, exitCode: EXIT_SUCCESS };
}
