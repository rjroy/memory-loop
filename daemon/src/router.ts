/**
 * Request router for the daemon API.
 *
 * Maps URL paths to route handlers. Bun.serve() calls this for every
 * incoming request.
 */

import { healthHandler } from "./routes/health";
import { helpHandler } from "./routes/help";
import {
  listVaultsHandler,
  getVaultHandler,
  createVaultHandler,
  getVaultConfigHandler,
  updateVaultConfigHandler,
  updatePinnedAssetsHandler,
  getSlashCommandsHandler,
  updateSlashCommandsHandler,
  vaultsHelpHandler,
} from "./routes/vaults";

/**
 * Extract a vault ID from a path segment. Returns null if the path doesn't match.
 */
function matchVaultPath(pathname: string): { vaultId: string; rest: string } | null {
  const match = pathname.match(/^\/vaults\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  return { vaultId: match[1], rest: match[2] ?? "" };
}

export async function handleRequest(req: Request, startTime: number): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // Health and help
  if (method === "GET" && pathname === "/health") {
    return healthHandler(startTime);
  }

  if (method === "GET" && pathname === "/help") {
    return helpHandler();
  }

  // Vault routes
  if (method === "GET" && pathname === "/vaults") {
    return listVaultsHandler();
  }

  if (method === "POST" && pathname === "/vaults") {
    return createVaultHandler(req);
  }

  if (method === "GET" && pathname === "/vaults/help") {
    return vaultsHelpHandler();
  }

  const vaultMatch = matchVaultPath(pathname);
  if (vaultMatch) {
    const { vaultId, rest } = vaultMatch;

    if (method === "GET" && rest === "") {
      return getVaultHandler(vaultId);
    }

    if (method === "GET" && rest === "/config") {
      return getVaultConfigHandler(vaultId);
    }

    if (method === "PUT" && rest === "/config") {
      return updateVaultConfigHandler(vaultId, req);
    }

    if (method === "PUT" && rest === "/config/pinned-assets") {
      return updatePinnedAssetsHandler(vaultId, req);
    }

    if (method === "GET" && rest === "/config/slash-commands") {
      return getSlashCommandsHandler(vaultId);
    }

    if (method === "PUT" && rest === "/config/slash-commands") {
      return updateSlashCommandsHandler(vaultId, req);
    }
  }

  return Response.json(
    { error: "Not found", code: "NOT_FOUND" },
    { status: 404 },
  );
}
