/**
 * Goals API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/goals - Get vault goals
 *
 * Proxies requests to daemon endpoint:
 *   GET /vaults/:id/goals
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/goals
 *
 * Returns the vault's goals content from goals.md.
 * Returns null content if no goals file exists.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/goals`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
