/**
 * Daemon Session Client
 *
 * HTTP client that proxies session and chat operations to the daemon API.
 * Part of the permanent daemon client layer for the web app.
 */

import type { SessionState } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";
import { daemonFetch } from "./fetch";

const log = createLogger("session-client");

/**
 * Error with additional daemon-specific fields (code, status).
 * Avoids unsafe casting of Error to Record<string, unknown>.
 */
class DaemonError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message);
    this.name = "DaemonError";
    this.code = opts?.code;
    this.status = opts?.status;
  }
}

// ---------------------------------------------------------------------------
// Chat operations (live routes — all keyed by sessionId in the path)
// ---------------------------------------------------------------------------

export async function sendMessage(params: {
  vaultId: string;
  vaultPath: string;
  sessionId: string;
  prompt: string;
}): Promise<{ sessionId: string }> {
  const { sessionId, ...body } = params;
  const res = await daemonFetch(
    `/session/${encodeURIComponent(sessionId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const resBody = (await res.json()) as { error: { code: string; message: string } };
    throw new DaemonError(resBody.error.message, {
      code: resBody.error.code,
      status: res.status,
    });
  }
  return (await res.json()) as { sessionId: string };
}

export async function getChatStream(sessionId: string): Promise<Response> {
  return daemonFetch(`/session/${encodeURIComponent(sessionId)}/chat`);
}

export async function abortProcessing(sessionId: string): Promise<void> {
  const res = await daemonFetch(
    `/session/${encodeURIComponent(sessionId)}/abort`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: string | { code: string; message: string } };
    const msg = typeof body.error === "string" ? body.error : body.error.message;
    throw new DaemonError(msg, { status: res.status });
  }
}

export async function respondToPermission(
  sessionId: string,
  toolUseId: string,
  allowed: boolean,
): Promise<void> {
  const res = await daemonFetch(
    `/session/${encodeURIComponent(sessionId)}/permission`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolUseId, allowed }),
    },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    throw new DaemonError(body.error.message, { status: res.status });
  }
}

export async function respondToAnswer(
  sessionId: string,
  toolUseId: string,
  answers: Record<string, string>,
): Promise<void> {
  const res = await daemonFetch(
    `/session/${encodeURIComponent(sessionId)}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolUseId, answers }),
    },
  );
  if (!res.ok) {
    const body = (await res.json()) as { error: { code: string; message: string } };
    throw new DaemonError(body.error.message, { status: res.status });
  }
}

export async function clearSession(sessionId: string): Promise<void> {
  const res = await daemonFetch(
    `/session/${encodeURIComponent(sessionId)}/clear`,
    { method: "POST" },
  );
  if (!res.ok) {
    log.error(`Failed to clear session ${sessionId}: ${res.status}`);
  }
}

export async function getSessionState(sessionId: string): Promise<SessionState> {
  const res = await daemonFetch(`/session/${encodeURIComponent(sessionId)}/state`);
  if (!res.ok) {
    throw new Error(`Failed to get session state for ${sessionId}: ${res.status}`);
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
    throw new DaemonError(body.error.message, {
      code: body.error.code,
      status: res.status,
    });
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
    throw new DaemonError(msg, { status: res.status });
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
