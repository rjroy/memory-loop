/**
 * Card Generator Config API - Daemon Proxy
 *
 * GET /api/config/card-generator - Get config with requirements and usage
 * PUT /api/config/card-generator - Save config
 *
 * Proxies to daemon: GET/PUT /config/card-generator
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

export async function GET() {
  const res = await daemonFetch("/config/card-generator");
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function PUT(request: Request) {
  const body = await request.text();
  const res = await daemonFetch("/config/card-generator", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
