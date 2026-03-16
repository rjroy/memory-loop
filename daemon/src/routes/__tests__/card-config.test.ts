/**
 * Card Config Route Tests
 *
 * Tests for card generator config endpoints: GET/PUT config,
 * DELETE requirements, GET status, POST trigger.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../server";
import {
  resetSchedulerState,
} from "../../spaced-repetition/card-discovery-scheduler";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const startTime = Date.now();
  app = createApp(startTime);
  resetSchedulerState();
});

afterEach(() => {
  resetSchedulerState();
});

// ---------------------------------------------------------------------------
// GET /config/card-generator
// ---------------------------------------------------------------------------

describe("GET /config/card-generator", () => {
  test("returns config shape", async () => {
    const response = await app.request("/config/card-generator");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.requirements).toBe("string");
    expect(typeof body.isOverride).toBe("boolean");
    expect(typeof body.weeklyByteLimit).toBe("number");
    expect(typeof body.weeklyBytesUsed).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// PUT /config/card-generator
// ---------------------------------------------------------------------------

describe("PUT /config/card-generator", () => {
  test("accepts empty update", async () => {
    const response = await app.request("/config/card-generator", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);

    const body = await response.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /config/card-generator/requirements
// ---------------------------------------------------------------------------

describe("DELETE /config/card-generator/requirements", () => {
  test("returns expected response shape", async () => {
    const response = await app.request("/config/card-generator/requirements", {
      method: "DELETE",
    });

    const body = await response.json() as { success: boolean; content: string };
    expect(typeof body.success).toBe("boolean");
    expect(typeof body.content).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// GET /config/card-generator/status
// ---------------------------------------------------------------------------

describe("GET /config/card-generator/status", () => {
  test("returns idle status when not running", async () => {
    const response = await app.request("/config/card-generator/status");
    expect(response.status).toBe(200);

    const body = await response.json() as { status: string; message: string };
    expect(body.status).toBe("idle");
    expect(body.message).toContain("No generation running");
  });
});

// ---------------------------------------------------------------------------
// POST /config/card-generator/trigger
// ---------------------------------------------------------------------------

describe("POST /config/card-generator/trigger", () => {
  test("returns a status response", async () => {
    const response = await app.request("/config/card-generator/trigger", {
      method: "POST",
    });

    const body = await response.json() as { status: string };
    expect(typeof body.status).toBe("string");
    expect(["complete", "error"]).toContain(body.status);
  });
});
