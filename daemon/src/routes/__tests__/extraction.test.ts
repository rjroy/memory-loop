/**
 * Extraction Route Tests
 *
 * Tests for extraction scheduler status/trigger, memory CRUD,
 * and extraction prompt management endpoints.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server";
import {
  resetManagerState,
} from "../../extraction/extraction-manager";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: ReturnType<typeof createApp>;
let tempDir: string;

beforeEach(async () => {
  const startTime = Date.now();
  app = createApp(startTime);
  tempDir = await mkdtemp(join(tmpdir(), "extraction-route-test-"));
  resetManagerState();
});

afterEach(async () => {
  resetManagerState();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /config/extraction/status
// ---------------------------------------------------------------------------

describe("GET /config/extraction/status", () => {
  test("returns expected shape when scheduler is not running", async () => {
    const response = await app.request("/config/extraction/status");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(body.schedulerRunning).toBe(false);
    expect(body.extractionRunning).toBe(false);
    expect(body.lastRun).toBeNull();
    expect(body.nextScheduledRun).toBeNull();
    expect(typeof body.schedule).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// POST /config/extraction/trigger
// ---------------------------------------------------------------------------

describe("POST /config/extraction/trigger", () => {
  test("returns a status response", async () => {
    // Without SDK initialized, extraction returns error status
    const response = await app.request("/config/extraction/trigger", {
      method: "POST",
    });

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.status).toBe("string");
    expect(["complete", "error", "running"]).toContain(body.status);
  });
});

// ---------------------------------------------------------------------------
// GET /config/memory
// ---------------------------------------------------------------------------

describe("GET /config/memory", () => {
  test("returns memory content", async () => {
    const response = await app.request("/config/memory");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.content).toBe("string");
    expect(typeof body.exists).toBe("boolean");
    expect(typeof body.sizeBytes).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// GET /config/extraction-prompt
// ---------------------------------------------------------------------------

describe("GET /config/extraction-prompt", () => {
  test("returns extraction prompt content", async () => {
    const response = await app.request("/config/extraction-prompt");
    expect(response.status).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.content).toBe("string");
    expect(body.content).toBeTruthy();
    expect(typeof body.isOverride).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// PUT /config/extraction-prompt
// ---------------------------------------------------------------------------

describe("PUT /config/extraction-prompt", () => {
  test("rejects missing content", async () => {
    const response = await app.request("/config/extraction-prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /config/memory
// ---------------------------------------------------------------------------

describe("PUT /config/memory", () => {
  test("rejects invalid JSON", async () => {
    const response = await app.request("/config/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  test("rejects missing content", async () => {
    const response = await app.request("/config/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});
