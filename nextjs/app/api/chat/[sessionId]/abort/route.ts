/**
 * Abort Chat Endpoint (Proxy)
 *
 * POST /api/chat/[sessionId]/abort - Proxies to daemon POST /session/chat/abort
 */

import { NextRequest } from "next/server";
import * as sessionClient from "@/lib/session-client";
import { DaemonUnavailableError } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  try {
    await sessionClient.abortProcessing(sessionId);
    return Response.json({ success: true, aborted: true });
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      return Response.json(
        { error: "Daemon is not available" },
        { status: 503 }
      );
    }

    const status = (err as Record<string, unknown>).status;
    if (typeof status === "number" && status >= 400) {
      return Response.json(
        { error: (err as Error).message },
        { status }
      );
    }

    return Response.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
