/**
 * Card Archive API Route (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/cards/:cardId/archive - Archive a card
 *
 * Proxies to daemon: POST /vaults/:id/cards/:cardId/archive
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/cards/${encodeURIComponent(cardId)}/archive`,
    { method: "POST" },
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
