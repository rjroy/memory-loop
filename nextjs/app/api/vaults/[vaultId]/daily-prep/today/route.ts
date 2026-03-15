/**
 * Daily Prep Status Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/daily-prep/today - Get today's prep status
 *
 * Proxies requests to daemon endpoint:
 *   GET /vaults/:id/daily-prep/today
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/daily-prep/today
 *
 * Returns the daily prep status for today.
 * Used by Ground tab to determine button visibility and show commitment.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/daily-prep/today`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
