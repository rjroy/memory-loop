/**
 * Chat Send Endpoint (Proxy)
 *
 * POST /api/chat - Proxies to daemon POST /session/chat/send
 */

import { NextRequest } from "next/server";
import * as sessionClient from "@/lib/session-client";
import { DaemonUnavailableError } from "@/lib/daemon-fetch";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("api/chat");

export async function POST(request: NextRequest) {
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
    const result = await sessionClient.sendMessage(
      body as {
        vaultId: string;
        vaultPath: string;
        sessionId?: string;
        prompt: string;
      },
    );
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
