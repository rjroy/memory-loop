/**
 * Transcript Route Tests
 *
 * Tests for POST /vaults/:id/transcripts/append with path traversal validation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir as osTmpdir } from "node:os";

function tmpdir(): string {
  return process.env.TMPDIR ?? osTmpdir();
}
import { createApp } from "../../server";
import { resetCache } from "../../vault";

let testDir: string;
let vaultDir: string;
let inboxDir: string;
let chatsDir: string;
let originalVaultsDir: string | undefined;

beforeEach(async () => {
  originalVaultsDir = process.env.VAULTS_DIR;

  testDir = join(tmpdir(), `transcript-route-test-${Date.now()}`);
  vaultDir = join(testDir, "test-vault");
  inboxDir = join(vaultDir, "00_Inbox");
  chatsDir = join(inboxDir, "chats");

  await mkdir(chatsDir, { recursive: true });
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

describe("POST /vaults/:id/transcripts/append", () => {
  test("appends content to a valid transcript path within vault", async () => {
    const transcriptPath = join(chatsDir, "2026-01-16-1430-abc12.md");
    await writeFile(transcriptPath, "---\ntitle: test\n---\n\n");

    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/transcripts/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: transcriptPath, content: "## New content\n" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const contents = await readFile(transcriptPath, "utf-8");
    expect(contents).toContain("## New content");
  });

  test("rejects path traversal attempt with relative path", async () => {
    const maliciousPath = join(chatsDir, "../../../../../../etc/passwd");

    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/transcripts/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: maliciousPath, content: "malicious content" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("PATH_TRAVERSAL");
  });

  test("rejects absolute path outside vault", async () => {
    const outsidePath = "/tmp/outside-vault/evil.md";

    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/transcripts/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: outsidePath, content: "malicious content" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("PATH_TRAVERSAL");
  });

  test("returns 404 for unknown vault", async () => {
    const app = createApp(Date.now());
    const response = await app.request("/vaults/nonexistent/transcripts/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/some/path", content: "content" }),
    });

    expect(response.status).toBe(404);
  });

  test("returns 400 for missing fields", async () => {
    const app = createApp(Date.now());
    const response = await app.request("/vaults/test-vault/transcripts/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/some/path" }),
    });

    expect(response.status).toBe(400);
  });
});
