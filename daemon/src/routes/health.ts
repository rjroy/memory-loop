/**
 * Health endpoint handler.
 *
 * Returns daemon status including uptime, vault count, active sessions,
 * and scheduler status. Shape is the contract; placeholder values are
 * replaced as domain modules migrate in later stages.
 */

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

export function healthHandler(startTime: number): Response {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const body: HealthResponse = {
    status: "ok",
    uptime: uptimeSeconds,
    version: "0.0.0",
    vaults: 0,
    activeSessions: 0,
    schedulers: {
      extraction: { status: "idle", lastRun: null, nextRun: null },
      cardDiscovery: { status: "idle", lastRun: null, nextRun: null },
    },
  };

  return Response.json(body);
}
