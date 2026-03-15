/**
 * Session Initialization API (Proxy)
 *
 * POST /api/vaults/:vaultId/sessions - Proxies to daemon POST /session/init/:vaultId
 */

import { NextResponse } from "next/server";
import * as sessionClient from "@/lib/session-client";
import { DaemonUnavailableError } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;

  // Parse optional sessionId from body
  let sessionId: string | undefined;
  try {
    const text = await request.text();
    if (text) {
      const body = JSON.parse(text) as { sessionId?: string };
      sessionId = body.sessionId;
    }
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  try {
    const result = await sessionClient.initSession(vaultId, sessionId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      return NextResponse.json(
        { error: "DAEMON_UNAVAILABLE", message: "Daemon is not available" },
        { status: 503 }
      );
    }
    const status = (err as Record<string, unknown>).status;
    return NextResponse.json(
      { error: (err as Error).message },
      { status: typeof status === "number" ? status : 500 }
    );
  }
}
