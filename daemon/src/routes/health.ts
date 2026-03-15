/**
 * Health endpoint handler.
 *
 * Returns daemon status including uptime, vault count, active sessions,
 * and scheduler status. Shape is the contract; placeholder values are
 * replaced as domain modules migrate in later stages.
 */

import type { Context } from "hono";
import { getVaults } from "../vault";

export interface HealthResponse {
  status: "ok";
  uptime: number;
  version: string;
  vaults: number;
  activeSessions: number;
  schedulers: {
    extraction: { status: string; lastRun: string | null; nextRun: string | null };
    cardDiscovery: { status: string; lastRun: string | null; nextRun: string | null };
  };
}

export async function healthHandler(c: Context, startTime: number): Promise<Response> {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const vaults = await getVaults();

  const body: HealthResponse = {
    status: "ok",
    uptime: uptimeSeconds,
    version: "0.0.0",
    vaults: vaults.length,
    activeSessions: 0,
    schedulers: {
      extraction: { status: "idle", lastRun: null, nextRun: null },
      cardDiscovery: { status: "idle", lastRun: null, nextRun: null },
    },
  };

  return c.json(body);
}
