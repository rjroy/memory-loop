/**
 * Meetings API Route (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/meetings - Start a new meeting
 *
 * Proxies requests to daemon endpoint:
 *   POST /vaults/:id/meetings (body: { title })
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/meetings
 *
 * Creates a new meeting file and sets the vault to meeting capture mode.
 * Subsequent captures will route to the meeting file instead of daily notes.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/meetings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
