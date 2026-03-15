/**
 * Transcript API route handlers.
 *
 * Handles transcript initialization and appending for chat sessions.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import { initializeTranscript, appendToTranscript } from "../files/transcript-manager";

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
): Response {
  return c.json({ error, code }, status);
}

/**
 * POST /vaults/:id/transcripts - Initialize a new transcript file.
 */
export async function initTranscriptHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { sessionId, firstMessage } = body as { sessionId?: string; firstMessage?: string };
  if (typeof sessionId !== "string" || typeof firstMessage !== "string") {
    return jsonError(
      c,
      "Missing required fields: sessionId, firstMessage",
      "INVALID_REQUEST",
      400,
    );
  }

  try {
    const path = await initializeTranscript(vault, sessionId, firstMessage);
    return c.json({ path }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(c, message, "TRANSCRIPT_FAILED", 500);
  }
}

/**
 * POST /vaults/:id/transcripts/append - Append content to a transcript.
 */
export async function appendTranscriptHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { path, content } = body as { path?: string; content?: string };
  if (typeof path !== "string" || typeof content !== "string") {
    return jsonError(c, "Missing required fields: path, content", "INVALID_REQUEST", 400);
  }

  try {
    await appendToTranscript(path, content);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(c, message, "TRANSCRIPT_FAILED", 500);
  }
}
