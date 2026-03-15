/**
 * Tasks API Route (Vault-Scoped) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/tasks - Get tasks list
 * PATCH /api/vaults/:vaultId/tasks - Toggle task completion
 *
 * Proxies requests to daemon endpoints:
 *   GET /vaults/:id/tasks
 *   PATCH /vaults/:id/tasks (body: { filePath, lineNumber, newState? })
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

/**
 * GET /api/vaults/:vaultId/tasks
 *
 * Returns all tasks from configured directories (inbox, projects, areas).
 * Tasks are sorted by file path then line number.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/tasks`
  );
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

/**
 * PATCH /api/vaults/:vaultId/tasks
 *
 * Toggles or sets the state of a task checkbox.
 * If newState is provided, sets to that state directly.
 * Otherwise cycles: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const body = await request.text();
  const res = await daemonFetch(
    `/vaults/${encodeURIComponent(vaultId)}/tasks`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
