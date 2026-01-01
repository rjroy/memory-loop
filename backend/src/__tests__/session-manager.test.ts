/**
 * Session Manager Tests
 *
 * Unit tests for session lifecycle management.
 * Uses mocking for the SDK to avoid real API calls.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionMetadata, VaultInfo } from "@memory-loop/shared";

// Mock the SDK before importing session-manager
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = mock<(...args: any[]) => any>(() => undefined);
const mockInterrupt = mock(() => Promise.resolve());

void mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

// Now import session-manager (it will use the mocked SDK)
import {
  getSessionsDir,
  getSessionFilePath,
  saveSession,
  loadSession,
  deleteSession,
  listSessionsByVault,
  getRecentSessions,
  touchSession,
  SessionError,
  mapSdkError,
  createSession,
  resumeSession,
  querySession,
  SESSIONS_DIR,
} from "../session-manager";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockVault(overrides: Partial<VaultInfo> = {}): VaultInfo {
  const path = overrides.path ?? "/tmp/test-vault";
  const contentRoot = overrides.contentRoot ?? path;
  return {
    id: "test-vault",
    name: "Test Vault",
    path,
    hasClaudeMd: true,
    contentRoot,
    inboxPath: "00_Inbox",
    metadataPath: "06_Metadata/memory-loop",
    ...overrides,
  };
}

function createMockMetadata(
  overrides: Partial<SessionMetadata> = {}
): SessionMetadata {
  return {
    id: "test-session-123",
    vaultId: "test-vault",
    vaultPath: "/tmp/test-vault",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastActiveAt: "2025-01-01T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

/**
 * Creates a mock async generator for SDK query results.
 */
