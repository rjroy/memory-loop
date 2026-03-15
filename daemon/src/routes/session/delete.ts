/**
 * Session Delete Endpoint
 *
 * DELETE /session/:vaultId/:sessionId - Delete a session
 */

import type { Context } from "hono";
import { getCachedVaultById } from "../../vault/vault-cache";
import { deleteSession, validateSessionId, SessionError } from "../../session-manager";

export async function sessionDeleteHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("vaultId");
  const sessionId = c.req.param("sessionId");

  if (!vaultId || !sessionId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "vaultId and sessionId are required" } },
      400
    );
  }

  const vault = getCachedVaultById(vaultId);
  if (!vault) {
    return c.json(
      { error: { code: "VAULT_NOT_FOUND", message: "Vault not found" } },
      404
    );
  }

  // Validate session ID format
  try {
    validateSessionId(sessionId);
  } catch (error) {
    if (error instanceof SessionError && error.code === "SESSION_INVALID") {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: error.message } },
        400
      );
    }
    throw error;
  }

  try {
    const deleted = await deleteSession(vault.path, sessionId);
    return c.json({ success: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete session";
    return c.json(
      { success: false, deleted: false, error: message },
      500
    );
  }
}
