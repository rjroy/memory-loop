/**
 * Setup API Route (Proxy)
 *
 * POST /api/vaults/:vaultId/setup - Proxies to daemon POST /config/setup
 */

import { NextResponse } from "next/server";
import * as sessionClient from "@/lib/daemon/sessions";
import { DaemonUnavailableError } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;

  try {
    const result = await sessionClient.runSetup(vaultId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DaemonUnavailableError) {
      return NextResponse.json(
        { error: { code: "DAEMON_UNAVAILABLE", message: "Daemon is not available" } },
        { status: 503 }
      );
    }

    const status = (err as Record<string, unknown>).status;
    const code = (err as Record<string, unknown>).code;

    return NextResponse.json(
      { error: { code: code ?? "INTERNAL_ERROR", message: (err as Error).message } },
      { status: typeof status === "number" ? status : 500 }
    );
  }
}
