/**
 * Card Generator Requirements Reset API - Daemon Proxy
 *
 * DELETE /api/config/card-generator/requirements - Reset requirements to default
 *
 * Proxies to daemon: DELETE /config/card-generator/requirements
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

export async function DELETE() {
  const res = await daemonFetch("/config/card-generator/requirements", {
    method: "DELETE",
  });
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}
