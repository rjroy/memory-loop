/**
 * Health endpoint handler.
 *
 * Returns daemon status including uptime, vault count, active sessions,
 * and real scheduler status from extraction and card discovery modules.
 */

import type { Context } from "hono";
import { getVaults } from "../vault";
import {
  isSchedulerRunning as isExtractionSchedulerRunning,
  isExtractionRunning,
  getLastRunResult,
  getNextScheduledRun,
  type ExtractionRunResult,
} from "../extraction/extraction-manager";
import {
  isSchedulerRunning as isCardSchedulerRunning,
  isGenerationRunning,
} from "../spaced-repetition/card-discovery-scheduler";

export interface HealthResponse {
  status: "ok";
  uptime: number;
  version: string;
  vaults: number;
  activeSessions: number;
  schedulers: {
    extraction: {
      status: string;
      lastRun: ExtractionRunResult | null;
      nextRun: string | null;
    };
    cardDiscovery: {
      status: string;
      lastRun: null;
      nextRun: null;
    };
  };
}

export async function healthHandler(c: Context, startTime: number): Promise<Response> {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const vaults = await getVaults();

  const extractionNextRun = getNextScheduledRun();

  function extractionStatus(): string {
    if (isExtractionRunning()) return "running";
    if (isExtractionSchedulerRunning()) return "running";
    return "idle";
  }

  function cardDiscoveryStatus(): string {
    if (isGenerationRunning()) return "running";
    if (isCardSchedulerRunning()) return "running";
    return "idle";
  }

  const body: HealthResponse = {
    status: "ok",
    uptime: uptimeSeconds,
    version: "0.0.0",
    vaults: vaults.length,
    activeSessions: 0,
    schedulers: {
      extraction: {
        status: extractionStatus(),
        lastRun: getLastRunResult(),
        nextRun: extractionNextRun ? extractionNextRun.toISOString() : null,
      },
      cardDiscovery: {
        status: cardDiscoveryStatus(),
        lastRun: null,
        nextRun: null,
      },
    },
  };

  return c.json(body);
}
