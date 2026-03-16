/**
 * Extraction Trigger API - Daemon Proxy
 *
 * POST /api/config/extraction-prompt/trigger - Manually trigger extraction
 *
 * Proxies to daemon: POST /config/extraction/trigger
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

export async function POST() {
  const res = await daemonFetch("/config/extraction/trigger", {
    method: "POST",
  });
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
