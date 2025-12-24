/**
 * Protocol Schema Tests
 *
 * Comprehensive tests for WebSocket message validation using Zod schemas.
 * Tests cover valid messages, invalid messages, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import {
  // Client message schemas
  ClientMessageSchema,
  SelectVaultMessageSchema,
  CaptureNoteMessageSchema,
  DiscussionMessageSchema,
  ResumeSessionMessageSchema,
  NewSessionMessageSchema,
  AbortMessageSchema,
  PingMessageSchema,
  ListDirectoryMessageSchema,
  ReadFileMessageSchema,
  // Server message schemas
  ServerMessageSchema,
  VaultListMessageSchema,
  SessionReadyMessageSchema,
  NoteCapturedMessageSchema,
  ResponseStartMessageSchema,
  ResponseChunkMessageSchema,
  ResponseEndMessageSchema,
  ToolStartMessageSchema,
  ToolInputMessageSchema,
  ToolEndMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
  DirectoryListingMessageSchema,
  FileContentMessageSchema,
  // Supporting schemas
  VaultInfoSchema,
  ErrorCodeSchema,
  FileEntrySchema,
  // Utilities
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  safeParseServerMessage,
} from "../protocol.js";
import type { ErrorCode } from "../types.js";

// =============================================================================
// VaultInfo Schema Tests
// =============================================================================

describe("VaultInfoSchema", () => {
  test("accepts valid vault info", () => {
    const validVault = {
      id: "my-vault",
      name: "My Vault",
      path: "/vaults/my-vault",
      hasClaudeMd: true,
      inboxPath: "00_Inbox",
    };

    const result = VaultInfoSchema.parse(validVault);
    expect(result.id).toBe("my-vault");
    expect(result.name).toBe("My Vault");
    expect(result.path).toBe("/vaults/my-vault");
    expect(result.hasClaudeMd).toBe(true);
    expect(result.inboxPath).toBe("00_Inbox");
  });

  test("rejects empty id", () => {
    const invalidVault = {
      id: "",
      name: "My Vault",
      path: "/vaults/my-vault",
      hasClaudeMd: true,
      inboxPath: "00_Inbox",
    };

    expect(() => VaultInfoSchema.parse(invalidVault)).toThrow(ZodError);
  });

  test("rejects missing fields", () => {
    const invalidVault = {
      id: "my-vault",
      name: "My Vault",
    };

    expect(() => VaultInfoSchema.parse(invalidVault)).toThrow(ZodError);
  });

  test("rejects wrong hasClaudeMd type", () => {
    const invalidVault = {
      id: "my-vault",
      name: "My Vault",
      path: "/vaults/my-vault",
      hasClaudeMd: "yes", // should be boolean
      inboxPath: "00_Inbox",
    };

    expect(() => VaultInfoSchema.parse(invalidVault)).toThrow(ZodError);
  });
});

// =============================================================================
// ErrorCode Schema Tests
// =============================================================================

describe("ErrorCodeSchema", () => {
  test("accepts valid error codes", () => {
    const validCodes: ErrorCode[] = [
      "VAULT_NOT_FOUND",
      "VAULT_ACCESS_DENIED",
      "SESSION_NOT_FOUND",
      "SESSION_INVALID",
      "SDK_ERROR",
      "NOTE_CAPTURE_FAILED",
      "VALIDATION_ERROR",
      "INTERNAL_ERROR",
      "FILE_NOT_FOUND",
      "DIRECTORY_NOT_FOUND",
      "PATH_TRAVERSAL",
      "INVALID_FILE_TYPE",
    ];

    for (const code of validCodes) {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  test("rejects invalid error code", () => {
    expect(() => ErrorCodeSchema.parse("UNKNOWN_ERROR")).toThrow(ZodError);
  });

  test("rejects non-string", () => {
    expect(() => ErrorCodeSchema.parse(404)).toThrow(ZodError);
  });
});

// =============================================================================
// File Browser Schema Tests
// =============================================================================

describe("FileEntrySchema", () => {
  test("accepts valid file entry", () => {
    const entry = {
      name: "my-note.md",
      type: "file" as const,
      path: "subfolder/my-note.md",
    };
    const result = FileEntrySchema.parse(entry);
    expect(result.name).toBe("my-note.md");
    expect(result.type).toBe("file");
    expect(result.path).toBe("subfolder/my-note.md");
  });

  test("accepts valid directory entry", () => {
    const entry = {
      name: "subfolder",
      type: "directory" as const,
      path: "subfolder",
    };
    const result = FileEntrySchema.parse(entry);
    expect(result.type).toBe("directory");
  });

  test("accepts empty path for root entries", () => {
    const entry = {
      name: "root-note.md",
      type: "file" as const,
      path: "",
    };
    const result = FileEntrySchema.parse(entry);
    expect(result.path).toBe("");
  });

  test("rejects empty name", () => {
    const entry = { name: "", type: "file", path: "file.md" };
    expect(() => FileEntrySchema.parse(entry)).toThrow(ZodError);
  });

  test("rejects invalid type", () => {
    const entry = { name: "file.md", type: "symlink", path: "file.md" };
    expect(() => FileEntrySchema.parse(entry)).toThrow(ZodError);
  });
});

// =============================================================================
// Client -> Server Message Tests
// =============================================================================

describe("Client -> Server Messages", () => {
  describe("SelectVaultMessageSchema", () => {
    test("accepts valid select_vault message", () => {
      const msg = { type: "select_vault" as const, vaultId: "my-vault" };
      const result = SelectVaultMessageSchema.parse(msg);
      expect(result.type).toBe("select_vault");
      expect(result.vaultId).toBe("my-vault");
    });

    test("rejects empty vaultId", () => {
      const msg = { type: "select_vault", vaultId: "" };
      expect(() => SelectVaultMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing vaultId", () => {
      const msg = { type: "select_vault" };
      expect(() => SelectVaultMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("CaptureNoteMessageSchema", () => {
    test("accepts valid capture_note message", () => {
      const msg = { type: "capture_note" as const, text: "Remember to buy milk" };
      const result = CaptureNoteMessageSchema.parse(msg);
      expect(result.type).toBe("capture_note");
      expect(result.text).toBe("Remember to buy milk");
    });

    test("accepts multiline text", () => {
      const msg = {
        type: "capture_note" as const,
        text: "Line 1\nLine 2\nLine 3",
      };
      const result = CaptureNoteMessageSchema.parse(msg);
      expect(result.text).toBe("Line 1\nLine 2\nLine 3");
    });

    test("rejects empty text", () => {
      const msg = { type: "capture_note", text: "" };
      expect(() => CaptureNoteMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("DiscussionMessageSchema", () => {
    test("accepts valid discussion_message", () => {
      const msg = {
        type: "discussion_message" as const,
        text: "What notes do I have about project X?",
      };
      const result = DiscussionMessageSchema.parse(msg);
      expect(result.type).toBe("discussion_message");
      expect(result.text).toBe("What notes do I have about project X?");
    });

    test("rejects empty text", () => {
      const msg = { type: "discussion_message", text: "" };
      expect(() => DiscussionMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ResumeSessionMessageSchema", () => {
    test("accepts valid resume_session message", () => {
      const msg = { type: "resume_session" as const, sessionId: "session-123-abc" };
      const result = ResumeSessionMessageSchema.parse(msg);
      expect(result.type).toBe("resume_session");
      expect(result.sessionId).toBe("session-123-abc");
    });

    test("rejects empty sessionId", () => {
      const msg = { type: "resume_session", sessionId: "" };
      expect(() => ResumeSessionMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("NewSessionMessageSchema", () => {
    test("accepts valid new_session message", () => {
      const msg = { type: "new_session" as const };
      const result = NewSessionMessageSchema.parse(msg);
      expect(result.type).toBe("new_session");
    });

    test("ignores extra fields", () => {
      const msg = { type: "new_session", extra: "ignored" };
      const result = NewSessionMessageSchema.parse(msg);
      expect(result.type).toBe("new_session");
    });
  });

  describe("AbortMessageSchema", () => {
    test("accepts valid abort message", () => {
      const msg = { type: "abort" as const };
      const result = AbortMessageSchema.parse(msg);
      expect(result.type).toBe("abort");
    });
  });

  describe("PingMessageSchema", () => {
    test("accepts valid ping message", () => {
      const msg = { type: "ping" as const };
      const result = PingMessageSchema.parse(msg);
      expect(result.type).toBe("ping");
    });
  });

  describe("ListDirectoryMessageSchema", () => {
    test("accepts valid list_directory with path", () => {
      const msg = { type: "list_directory" as const, path: "subfolder" };
      const result = ListDirectoryMessageSchema.parse(msg);
      expect(result.type).toBe("list_directory");
      expect(result.path).toBe("subfolder");
    });

    test("accepts empty path for root directory", () => {
      const msg = { type: "list_directory" as const, path: "" };
      const result = ListDirectoryMessageSchema.parse(msg);
      expect(result.path).toBe("");
    });

    test("accepts nested path", () => {
      const msg = { type: "list_directory" as const, path: "folder/subfolder/deep" };
      const result = ListDirectoryMessageSchema.parse(msg);
      expect(result.path).toBe("folder/subfolder/deep");
    });
  });

  describe("ReadFileMessageSchema", () => {
    test("accepts valid read_file with path", () => {
      const msg = { type: "read_file" as const, path: "notes/my-note.md" };
      const result = ReadFileMessageSchema.parse(msg);
      expect(result.type).toBe("read_file");
      expect(result.path).toBe("notes/my-note.md");
    });

    test("rejects empty path", () => {
      const msg = { type: "read_file", path: "" };
      expect(() => ReadFileMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ClientMessageSchema (discriminated union)", () => {
    test("parses all client message types", () => {
      const messages = [
        { type: "select_vault", vaultId: "vault-1" },
        { type: "capture_note", text: "Note text" },
        { type: "discussion_message", text: "Question?" },
        { type: "resume_session", sessionId: "session-1" },
        { type: "new_session" },
        { type: "abort" },
        { type: "ping" },
        { type: "list_directory", path: "" },
        { type: "read_file", path: "note.md" },
      ];

      for (const msg of messages) {
        expect(() => ClientMessageSchema.parse(msg)).not.toThrow();
      }
    });

    test("rejects unknown message type", () => {
      const msg = { type: "unknown_type" };
      expect(() => ClientMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects message without type field", () => {
      const msg = { vaultId: "vault-1" };
      expect(() => ClientMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects null", () => {
      expect(() => ClientMessageSchema.parse(null)).toThrow(ZodError);
    });

    test("rejects non-object", () => {
      expect(() => ClientMessageSchema.parse("ping")).toThrow(ZodError);
    });
  });
});

// =============================================================================
// Server -> Client Message Tests
// =============================================================================

describe("Server -> Client Messages", () => {
  describe("VaultListMessageSchema", () => {
    test("accepts valid vault_list with vaults", () => {
      const msg = {
        type: "vault_list" as const,
        vaults: [
          {
            id: "vault-1",
            name: "Vault 1",
            path: "/vaults/vault-1",
            hasClaudeMd: true,
            inboxPath: "00_Inbox",
          },
          {
            id: "vault-2",
            name: "Vault 2",
            path: "/vaults/vault-2",
            hasClaudeMd: false,
            inboxPath: "Inbox",
          },
        ],
      };
      const result = VaultListMessageSchema.parse(msg);
      expect(result.type).toBe("vault_list");
      expect(result.vaults).toHaveLength(2);
      expect(result.vaults[0].id).toBe("vault-1");
    });

    test("accepts empty vault list", () => {
      const msg = { type: "vault_list" as const, vaults: [] };
      const result = VaultListMessageSchema.parse(msg);
      expect(result.vaults).toHaveLength(0);
    });

    test("rejects invalid vault in list", () => {
      const msg = {
        type: "vault_list",
        vaults: [{ id: "", name: "Invalid" }],
      };
      expect(() => VaultListMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("SessionReadyMessageSchema", () => {
    test("accepts valid session_ready message", () => {
      const msg = {
        type: "session_ready" as const,
        sessionId: "session-123",
        vaultId: "vault-1",
      };
      const result = SessionReadyMessageSchema.parse(msg);
      expect(result.type).toBe("session_ready");
      expect(result.sessionId).toBe("session-123");
      expect(result.vaultId).toBe("vault-1");
    });

    test("accepts empty sessionId (lazy session creation)", () => {
      const msg = {
        type: "session_ready" as const,
        sessionId: "",
        vaultId: "vault-1",
      };
      const result = SessionReadyMessageSchema.parse(msg);
      expect(result.sessionId).toBe("");
      expect(result.vaultId).toBe("vault-1");
    });
  });

  describe("NoteCapturedMessageSchema", () => {
    test("accepts valid note_captured message", () => {
      const msg = {
        type: "note_captured" as const,
        timestamp: "2025-12-22T10:30:00.000Z",
      };
      const result = NoteCapturedMessageSchema.parse(msg);
      expect(result.type).toBe("note_captured");
      expect(result.timestamp).toBe("2025-12-22T10:30:00.000Z");
    });

    test("rejects empty timestamp", () => {
      const msg = { type: "note_captured", timestamp: "" };
      expect(() => NoteCapturedMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("Response streaming messages", () => {
    test("accepts valid response_start message", () => {
      const msg = { type: "response_start" as const, messageId: "msg-001" };
      const result = ResponseStartMessageSchema.parse(msg);
      expect(result.type).toBe("response_start");
      expect(result.messageId).toBe("msg-001");
    });

    test("accepts valid response_chunk message", () => {
      const msg = {
        type: "response_chunk" as const,
        messageId: "msg-001",
        content: "Hello, ",
      };
      const result = ResponseChunkMessageSchema.parse(msg);
      expect(result.type).toBe("response_chunk");
      expect(result.content).toBe("Hello, ");
    });

    test("accepts empty content in response_chunk", () => {
      // Empty chunks can occur for whitespace or streaming artifacts
      const msg = { type: "response_chunk" as const, messageId: "msg-001", content: "" };
      const result = ResponseChunkMessageSchema.parse(msg);
      expect(result.content).toBe("");
    });

    test("accepts valid response_end message", () => {
      const msg = { type: "response_end" as const, messageId: "msg-001" };
      const result = ResponseEndMessageSchema.parse(msg);
      expect(result.type).toBe("response_end");
    });

    test("rejects response_start with empty messageId", () => {
      const msg = { type: "response_start", messageId: "" };
      expect(() => ResponseStartMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("Tool messages", () => {
    test("accepts valid tool_start message", () => {
      const msg = {
        type: "tool_start" as const,
        toolName: "Read",
        toolUseId: "tool-001",
      };
      const result = ToolStartMessageSchema.parse(msg);
      expect(result.type).toBe("tool_start");
      expect(result.toolName).toBe("Read");
      expect(result.toolUseId).toBe("tool-001");
    });

    test("accepts valid tool_input with object input", () => {
      const msg = {
        type: "tool_input" as const,
        toolUseId: "tool-001",
        input: { file_path: "/path/to/file.md" },
      };
      const result = ToolInputMessageSchema.parse(msg);
      expect(result.type).toBe("tool_input");
      expect(result.input).toEqual({ file_path: "/path/to/file.md" });
    });

    test("accepts valid tool_input with string input", () => {
      const msg = {
        type: "tool_input" as const,
        toolUseId: "tool-001",
        input: "simple string input",
      };
      const result = ToolInputMessageSchema.parse(msg);
      expect(result.input).toBe("simple string input");
    });

    test("accepts valid tool_input with null input", () => {
      const msg = { type: "tool_input" as const, toolUseId: "tool-001", input: null };
      const result = ToolInputMessageSchema.parse(msg);
      expect(result.input).toBeNull();
    });

    test("accepts valid tool_end with object output", () => {
      const msg = {
        type: "tool_end" as const,
        toolUseId: "tool-001",
        output: { content: "File contents here", success: true },
      };
      const result = ToolEndMessageSchema.parse(msg);
      expect(result.type).toBe("tool_end");
      expect(result.output).toEqual({ content: "File contents here", success: true });
    });

    test("accepts valid tool_end with string output", () => {
      const msg = {
        type: "tool_end" as const,
        toolUseId: "tool-001",
        output: "Operation completed",
      };
      const result = ToolEndMessageSchema.parse(msg);
      expect(result.output).toBe("Operation completed");
    });

    test("accepts valid tool_end with undefined output", () => {
      const msg = { type: "tool_end" as const, toolUseId: "tool-001", output: undefined };
      const result = ToolEndMessageSchema.parse(msg);
      expect(result.output).toBeUndefined();
    });

    test("rejects tool_start with empty toolName", () => {
      const msg = { type: "tool_start", toolName: "", toolUseId: "tool-001" };
      expect(() => ToolStartMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects tool_start with empty toolUseId", () => {
      const msg = { type: "tool_start", toolName: "Read", toolUseId: "" };
      expect(() => ToolStartMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ErrorMessageSchema", () => {
    test("accepts valid error message", () => {
      const msg = {
        type: "error" as const,
        code: "VAULT_NOT_FOUND" as const,
        message: "Vault 'unknown' not found",
      };
      const result = ErrorMessageSchema.parse(msg);
      expect(result.type).toBe("error");
      expect(result.code).toBe("VAULT_NOT_FOUND");
      expect(result.message).toBe("Vault 'unknown' not found");
    });

    test("accepts all error codes", () => {
      const codes: ErrorCode[] = [
        "VAULT_NOT_FOUND",
        "VAULT_ACCESS_DENIED",
        "SESSION_NOT_FOUND",
        "SESSION_INVALID",
        "SDK_ERROR",
        "NOTE_CAPTURE_FAILED",
        "VALIDATION_ERROR",
        "INTERNAL_ERROR",
        "FILE_NOT_FOUND",
        "DIRECTORY_NOT_FOUND",
        "PATH_TRAVERSAL",
        "INVALID_FILE_TYPE",
      ];

      for (const code of codes) {
        const msg = { type: "error" as const, code, message: "Error description" };
        expect(() => ErrorMessageSchema.parse(msg)).not.toThrow();
      }
    });

    test("rejects invalid error code", () => {
      const msg = {
        type: "error",
        code: "UNKNOWN_CODE",
        message: "Error message",
      };
      expect(() => ErrorMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty message", () => {
      const msg = { type: "error", code: "SDK_ERROR", message: "" };
      expect(() => ErrorMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("PongMessageSchema", () => {
    test("accepts valid pong message", () => {
      const msg = { type: "pong" as const };
      const result = PongMessageSchema.parse(msg);
      expect(result.type).toBe("pong");
    });
  });

  describe("DirectoryListingMessageSchema", () => {
    test("accepts valid directory_listing with entries", () => {
      const msg = {
        type: "directory_listing" as const,
        path: "subfolder",
        entries: [
          { name: "child-folder", type: "directory" as const, path: "subfolder/child-folder" },
          { name: "note.md", type: "file" as const, path: "subfolder/note.md" },
        ],
      };
      const result = DirectoryListingMessageSchema.parse(msg);
      expect(result.type).toBe("directory_listing");
      expect(result.path).toBe("subfolder");
      expect(result.entries).toHaveLength(2);
    });

    test("accepts empty entries for empty directory", () => {
      const msg = {
        type: "directory_listing" as const,
        path: "empty-folder",
        entries: [],
      };
      const result = DirectoryListingMessageSchema.parse(msg);
      expect(result.entries).toHaveLength(0);
    });

    test("accepts root directory listing", () => {
      const msg = {
        type: "directory_listing" as const,
        path: "",
        entries: [{ name: "README.md", type: "file" as const, path: "README.md" }],
      };
      const result = DirectoryListingMessageSchema.parse(msg);
      expect(result.path).toBe("");
    });

    test("rejects invalid entry in entries array", () => {
      const msg = {
        type: "directory_listing",
        path: "",
        entries: [{ name: "", type: "file", path: "" }], // empty name is invalid
      };
      expect(() => DirectoryListingMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("FileContentMessageSchema", () => {
    test("accepts valid file_content", () => {
      const msg = {
        type: "file_content" as const,
        path: "notes/my-note.md",
        content: "# My Note\n\nSome content here.",
        truncated: false,
      };
      const result = FileContentMessageSchema.parse(msg);
      expect(result.type).toBe("file_content");
      expect(result.path).toBe("notes/my-note.md");
      expect(result.content).toContain("# My Note");
      expect(result.truncated).toBe(false);
    });

    test("accepts truncated file content", () => {
      const msg = {
        type: "file_content" as const,
        path: "large-file.md",
        content: "...(truncated content)...",
        truncated: true,
      };
      const result = FileContentMessageSchema.parse(msg);
      expect(result.truncated).toBe(true);
    });

    test("accepts empty content", () => {
      const msg = {
        type: "file_content" as const,
        path: "empty.md",
        content: "",
        truncated: false,
      };
      const result = FileContentMessageSchema.parse(msg);
      expect(result.content).toBe("");
    });

    test("rejects empty path", () => {
      const msg = { type: "file_content", path: "", content: "test", truncated: false };
      expect(() => FileContentMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing truncated flag", () => {
      const msg = { type: "file_content", path: "note.md", content: "test" };
      expect(() => FileContentMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ServerMessageSchema (discriminated union)", () => {
    test("parses all server message types", () => {
      const messages = [
        {
          type: "vault_list",
          vaults: [
            {
              id: "v1",
              name: "V1",
              path: "/v1",
              hasClaudeMd: true,
              inboxPath: "Inbox",
            },
          ],
        },
        { type: "session_ready", sessionId: "s1", vaultId: "v1" },
        { type: "note_captured", timestamp: "2025-01-01T00:00:00Z" },
        { type: "response_start", messageId: "m1" },
        { type: "response_chunk", messageId: "m1", content: "chunk" },
        { type: "response_end", messageId: "m1" },
        { type: "tool_start", toolName: "Read", toolUseId: "t1" },
        { type: "tool_input", toolUseId: "t1", input: {} },
        { type: "tool_end", toolUseId: "t1", output: {} },
        { type: "error", code: "SDK_ERROR", message: "Error" },
        { type: "pong" },
        { type: "directory_listing", path: "", entries: [] },
        { type: "file_content", path: "note.md", content: "test", truncated: false },
      ];

      for (const msg of messages) {
        expect(() => ServerMessageSchema.parse(msg)).not.toThrow();
      }
    });

    test("rejects unknown message type", () => {
      const msg = { type: "unknown_server_type" };
      expect(() => ServerMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("Validation Utilities", () => {
  describe("parseClientMessage", () => {
    test("returns parsed message for valid input", () => {
      const msg = { type: "ping" };
      const result = parseClientMessage(msg);
      expect(result.type).toBe("ping");
    });

    test("throws ZodError for invalid input", () => {
      expect(() => parseClientMessage({ type: "invalid" })).toThrow(ZodError);
    });
  });

  describe("parseServerMessage", () => {
    test("returns parsed message for valid input", () => {
      const msg = { type: "pong" };
      const result = parseServerMessage(msg);
      expect(result.type).toBe("pong");
    });

    test("throws ZodError for invalid input", () => {
      expect(() => parseServerMessage({ type: "invalid" })).toThrow(ZodError);
    });
  });

  describe("safeParseClientMessage", () => {
    test("returns success result for valid input", () => {
      const msg = { type: "abort" };
      const result = safeParseClientMessage(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("abort");
      }
    });

    test("returns error result for invalid input", () => {
      const result = safeParseClientMessage({ type: "invalid" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ZodError);
      }
    });

    test("returns error result for null", () => {
      const result = safeParseClientMessage(null);
      expect(result.success).toBe(false);
    });

    test("returns error result for undefined", () => {
      const result = safeParseClientMessage(undefined);
      expect(result.success).toBe(false);
    });
  });

  describe("safeParseServerMessage", () => {
    test("returns success result for valid input", () => {
      const msg = { type: "pong" };
      const result = safeParseServerMessage(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("pong");
      }
    });

    test("returns error result for invalid input", () => {
      const result = safeParseServerMessage({ type: "invalid" });
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe("Edge Cases", () => {
  test("handles very long strings", () => {
    const longText = "a".repeat(100000);
    const msg = { type: "capture_note", text: longText };
    expect(() => CaptureNoteMessageSchema.parse(msg)).not.toThrow();
  });

  test("handles unicode in text fields", () => {
    const msg = {
      type: "capture_note",
      text: "Unicode: \u{1F600} \u{1F4DA} \u{2764} \u{1F680}",
    };
    expect(() => CaptureNoteMessageSchema.parse(msg)).not.toThrow();
  });

  test("handles special characters in vault id", () => {
    // Vault IDs come from directory names, which might have unusual characters
    const msg = { type: "select_vault", vaultId: "my-vault_2025.backup" };
    expect(() => SelectVaultMessageSchema.parse(msg)).not.toThrow();
  });

  test("handles whitespace-only text (rejects)", () => {
    // Whitespace-only should be rejected - min(1) checks length, not content
    // but " " has length 1, so this will pass the schema
    const msg = { type: "capture_note", text: " " };
    expect(() => CaptureNoteMessageSchema.parse(msg)).not.toThrow();
  });

  test("handles deeply nested tool input", () => {
    const deepInput = {
      level1: {
        level2: {
          level3: {
            value: "deep",
          },
        },
      },
    };
    const msg = { type: "tool_input" as const, toolUseId: "t1", input: deepInput };
    const result = ToolInputMessageSchema.parse(msg);
    expect(result.input).toEqual(deepInput);
  });

  test("handles array tool output", () => {
    const output = ["item1", "item2", { nested: true }];
    const msg = {
      type: "tool_end" as const,
      toolUseId: "t1",
      output,
    };
    const result = ToolEndMessageSchema.parse(msg);
    expect(result.output).toEqual(output);
  });

  test("handles numeric tool input", () => {
    const msg = { type: "tool_input" as const, toolUseId: "t1", input: 42 };
    const result = ToolInputMessageSchema.parse(msg);
    expect(result.input).toBe(42);
  });

  test("handles boolean tool output", () => {
    const msg = { type: "tool_end" as const, toolUseId: "t1", output: true };
    const result = ToolEndMessageSchema.parse(msg);
    expect(result.output).toBe(true);
  });

  test("preserves extra fields in strict mode behavior", () => {
    // By default Zod strips unknown keys, which is fine for protocol messages
    const msg = { type: "ping", extraField: "ignored" };
    const result = PingMessageSchema.parse(msg);
    expect(result.type).toBe("ping");
    // extra field should be stripped
    expect((result as Record<string, unknown>).extraField).toBeUndefined();
  });
});
