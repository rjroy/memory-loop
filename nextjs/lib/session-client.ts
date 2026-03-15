/**
 * Transitional Session Client
 *
 * HTTP client that proxies session and chat operations to the daemon API.
 * Uses the shared daemon-fetch module for connection logic.
 *
 * This module replaces direct imports of session-manager, controller,
 * and streaming modules. It will be deleted in a future stage when the
 * Next.js app is fully converted to a daemon client.
 */

import type { SessionState } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";
import { daemonFetch } from "./daemon-fetch";

const log = createLogger("session-client");

// ---------------------------------------------------------------------------
// Chat operations
// ---------------------------------------------------------------------------

export async function sendMessage(params: {
  vaultId: string;
  vaultPath: string;
  sessionId?: string;
  prompt: string;
}): Promise<{ sessionId: string }> {
  const res = await daemonFetch("/session/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    const err = new Error(body.error.message);
    (err as Record<string, unknown>).code = body.error.code;
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
  return (await res.json()) as { sessionId: string };
}

export async function getChatStream(): Promise<Response> {
  return daemonFetch("/session/chat/stream");
}

export async function abortProcessing(sessionId: string): Promise<void> {
  const res = await daemonFetch("/session/chat/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: string | { code: string; message: string } };
    const msg = typeof body.error === "string" ? body.error : body.error.message;
    const err = new Error(msg);
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
}

export async function respondToPermission(
  sessionId: string,
  toolUseId: string,
  allowed: boolean,
): Promise<void> {
  const res = await daemonFetch("/session/chat/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, toolUseId, allowed }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    const err = new Error(body.error.message);
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
}

export async function respondToAnswer(
  sessionId: string,
  toolUseId: string,
  answers: Record<string, string>,
): Promise<void> {
  const res = await daemonFetch("/session/chat/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, toolUseId, answers }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    const err = new Error(body.error.message);
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
}

export async function clearSession(): Promise<void> {
  const res = await daemonFetch("/session/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    log.error(`Failed to clear session: ${res.status}`);
  }
}

export async function getSessionState(): Promise<SessionState> {
  const res = await daemonFetch("/session/state");
  if (!res.ok) {
    throw new Error(`Failed to get session state: ${res.status}`);
  }
  return (await res.json()) as SessionState;
}

// ---------------------------------------------------------------------------
// Vault setup and inspiration (SDK-dependent, proxied to daemon)
// ---------------------------------------------------------------------------

export async function runSetup(
  vaultId: string,
): Promise<unknown> {
  const res = await daemonFetch("/config/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaultId }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    const err = new Error(body.error.message);
    (err as Record<string, unknown>).code = body.error.code;
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getInspiration(
  vaultId: string,
): Promise<{ contextual: unknown; quote: unknown }> {
  const res = await daemonFetch(
    `/inspiration?vaultId=${encodeURIComponent(vaultId)}`,
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    throw new Error(body.error.message);
  }
  return (await res.json()) as { contextual: unknown; quote: unknown };
}

// ---------------------------------------------------------------------------
// Session init and delete (session metadata operations)
// ---------------------------------------------------------------------------

export async function initSession(
  vaultId: string,
  sessionId?: string,
): Promise<unknown> {
  const res = await daemonFetch(
    `/session/init/${encodeURIComponent(vaultId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: sessionId ? JSON.stringify({ sessionId }) : "{}",
    },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: string; message?: string };
    const msg = typeof body.error === "string" ? body.message ?? body.error : String(body.error);
    const err = new Error(msg);
    (err as Record<string, unknown>).status = res.status;
    throw err;
  }
  return res.json();
}

export async function deleteSessionById(
  vaultId: string,
  sessionId: string,
): Promise<{ success: boolean; deleted: boolean; error?: string }> {
  const res = await daemonFetch(
    `/session/${encodeURIComponent(vaultId)}/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  return (await res.json()) as { success: boolean; deleted: boolean; error?: string };
}

// ---------------------------------------------------------------------------
// Session lookup
// ---------------------------------------------------------------------------

export async function lookupSession(
  vaultId: string,
): Promise<string | null> {
  const res = await daemonFetch(
    `/session/lookup/${encodeURIComponent(vaultId)}`,
  );
  if (!res.ok) {
    log.error(`Failed to lookup session for vault ${vaultId}: ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { sessionId: string | null };
  return body.sessionId;
}
