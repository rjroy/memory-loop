/**
 * Sessions REST Routes
 *
 * REST endpoints for session management:
 * - DELETE /sessions/:sessionId - Delete a specific session (REQ-F-40)
 *
 * Sessions are stored in .memory-loop/sessions/ within each vault.
 * The vaultId is resolved by the vault resolution middleware.
 */

import { Hono } from "hono";
import { deleteSession, validateSessionId, SessionError } from "../session-manager.js";
import { getVaultFromContext } from "../middleware/vault-resolution.js";
import { serverLog as log } from "../logger.js";

/**
 * Response schema for DELETE /sessions/:sessionId
 */
export interface DeleteSessionResponse {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Hono router for vault-scoped session routes.
 *
 * All routes receive vault info from context via vault resolution middleware.
 */
const sessionsRoutes = new Hono();

/**
 * DELETE /sessions/:sessionId - Delete a specific session
 *
 * Deletes the session metadata file from the vault's sessions directory.
 * Returns success: true with deleted: false if the session doesn't exist.
 *
 * Response: DeleteSessionResponse
 */
sessionsRoutes.delete("/:sessionId", async (c) => {
  const vault = getVaultFromContext(c);
  const sessionId = c.req.param("sessionId");

  log.info(`REST: Deleting session ${sessionId} from vault ${vault.id}`);

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

    log.info(`REST: Session deletion result: deleted=${deleted}`);

    const response: DeleteSessionResponse = {
      success: true,
      deleted,
    };

    return c.json(response);
  } catch (error) {
    log.error(`REST: Failed to delete session ${sessionId}`, error);
    const message = error instanceof Error ? error.message : "Failed to delete session";

    const response: DeleteSessionResponse = {
      success: false,
      deleted: false,
      error: message,
    };

    return c.json(response, 500);
  }
});

export { sessionsRoutes };
