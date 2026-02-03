/**
 * Daily Prep Routes
 *
 * REST endpoints for daily prep status:
 * - GET /daily-prep/today - Get today's prep status
 *
 * All routes are under /api/vaults/:vaultId/ (vault middleware applied).
 */

import { Hono } from "hono";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import { getDailyPrepStatus, type DailyPrepStatus } from "../daily-prep-manager";
import { createLogger } from "../logger";

const log = createLogger("DailyPrepRoutes");

/**
 * Daily prep routes.
 */
const dailyPrepRoutes = new Hono();

/**
 * GET /daily-prep/today
 *
 * Returns the daily prep status for today.
 * Used by Ground tab to determine button visibility and show commitment.
 *
 * Response: { exists: boolean, commitment?: string[], energy?: string, calendar?: string }
 */
dailyPrepRoutes.get("/today", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Getting daily prep status for vault: ${vault.id}`);

  try {
    const status: DailyPrepStatus = await getDailyPrepStatus(vault);
    log.info(`Daily prep status: exists=${status.exists}, commitments=${status.commitment?.length ?? 0}`);
    return c.json(status);
  } catch (error) {
    log.error("Failed to get daily prep status", error);
    const message = error instanceof Error ? error.message : "Failed to get daily prep status";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

export { dailyPrepRoutes };
