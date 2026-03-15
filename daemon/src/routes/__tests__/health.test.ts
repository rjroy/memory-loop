import { describe, test, expect } from "bun:test";
import { healthHandler, type HealthResponse } from "../health";

describe("GET /health", () => {
  test("returns 200 with expected JSON shape", async () => {
    const startTime = Date.now() - 5000;
    const response = healthHandler(startTime);

    expect(response.status).toBe(200);

    const body = (await response.json()) as HealthResponse;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.0.0");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.vaults).toBe("number");
    expect(typeof body.activeSessions).toBe("number");
    expect(body.schedulers).toBeDefined();
    expect(body.schedulers.extraction.status).toBe("idle");
    expect(body.schedulers.cardDiscovery.status).toBe("idle");
  });

  test("uptime is a non-negative number", async () => {
    const startTime = Date.now();
    const response = healthHandler(startTime);
    const body = (await response.json()) as HealthResponse;

    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  test("uptime reflects elapsed time", async () => {
    const startTime = Date.now() - 10_000;
    const response = healthHandler(startTime);
    const body = (await response.json()) as HealthResponse;

    expect(body.uptime).toBeGreaterThanOrEqual(9);
    expect(body.uptime).toBeLessThanOrEqual(11);
  });
});
