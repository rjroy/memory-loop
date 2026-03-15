/**
 * Extraction Prompt API - Daemon Proxy
 *
 * GET /api/config/extraction-prompt - Get extraction prompt
 * PUT /api/config/extraction-prompt - Save extraction prompt
 * DELETE /api/config/extraction-prompt - Reset to default
 *
 * Proxies to daemon: GET/PUT/DELETE /config/extraction-prompt
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

export async function GET() {
  const res = await daemonFetch("/config/extraction-prompt");
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function PUT(request: Request) {
  const body = await request.text();
  const res = await daemonFetch("/config/extraction-prompt", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}

export async function DELETE() {
  const res = await daemonFetch("/config/extraction-prompt", {
    method: "DELETE",
  });
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
