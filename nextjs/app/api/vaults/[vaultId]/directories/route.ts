/**
 * Directories API Route (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/directories - Create a new directory
 *
 * Proxies requests to daemon endpoint:
 *   POST /vaults/:id/directories (body: { path, name })
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/directories
 *
 * Creates a new directory. Body: { path: string, name: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/directories`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
