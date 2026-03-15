/**
 * Due Cards API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/cards/due - Get cards due for review
 *
 * Proxies to daemon: GET /vaults/:id/cards/due
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(`/vaults/${encodeURIComponent(vaultId)}/cards/due`);
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
