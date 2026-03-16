/**
 * Session Manager Tests
 *
 * Tests prepareTurnOptions(), resume failure detection, and session lifecycle.
 * Uses real filesystem (temp dirs) for vault config, mock SDK via DI.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  prepareTurnOptions,
  DISCUSSION_MODE_OPTIONS,
  resumeSession,
  saveSession,
  SessionError,
} from "../session-manager";
import type { SessionMetadata } from "@memory-loop/shared";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join("/tmp/claude-1000", "session-mgr-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// prepareTurnOptions
// =============================================================================

describe("prepareTurnOptions", () => {
  test("returns default options when no vault config exists", async () => {
    const options = await prepareTurnOptions({ vaultPath: tempDir });

    expect(options.cwd).toBe(tempDir);
    // Default model from resolveDiscussionModel when no config
    expect(options.model).toBeDefined();
    expect(options.allowedTools).toEqual(DISCUSSION_MODE_OPTIONS.allowedTools);
    expect(options.permissionMode).toBe("acceptEdits");
    expect(options.includePartialMessages).toBe(true);
    expect(options.mcpServers).toBeDefined();
    expect(options.mcpServers!["vault-transfer"]).toBeDefined();
    // No resume
    expect(options.resume).toBeUndefined();
    // No canUseTool
    expect(options.canUseTool).toBeUndefined();
  });

  test("includes resume when provided", async () => {
    const options = await prepareTurnOptions({
      vaultPath: tempDir,
      resume: "sess-abc123",
    });

    expect(options.resume).toBe("sess-abc123");
  });

  test("includes canUseTool when provided", async () => {
    const mockCanUseTool = async () => ({
      behavior: "allow" as const,
      updatedInput: {},
    });

    const options = await prepareTurnOptions({
      vaultPath: tempDir,
      canUseTool: mockCanUseTool,
    });

    expect(options.canUseTool).toBe(mockCanUseTool);
  });

  test("resolves model from vault config", async () => {
    // Write a vault config with a custom model
    await writeFile(
      join(tempDir, ".memory-loop.json"),
      JSON.stringify({ discussionModel: "haiku" })
    );

    const options = await prepareTurnOptions({ vaultPath: tempDir });

    expect(options.model).toBe("haiku");
  });

  test("merges additionalOptions", async () => {
    const options = await prepareTurnOptions({
      vaultPath: tempDir,
      additionalOptions: {
        maxBudgetUsd: 5.0,
      },
    });

    expect(options.maxBudgetUsd).toBe(5.0);
  });

  test("additionalOptions mcpServers merge with vault-transfer", async () => {
    const options = await prepareTurnOptions({
      vaultPath: tempDir,
      additionalOptions: {
        mcpServers: {
          "custom-server": { command: "echo", args: ["test"] },
        },
      },
    });

    expect(options.mcpServers!["vault-transfer"]).toBeDefined();
    expect(options.mcpServers!["custom-server"]).toBeDefined();
  });

  test("cwd is always set to vaultPath", async () => {
    const options = await prepareTurnOptions({
      vaultPath: tempDir,
      additionalOptions: { cwd: "/should/be/overridden" },
    });

    // cwd from vaultPath takes precedence (it's spread after additionalOptions)
    expect(options.cwd).toBe(tempDir);
  });
});

// =============================================================================
// Resume failure detection
// =============================================================================

describe("resumeSession failure detection", () => {
  async function createTestSession(sessionId: string): Promise<void> {
    const sessionsDir = join(tempDir, ".memory-loop", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const metadata: SessionMetadata = {
      id: sessionId,
      vaultId: "test-vault",
      vaultPath: tempDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messages: [],
    };
    await saveSession(metadata);
  }

  test("SDK session expiry error produces RESUME_FAILED", async () => {
    await createTestSession("sess-expired");

    // Mock SDK that throws a session expiry error
    const mockQuery = (() => {
      throw new Error("Session not found: sess-expired");
    }) as never;

    try {
      await resumeSession(
        tempDir,
        "sess-expired",
        "hello",
        undefined,
        undefined,
        undefined,
        mockQuery
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      const sessionErr = err as SessionError;
      expect(sessionErr.code).toBe("RESUME_FAILED");
      expect(sessionErr.message).toContain("expired");
    }
  });

  test("SDK session ID mismatch produces RESUME_FAILED", async () => {
    await createTestSession("sess-original");

    let closeCalled = false;
    // Mock SDK that returns a different session ID
    const mockQuery = (() => {
      async function* events() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sess-different",
        };
      }
      return {
        [Symbol.asyncIterator]: () => events(),
        next: async () => {
          const gen = events();
          return gen.next();
        },
        return: async () => ({ done: true as const, value: undefined }),
        throw: async () => ({ done: true as const, value: undefined }),
        interrupt: async () => {},
        close: () => {
          closeCalled = true;
        },
        supportedCommands: async () => [],
      };
    }) as never;

    try {
      await resumeSession(
        tempDir,
        "sess-original",
        "hello",
        undefined,
        undefined,
        undefined,
        mockQuery
      );
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      const sessionErr = err as SessionError;
      expect(sessionErr.code).toBe("RESUME_FAILED");
      expect(closeCalled).toBe(true);
    }
  });

  test("non-expiry SDK error produces SDK_ERROR", async () => {
    await createTestSession("sess-other");

    const mockQuery = (() => {
      throw new Error("Rate limit exceeded");
    }) as never;

    try {
      await resumeSession(
        tempDir,
        "sess-other",
        "hello",
        undefined,
        undefined,
        undefined,
        mockQuery
      );
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      const sessionErr = err as SessionError;
      expect(sessionErr.code).toBe("SDK_ERROR");
    }
  });

  test("session not found on disk produces SESSION_NOT_FOUND", async () => {
    const mockQuery = (() => {
      throw new Error("Should not reach SDK");
    }) as never;

    try {
      await resumeSession(
        tempDir,
        "nonexistent-session",
        "hello",
        undefined,
        undefined,
        undefined,
        mockQuery
      );
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SessionError);
      const sessionErr = err as SessionError;
      expect(sessionErr.code).toBe("SESSION_NOT_FOUND");
    }
  });
});
