/**
 * Directories API Route (Vault-Scoped, Path-Based) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/directories/:path/contents - Get directory contents for delete preview
 * DELETE /api/vaults/:vaultId/directories/:path - Delete directory and contents
 *
 * Proxies requests to daemon endpoints.
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

/**
 * GET /api/vaults/:vaultId/directories/:path
 *
 * Gets directory contents for deletion preview.
 * The last segment must be "contents" (matching the daemon pattern /directories/:path/contents).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const segments = path.map(decodeURIComponent);

  // The catch-all captures "some/dir/contents" - strip trailing "contents" segment
  if (segments[segments.length - 1] !== "contents") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const dirSegments = segments.slice(0, -1);
  const encodedPath = dirSegments.map(encodeURIComponent).join("/");

  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/directories/${encodedPath}/contents`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

/**
 * DELETE /api/vaults/:vaultId/directories/:path
 *
 * Deletes a directory and all its contents.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const encodedPath = path.map(encodeURIComponent).join("/");

  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/directories/${encodedPath}`,
    { method: "DELETE" }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
