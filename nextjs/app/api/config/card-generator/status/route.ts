/**
 * Card Generation Status API - Daemon Proxy
 *
 * GET /api/config/card-generator/status - Get current generation status
 *
 * Proxies to daemon: GET /config/card-generator/status
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

export async function GET() {
  const res = await daemonFetch("/config/card-generator/status");
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
