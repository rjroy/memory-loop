/**
 * Asset Serving Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /vault/:vaultId/assets/:path - Serve binary files from vault
 *
 * Proxies to daemon endpoint: GET /vaults/:id/assets/*
 * Used by ImageViewer, VideoViewer, PdfViewer, MarkdownViewer, and MessageBubble.
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

/**
 * GET /vault/:vaultId/assets/*
 *
 * Proxies the request to the daemon, which handles path validation,
 * symlink checks, and binary file reading.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path: pathSegments } = await params;

  const encodedVaultId = encodeURIComponent(vaultId);
  const encodedPath = pathSegments.map(encodeURIComponent).join("/");
  const daemonPath = `/vaults/${encodedVaultId}/assets/${encodedPath}`;

  const res = await daemonFetch(daemonPath);

  if (!res.ok) {
    const body: unknown = await res.json();
    return NextResponse.json(body, { status: res.status });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Length": res.headers.get("Content-Length") ?? String(buffer.byteLength),
      "Cache-Control": res.headers.get("Cache-Control") ?? "private, max-age=3600",
    },
  });
}
