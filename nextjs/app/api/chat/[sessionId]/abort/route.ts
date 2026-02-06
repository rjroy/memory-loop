/**
 * Abort Chat Endpoint
 *
 * POST /api/chat/[sessionId]/abort
 *
 * Aborts the current streaming response.
 */

import { NextRequest } from "next/server";
import { getController } from "@/lib/controller";

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  const controller = getController();
  const state = controller.getState();

  // Validate session matches
  if (state.sessionId !== sessionId) {
    return Response.json(
      { error: "Session mismatch" },
      { status: 409 }
    );
  }

  // Only abort if streaming
  if (!controller.isStreaming()) {
    return Response.json(
      { error: "No active streaming to abort" },
      { status: 400 }
    );
  }

  // Clear session (which aborts streaming)
  await controller.clearSession();

  return Response.json({ success: true, aborted: true });
}
