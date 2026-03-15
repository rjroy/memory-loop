/**
 * Session Lookup Endpoint
 *
 * GET /session/lookup/:vaultId - Look up existing session for a vault
 *
 * Resolves vaultId to vaultPath, then checks for an existing session.
 */

import type { Context } from "hono";
import { getCachedVaultById } from "../../vault/vault-cache";
import { getSessionForVault } from "../../session-manager";

export async function sessionLookupHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("vaultId");

  if (!vaultId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "vaultId is required" } },
      400
    );
  }

  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return c.json(
      { error: { code: "VAULT_NOT_FOUND", message: `Vault not found: ${vaultId}` } },
      404
    );
  }

  const sessionId = await getSessionForVault(vault.path);
  return c.json({ sessionId });
}
