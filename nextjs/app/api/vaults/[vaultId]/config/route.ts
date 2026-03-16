/**
 * Config API Route (Vault-Scoped) - Daemon Proxy
 *
 * PATCH /api/vaults/:vaultId/config - Update vault configuration
 *
 * Proxies to daemon endpoint:
 *   PUT /vaults/:id/config
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
