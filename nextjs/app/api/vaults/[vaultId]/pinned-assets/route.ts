/**
 * Pinned Assets API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/pinned-assets - Get pinned asset paths
 * PUT /api/vaults/:vaultId/pinned-assets - Set pinned asset paths
 *
 * Proxies to daemon endpoints:
 *   GET  /vaults/:id/config (extracts pinnedAssets from response)
 *   PUT  /vaults/:id/config/pinned-assets
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/config`);
  if (!res.ok) {
    const body: unknown = await res.json();
    return NextResponse.json(body, { status: res.status });
  }
  const config = await res.json() as { pinnedAssets?: string[] };
  return NextResponse.json({ paths: config.pinnedAssets ?? [] });
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/config/pinned-assets`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
