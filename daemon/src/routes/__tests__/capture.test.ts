/**
 * Capture Route Tests
 *
 * Tests for GET /vaults/:id/recent-activity returning discussions.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir as osTmpdir } from "node:os";
import { createApp } from "../../server";
import { resetCache } from "../../vault";
import type { SessionMetadata, RecentDiscussionEntry } from "@memory-loop/shared";

function tmpdir(): string {
  return process.env.TMPDIR ?? osTmpdir();
}

let testDir: string;
let vaultDir: string;
let sessionsDir: string;
let originalVaultsDir: string | undefined;

beforeEach(async () => {
  originalVaultsDir = process.env.VAULTS_DIR;

  testDir = join(tmpdir(), `capture-route-test-${Date.now()}`);
  vaultDir = join(testDir, "test-vault");
  sessionsDir = join(vaultDir, ".memory-loop", "sessions");

  await mkdir(sessionsDir, { recursive: true });
  // Also create inbox dir so vault discovery works
  await mkdir(join(vaultDir, "00_Inbox"), { recursive: true });
  await writeFile(join(vaultDir, "CLAUDE.md"), "# Test Vault\n");

  process.env.VAULTS_DIR = testDir;
  resetCache();
});

afterEach(async () => {
  if (originalVaultsDir !== undefined) {
    process.env.VAULTS_DIR = originalVaultsDir;
  } else {
    delete process.env.VAULTS_DIR;
  }
  resetCache();
  await rm(testDir, { recursive: true, force: true });
});

function makeSession(
  id: string,
  vaultId: string,
  vaultPath: string,
  lastActiveAt: string,
  userMessage: string,
): SessionMetadata {
  return {
    id,
    vaultId,
    vaultPath,
    createdAt: lastActiveAt,
    lastActiveAt,
    messages: [{ id: `msg-${id}`, role: "user", content: userMessage, timestamp: lastActiveAt }],
  };
}

describe("GET /vaults/:id/recent-activity", () => {
  test("returns discussions from session files", async () => {
    const session = makeSession(
      "sess-001",
      "test-vault",
      vaultDir,
      "2026-03-15T10:00:00.000Z",
      "Hello world",
    );
    await writeFile(
      join(sessionsDir, "sess-001.json"),
      JSON.stringify(session),
    );

    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/recent-activity");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      captures: unknown[];
      discussions: RecentDiscussionEntry[];
    };
    expect(body.discussions).toHaveLength(1);
    expect(body.discussions[0].sessionId).toBe("sess-001");
    expect(body.discussions[0].preview).toBe("Hello world");
    expect(body.discussions[0].messageCount).toBe(1);
  });

  test("returns empty discussions when no sessions exist", async () => {
    // Remove sessions dir so there are no sessions
    await rm(sessionsDir, { recursive: true, force: true });

    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/recent-activity");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      captures: unknown[];
      discussions: RecentDiscussionEntry[];
    };
    expect(body.discussions).toHaveLength(0);
  });

  test("returns 404 for unknown vault", async () => {
    const app = createApp(Date.now());
    const response = await app.request("/vaults/nonexistent/recent-activity");

    expect(response.status).toBe(404);
  });
});
