/**
 * Session API Route (Proxy)
 *
 * DELETE /api/vaults/:vaultId/sessions/:sessionId - Proxies to daemon DELETE /session/:vaultId/:sessionId
 */

import { NextResponse } from "next/server";
import * as sessionClient from "@/lib/session-client";
import { DaemonUnavailableError } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; sessionId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, sessionId } = await params;

  try {
    const result = await sessionClient.deleteSessionById(vaultId, sessionId);
    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
    });
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      return NextResponse.json(
        { success: false, deleted: false, error: "Daemon is not available" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, deleted: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
