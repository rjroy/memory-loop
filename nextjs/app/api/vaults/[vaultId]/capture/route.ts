/**
 * Capture API Routes (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/capture - Capture text to daily/meeting note
 *
 * Proxies requests to daemon endpoint:
 *   POST /vaults/:id/capture (body: { text })
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/capture
 *
 * Captures text to today's daily note or active meeting.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/capture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
