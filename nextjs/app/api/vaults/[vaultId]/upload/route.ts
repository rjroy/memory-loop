/**
 * Upload API Route (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/upload - Upload a file to the vault's attachment directory
 *
 * Proxies requests to daemon endpoint:
 *   POST /vaults/:id/upload (multipart)
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * POST /api/vaults/:vaultId/upload
 *
 * Accepts multipart form data with a "file" field.
 * Forwards the form data to the daemon for processing.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;

  // Read incoming form data and reconstruct for the daemon
  const formData = await request.formData();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/upload`,
    {
      method: "POST",
      body: formData,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
