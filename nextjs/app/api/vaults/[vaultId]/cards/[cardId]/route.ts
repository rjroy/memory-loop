/**
 * Card Detail API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/cards/:cardId - Get full card details
 *
 * Proxies to daemon: GET /vaults/:id/cards/:cardId
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/cards/${encodeURIComponent(cardId)}`,
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
