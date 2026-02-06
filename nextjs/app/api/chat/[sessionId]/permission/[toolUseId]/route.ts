/**
 * Tool Permission Response Endpoint
 *
 * POST /api/chat/[sessionId]/permission/[toolUseId]
 *
 * Resolves a pending tool permission request.
 *
 * Request body:
 * - allowed: boolean
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getController } from "@/lib/controller";

const PermissionResponseSchema = z.object({
  allowed: z.boolean(),
});

interface RouteParams {
  params: Promise<{
    sessionId: string;
    toolUseId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId, toolUseId } = await params;

  // Validate session matches current session
  const controller = getController();
  const state = controller.getState();

  if (state.sessionId !== sessionId) {
    return Response.json(
      { error: "Session mismatch. This permission request may have expired." },
      { status: 409 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = PermissionResponseSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: result.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { allowed } = result.data;

  // Resolve the pending permission
  controller.respondToPrompt(toolUseId, {
    type: "tool_permission",
    allowed,
  });

  return Response.json({ success: true });
}
