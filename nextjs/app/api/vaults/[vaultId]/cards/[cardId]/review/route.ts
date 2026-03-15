/**
 * Card Review API Route (Vault-Scoped) - Daemon Proxy
 *
 * POST /api/vaults/:vaultId/cards/:cardId/review - Submit review response
 *
 * Proxies to daemon: POST /vaults/:id/cards/:cardId/review
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; cardId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { vaultId, cardId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/cards/${encodeURIComponent(cardId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
