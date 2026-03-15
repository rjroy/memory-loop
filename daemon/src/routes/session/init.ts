/**
 * Session Init Endpoint
 *
 * POST /session/init/:vaultId - Initialize or resume a session for a vault
 *
 * Request body (optional):
 * - sessionId: string (if provided, attempts to resume that session)
 *
 * Returns session state including messages, slash commands, and config.
 */

import type { Context } from "hono";
import { getCachedVaultById } from "../../vault/vault-cache";
import { loadVaultConfig, loadSlashCommands } from "../../vault/vault-config";
import { loadSession, getSessionForVault } from "../../session-manager";
import type { SlashCommand } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("session/init");

interface SessionInitRequest {
  sessionId?: string;
}

/**
 * Sanitizes slash commands to ensure argumentHint is either a valid string or omitted.
 */
function sanitizeSlashCommands(commands: SlashCommand[] | undefined): SlashCommand[] | undefined {
  if (!commands || commands.length === 0) {
    return undefined;
  }
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    ...(typeof cmd.argumentHint === "string" && cmd.argumentHint
      ? { argumentHint: cmd.argumentHint }
      : {}),
  }));
}

export async function sessionInitHandler(c: Context): Promise<Response> {
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
      { error: "VAULT_NOT_FOUND", message: `Vault "${vaultId}" not found` },
      404
    );
  }

  // Parse request body
  let body: SessionInitRequest = {};
  try {
    const text = await c.req.text();
    if (text) {
      body = JSON.parse(text) as SessionInitRequest;
    }
  } catch {
    return c.json(
      { error: "VALIDATION_ERROR", message: "Invalid JSON body" },
      400
    );
  }

  // Load vault config for settings
  const config = await loadVaultConfig(vault.path);

  // Load cached slash commands
  const cachedCommands = await loadSlashCommands(vault.path);

  // If sessionId provided, try to resume
  if (body.sessionId) {
    try {
      const metadata = await loadSession(vault.path, body.sessionId);

      if (!metadata) {
        return c.json(
          { error: "SESSION_NOT_FOUND", message: "Session not found" },
          404
        );
      }

      if (metadata.vaultId !== vaultId) {
        return c.json(
          { error: "SESSION_INVALID", message: "Session belongs to a different vault" },
          400
        );
      }

      return c.json({
        sessionId: body.sessionId,
        vaultId: vault.id,
        messages: metadata.messages,
        createdAt: metadata.createdAt,
        slashCommands: sanitizeSlashCommands(cachedCommands),
        config: {
          discussionModel: config.discussionModel,
          viMode: config.viMode,
        },
      });
    } catch (err) {
      log.error("Failed to load session", err);
      return c.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found" },
        404
      );
    }
  }

  // No sessionId - check if there's a recent session to auto-resume
  const recentSessionId = await getSessionForVault(vault.path);

  if (recentSessionId) {
    try {
      const metadata = await loadSession(vault.path, recentSessionId);

      if (metadata && metadata.messages.length > 0) {
        return c.json({
          sessionId: recentSessionId,
          vaultId: vault.id,
          messages: metadata.messages,
          createdAt: metadata.createdAt,
          slashCommands: sanitizeSlashCommands(cachedCommands),
          config: {
            discussionModel: config.discussionModel,
            viMode: config.viMode,
          },
        });
      }
    } catch (err) {
      log.debug("Failed to load recent session, starting fresh", err);
    }
  }

  // No session to resume - return fresh session state
  return c.json({
    sessionId: "",
    vaultId: vault.id,
    messages: [],
    slashCommands: sanitizeSlashCommands(cachedCommands),
    config: {
      discussionModel: config.discussionModel,
      viMode: config.viMode,
    },
  });
}
