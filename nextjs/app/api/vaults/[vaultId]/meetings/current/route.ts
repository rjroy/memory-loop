/**
 * Current Meeting API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/meetings/current - Get meeting state
 * DELETE /api/vaults/:vaultId/meetings/current - Stop current meeting
 *
 * Proxies requests to daemon endpoints:
 *   GET /vaults/:id/meetings/current
 *   DELETE /vaults/:id/meetings/current
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/meetings/current
 *
 * Returns the current meeting state for the vault.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/meetings/current`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

/**
 * DELETE /api/vaults/:vaultId/meetings/current
 *
 * Ends the current meeting capture session and returns to normal daily note mode.
 * Returns the full file content for Claude Code integration.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/meetings/current`,
    { method: "DELETE" }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
