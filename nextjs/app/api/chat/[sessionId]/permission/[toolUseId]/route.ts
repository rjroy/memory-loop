/**
 * Tool Permission Response Endpoint (Proxy)
 *
 * POST /api/chat/[sessionId]/permission/[toolUseId]
 * Proxies to daemon POST /session/chat/permission
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import * as sessionClient from "@/lib/daemon/sessions";
import { DaemonUnavailableError } from "@/lib/daemon/fetch";

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

  try {
    await sessionClient.respondToPermission(
      sessionId,
      toolUseId,
      result.data.allowed,
    );
    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      return Response.json({ error: "Daemon is not available" }, { status: 503 });
    }
    const status = (err as Record<string, unknown>).status;
    return Response.json(
      { error: (err as Error).message },
      { status: typeof status === "number" ? status : 500 }
    );
  }
}
