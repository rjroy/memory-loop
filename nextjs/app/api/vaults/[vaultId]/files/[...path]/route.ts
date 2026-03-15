/**
 * Files API Routes (Vault-Scoped, Path-Based) - Daemon Proxy
 *
 * GET /api/vaults/:vaultId/files/:path - Read file content
 * PUT /api/vaults/:vaultId/files/:path - Write file content
 * PATCH /api/vaults/:vaultId/files/:path - Rename/move file
 * DELETE /api/vaults/:vaultId/files/:path - Delete file
 *
 * Proxies requests to daemon endpoints:
 *   GET /vaults/:id/files/*
 *   PUT /vaults/:id/files/* (body: { content })
 *   PATCH /vaults/:id/files/* (body: { newName } or { newPath })
 *   DELETE /vaults/:id/files/*
 */

import { NextResponse } from "next/server";
import { daemonFetch } from "@/lib/daemon-fetch";

interface RouteParams {
  params: Promise<{ vaultId: string; path: string[] }>;
}

function buildFilePath(vaultId: string, path: string[]): string {
  const encodedVaultId = encodeURIComponent(vaultId);
  const encodedPath = path.map(encodeURIComponent).join("/");
  return `/vaults/${encodedVaultId}/files/${encodedPath}`;
}

/**
 * GET /api/vaults/:vaultId/files/:path
 *
 * Reads file content.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const res = await daemonFetch(buildFilePath(vaultId, path));
  const body: unknown = await res.json();
  return NextResponse.json(body, { status: res.status });
}

/**
 * PUT /api/vaults/:vaultId/files/:path
 *
 * Writes content to existing file. Body: { content: string }
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const body = await request.text();
  const res = await daemonFetch(buildFilePath(vaultId, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}

/**
 * PATCH /api/vaults/:vaultId/files/:path
 *
 * Renames or moves a file/directory.
 * Body: { newName: string } for rename, { newPath: string } for move
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const body = await request.text();
  const res = await daemonFetch(buildFilePath(vaultId, path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}

/**
 * DELETE /api/vaults/:vaultId/files/:path
 *
 * Deletes a file.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { vaultId, path } = await params;
  const res = await daemonFetch(buildFilePath(vaultId, path), {
    method: "DELETE",
  });
  const responseBody: unknown = await res.json();
  return NextResponse.json(responseBody, { status: res.status });
}
