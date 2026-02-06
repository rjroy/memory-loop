/**
 * Health Check API Route
 *
 * GET /api/health - Returns basic health status
 */

import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "Memory Loop (Next.js)" });
}
