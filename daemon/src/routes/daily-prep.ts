/**
 * Daily prep API route handlers.
 *
 * Handles reading daily prep status for today.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById } from "../vault";
import { getDailyPrepStatus } from "../files/daily-prep-manager";

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
): Response {
  return c.json({ error, code }, status);
}

/**
 * GET /vaults/:id/daily-prep/today - Get daily prep status for today.
 */
export async function dailyPrepTodayHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const status = await getDailyPrepStatus(vault);
  return c.json(status);
}
