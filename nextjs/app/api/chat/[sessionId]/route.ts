/**
 * Chat Send Endpoint (Proxy)
 *
 * POST /api/chat/[sessionId] - Proxies to daemon POST /session/:sessionId/chat
 *
 * The sessionId is client-minted and carried in the path. The body carries
 * vaultId, vaultPath, and prompt. A 409 from the daemon (ALREADY_PROCESSING)
 * is forwarded as-is so the browser can display it without treating it as an
 * unexpected error.
 */

import { NextRequest } from "next/server";
import * as sessionClient from "@/lib/daemon/sessions";
import { DaemonUnavailableError } from "@/lib/daemon/fetch";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("api/chat/[sessionId]");

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  try {
    const { vaultId, vaultPath, prompt } = body as {
      vaultId: string;
      vaultPath: string;
      prompt: string;
    };
    const result = await sessionClient.sendMessage({
      vaultId,
      vaultPath,
      sessionId,
      prompt,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      log.error("Daemon unavailable", err);
      return Response.json(
        { error: { code: "DAEMON_UNAVAILABLE", message: "Daemon is not available" } },
        { status: 503 }
      );
    }

    const status = (err as Record<string, unknown>).status;
    const code = (err as Record<string, unknown>).code;

    if (typeof status === "number" && status >= 400) {
      return Response.json(
        { error: { code: code ?? "ERROR", message: (err as Error).message } },
        { status }
      );
    }

    log.error("Chat request failed", err);
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: (err as Error).message } },
      { status: 500 }
    );
  }
}
