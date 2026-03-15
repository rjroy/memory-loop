/**
 * Memory Config API - Daemon Proxy
 *
 * GET /api/config/memory - Get memory file content
 * PUT /api/config/memory - Update memory file content
 *
 * Proxies to daemon: GET/PUT /config/memory
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

export async function GET() {
  const res = await daemonFetch("/config/memory");
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function PUT(request: Request) {
  const body = await request.text();
  const res = await daemonFetch("/config/memory", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
