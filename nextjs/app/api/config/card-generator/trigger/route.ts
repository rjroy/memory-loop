/**
 * Card Generation Trigger API - Daemon Proxy
 *
 * POST /api/config/card-generator/trigger - Manually trigger card generation
 *
 * Proxies to daemon: POST /config/card-generator/trigger
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

export async function POST() {
  const res = await daemonFetch("/config/card-generator/trigger", {
    method: "POST",
  });
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
