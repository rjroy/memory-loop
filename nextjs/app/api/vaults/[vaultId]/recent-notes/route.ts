/**
 * Recent Notes API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/recent-notes - Get recent captured notes
 *
 * Proxies requests to daemon endpoint:
 *   GET /vaults/:id/recent-notes (query: limit)
 */

import { NextRequest, NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/recent-notes
 *
 * Returns recent captured notes from the vault inbox.
 * Query params: limit (optional, default 5)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const limitParam = request.nextUrl.searchParams.get("limit");

  let url = `/vaults/${encodeURIComponent(vaultId)}/recent-notes`;
  if (limitParam) {
    url += `?limit=${encodeURIComponent(limitParam)}`;
  }

  const res = await daemonFetch(url);
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
