import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon/fetch";

export async function GET() {
  const res = await daemonFetch("/models");
  return NextResponse.json(await res.json(), { status: res.status });
}
