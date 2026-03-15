/**
 * Files API Routes (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/files - List directory contents
 * POST /api/vaults/:vaultId/files - Create a new file
 *
 * Proxies requests to daemon endpoints:
 *   GET /vaults/:id/files (query: path)
 *   POST /vaults/:id/files (body: { path, name })
 */

import { NextRequest, NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/files
 *
 * Lists directory contents. Query param `path` specifies directory (empty for root).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { vaultId } = await params;
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/files?path=${encodeURIComponent(path)}`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

/**
 * POST /api/vaults/:vaultId/files
 *
 * Creates a new markdown file. Body: { path: string, name: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
