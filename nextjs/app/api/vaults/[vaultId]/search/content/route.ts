/**
 * Content Search API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/search/content - Search file contents
 *
 * Proxies requests to daemon endpoint:
 *   GET /vaults/:id/search/content (query: q, limit)
 */

import { NextRequest, NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/search/content
 *
 * Search file contents using full-text search.
 *
 * Query parameters:
 * - q: Search query (required, non-empty)
 * - limit: Maximum results (optional)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limitParam = request.nextUrl.searchParams.get("limit");

  let url = `/vaults/${encodeURIComponent(vaultId)}/search/content?q=${encodeURIComponent(query)}`;
  if (limitParam) {
    url += `&limit=${encodeURIComponent(limitParam)}`;
  }

  const res = await daemonFetch(url);
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
