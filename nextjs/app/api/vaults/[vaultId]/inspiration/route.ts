/**
 * Inspiration API Route (Proxy)
 *
 * GET /api/vaults/:vaultId/inspiration - Proxies to daemon GET /inspiration
 */

import { NextResponse } from "next/server";
import * as sessionClient from "@/lib/daemon/sessions";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;

  try {
    const result = await sessionClient.getInspiration(vaultId);
    return NextResponse.json(result);
  } catch {
    // Graceful degradation: return fallback
    return NextResponse.json({
      contextual: null,
      quote: {
        text: "The only way to do great work is to love what you do.",
        attribution: "Steve Jobs",
      },
    });
  }
}
