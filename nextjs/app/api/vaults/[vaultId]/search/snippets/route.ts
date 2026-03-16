/**
 * Search Snippets API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/search/snippets - Get context snippets for a file
 */

import { NextRequest, NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/search/snippets
 *
 * Proxies to daemon GET /vaults/:id/search/snippets
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const q = request.nextUrl.searchParams.get("q") ?? "";

  const search = new URLSearchParams();
  if (path) search.set("path", path);
  if (q) search.set("q", q);

  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/search/snippets?${search.toString()}`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
