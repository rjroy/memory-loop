/**
 * Recent Activity API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/recent-activity - Get combined recent activity
 *
 * Proxies requests to daemon endpoint:
 *   GET /vaults/:id/recent-activity
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/recent-activity
 *
 * Returns combined recent activity: captures and discussions.
 * The daemon handles config loading and session listing internally.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/recent-activity`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
