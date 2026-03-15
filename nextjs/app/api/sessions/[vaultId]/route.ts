/**
 * Session Lookup API Route (Proxy)
 *
 * GET /api/sessions/:vaultId - Proxies to daemon GET /session/lookup/:vaultId
 */

import { NextResponse } from "next/server";
import * as sessionClient from "@/lib/daemon/sessions";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const sessionId = await sessionClient.lookupSession(vaultId);
  return NextResponse.json({ sessionId });
}