function createMockQueryGenerator(
  sessionId: string,
  events: Array<{ type: string; [key: string]: unknown }> = []
) {
  const allEvents = [
    { type: "system", subtype: "init", session_id: sessionId },
    ...events.map((e) => ({ ...e, session_id: sessionId })),
  ];

  let index = 0;

  const generator = {
    next() {
      if (index < allEvents.length) {
        return Promise.resolve({ value: allEvents[index++], done: false as const });
      }
      return Promise.resolve({ value: undefined, done: true as const });
    },
    return() {
      return Promise.resolve({ value: undefined, done: true as const });
    },
    throw(e: Error) {
      return Promise.reject(e);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: mockInterrupt,
  };

  return generator;
}

// =============================================================================
// Environment Setup
// =============================================================================

describe("Session Manager", () => {
  let testDir: string;
  let sessionsDir: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(
      tmpdir(),
      `session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    // Set HOME to test directory for sessions storage
    process.env.HOME = testDir;
    sessionsDir = join(testDir, SESSIONS_DIR);

    // Reset mocks
    mockQuery.mockReset();
    mockInterrupt.mockReset();
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Error Mapping Tests
  // ===========================================================================

  describe("mapSdkError", () => {
    test("maps ENOENT to executable not found message", () => {
      const error = new Error("spawn ENOENT");
      expect(mapSdkError(error)).toContain("executable not found");
    });

    test("maps EACCES to permission denied message", () => {
      const error = new Error("EACCES permission denied");
      expect(mapSdkError(error)).toContain("Permission denied");
    });

    test("maps authentication error", () => {
      const error = new Error("authentication failed");
      expect(mapSdkError(error)).toContain("Authentication");
    });

    test("maps rate_limit error", () => {
      const error = new Error("rate_limit exceeded");
      expect(mapSdkError(error)).toContain("Rate limit");
    });

    test("maps billing error", () => {
      const error = new Error("billing error occurred");
      expect(mapSdkError(error)).toContain("Billing");
    });

    test("maps invalid_request error", () => {
      const error = new Error("invalid_request");
      expect(mapSdkError(error)).toContain("Invalid request");
    });

    test("maps server_error", () => {
      const error = new Error("server_error");
      expect(mapSdkError(error)).toContain("Server error");
    });

    test("returns original message for unknown errors", () => {
      const error = new Error("Something specific happened");
      expect(mapSdkError(error)).toBe("Something specific happened");
    });

    test("handles non-Error objects", () => {
      expect(mapSdkError("string error")).toContain("unknown error");
      expect(mapSdkError(null)).toContain("unknown error");
      expect(mapSdkError(undefined)).toContain("unknown error");
    });
  });

  // ===========================================================================
  // SessionError Tests
  // ===========================================================================

  describe("SessionError", () => {
    test("has correct name", () => {
      const error = new SessionError("test", "SESSION_NOT_FOUND");
      expect(error.name).toBe("SessionError");
    });

    test("has correct code", () => {
      const error = new SessionError("test", "SDK_ERROR");
      expect(error.code).toBe("SDK_ERROR");
    });

    test("is instance of Error", () => {
      const error = new SessionError("test", "STORAGE_ERROR");
      expect(error).toBeInstanceOf(Error);
    });

    test("preserves message", () => {
      const error = new SessionError("Custom message", "SESSION_INVALID");
      expect(error.message).toBe("Custom message");
    });
  });

  // ===========================================================================
  // Directory Management Tests
  // ===========================================================================

  describe("getSessionsDir", () => {
    test("creates sessions directory if missing", async () => {
      const dir = await getSessionsDir();
      expect(dir).toBe(sessionsDir);

      // Verify directory was created
      const { stat } = await import("node:fs/promises");
      const stats = await stat(dir);
      expect(stats.isDirectory()).toBe(true);
    });

    test("returns existing directory", async () => {
      await mkdir(sessionsDir, { recursive: true });
      const dir = await getSessionsDir();
      expect(dir).toBe(sessionsDir);
    });

    test("falls back to cwd when HOME is not set", async () => {
      delete process.env.HOME;
      const originalCwd = process.cwd();

      // Temporarily change to test dir
      process.chdir(testDir);
      try {
        const dir = await getSessionsDir();
        expect(dir).toBe(join(testDir, SESSIONS_DIR));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("getSessionFilePath", () => {
    test("returns correct path", async () => {
      const path = await getSessionFilePath("session-abc");
      expect(path).toBe(join(sessionsDir, "session-abc.json"));
    });

    test("creates sessions directory", async () => {
      await getSessionFilePath("any-session");

      const { stat } = await import("node:fs/promises");
      const stats = await stat(sessionsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test("rejects path traversal with ../", async () => {
      try {
        await getSessionFilePath("../../../etc/passwd");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("rejects path traversal with forward slashes", async () => {
      try {
        await getSessionFilePath("foo/bar/baz");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("rejects path traversal with backslashes", async () => {
      try {
        await getSessionFilePath("foo\\bar\\baz");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("rejects empty session ID", async () => {
      try {
        await getSessionFilePath("");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("rejects very long session ID", async () => {
      try {
        await getSessionFilePath("a".repeat(300));
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("allows valid UUID-style session IDs", async () => {
      const path = await getSessionFilePath("550e8400-e29b-41d4-a716-446655440000");
      expect(path).toBe(join(sessionsDir, "550e8400-e29b-41d4-a716-446655440000.json"));
    });

    test("allows alphanumeric with underscores and dots", async () => {
      const path = await getSessionFilePath("session_v2.1_test");
      expect(path).toBe(join(sessionsDir, "session_v2.1_test.json"));
    });
  });

  // ===========================================================================
  // Session Persistence Tests
  // ===========================================================================

  describe("saveSession", () => {
    test("saves session metadata to JSON file", async () => {
      const metadata = createMockMetadata();
      await saveSession(metadata);

      const filePath = join(sessionsDir, `${metadata.id}.json`);
      const content = await readFile(filePath, "utf-8");
      const saved = JSON.parse(content) as SessionMetadata;

      expect(saved.id).toBe(metadata.id);
      expect(saved.vaultId).toBe(metadata.vaultId);
      expect(saved.vaultPath).toBe(metadata.vaultPath);
    });

    test("overwrites existing session", async () => {
      const metadata = createMockMetadata();
      await saveSession(metadata);

      metadata.lastActiveAt = "2025-06-15T12:00:00.000Z";
      await saveSession(metadata);

      const filePath = join(sessionsDir, `${metadata.id}.json`);
      const content = await readFile(filePath, "utf-8");
      const saved = JSON.parse(content) as SessionMetadata;

      expect(saved.lastActiveAt).toBe("2025-06-15T12:00:00.000Z");
    });

    test("formats JSON with indentation", async () => {
      const metadata = createMockMetadata();
      await saveSession(metadata);

      const filePath = join(sessionsDir, `${metadata.id}.json`);
      const content = await readFile(filePath, "utf-8");

      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });
  });

  describe("loadSession", () => {
    test("returns null for non-existent session", async () => {
      const result = await loadSession("non-existent-id");
      expect(result).toBeNull();
    });

    test("loads existing session", async () => {
      const metadata = createMockMetadata();
      await saveSession(metadata);

      const loaded = await loadSession(metadata.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(metadata.id);
      expect(loaded!.vaultId).toBe(metadata.vaultId);
      expect(loaded!.vaultPath).toBe(metadata.vaultPath);
      expect(loaded!.createdAt).toBe(metadata.createdAt);
      expect(loaded!.lastActiveAt).toBe(metadata.lastActiveAt);
    });

    test("throws for invalid JSON", async () => {
      await mkdir(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "bad-json.json");
      await writeFile(filePath, "not valid json");

      try {
        await loadSession("bad-json");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });

    test("throws for missing required fields", async () => {
      await mkdir(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "missing-fields.json");
      await writeFile(filePath, JSON.stringify({ id: "test" }));

      try {
        await loadSession("missing-fields");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_INVALID");
      }
    });
  });

  describe("deleteSession", () => {
    test("returns false for non-existent session", async () => {
      const result = await deleteSession("non-existent");
      expect(result).toBe(false);
    });

    test("deletes existing session", async () => {
      const metadata = createMockMetadata();
      await saveSession(metadata);

      const result = await deleteSession(metadata.id);
      expect(result).toBe(true);

      const loaded = await loadSession(metadata.id);
      expect(loaded).toBeNull();
    });
  });

  describe("listSessionsByVault", () => {
    test("returns empty array for non-existent directory", async () => {
      const sessions = await listSessionsByVault("any-vault");
      expect(sessions).toEqual([]);
    });

    test("returns sessions for matching vault", async () => {
      await saveSession(createMockMetadata({ id: "session-1", vaultId: "vault-a" }));
      await saveSession(createMockMetadata({ id: "session-2", vaultId: "vault-a" }));
      await saveSession(createMockMetadata({ id: "session-3", vaultId: "vault-b" }));

      const sessions = await listSessionsByVault("vault-a");

      expect(sessions).toHaveLength(2);
      expect(sessions).toContain("session-1");
      expect(sessions).toContain("session-2");
      expect(sessions).not.toContain("session-3");
    });

    test("ignores non-JSON files", async () => {
      await saveSession(createMockMetadata({ id: "valid", vaultId: "vault-a" }));
      await writeFile(join(sessionsDir, "not-a-session.txt"), "text content");

      const sessions = await listSessionsByVault("vault-a");

      expect(sessions).toHaveLength(1);
      expect(sessions).toContain("valid");
    });
  });

  describe("getRecentSessions", () => {
    test("returns empty array for non-existent directory", async () => {
      const sessions = await getRecentSessions("any-vault");
      expect(sessions).toEqual([]);
    });

    test("returns sessions sorted by last activity (most recent first)", async () => {
      await saveSession(createMockMetadata({
        id: "old-session",
        vaultId: "vault-a",
        lastActiveAt: "2025-01-01T00:00:00.000Z",
        messages: [{ id: "1", role: "user", content: "Old message", timestamp: "2025-01-01T00:00:00.000Z" }],
      }));
      await saveSession(createMockMetadata({
        id: "new-session",
        vaultId: "vault-a",
        lastActiveAt: "2025-06-15T12:00:00.000Z",
        messages: [{ id: "2", role: "user", content: "New message", timestamp: "2025-06-15T12:00:00.000Z" }],
      }));
      await saveSession(createMockMetadata({
        id: "mid-session",
        vaultId: "vault-a",
        lastActiveAt: "2025-03-10T08:00:00.000Z",
        messages: [{ id: "3", role: "user", content: "Mid message", timestamp: "2025-03-10T08:00:00.000Z" }],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions).toHaveLength(3);
      expect(sessions[0].sessionId).toBe("new-session");
      expect(sessions[1].sessionId).toBe("mid-session");
      expect(sessions[2].sessionId).toBe("old-session");
    });

    test("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await saveSession(createMockMetadata({
          id: `session-${i}`,
          vaultId: "vault-a",
          lastActiveAt: new Date(2025, 0, i + 1).toISOString(),
          messages: [{ id: `${i}`, role: "user", content: `Message ${i}`, timestamp: new Date().toISOString() }],
        }));
      }

      const sessions = await getRecentSessions("vault-a", 3);

      expect(sessions).toHaveLength(3);
    });

    test("filters by vault ID", async () => {
      await saveSession(createMockMetadata({
        id: "vault-a-session",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: "A message", timestamp: new Date().toISOString() }],
      }));
      await saveSession(createMockMetadata({
        id: "vault-b-session",
        vaultId: "vault-b",
        messages: [{ id: "2", role: "user", content: "B message", timestamp: new Date().toISOString() }],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("vault-a-session");
    });

    test("ignores sessions with no messages", async () => {
      await saveSession(createMockMetadata({
        id: "has-messages",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: "Hello", timestamp: new Date().toISOString() }],
      }));
      await saveSession(createMockMetadata({
        id: "no-messages",
        vaultId: "vault-a",
        messages: [],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("has-messages");
    });

    test("uses first user message as preview", async () => {
      await saveSession(createMockMetadata({
        id: "preview-test",
        vaultId: "vault-a",
        messages: [
          { id: "1", role: "user", content: "First user question", timestamp: new Date().toISOString() },
          { id: "2", role: "assistant", content: "Response", timestamp: new Date().toISOString() },
          { id: "3", role: "user", content: "Second question", timestamp: new Date().toISOString() },
        ],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions[0].preview).toBe("First user question");
    });

    test("truncates long previews to 100 characters", async () => {
      const longMessage = "A".repeat(150);
      await saveSession(createMockMetadata({
        id: "long-preview",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: longMessage, timestamp: new Date().toISOString() }],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions[0].preview.length).toBe(100);
      expect(sessions[0].preview.endsWith("…")).toBe(true);
    });

    test("uses first line only for preview", async () => {
      await saveSession(createMockMetadata({
        id: "multiline-preview",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: "First line\nSecond line\nThird line", timestamp: new Date().toISOString() }],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions[0].preview).toBe("First line");
    });

    test("returns messageCount correctly", async () => {
      await saveSession(createMockMetadata({
        id: "count-test",
        vaultId: "vault-a",
        messages: [
          { id: "1", role: "user", content: "Q1", timestamp: new Date().toISOString() },
          { id: "2", role: "assistant", content: "A1", timestamp: new Date().toISOString() },
          { id: "3", role: "user", content: "Q2", timestamp: new Date().toISOString() },
        ],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions[0].messageCount).toBe(3);
    });

    test("formats time and date from lastActiveAt", async () => {
      await saveSession(createMockMetadata({
        id: "time-test",
        vaultId: "vault-a",
        lastActiveAt: "2025-06-15T14:30:00.000Z",
        messages: [{ id: "1", role: "user", content: "Hello", timestamp: new Date().toISOString() }],
      }));

      const sessions = await getRecentSessions("vault-a");

      // Time and date will be in local timezone, so we just verify they're strings
      expect(typeof sessions[0].time).toBe("string");
      expect(typeof sessions[0].date).toBe("string");
      expect(sessions[0].time).toMatch(/^\d{2}:\d{2}$/);
      expect(sessions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("handles corrupted session files gracefully", async () => {
      await saveSession(createMockMetadata({
        id: "valid-session",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: "Hello", timestamp: new Date().toISOString() }],
      }));
      await writeFile(join(sessionsDir, "corrupted.json"), "not valid json");

      // Should not throw, should return valid sessions
      const sessions = await getRecentSessions("vault-a");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("valid-session");
    });

    test("ignores non-JSON files", async () => {
      await saveSession(createMockMetadata({
        id: "valid",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "user", content: "Hello", timestamp: new Date().toISOString() }],
      }));
      await writeFile(join(sessionsDir, "not-a-session.txt"), "text content");

      const sessions = await getRecentSessions("vault-a");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("valid");
    });

    test("returns 'Discussion' as preview when no user messages", async () => {
      await saveSession(createMockMetadata({
        id: "assistant-only",
        vaultId: "vault-a",
        messages: [{ id: "1", role: "assistant", content: "Hello", timestamp: new Date().toISOString() }],
      }));

      const sessions = await getRecentSessions("vault-a");

      expect(sessions[0].preview).toBe("Discussion");
    });
  });

  describe("touchSession", () => {
    test("updates lastActiveAt timestamp", async () => {
      const metadata = createMockMetadata({
        lastActiveAt: "2025-01-01T00:00:00.000Z",
      });
      await saveSession(metadata);

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await touchSession(metadata.id);

      const loaded = await loadSession(metadata.id);
      expect(loaded!.lastActiveAt).not.toBe("2025-01-01T00:00:00.000Z");
    });

    test("does nothing for non-existent session", async () => {
      // Should not throw
      await touchSession("non-existent");
    });
  });

  // ===========================================================================
  // SDK Integration Tests (with mocks)
  // ===========================================================================

  describe("createSession", () => {
    test("calls SDK query with correct options", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("new-session-id");
      mockQuery.mockReturnValue(mockGenerator);

      await createSession(vault, "Hello");

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { prompt: string; options: { cwd: string; settingSources: string[]; resume?: string } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.prompt).toBe("Hello");
      expect(callArgs!.options.cwd).toBe(vault.path);
      expect(callArgs!.options.settingSources).toEqual(["project", "user"]);
      expect(callArgs!.options.resume).toBeUndefined();
    });

    test("saves session metadata", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("saved-session-id");
      mockQuery.mockReturnValue(mockGenerator);

      const result = await createSession(vault, "Hello");

      expect(result.sessionId).toBe("saved-session-id");

      const loaded = await loadSession("saved-session-id");
      expect(loaded).not.toBeNull();
      expect(loaded!.vaultId).toBe(vault.id);
      expect(loaded!.vaultPath).toBe(vault.path);
    });

    test("returns event generator", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("session-with-events", [
        { type: "assistant", content: "Hi there" },
      ]);
      mockQuery.mockReturnValue(mockGenerator);

      const result = await createSession(vault, "Hello");

      // Consume events
      const events: unknown[] = [];
      for await (const event of result.events) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty("type", "system");
    });

    test("throws SessionError on SDK failure", async () => {
      const vault = createMockVault();
      mockQuery.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      try {
        await createSession(vault, "Hello");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SDK_ERROR");
      }
    });

    test("provides interrupt function", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("interruptible-session");
      mockQuery.mockReturnValue(mockGenerator);

      const result = await createSession(vault, "Hello");

      expect(typeof result.interrupt).toBe("function");
      await result.interrupt();
      expect(mockInterrupt).toHaveBeenCalled();
    });

    test("passes additional options to SDK", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("custom-options-session");
      mockQuery.mockReturnValue(mockGenerator);

      await createSession(vault, "Hello", { maxTurns: 5 });

      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { options: { maxTurns?: number } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.options.maxTurns).toBe(5);
    });
  });

  describe("resumeSession", () => {
    test("throws for non-existent session", async () => {
      try {
        await resumeSession("non-existent", "Continue");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("SESSION_NOT_FOUND");
      }
    });

    test("calls SDK query with resume option", async () => {
      const metadata = createMockMetadata({ id: "existing-session" });
      await saveSession(metadata);

      const mockGenerator = createMockQueryGenerator("existing-session");
      mockQuery.mockReturnValue(mockGenerator);

      await resumeSession("existing-session", "Continue");

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { prompt: string; options: { resume: string; cwd: string } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.prompt).toBe("Continue");
      expect(callArgs!.options.resume).toBe("existing-session");
      expect(callArgs!.options.cwd).toBe(metadata.vaultPath);
    });

    test("updates lastActiveAt on resume", async () => {
      const metadata = createMockMetadata({
        id: "resume-session",
        lastActiveAt: "2025-01-01T00:00:00.000Z",
      });
      await saveSession(metadata);

      const mockGenerator = createMockQueryGenerator("resume-session");
      mockQuery.mockReturnValue(mockGenerator);

      await resumeSession("resume-session", "Continue");

      const updated = await loadSession("resume-session");
      expect(updated!.lastActiveAt).not.toBe("2025-01-01T00:00:00.000Z");
    });
  });

  describe("querySession", () => {
    test("creates new session when no sessionId provided", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("auto-created-session");
      mockQuery.mockReturnValue(mockGenerator);

      const result = await querySession(vault, "Hello");

      expect(result.sessionId).toBe("auto-created-session");

      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { options: { resume?: string } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.options.resume).toBeUndefined();
    });

    test("resumes session when sessionId provided", async () => {
      const vault = createMockVault();
      const metadata = createMockMetadata({
        id: "existing-for-query",
        vaultId: vault.id,
        vaultPath: vault.path,
      });
      await saveSession(metadata);

      const mockGenerator = createMockQueryGenerator("existing-for-query");
      mockQuery.mockReturnValue(mockGenerator);

      const result = await querySession(vault, "Continue", "existing-for-query");

      expect(result.sessionId).toBe("existing-for-query");

      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { options: { resume: string } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.options.resume).toBe("existing-for-query");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    test("handles session ID with special characters", async () => {
      const metadata = createMockMetadata({ id: "session-with-uuid-abc123" });
      await saveSession(metadata);

      const loaded = await loadSession("session-with-uuid-abc123");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("session-with-uuid-abc123");
    });

    test("handles concurrent session saves", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        saveSession(createMockMetadata({ id: `concurrent-${i}`, vaultId: "vault-a" }))
      );

      await Promise.all(promises);

      const sessions = await listSessionsByVault("vault-a");
      expect(sessions).toHaveLength(10);
    });

    test("handles empty prompt", async () => {
      const vault = createMockVault();
      const mockGenerator = createMockQueryGenerator("empty-prompt-session");
      mockQuery.mockReturnValue(mockGenerator);

      const result = await createSession(vault, "");

      expect(result.sessionId).toBe("empty-prompt-session");
      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { prompt: string } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.prompt).toBe("");
    });

    test("preserves vault path with spaces", async () => {
      const vault = createMockVault({ path: "/path/with spaces/vault" });
      const mockGenerator = createMockQueryGenerator("spaces-session");
      mockQuery.mockReturnValue(mockGenerator);

      await createSession(vault, "Hello");

      const calls = mockQuery.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0]?.[0] as { options: { cwd: string } } | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs!.options.cwd).toBe("/path/with spaces/vault");
    });
  });
});
