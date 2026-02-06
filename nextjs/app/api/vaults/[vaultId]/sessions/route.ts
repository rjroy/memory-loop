/**
 * Session Initialization API
 *
 * POST /api/vaults/:vaultId/sessions
 *
 * Initializes a session for a vault. If a sessionId is provided in the body,
 * attempts to resume that session. Otherwise creates a fresh session state.
 *
 * This replaces the WebSocket select_vault and resume_session messages.
 * Note: This does NOT create a Claude SDK session - that happens when the
 * first discussion_message is sent over WebSocket (still needed for streaming).
 */

import { NextResponse } from "next/server";
import { getVaultById } from "@memory-loop/backend/vault-manager";
import { loadSession, getSessionForVault } from "@memory-loop/backend/session-manager";
import { loadSlashCommands, loadVaultConfig } from "@memory-loop/backend/vault-config";
import type { SlashCommand } from "@memory-loop/shared";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

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

export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;

  // Get vault info
  const vault = await getVaultById(vaultId);
  if (!vault) {
    return NextResponse.json(
      { error: "VAULT_NOT_FOUND", message: `Vault "${vaultId}" not found` },
      { status: 404 }
    );
  }

  // Parse request body
  let body: SessionInitRequest = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text) as SessionInitRequest;
    }
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Load vault config for settings
  const config = await loadVaultConfig(vault.path);

  // Load cached slash commands
  const cachedCommands = await loadSlashCommands(vault.path);

  // If sessionId provided, try to resume
  if (body.sessionId) {
    const metadata = await loadSession(vault.path, body.sessionId);

    if (!metadata) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found" },
        { status: 404 }
      );
    }

    if (metadata.vaultId !== vaultId) {
      return NextResponse.json(
        { error: "SESSION_INVALID", message: "Session belongs to a different vault" },
        { status: 400 }
      );
    }

    // Return resumed session data
    return NextResponse.json({
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
  }

  // No sessionId - check if there's a recent session to auto-resume
  const recentSessionId = await getSessionForVault(vault.path);

  if (recentSessionId) {
    const metadata = await loadSession(vault.path, recentSessionId);

    if (metadata && metadata.messages.length > 0) {
      // Return recent session for auto-resume
      return NextResponse.json({
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
  }

  // No session to resume - return fresh session state
  return NextResponse.json({
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
