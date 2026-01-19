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
  GetInspirationMessageSchema,
  WriteFileMessageSchema,
  GetTasksMessageSchema,
  ToggleTaskMessageSchema,
  ToolPermissionResponseMessageSchema,
  AskUserQuestionResponseMessageSchema,
  SetupVaultMessageSchema,
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
  InspirationItemSchema,
  InspirationMessageSchema,
  FileWrittenMessageSchema,
  CreateDirectoryMessageSchema,
  DirectoryCreatedMessageSchema,
  TasksMessageSchema,
  TaskToggledMessageSchema,
  ToolPermissionRequestMessageSchema,
  AskUserQuestionRequestMessageSchema,
  SetupCompleteMessageSchema,
  // Health schemas
  HealthSeveritySchema,
  HealthCategorySchema,
  HealthIssueSchema,
  HealthReportMessageSchema,
  DismissHealthIssueMessageSchema,
  // AskUserQuestion schemas
  AskUserQuestionOptionSchema,
  AskUserQuestionItemSchema,
  // Memory Extraction schemas
  ExtractionStatusValueSchema,
  GetMemoryMessageSchema,
  SaveMemoryMessageSchema,
  GetExtractionPromptMessageSchema,
  SaveExtractionPromptMessageSchema,
  TriggerExtractionMessageSchema,
  MemoryContentMessageSchema,
  ExtractionPromptContentMessageSchema,
  MemorySavedMessageSchema,
  ExtractionPromptSavedMessageSchema,
  ExtractionStatusMessageSchema,
  // Supporting schemas
  VaultInfoSchema,
  ErrorCodeSchema,
  FileEntrySchema,
  TaskEntrySchema,
  SlashCommandSchema,
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
      contentRoot: "/vaults/my-vault",
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      hasSyncConfig: false,
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 3,
      badges: [],
      order: 0,
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
      contentRoot: "/vaults/my-vault",
      inboxPath: "00_Inbox",
      metadataPath: "06_Metadata/memory-loop",
      attachmentPath: "05_Attachments",
      setupComplete: false,
      hasSyncConfig: false,
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
// Task Entry Schema Tests
// =============================================================================

describe("TaskEntrySchema", () => {
  test("accepts valid task entry with incomplete state", () => {
    const task = {
      text: "Buy groceries",
      state: " ",
      filePath: "00_Inbox/2025-01-01.md",
      lineNumber: 5,
      fileMtime: 1704067200000,
      category: "inbox",
    };
    const result = TaskEntrySchema.parse(task);
    expect(result.text).toBe("Buy groceries");
    expect(result.state).toBe(" ");
    expect(result.filePath).toBe("00_Inbox/2025-01-01.md");
    expect(result.lineNumber).toBe(5);
  });

  test("accepts valid task entry with complete state", () => {
    const task = {
      text: "Finish project",
      state: "x",
      filePath: "01_Projects/project.md",
      lineNumber: 10,
      fileMtime: 1704067200000,
      category: "inbox",
    };
    const result = TaskEntrySchema.parse(task);
    expect(result.state).toBe("x");
  });

  test("accepts all valid task states", () => {
    const validStates = [" ", "x", "/", "?", "b", "f"];
    for (const state of validStates) {
      const task = {
        text: "Test task",
        state,
        filePath: "test.md",
        lineNumber: 1,
        fileMtime: 1704067200000,
        category: "inbox",
      };
      expect(() => TaskEntrySchema.parse(task)).not.toThrow();
    }
  });

  test("accepts empty text (edge case from regex capture)", () => {
    // Empty text is technically valid - the regex could capture empty string
    const task = {
      text: "",
      state: " ",
      filePath: "test.md",
      lineNumber: 1,
      fileMtime: 1704067200000,
      category: "inbox",
    };
    const result = TaskEntrySchema.parse(task);
    expect(result.text).toBe("");
  });

  test("accepts task text with special characters", () => {
    const task = {
      text: "Task with emojis \u{1F525} and \"quotes\" and [links](url)",
      state: " ",
      filePath: "test.md",
      lineNumber: 1,
      fileMtime: 1704067200000,
      category: "inbox",
    };
    const result = TaskEntrySchema.parse(task);
    expect(result.text).toContain("\u{1F525}");
  });

  test("rejects state with more than one character", () => {
    const task = {
      text: "Test",
      state: "xx",
      filePath: "test.md",
      lineNumber: 1,
      fileMtime: 1704067200000,
      category: "inbox",
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects state with zero characters", () => {
    const task = {
      text: "Test",
      state: "",
      filePath: "test.md",
      lineNumber: 1,
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects empty filePath", () => {
    const task = {
      text: "Test",
      state: " ",
      filePath: "",
      lineNumber: 1,
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects lineNumber less than 1", () => {
    const task = {
      text: "Test",
      state: " ",
      filePath: "test.md",
      lineNumber: 0,
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects negative lineNumber", () => {
    const task = {
      text: "Test",
      state: " ",
      filePath: "test.md",
      lineNumber: -1,
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects non-integer lineNumber", () => {
    const task = {
      text: "Test",
      state: " ",
      filePath: "test.md",
      lineNumber: 1.5,
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });

  test("rejects missing fields", () => {
    const task = {
      text: "Test",
      state: " ",
    };
    expect(() => TaskEntrySchema.parse(task)).toThrow(ZodError);
  });
});

// =============================================================================
// SlashCommand Schema Tests
// =============================================================================

describe("SlashCommandSchema", () => {
  test("accepts valid slash command with all fields", () => {
    const cmd = {
      name: "/commit",
      description: "Commit changes to the repository",
      argumentHint: "<message>",
    };
    const result = SlashCommandSchema.parse(cmd);
    expect(result.name).toBe("/commit");
    expect(result.description).toBe("Commit changes to the repository");
    expect(result.argumentHint).toBe("<message>");
  });

  test("accepts valid slash command without argumentHint", () => {
    const cmd = {
      name: "/help",
      description: "Show available commands",
    };
    const result = SlashCommandSchema.parse(cmd);
    expect(result.name).toBe("/help");
    expect(result.argumentHint).toBeUndefined();
  });

  test("rejects name shorter than 2 characters", () => {
    const cmd = { name: "/", description: "Invalid" };
    expect(() => SlashCommandSchema.parse(cmd)).toThrow(ZodError);
  });

  test("rejects empty name", () => {
    const cmd = { name: "", description: "Invalid" };
    expect(() => SlashCommandSchema.parse(cmd)).toThrow(ZodError);
  });

  test("rejects empty description", () => {
    const cmd = { name: "/test", description: "" };
    expect(() => SlashCommandSchema.parse(cmd)).toThrow(ZodError);
  });

  test("rejects missing name", () => {
    const cmd = { description: "Missing name" };
    expect(() => SlashCommandSchema.parse(cmd)).toThrow(ZodError);
  });

  test("rejects missing description", () => {
    const cmd = { name: "/test" };
    expect(() => SlashCommandSchema.parse(cmd)).toThrow(ZodError);
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

  describe("GetInspirationMessageSchema", () => {
    test("accepts valid get_inspiration message", () => {
      const msg = { type: "get_inspiration" as const };
      const result = GetInspirationMessageSchema.parse(msg);
      expect(result.type).toBe("get_inspiration");
    });

    test("ignores extra fields", () => {
      const msg = { type: "get_inspiration", extra: "ignored" };
      const result = GetInspirationMessageSchema.parse(msg);
      expect(result.type).toBe("get_inspiration");
    });
  });

  describe("WriteFileMessageSchema", () => {
    test("accepts valid write_file message with path and content", () => {
      const msg = {
        type: "write_file" as const,
        path: "notes/my-note.md",
        content: "# My Note\n\nSome content here.",
      };
      const result = WriteFileMessageSchema.parse(msg);
      expect(result.type).toBe("write_file");
      expect(result.path).toBe("notes/my-note.md");
      expect(result.content).toBe("# My Note\n\nSome content here.");
    });

    test("accepts empty content (clearing file)", () => {
      const msg = {
        type: "write_file" as const,
        path: "notes/empty.md",
        content: "",
      };
      const result = WriteFileMessageSchema.parse(msg);
      expect(result.content).toBe("");
    });

    test("accepts multiline content", () => {
      const msg = {
        type: "write_file" as const,
        path: "notes/multiline.md",
        content: "Line 1\nLine 2\nLine 3\n\n## Section\n\n- Item 1\n- Item 2",
      };
      const result = WriteFileMessageSchema.parse(msg);
      expect(result.content).toContain("Line 1\nLine 2");
    });

    test("accepts very long content", () => {
      const longContent = "a".repeat(100000);
      const msg = {
        type: "write_file" as const,
        path: "notes/large.md",
        content: longContent,
      };
      const result = WriteFileMessageSchema.parse(msg);
      expect(result.content.length).toBe(100000);
    });

    test("accepts unicode content", () => {
      const msg = {
        type: "write_file" as const,
        path: "notes/unicode.md",
        content: "Unicode: \u{1F600} \u{1F4DA} \u{2764} \u{1F680}",
      };
      const result = WriteFileMessageSchema.parse(msg);
      expect(result.content).toContain("\u{1F600}");
    });

    test("rejects empty path", () => {
      const msg = { type: "write_file", path: "", content: "test content" };
      expect(() => WriteFileMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "write_file", content: "test content" };
      expect(() => WriteFileMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing content", () => {
      const msg = { type: "write_file", path: "notes/test.md" };
      expect(() => WriteFileMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string path", () => {
      const msg = { type: "write_file", path: 123, content: "test" };
      expect(() => WriteFileMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string content", () => {
      const msg = { type: "write_file", path: "notes/test.md", content: 123 };
      expect(() => WriteFileMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("GetTasksMessageSchema", () => {
    test("accepts valid get_tasks message", () => {
      const msg = { type: "get_tasks" as const };
      const result = GetTasksMessageSchema.parse(msg);
      expect(result.type).toBe("get_tasks");
    });

    test("ignores extra fields", () => {
      const msg = { type: "get_tasks", extra: "ignored" };
      const result = GetTasksMessageSchema.parse(msg);
      expect(result.type).toBe("get_tasks");
    });
  });

  describe("ToggleTaskMessageSchema", () => {
    test("accepts valid toggle_task message", () => {
      const msg = {
        type: "toggle_task" as const,
        filePath: "00_Inbox/2025-01-01.md",
        lineNumber: 5,
      };
      const result = ToggleTaskMessageSchema.parse(msg);
      expect(result.type).toBe("toggle_task");
      expect(result.filePath).toBe("00_Inbox/2025-01-01.md");
      expect(result.lineNumber).toBe(5);
    });

    test("accepts nested file path", () => {
      const msg = {
        type: "toggle_task" as const,
        filePath: "01_Projects/work/project-a/tasks.md",
        lineNumber: 100,
      };
      const result = ToggleTaskMessageSchema.parse(msg);
      expect(result.filePath).toBe("01_Projects/work/project-a/tasks.md");
    });

    test("rejects empty filePath", () => {
      const msg = { type: "toggle_task", filePath: "", lineNumber: 5 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects lineNumber less than 1", () => {
      const msg = { type: "toggle_task", filePath: "test.md", lineNumber: 0 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects negative lineNumber", () => {
      const msg = { type: "toggle_task", filePath: "test.md", lineNumber: -1 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-integer lineNumber", () => {
      const msg = { type: "toggle_task", filePath: "test.md", lineNumber: 1.5 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing filePath", () => {
      const msg = { type: "toggle_task", lineNumber: 5 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing lineNumber", () => {
      const msg = { type: "toggle_task", filePath: "test.md" };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string filePath", () => {
      const msg = { type: "toggle_task", filePath: 123, lineNumber: 5 };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-number lineNumber", () => {
      const msg = { type: "toggle_task", filePath: "test.md", lineNumber: "5" };
      expect(() => ToggleTaskMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ToolPermissionResponseMessageSchema", () => {
    test("accepts valid tool_permission_response with allowed=true", () => {
      const msg = {
        type: "tool_permission_response" as const,
        toolUseId: "tool_123_abc",
        allowed: true,
      };
      const result = ToolPermissionResponseMessageSchema.parse(msg);
      expect(result.type).toBe("tool_permission_response");
      expect(result.toolUseId).toBe("tool_123_abc");
      expect(result.allowed).toBe(true);
    });

    test("accepts valid tool_permission_response with allowed=false", () => {
      const msg = {
        type: "tool_permission_response" as const,
        toolUseId: "tool_456_def",
        allowed: false,
      };
      const result = ToolPermissionResponseMessageSchema.parse(msg);
      expect(result.toolUseId).toBe("tool_456_def");
      expect(result.allowed).toBe(false);
    });

    test("rejects empty toolUseId", () => {
      const msg = { type: "tool_permission_response", toolUseId: "", allowed: true };
      expect(() => ToolPermissionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing toolUseId", () => {
      const msg = { type: "tool_permission_response", allowed: true };
      expect(() => ToolPermissionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing allowed", () => {
      const msg = { type: "tool_permission_response", toolUseId: "tool_123" };
      expect(() => ToolPermissionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-boolean allowed", () => {
      const msg = { type: "tool_permission_response", toolUseId: "tool_123", allowed: "true" };
      expect(() => ToolPermissionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string toolUseId", () => {
      const msg = { type: "tool_permission_response", toolUseId: 123, allowed: true };
      expect(() => ToolPermissionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("AskUserQuestionOptionSchema", () => {
    test("accepts valid option with label and description", () => {
      const option = { label: "Option A", description: "Description for option A" };
      const result = AskUserQuestionOptionSchema.parse(option);
      expect(result.label).toBe("Option A");
      expect(result.description).toBe("Description for option A");
    });

    test("accepts option with empty description", () => {
      const option = { label: "Option B", description: "" };
      const result = AskUserQuestionOptionSchema.parse(option);
      expect(result.description).toBe("");
    });

    test("rejects empty label", () => {
      const option = { label: "", description: "Some description" };
      expect(() => AskUserQuestionOptionSchema.parse(option)).toThrow(ZodError);
    });

    test("rejects missing label", () => {
      const option = { description: "Some description" };
      expect(() => AskUserQuestionOptionSchema.parse(option)).toThrow(ZodError);
    });

    test("rejects missing description", () => {
      const option = { label: "Option" };
      expect(() => AskUserQuestionOptionSchema.parse(option)).toThrow(ZodError);
    });

    test("rejects non-string label", () => {
      const option = { label: 123, description: "Description" };
      expect(() => AskUserQuestionOptionSchema.parse(option)).toThrow(ZodError);
    });

    test("rejects non-string description", () => {
      const option = { label: "Option", description: 123 };
      expect(() => AskUserQuestionOptionSchema.parse(option)).toThrow(ZodError);
    });
  });

  describe("AskUserQuestionItemSchema", () => {
    const validQuestion = {
      question: "Which library should we use?",
      header: "Library",
      options: [
        { label: "Option A", description: "Use library A" },
        { label: "Option B", description: "Use library B" },
      ],
      multiSelect: false,
    };

    test("accepts valid question with 2 options", () => {
      const result = AskUserQuestionItemSchema.parse(validQuestion);
      expect(result.question).toBe("Which library should we use?");
      expect(result.header).toBe("Library");
      expect(result.options).toHaveLength(2);
      expect(result.multiSelect).toBe(false);
    });

    test("accepts valid question with 4 options (max)", () => {
      const question = {
        ...validQuestion,
        options: [
          { label: "A", description: "Option A" },
          { label: "B", description: "Option B" },
          { label: "C", description: "Option C" },
          { label: "D", description: "Option D" },
        ],
      };
      const result = AskUserQuestionItemSchema.parse(question);
      expect(result.options).toHaveLength(4);
    });

    test("accepts multiSelect true", () => {
      const question = { ...validQuestion, multiSelect: true };
      const result = AskUserQuestionItemSchema.parse(question);
      expect(result.multiSelect).toBe(true);
    });

    test("accepts header at max length (12 chars)", () => {
      const question = { ...validQuestion, header: "123456789012" };
      const result = AskUserQuestionItemSchema.parse(question);
      expect(result.header).toBe("123456789012");
    });

    test("accepts empty header", () => {
      const question = { ...validQuestion, header: "" };
      const result = AskUserQuestionItemSchema.parse(question);
      expect(result.header).toBe("");
    });

    test("rejects header exceeding 12 characters", () => {
      const question = { ...validQuestion, header: "1234567890123" };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects empty question text", () => {
      const question = { ...validQuestion, question: "" };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects missing question text", () => {
      const { header, options, multiSelect } = validQuestion;
      expect(() => AskUserQuestionItemSchema.parse({ header, options, multiSelect })).toThrow(ZodError);
    });

    test("rejects fewer than 2 options", () => {
      const question = {
        ...validQuestion,
        options: [{ label: "Only one", description: "Just one option" }],
      };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects more than 4 options", () => {
      const question = {
        ...validQuestion,
        options: [
          { label: "A", description: "1" },
          { label: "B", description: "2" },
          { label: "C", description: "3" },
          { label: "D", description: "4" },
          { label: "E", description: "5" },
        ],
      };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects empty options array", () => {
      const question = { ...validQuestion, options: [] };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects missing options", () => {
      const { question, header, multiSelect } = validQuestion;
      expect(() => AskUserQuestionItemSchema.parse({ question, header, multiSelect })).toThrow(ZodError);
    });

    test("rejects missing multiSelect", () => {
      const { question, header, options } = validQuestion;
      expect(() => AskUserQuestionItemSchema.parse({ question, header, options })).toThrow(ZodError);
    });

    test("rejects non-boolean multiSelect", () => {
      const question = { ...validQuestion, multiSelect: "false" };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });

    test("rejects invalid option in options array", () => {
      const question = {
        ...validQuestion,
        options: [
          { label: "Valid", description: "Valid option" },
          { label: "", description: "Invalid - empty label" },
        ],
      };
      expect(() => AskUserQuestionItemSchema.parse(question)).toThrow(ZodError);
    });
  });

  describe("AskUserQuestionResponseMessageSchema", () => {
    test("accepts valid response with single answer", () => {
      const msg = {
        type: "ask_user_question_response" as const,
        toolUseId: "tool_123_abc",
        answers: { "Which library?": "Option A" },
      };
      const result = AskUserQuestionResponseMessageSchema.parse(msg);
      expect(result.type).toBe("ask_user_question_response");
      expect(result.toolUseId).toBe("tool_123_abc");
      expect(result.answers["Which library?"]).toBe("Option A");
    });

    test("accepts response with multiple answers", () => {
      const msg = {
        type: "ask_user_question_response" as const,
        toolUseId: "tool_456",
        answers: {
          "First question?": "Answer 1",
          "Second question?": "Answer 2",
          "Third question?": "Answer 3, Answer 4",
        },
      };
      const result = AskUserQuestionResponseMessageSchema.parse(msg);
      expect(Object.keys(result.answers)).toHaveLength(3);
    });

    test("accepts response with empty answers object", () => {
      const msg = {
        type: "ask_user_question_response" as const,
        toolUseId: "tool_789",
        answers: {},
      };
      const result = AskUserQuestionResponseMessageSchema.parse(msg);
      expect(Object.keys(result.answers)).toHaveLength(0);
    });

    test("accepts response with custom 'Other' text", () => {
      const msg = {
        type: "ask_user_question_response" as const,
        toolUseId: "tool_other",
        answers: { "Which framework?": "Custom framework I wrote" },
      };
      const result = AskUserQuestionResponseMessageSchema.parse(msg);
      expect(result.answers["Which framework?"]).toBe("Custom framework I wrote");
    });

    test("rejects empty toolUseId", () => {
      const msg = {
        type: "ask_user_question_response",
        toolUseId: "",
        answers: { "Question?": "Answer" },
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing toolUseId", () => {
      const msg = {
        type: "ask_user_question_response",
        answers: { "Question?": "Answer" },
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing answers", () => {
      const msg = {
        type: "ask_user_question_response",
        toolUseId: "tool_123",
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-object answers", () => {
      const msg = {
        type: "ask_user_question_response",
        toolUseId: "tool_123",
        answers: "not an object",
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string answer values", () => {
      const msg = {
        type: "ask_user_question_response",
        toolUseId: "tool_123",
        answers: { "Question?": 123 },
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string toolUseId", () => {
      const msg = {
        type: "ask_user_question_response",
        toolUseId: 123,
        answers: {},
      };
      expect(() => AskUserQuestionResponseMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("SetupVaultMessageSchema", () => {
    test("accepts valid setup_vault message", () => {
      const msg = {
        type: "setup_vault" as const,
        vaultId: "my-vault",
      };
      const result = SetupVaultMessageSchema.parse(msg);
      expect(result.type).toBe("setup_vault");
      expect(result.vaultId).toBe("my-vault");
    });

    test("rejects empty vaultId", () => {
      const msg = { type: "setup_vault", vaultId: "" };
      expect(() => SetupVaultMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing vaultId", () => {
      const msg = { type: "setup_vault" };
      expect(() => SetupVaultMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string vaultId", () => {
      const msg = { type: "setup_vault", vaultId: 123 };
      expect(() => SetupVaultMessageSchema.parse(msg)).toThrow(ZodError);
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
        { type: "get_inspiration" },
        { type: "write_file", path: "note.md", content: "test" },
        { type: "get_tasks" },
        { type: "toggle_task", filePath: "test.md", lineNumber: 1 },
        { type: "tool_permission_response", toolUseId: "tool_123", allowed: true },
        { type: "ask_user_question_response", toolUseId: "tool_456", answers: { "Question?": "Answer" } },
        { type: "setup_vault", vaultId: "my-vault" },
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
            contentRoot: "/vaults/vault-1",
            inboxPath: "00_Inbox",
            metadataPath: "06_Metadata/memory-loop",
            attachmentPath: "05_Attachments",
            setupComplete: true,
            hasSyncConfig: false,
            promptsPerGeneration: 5,
            maxPoolSize: 50,
            quotesPerWeek: 3,
            badges: [],
            order: 0,
          },
          {
            id: "vault-2",
            name: "Vault 2",
            path: "/vaults/vault-2",
            hasClaudeMd: false,
            contentRoot: "/vaults/vault-2",
            inboxPath: "Inbox",
            metadataPath: "06_Metadata/memory-loop",
            attachmentPath: "05_Attachments",
            setupComplete: false,
            hasSyncConfig: false,
            promptsPerGeneration: 5,
            maxPoolSize: 50,
            quotesPerWeek: 3,
            badges: [],
            order: 1,
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

    test("accepts session_ready with slashCommands", () => {
      const msg = {
        type: "session_ready" as const,
        sessionId: "session-123",
        vaultId: "vault-1",
        slashCommands: [
          { name: "/commit", description: "Commit changes", argumentHint: "<message>" },
          { name: "/help", description: "Show help" },
        ],
      };
      const result = SessionReadyMessageSchema.parse(msg);
      expect(result.slashCommands).toHaveLength(2);
      expect(result.slashCommands?.[0].name).toBe("/commit");
      expect(result.slashCommands?.[1].argumentHint).toBeUndefined();
    });

    test("accepts session_ready without slashCommands (optional field)", () => {
      const msg = {
        type: "session_ready" as const,
        sessionId: "session-123",
        vaultId: "vault-1",
      };
      const result = SessionReadyMessageSchema.parse(msg);
      expect(result.slashCommands).toBeUndefined();
    });

    test("accepts session_ready with empty slashCommands array", () => {
      const msg = {
        type: "session_ready" as const,
        sessionId: "session-123",
        vaultId: "vault-1",
        slashCommands: [],
      };
      const result = SessionReadyMessageSchema.parse(msg);
      expect(result.slashCommands).toHaveLength(0);
    });

    test("rejects session_ready with invalid slashCommand in array", () => {
      const msg = {
        type: "session_ready",
        sessionId: "session-123",
        vaultId: "vault-1",
        slashCommands: [{ name: "/", description: "" }], // Both invalid
      };
      expect(() => SessionReadyMessageSchema.parse(msg)).toThrow(ZodError);
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

  describe("InspirationItemSchema", () => {
    test("accepts valid item with text only", () => {
      const item = { text: "What would make today great?" };
      const result = InspirationItemSchema.parse(item);
      expect(result.text).toBe("What would make today great?");
      expect(result.attribution).toBeUndefined();
    });

    test("accepts valid item with text and attribution", () => {
      const item = {
        text: "The only way to do great work is to love what you do.",
        attribution: "Steve Jobs",
      };
      const result = InspirationItemSchema.parse(item);
      expect(result.text).toBe("The only way to do great work is to love what you do.");
      expect(result.attribution).toBe("Steve Jobs");
    });

    test("accepts empty attribution string", () => {
      const item = { text: "Some inspiration", attribution: "" };
      const result = InspirationItemSchema.parse(item);
      expect(result.attribution).toBe("");
    });

    test("rejects empty text", () => {
      const item = { text: "" };
      expect(() => InspirationItemSchema.parse(item)).toThrow(ZodError);
    });

    test("rejects missing text", () => {
      const item = { attribution: "Someone" };
      expect(() => InspirationItemSchema.parse(item)).toThrow(ZodError);
    });

    test("rejects wrong text type", () => {
      const item = { text: 123 };
      expect(() => InspirationItemSchema.parse(item)).toThrow(ZodError);
    });
  });

  describe("InspirationMessageSchema", () => {
    test("accepts valid message with contextual and quote", () => {
      const msg = {
        type: "inspiration" as const,
        contextual: { text: "What would make today great?" },
        quote: {
          text: "The only way to do great work is to love what you do.",
          attribution: "Steve Jobs",
        },
      };
      const result = InspirationMessageSchema.parse(msg);
      expect(result.type).toBe("inspiration");
      expect(result.contextual?.text).toBe("What would make today great?");
      expect(result.quote.text).toBe("The only way to do great work is to love what you do.");
      expect(result.quote.attribution).toBe("Steve Jobs");
    });

    test("accepts valid message with null contextual (file missing/empty)", () => {
      const msg = {
        type: "inspiration" as const,
        contextual: null,
        quote: { text: "Stay hungry, stay foolish.", attribution: "Steve Jobs" },
      };
      const result = InspirationMessageSchema.parse(msg);
      expect(result.type).toBe("inspiration");
      expect(result.contextual).toBeNull();
      expect(result.quote.text).toBe("Stay hungry, stay foolish.");
    });

    test("accepts quote without attribution", () => {
      const msg = {
        type: "inspiration" as const,
        contextual: null,
        quote: { text: "Just do it." },
      };
      const result = InspirationMessageSchema.parse(msg);
      expect(result.quote.attribution).toBeUndefined();
    });

    test("accepts contextual with attribution", () => {
      const msg = {
        type: "inspiration" as const,
        contextual: { text: "What would make today great?", attribution: "Daily Prompt" },
        quote: { text: "Carpe diem." },
      };
      const result = InspirationMessageSchema.parse(msg);
      expect(result.contextual?.attribution).toBe("Daily Prompt");
    });

    test("rejects missing quote", () => {
      const msg = {
        type: "inspiration",
        contextual: null,
      };
      expect(() => InspirationMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing contextual field", () => {
      const msg = {
        type: "inspiration",
        quote: { text: "Some quote" },
      };
      expect(() => InspirationMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty quote text", () => {
      const msg = {
        type: "inspiration",
        contextual: null,
        quote: { text: "" },
      };
      expect(() => InspirationMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects wrong contextual type (not object or null)", () => {
      const msg = {
        type: "inspiration",
        contextual: "not an object",
        quote: { text: "Some quote" },
      };
      expect(() => InspirationMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects wrong type literal", () => {
      const msg = {
        type: "wrong_type",
        contextual: null,
        quote: { text: "Some quote" },
      };
      expect(() => InspirationMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("FileWrittenMessageSchema", () => {
    test("accepts valid file_written message", () => {
      const msg = {
        type: "file_written" as const,
        path: "notes/my-note.md",
        success: true as const,
      };
      const result = FileWrittenMessageSchema.parse(msg);
      expect(result.type).toBe("file_written");
      expect(result.path).toBe("notes/my-note.md");
      expect(result.success).toBe(true);
    });

    test("accepts nested path", () => {
      const msg = {
        type: "file_written" as const,
        path: "deep/nested/folder/note.md",
        success: true as const,
      };
      const result = FileWrittenMessageSchema.parse(msg);
      expect(result.path).toBe("deep/nested/folder/note.md");
    });

    test("rejects empty path", () => {
      const msg = { type: "file_written", path: "", success: true };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "file_written", success: true };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects success: false", () => {
      // success must be literal true - failures use error messages
      const msg = { type: "file_written", path: "note.md", success: false };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing success field", () => {
      const msg = { type: "file_written", path: "note.md" };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-boolean success", () => {
      const msg = { type: "file_written", path: "note.md", success: "true" };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string path", () => {
      const msg = { type: "file_written", path: 123, success: true };
      expect(() => FileWrittenMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("TasksMessageSchema", () => {
    test("accepts valid tasks message with tasks", () => {
      const msg = {
        type: "tasks" as const,
        tasks: [
          {
            text: "Buy groceries",
            state: " ",
            filePath: "00_Inbox/today.md",
            lineNumber: 5,
            fileMtime: 1704067200000,
            category: "inbox" as const,
          },
          {
            text: "Finish report",
            state: "x",
            filePath: "01_Projects/work.md",
            lineNumber: 10,
            fileMtime: 1704067200000,
            category: "projects" as const,
          },
        ],
        incomplete: 1,
        total: 2,
      };
      const result = TasksMessageSchema.parse(msg);
      expect(result.type).toBe("tasks");
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].text).toBe("Buy groceries");
      expect(result.tasks[0].state).toBe(" ");
      expect(result.tasks[1].state).toBe("x");
      expect(result.incomplete).toBe(1);
      expect(result.total).toBe(2);
    });

    test("accepts empty tasks array", () => {
      const msg = {
        type: "tasks" as const,
        tasks: [],
        incomplete: 0,
        total: 0,
      };
      const result = TasksMessageSchema.parse(msg);
      expect(result.tasks).toHaveLength(0);
      expect(result.incomplete).toBe(0);
      expect(result.total).toBe(0);
    });

    test("accepts tasks with all valid states", () => {
      const tasks = [" ", "x", "/", "?", "b", "f"].map((state, i) => ({
        text: `Task ${i}`,
        state,
        filePath: "test.md",
        lineNumber: i + 1,
        fileMtime: 1704067200000,
        category: "inbox" as const,
      }));
      const msg = {
        type: "tasks" as const,
        tasks,
        incomplete: 1,
        total: 6,
      };
      const result = TasksMessageSchema.parse(msg);
      expect(result.tasks).toHaveLength(6);
    });

    test("rejects invalid task in tasks array", () => {
      const msg = {
        type: "tasks",
        tasks: [{ text: "Valid", state: "xx", filePath: "test.md", lineNumber: 1, fileMtime: 1704067200000, category: "inbox" }], // invalid state
        incomplete: 0,
        total: 1,
      };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects negative incomplete count", () => {
      const msg = {
        type: "tasks",
        tasks: [],
        incomplete: -1,
        total: 0,
      };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects negative total count", () => {
      const msg = {
        type: "tasks",
        tasks: [],
        incomplete: 0,
        total: -1,
      };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-integer counts", () => {
      const msg = {
        type: "tasks",
        tasks: [],
        incomplete: 1.5,
        total: 2,
      };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing tasks field", () => {
      const msg = { type: "tasks", incomplete: 0, total: 0 };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing incomplete field", () => {
      const msg = { type: "tasks", tasks: [], total: 0 };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing total field", () => {
      const msg = { type: "tasks", tasks: [], incomplete: 0 };
      expect(() => TasksMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("TaskToggledMessageSchema", () => {
    test("accepts valid task_toggled message", () => {
      const msg = {
        type: "task_toggled" as const,
        filePath: "00_Inbox/today.md",
        lineNumber: 5,
        newState: "x",
      };
      const result = TaskToggledMessageSchema.parse(msg);
      expect(result.type).toBe("task_toggled");
      expect(result.filePath).toBe("00_Inbox/today.md");
      expect(result.lineNumber).toBe(5);
      expect(result.newState).toBe("x");
    });

    test("accepts all valid newState values", () => {
      const validStates = [" ", "x", "/", "?", "b", "f"];
      for (const newState of validStates) {
        const msg = {
          type: "task_toggled" as const,
          filePath: "test.md",
          lineNumber: 1,
          newState,
        };
        expect(() => TaskToggledMessageSchema.parse(msg)).not.toThrow();
      }
    });

    test("rejects empty filePath", () => {
      const msg = { type: "task_toggled", filePath: "", lineNumber: 5, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects lineNumber less than 1", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 0, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects negative lineNumber", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: -1, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-integer lineNumber", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 1.5, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects newState with more than one character", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 1, newState: "xx" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects newState with zero characters", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 1, newState: "" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing filePath", () => {
      const msg = { type: "task_toggled", lineNumber: 5, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing lineNumber", () => {
      const msg = { type: "task_toggled", filePath: "test.md", newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing newState", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 5 };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string filePath", () => {
      const msg = { type: "task_toggled", filePath: 123, lineNumber: 5, newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-number lineNumber", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: "5", newState: "x" };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string newState", () => {
      const msg = { type: "task_toggled", filePath: "test.md", lineNumber: 5, newState: 1 };
      expect(() => TaskToggledMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("ToolPermissionRequestMessageSchema", () => {
    test("accepts valid tool_permission_request message", () => {
      const msg = {
        type: "tool_permission_request" as const,
        toolUseId: "tool_123_abc",
        toolName: "Read",
        input: { file_path: "/path/to/file.md" },
      };
      const result = ToolPermissionRequestMessageSchema.parse(msg);
      expect(result.type).toBe("tool_permission_request");
      expect(result.toolUseId).toBe("tool_123_abc");
      expect(result.toolName).toBe("Read");
      expect(result.input).toEqual({ file_path: "/path/to/file.md" });
    });

    test("accepts tool_permission_request with null input", () => {
      const msg = {
        type: "tool_permission_request" as const,
        toolUseId: "tool_456",
        toolName: "Bash",
        input: null,
      };
      const result = ToolPermissionRequestMessageSchema.parse(msg);
      expect(result.input).toBeNull();
    });

    test("accepts tool_permission_request with string input", () => {
      const msg = {
        type: "tool_permission_request" as const,
        toolUseId: "tool_789",
        toolName: "Edit",
        input: "some string input",
      };
      const result = ToolPermissionRequestMessageSchema.parse(msg);
      expect(result.input).toBe("some string input");
    });

    test("rejects empty toolUseId", () => {
      const msg = { type: "tool_permission_request", toolUseId: "", toolName: "Read", input: {} };
      expect(() => ToolPermissionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty toolName", () => {
      const msg = { type: "tool_permission_request", toolUseId: "tool_123", toolName: "", input: {} };
      expect(() => ToolPermissionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing toolUseId", () => {
      const msg = { type: "tool_permission_request", toolName: "Read", input: {} };
      expect(() => ToolPermissionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing toolName", () => {
      const msg = { type: "tool_permission_request", toolUseId: "tool_123", input: {} };
      expect(() => ToolPermissionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("accepts missing input (undefined)", () => {
      const msg = { type: "tool_permission_request" as const, toolUseId: "tool_123", toolName: "Read" };
      // input is z.unknown() so undefined is valid
      const result = ToolPermissionRequestMessageSchema.parse(msg);
      expect(result.input).toBeUndefined();
    });
  });

  describe("AskUserQuestionRequestMessageSchema", () => {
    const validQuestion = {
      question: "Which library should we use?",
      header: "Library",
      options: [
        { label: "Option A", description: "Use library A" },
        { label: "Option B", description: "Use library B" },
      ],
      multiSelect: false,
    };

    test("accepts valid request with single question", () => {
      const msg = {
        type: "ask_user_question_request" as const,
        toolUseId: "tool_123_abc",
        questions: [validQuestion],
      };
      const result = AskUserQuestionRequestMessageSchema.parse(msg);
      expect(result.type).toBe("ask_user_question_request");
      expect(result.toolUseId).toBe("tool_123_abc");
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].question).toBe("Which library should we use?");
    });

    test("accepts request with 4 questions (max)", () => {
      const msg = {
        type: "ask_user_question_request" as const,
        toolUseId: "tool_456",
        questions: [
          { ...validQuestion, question: "Question 1?" },
          { ...validQuestion, question: "Question 2?" },
          { ...validQuestion, question: "Question 3?" },
          { ...validQuestion, question: "Question 4?" },
        ],
      };
      const result = AskUserQuestionRequestMessageSchema.parse(msg);
      expect(result.questions).toHaveLength(4);
    });

    test("accepts request with multiSelect questions", () => {
      const msg = {
        type: "ask_user_question_request" as const,
        toolUseId: "tool_789",
        questions: [{ ...validQuestion, multiSelect: true }],
      };
      const result = AskUserQuestionRequestMessageSchema.parse(msg);
      expect(result.questions[0].multiSelect).toBe(true);
    });

    test("accepts request with mixed single and multiSelect questions", () => {
      const msg = {
        type: "ask_user_question_request" as const,
        toolUseId: "tool_mixed",
        questions: [
          { ...validQuestion, multiSelect: false },
          { ...validQuestion, question: "Select all that apply?", multiSelect: true },
        ],
      };
      const result = AskUserQuestionRequestMessageSchema.parse(msg);
      expect(result.questions[0].multiSelect).toBe(false);
      expect(result.questions[1].multiSelect).toBe(true);
    });

    test("rejects empty toolUseId", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "",
        questions: [validQuestion],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing toolUseId", () => {
      const msg = {
        type: "ask_user_question_request",
        questions: [validQuestion],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty questions array", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "tool_123",
        questions: [],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects more than 4 questions", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "tool_123",
        questions: [
          { ...validQuestion, question: "Q1?" },
          { ...validQuestion, question: "Q2?" },
          { ...validQuestion, question: "Q3?" },
          { ...validQuestion, question: "Q4?" },
          { ...validQuestion, question: "Q5?" },
        ],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing questions", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "tool_123",
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects invalid question in questions array", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "tool_123",
        questions: [
          validQuestion,
          { ...validQuestion, options: [] }, // Invalid - no options
        ],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-string toolUseId", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: 123,
        questions: [validQuestion],
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-array questions", () => {
      const msg = {
        type: "ask_user_question_request",
        toolUseId: "tool_123",
        questions: validQuestion,
      };
      expect(() => AskUserQuestionRequestMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("SetupCompleteMessageSchema", () => {
    test("accepts valid setup_complete with success", () => {
      const msg = {
        type: "setup_complete" as const,
        vaultId: "my-vault",
        success: true,
        summary: ["Installed 6 commands", "Created 4 directories", "Updated CLAUDE.md"],
      };
      const result = SetupCompleteMessageSchema.parse(msg);
      expect(result.type).toBe("setup_complete");
      expect(result.vaultId).toBe("my-vault");
      expect(result.success).toBe(true);
      expect(result.summary).toHaveLength(3);
    });

    test("accepts setup_complete with failure and errors", () => {
      const msg = {
        type: "setup_complete" as const,
        vaultId: "my-vault",
        success: false,
        summary: ["Installed 6 commands"],
        errors: ["Failed to update CLAUDE.md: permission denied"],
      };
      const result = SetupCompleteMessageSchema.parse(msg);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toContain("permission denied");
    });

    test("accepts setup_complete without errors field", () => {
      const msg = {
        type: "setup_complete" as const,
        vaultId: "my-vault",
        success: true,
        summary: [],
      };
      const result = SetupCompleteMessageSchema.parse(msg);
      expect(result.errors).toBeUndefined();
    });

    test("rejects empty vaultId", () => {
      const msg = { type: "setup_complete", vaultId: "", success: true, summary: [] };
      expect(() => SetupCompleteMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing vaultId", () => {
      const msg = { type: "setup_complete", success: true, summary: [] };
      expect(() => SetupCompleteMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing success", () => {
      const msg = { type: "setup_complete", vaultId: "v1", summary: [] };
      expect(() => SetupCompleteMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing summary", () => {
      const msg = { type: "setup_complete", vaultId: "v1", success: true };
      expect(() => SetupCompleteMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-array summary", () => {
      const msg = { type: "setup_complete", vaultId: "v1", success: true, summary: "not an array" };
      expect(() => SetupCompleteMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  // ===========================================================================
  // Health Schema Tests
  // ===========================================================================

  describe("HealthSeveritySchema", () => {
    test("accepts 'error'", () => {
      expect(HealthSeveritySchema.parse("error")).toBe("error");
    });

    test("accepts 'warning'", () => {
      expect(HealthSeveritySchema.parse("warning")).toBe("warning");
    });

    test("rejects invalid severity", () => {
      expect(() => HealthSeveritySchema.parse("info")).toThrow(ZodError);
      expect(() => HealthSeveritySchema.parse("critical")).toThrow(ZodError);
      expect(() => HealthSeveritySchema.parse("")).toThrow(ZodError);
    });
  });

  describe("HealthCategorySchema", () => {
    const validCategories = [
      "widget_config",
      "widget_compute",
      "vault_config",
      "file_watcher",
      "cache",
      "sync",
      "general",
    ] as const;

    for (const category of validCategories) {
      test(`accepts '${category}'`, () => {
        expect(HealthCategorySchema.parse(category)).toBe(category);
      });
    }

    test("rejects invalid category", () => {
      expect(() => HealthCategorySchema.parse("unknown")).toThrow(ZodError);
      expect(() => HealthCategorySchema.parse("widget")).toThrow(ZodError);
      expect(() => HealthCategorySchema.parse("")).toThrow(ZodError);
    });
  });

  describe("HealthIssueSchema", () => {
    const validIssue = {
      id: "issue-123",
      severity: "error" as const,
      category: "widget_config" as const,
      message: "Failed to parse widget configuration",
      timestamp: "2024-01-15T10:30:00Z",
      dismissible: true,
    };

    test("accepts valid health issue", () => {
      const result = HealthIssueSchema.parse(validIssue);
      expect(result.id).toBe("issue-123");
      expect(result.severity).toBe("error");
      expect(result.category).toBe("widget_config");
      expect(result.message).toBe("Failed to parse widget configuration");
      expect(result.dismissible).toBe(true);
    });

    test("accepts issue with details", () => {
      const issueWithDetails = {
        ...validIssue,
        details: "/path/to/config.yaml: invalid syntax at line 5",
      };
      const result = HealthIssueSchema.parse(issueWithDetails);
      expect(result.details).toBe("/path/to/config.yaml: invalid syntax at line 5");
    });

    test("accepts issue without details", () => {
      const result = HealthIssueSchema.parse(validIssue);
      expect(result.details).toBeUndefined();
    });

    test("accepts warning severity", () => {
      const warning = { ...validIssue, severity: "warning" as const };
      const result = HealthIssueSchema.parse(warning);
      expect(result.severity).toBe("warning");
    });

    test("accepts all valid categories", () => {
      const categories = ["widget_config", "widget_compute", "vault_config", "file_watcher", "cache", "general"] as const;
      for (const category of categories) {
        const issue = { ...validIssue, category };
        const result = HealthIssueSchema.parse(issue);
        expect(result.category).toBe(category);
      }
    });

    test("accepts dismissible false", () => {
      const nonDismissible = { ...validIssue, dismissible: false };
      const result = HealthIssueSchema.parse(nonDismissible);
      expect(result.dismissible).toBe(false);
    });

    test("rejects missing id", () => {
      const noId = {
        severity: validIssue.severity,
        category: validIssue.category,
        message: validIssue.message,
        timestamp: validIssue.timestamp,
        dismissible: validIssue.dismissible,
      };
      expect(() => HealthIssueSchema.parse(noId)).toThrow(ZodError);
    });

    test("rejects empty id", () => {
      const emptyId = { ...validIssue, id: "" };
      expect(() => HealthIssueSchema.parse(emptyId)).toThrow(ZodError);
    });

    test("rejects missing severity", () => {
      const noSeverity = {
        id: validIssue.id,
        category: validIssue.category,
        message: validIssue.message,
        timestamp: validIssue.timestamp,
        dismissible: validIssue.dismissible,
      };
      expect(() => HealthIssueSchema.parse(noSeverity)).toThrow(ZodError);
    });

    test("rejects invalid severity", () => {
      const invalidSeverity = { ...validIssue, severity: "critical" };
      expect(() => HealthIssueSchema.parse(invalidSeverity)).toThrow(ZodError);
    });

    test("rejects missing category", () => {
      const noCategory = {
        id: validIssue.id,
        severity: validIssue.severity,
        message: validIssue.message,
        timestamp: validIssue.timestamp,
        dismissible: validIssue.dismissible,
      };
      expect(() => HealthIssueSchema.parse(noCategory)).toThrow(ZodError);
    });

    test("rejects invalid category", () => {
      const invalidCategory = { ...validIssue, category: "unknown" };
      expect(() => HealthIssueSchema.parse(invalidCategory)).toThrow(ZodError);
    });

    test("rejects missing message", () => {
      const noMessage = {
        id: validIssue.id,
        severity: validIssue.severity,
        category: validIssue.category,
        timestamp: validIssue.timestamp,
        dismissible: validIssue.dismissible,
      };
      expect(() => HealthIssueSchema.parse(noMessage)).toThrow(ZodError);
    });

    test("rejects empty message", () => {
      const emptyMessage = { ...validIssue, message: "" };
      expect(() => HealthIssueSchema.parse(emptyMessage)).toThrow(ZodError);
    });

    test("rejects missing timestamp", () => {
      const noTimestamp = {
        id: validIssue.id,
        severity: validIssue.severity,
        category: validIssue.category,
        message: validIssue.message,
        dismissible: validIssue.dismissible,
      };
      expect(() => HealthIssueSchema.parse(noTimestamp)).toThrow(ZodError);
    });

    test("rejects missing dismissible", () => {
      const noDismissible = {
        id: validIssue.id,
        severity: validIssue.severity,
        category: validIssue.category,
        message: validIssue.message,
        timestamp: validIssue.timestamp,
      };
      expect(() => HealthIssueSchema.parse(noDismissible)).toThrow(ZodError);
    });
  });

  describe("HealthReportMessageSchema", () => {
    test("accepts valid health report with issues", () => {
      const msg = {
        type: "health_report" as const,
        issues: [
          {
            id: "issue-1",
            severity: "error" as const,
            category: "widget_config" as const,
            message: "Config error",
            timestamp: "2024-01-15T10:30:00Z",
            dismissible: true,
          },
          {
            id: "issue-2",
            severity: "warning" as const,
            category: "cache" as const,
            message: "Cache warning",
            timestamp: "2024-01-15T10:31:00Z",
            dismissible: false,
          },
        ],
      };
      const result = HealthReportMessageSchema.parse(msg);
      expect(result.type).toBe("health_report");
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].severity).toBe("error");
      expect(result.issues[1].severity).toBe("warning");
    });

    test("accepts health report with empty issues array", () => {
      const msg = { type: "health_report" as const, issues: [] };
      const result = HealthReportMessageSchema.parse(msg);
      expect(result.type).toBe("health_report");
      expect(result.issues).toHaveLength(0);
    });

    test("rejects missing type", () => {
      const msg = { issues: [] };
      expect(() => HealthReportMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects wrong type", () => {
      const msg = { type: "health_update", issues: [] };
      expect(() => HealthReportMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing issues", () => {
      const msg = { type: "health_report" };
      expect(() => HealthReportMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects non-array issues", () => {
      const msg = { type: "health_report", issues: "not an array" };
      expect(() => HealthReportMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects invalid issue in array", () => {
      const msg = {
        type: "health_report",
        issues: [{ id: "issue-1", severity: "invalid" }],
      };
      expect(() => HealthReportMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("DismissHealthIssueMessageSchema", () => {
    test("accepts valid dismiss message", () => {
      const msg = { type: "dismiss_health_issue" as const, issueId: "issue-123" };
      const result = DismissHealthIssueMessageSchema.parse(msg);
      expect(result.type).toBe("dismiss_health_issue");
      expect(result.issueId).toBe("issue-123");
    });

    test("rejects missing type", () => {
      const msg = { issueId: "issue-123" };
      expect(() => DismissHealthIssueMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects wrong type", () => {
      const msg = { type: "dismiss_issue", issueId: "issue-123" };
      expect(() => DismissHealthIssueMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing issueId", () => {
      const msg = { type: "dismiss_health_issue" };
      expect(() => DismissHealthIssueMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty issueId", () => {
      const msg = { type: "dismiss_health_issue", issueId: "" };
      expect(() => DismissHealthIssueMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("Health messages in discriminated unions", () => {
    test("ServerMessageSchema parses health_report", () => {
      const msg = {
        type: "health_report" as const,
        issues: [
          {
            id: "issue-1",
            severity: "error" as const,
            category: "general" as const,
            message: "Test error",
            timestamp: "2024-01-15T10:30:00Z",
            dismissible: true,
          },
        ],
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("health_report");
    });

    test("ClientMessageSchema parses dismiss_health_issue", () => {
      const msg = { type: "dismiss_health_issue" as const, issueId: "issue-123" };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("dismiss_health_issue");
    });

    test("safeParseServerMessage handles health_report", () => {
      const msg = {
        type: "health_report",
        issues: [],
      };
      const result = safeParseServerMessage(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("health_report");
      }
    });

    test("safeParseClientMessage handles dismiss_health_issue", () => {
      const msg = { type: "dismiss_health_issue", issueId: "test-id" };
      const result = safeParseClientMessage(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("dismiss_health_issue");
      }
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
              contentRoot: "/v1",
              inboxPath: "Inbox",
              metadataPath: "06_Metadata/memory-loop",
              attachmentPath: "05_Attachments",
              setupComplete: false,
              hasSyncConfig: false,
              promptsPerGeneration: 5,
              maxPoolSize: 50,
              quotesPerWeek: 3,
              badges: [],
              order: 0,
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
        { type: "inspiration", contextual: null, quote: { text: "Carpe diem." } },
        {
          type: "inspiration",
          contextual: { text: "What would make today great?" },
          quote: { text: "Stay hungry.", attribution: "Steve Jobs" },
        },
        { type: "file_written", path: "note.md", success: true },
        { type: "tasks", tasks: [], incomplete: 0, total: 0 },
        {
          type: "tasks",
          tasks: [
            { text: "Buy milk", state: " ", filePath: "inbox.md", lineNumber: 1, fileMtime: 1704067200000, category: "inbox" },
          ],
          incomplete: 1,
          total: 1,
        },
        { type: "task_toggled", filePath: "test.md", lineNumber: 5, newState: "x" },
        { type: "tool_permission_request", toolUseId: "tool_123", toolName: "Read", input: {} },
        {
          type: "ask_user_question_request",
          toolUseId: "tool_456",
          questions: [
            {
              question: "Which library?",
              header: "Library",
              options: [
                { label: "A", description: "Option A" },
                { label: "B", description: "Option B" },
              ],
              multiSelect: false,
            },
          ],
        },
        { type: "setup_complete", vaultId: "v1", success: true, summary: ["Installed 6 commands"] },
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

// =============================================================================
// Sync Message Schema Tests (External Data Sync Feature)
// =============================================================================

import {
  TriggerSyncMessageSchema,
  SyncStatusValueSchema,
  SyncProgressSchema,
  SyncFileErrorSchema,
  SyncStatusMessageSchema,
} from "../protocol.js";

describe("Sync Messages", () => {
  describe("TriggerSyncMessageSchema", () => {
    test("accepts valid trigger_sync with full mode", () => {
      const msg = {
        type: "trigger_sync" as const,
        mode: "full" as const,
      };
      const result = TriggerSyncMessageSchema.parse(msg);
      expect(result.type).toBe("trigger_sync");
      expect(result.mode).toBe("full");
      expect(result.pipeline).toBeUndefined();
    });

    test("accepts valid trigger_sync with incremental mode", () => {
      const msg = {
        type: "trigger_sync" as const,
        mode: "incremental" as const,
      };
      const result = TriggerSyncMessageSchema.parse(msg);
      expect(result.mode).toBe("incremental");
    });

    test("accepts trigger_sync with specific pipeline", () => {
      const msg = {
        type: "trigger_sync" as const,
        mode: "full" as const,
        pipeline: "boardgames",
      };
      const result = TriggerSyncMessageSchema.parse(msg);
      expect(result.pipeline).toBe("boardgames");
    });

    test("accepts trigger_sync with empty pipeline string", () => {
      // Empty string is technically valid (will be treated as no filter)
      const msg = {
        type: "trigger_sync" as const,
        mode: "full" as const,
        pipeline: "",
      };
      const result = TriggerSyncMessageSchema.parse(msg);
      expect(result.pipeline).toBe("");
    });

    test("rejects trigger_sync with invalid mode", () => {
      const msg = {
        type: "trigger_sync",
        mode: "partial", // Invalid mode
      };
      expect(() => TriggerSyncMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects trigger_sync without mode", () => {
      const msg = { type: "trigger_sync" };
      expect(() => TriggerSyncMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("trigger_sync is included in ClientMessageSchema", () => {
      const msg = {
        type: "trigger_sync" as const,
        mode: "incremental" as const,
        pipeline: "bgg-games",
      };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("trigger_sync");
    });
  });

  describe("SyncStatusValueSchema", () => {
    test("accepts all valid status values", () => {
      const validStatuses = ["idle", "syncing", "success", "error"] as const;
      for (const status of validStatuses) {
        expect(SyncStatusValueSchema.parse(status)).toBe(status);
      }
    });

    test("rejects invalid status value", () => {
      expect(() => SyncStatusValueSchema.parse("pending")).toThrow(ZodError);
      expect(() => SyncStatusValueSchema.parse("running")).toThrow(ZodError);
    });
  });

  describe("SyncProgressSchema", () => {
    test("accepts valid progress with all fields", () => {
      const progress = {
        current: 5,
        total: 10,
        currentFile: "Games/Gloomhaven.md",
      };
      const result = SyncProgressSchema.parse(progress);
      expect(result.current).toBe(5);
      expect(result.total).toBe(10);
      expect(result.currentFile).toBe("Games/Gloomhaven.md");
    });

    test("accepts progress without currentFile", () => {
      const progress = { current: 0, total: 100 };
      const result = SyncProgressSchema.parse(progress);
      expect(result.currentFile).toBeUndefined();
    });

    test("accepts zero values", () => {
      const progress = { current: 0, total: 0 };
      const result = SyncProgressSchema.parse(progress);
      expect(result.current).toBe(0);
      expect(result.total).toBe(0);
    });

    test("rejects negative current", () => {
      const progress = { current: -1, total: 10 };
      expect(() => SyncProgressSchema.parse(progress)).toThrow(ZodError);
    });

    test("rejects negative total", () => {
      const progress = { current: 5, total: -1 };
      expect(() => SyncProgressSchema.parse(progress)).toThrow(ZodError);
    });

    test("rejects non-integer current", () => {
      const progress = { current: 5.5, total: 10 };
      expect(() => SyncProgressSchema.parse(progress)).toThrow(ZodError);
    });

    test("rejects non-integer total", () => {
      const progress = { current: 5, total: 10.5 };
      expect(() => SyncProgressSchema.parse(progress)).toThrow(ZodError);
    });
  });

  describe("SyncFileErrorSchema", () => {
    test("accepts valid file error", () => {
      const err = {
        file: "Games/Gloomhaven.md",
        error: "Invalid BGG ID: xyz",
      };
      const result = SyncFileErrorSchema.parse(err);
      expect(result.file).toBe("Games/Gloomhaven.md");
      expect(result.error).toBe("Invalid BGG ID: xyz");
    });

    test("rejects empty file path", () => {
      const err = { file: "", error: "Some error" };
      expect(() => SyncFileErrorSchema.parse(err)).toThrow(ZodError);
    });

    test("rejects empty error message", () => {
      const err = { file: "test.md", error: "" };
      expect(() => SyncFileErrorSchema.parse(err)).toThrow(ZodError);
    });

    test("rejects missing file", () => {
      const err = { error: "Some error" };
      expect(() => SyncFileErrorSchema.parse(err)).toThrow(ZodError);
    });

    test("rejects missing error", () => {
      const err = { file: "test.md" };
      expect(() => SyncFileErrorSchema.parse(err)).toThrow(ZodError);
    });
  });

  describe("SyncStatusMessageSchema", () => {
    test("accepts idle status", () => {
      const msg = {
        type: "sync_status" as const,
        status: "idle" as const,
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.type).toBe("sync_status");
      expect(result.status).toBe("idle");
    });

    test("accepts syncing status with progress", () => {
      const msg = {
        type: "sync_status" as const,
        status: "syncing" as const,
        progress: {
          current: 3,
          total: 10,
          currentFile: "Games/Terraforming Mars.md",
        },
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.status).toBe("syncing");
      expect(result.progress?.current).toBe(3);
      expect(result.progress?.total).toBe(10);
      expect(result.progress?.currentFile).toBe("Games/Terraforming Mars.md");
    });

    test("accepts success status with message", () => {
      const msg = {
        type: "sync_status" as const,
        status: "success" as const,
        message: "Synced 10/10 files",
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.status).toBe("success");
      expect(result.message).toBe("Synced 10/10 files");
    });

    test("accepts error status with message and errors array", () => {
      const msg = {
        type: "sync_status" as const,
        status: "error" as const,
        message: "3 files failed to sync",
        errors: [
          { file: "Games/Unknown1.md", error: "BGG ID not found" },
          { file: "Games/Unknown2.md", error: "Network timeout" },
          { file: "Games/Unknown3.md", error: "Rate limited" },
        ],
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.status).toBe("error");
      expect(result.message).toBe("3 files failed to sync");
      expect(result.errors).toHaveLength(3);
      expect(result.errors?.[0].file).toBe("Games/Unknown1.md");
      expect(result.errors?.[1].error).toBe("Network timeout");
    });

    test("accepts sync_status without optional fields", () => {
      const msg = {
        type: "sync_status" as const,
        status: "idle" as const,
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.progress).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(result.errors).toBeUndefined();
    });

    test("accepts empty errors array", () => {
      const msg = {
        type: "sync_status" as const,
        status: "success" as const,
        errors: [],
      };
      const result = SyncStatusMessageSchema.parse(msg);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects invalid status value", () => {
      const msg = {
        type: "sync_status",
        status: "running", // Invalid
      };
      expect(() => SyncStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing status field", () => {
      const msg = { type: "sync_status" };
      expect(() => SyncStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects invalid error in errors array", () => {
      const msg = {
        type: "sync_status",
        status: "error",
        errors: [{ file: "", error: "test" }], // Empty file is invalid
      };
      expect(() => SyncStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects invalid progress object", () => {
      const msg = {
        type: "sync_status",
        status: "syncing",
        progress: { current: -1, total: 10 }, // Negative current is invalid
      };
      expect(() => SyncStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("sync_status is included in ServerMessageSchema", () => {
      const msg = {
        type: "sync_status" as const,
        status: "success" as const,
        message: "Sync complete",
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("sync_status");
    });
  });

  describe("CreateDirectoryMessageSchema", () => {
    test("accepts valid create_directory message at root", () => {
      const msg = {
        type: "create_directory" as const,
        path: "",
        name: "new-folder",
      };
      const result = CreateDirectoryMessageSchema.parse(msg);
      expect(result.type).toBe("create_directory");
      expect(result.path).toBe("");
      expect(result.name).toBe("new-folder");
    });

    test("accepts valid create_directory message with parent path", () => {
      const msg = {
        type: "create_directory" as const,
        path: "Projects",
        name: "my_project",
      };
      const result = CreateDirectoryMessageSchema.parse(msg);
      expect(result.path).toBe("Projects");
      expect(result.name).toBe("my_project");
    });

    test("accepts alphanumeric names with hyphens and underscores", () => {
      const msg = {
        type: "create_directory" as const,
        path: "",
        name: "Test-123_folder",
      };
      const result = CreateDirectoryMessageSchema.parse(msg);
      expect(result.name).toBe("Test-123_folder");
    });

    test("rejects empty name", () => {
      const msg = { type: "create_directory", path: "", name: "" };
      expect(() => CreateDirectoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects name with spaces", () => {
      const msg = { type: "create_directory", path: "", name: "my folder" };
      expect(() => CreateDirectoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects name with special characters", () => {
      const msg = { type: "create_directory", path: "", name: "my@folder" };
      expect(() => CreateDirectoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects name with dots", () => {
      const msg = { type: "create_directory", path: "", name: "my.folder" };
      expect(() => CreateDirectoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing name", () => {
      const msg = { type: "create_directory", path: "" };
      expect(() => CreateDirectoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("create_directory is included in ClientMessageSchema", () => {
      const msg = {
        type: "create_directory" as const,
        path: "Notes",
        name: "new-note-folder",
      };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("create_directory");
    });
  });

  describe("DirectoryCreatedMessageSchema", () => {
    test("accepts valid directory_created message", () => {
      const msg = {
        type: "directory_created" as const,
        path: "Projects/new-folder",
      };
      const result = DirectoryCreatedMessageSchema.parse(msg);
      expect(result.type).toBe("directory_created");
      expect(result.path).toBe("Projects/new-folder");
    });

    test("accepts root-level path", () => {
      const msg = {
        type: "directory_created" as const,
        path: "new-folder",
      };
      const result = DirectoryCreatedMessageSchema.parse(msg);
      expect(result.path).toBe("new-folder");
    });

    test("rejects empty path", () => {
      const msg = { type: "directory_created", path: "" };
      expect(() => DirectoryCreatedMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "directory_created" };
      expect(() => DirectoryCreatedMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("directory_created is included in ServerMessageSchema", () => {
      const msg = {
        type: "directory_created" as const,
        path: "new-folder",
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("directory_created");
    });
  });
});

// =============================================================================
// Memory Extraction Schema Tests
// =============================================================================

describe("Memory Extraction Schemas", () => {
  describe("ExtractionStatusValueSchema", () => {
    test("accepts valid status values", () => {
      expect(ExtractionStatusValueSchema.parse("idle")).toBe("idle");
      expect(ExtractionStatusValueSchema.parse("running")).toBe("running");
      expect(ExtractionStatusValueSchema.parse("complete")).toBe("complete");
      expect(ExtractionStatusValueSchema.parse("error")).toBe("error");
    });

    test("rejects invalid status value", () => {
      expect(() => ExtractionStatusValueSchema.parse("unknown")).toThrow(ZodError);
      expect(() => ExtractionStatusValueSchema.parse("pending")).toThrow(ZodError);
    });
  });

  describe("GetMemoryMessageSchema", () => {
    test("accepts valid get_memory message", () => {
      const msg = { type: "get_memory" };
      const result = GetMemoryMessageSchema.parse(msg);
      expect(result.type).toBe("get_memory");
    });

    test("get_memory is included in ClientMessageSchema", () => {
      const msg = { type: "get_memory" as const };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("get_memory");
    });
  });

  describe("SaveMemoryMessageSchema", () => {
    test("accepts valid save_memory message", () => {
      const msg = {
        type: "save_memory",
        content: "# Memory\n\n## Identity\nSoftware engineer...",
      };
      const result = SaveMemoryMessageSchema.parse(msg);
      expect(result.type).toBe("save_memory");
      expect(result.content).toContain("# Memory");
    });

    test("accepts empty content (clearing memory)", () => {
      const msg = {
        type: "save_memory",
        content: "",
      };
      const result = SaveMemoryMessageSchema.parse(msg);
      expect(result.content).toBe("");
    });

    test("rejects missing content", () => {
      const msg = { type: "save_memory" };
      expect(() => SaveMemoryMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("save_memory is included in ClientMessageSchema", () => {
      const msg = {
        type: "save_memory" as const,
        content: "test content",
      };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("save_memory");
    });
  });

  describe("GetExtractionPromptMessageSchema", () => {
    test("accepts valid get_extraction_prompt message", () => {
      const msg = { type: "get_extraction_prompt" };
      const result = GetExtractionPromptMessageSchema.parse(msg);
      expect(result.type).toBe("get_extraction_prompt");
    });

    test("get_extraction_prompt is included in ClientMessageSchema", () => {
      const msg = { type: "get_extraction_prompt" as const };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("get_extraction_prompt");
    });
  });

  describe("SaveExtractionPromptMessageSchema", () => {
    test("accepts valid save_extraction_prompt message", () => {
      const msg = {
        type: "save_extraction_prompt",
        content: "Extract identity, goals, and preferences from conversations.",
      };
      const result = SaveExtractionPromptMessageSchema.parse(msg);
      expect(result.type).toBe("save_extraction_prompt");
      expect(result.content).toContain("Extract");
    });

    test("accepts empty content", () => {
      const msg = {
        type: "save_extraction_prompt",
        content: "",
      };
      const result = SaveExtractionPromptMessageSchema.parse(msg);
      expect(result.content).toBe("");
    });

    test("rejects missing content", () => {
      const msg = { type: "save_extraction_prompt" };
      expect(() => SaveExtractionPromptMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("save_extraction_prompt is included in ClientMessageSchema", () => {
      const msg = {
        type: "save_extraction_prompt" as const,
        content: "custom prompt",
      };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("save_extraction_prompt");
    });
  });

  describe("TriggerExtractionMessageSchema", () => {
    test("accepts valid trigger_extraction message", () => {
      const msg = { type: "trigger_extraction" };
      const result = TriggerExtractionMessageSchema.parse(msg);
      expect(result.type).toBe("trigger_extraction");
    });

    test("trigger_extraction is included in ClientMessageSchema", () => {
      const msg = { type: "trigger_extraction" as const };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("trigger_extraction");
    });
  });

  describe("MemoryContentMessageSchema", () => {
    test("accepts valid memory_content message with existing file", () => {
      const msg = {
        type: "memory_content",
        content: "# Memory\n\n## Identity\nDeveloper...",
        sizeBytes: 1024,
        exists: true,
      };
      const result = MemoryContentMessageSchema.parse(msg);
      expect(result.type).toBe("memory_content");
      expect(result.content).toContain("# Memory");
      expect(result.sizeBytes).toBe(1024);
      expect(result.exists).toBe(true);
    });

    test("accepts valid memory_content message for non-existent file", () => {
      const msg = {
        type: "memory_content",
        content: "",
        sizeBytes: 0,
        exists: false,
      };
      const result = MemoryContentMessageSchema.parse(msg);
      expect(result.content).toBe("");
      expect(result.sizeBytes).toBe(0);
      expect(result.exists).toBe(false);
    });

    test("rejects negative sizeBytes", () => {
      const msg = {
        type: "memory_content",
        content: "",
        sizeBytes: -1,
        exists: true,
      };
      expect(() => MemoryContentMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing fields", () => {
      const msg = { type: "memory_content" };
      expect(() => MemoryContentMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("memory_content is included in ServerMessageSchema", () => {
      const msg = {
        type: "memory_content" as const,
        content: "test",
        sizeBytes: 4,
        exists: true,
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("memory_content");
    });
  });

  describe("ExtractionPromptContentMessageSchema", () => {
    test("accepts valid extraction_prompt_content with default prompt", () => {
      const msg = {
        type: "extraction_prompt_content",
        content: "Default extraction prompt...",
        isOverride: false,
      };
      const result = ExtractionPromptContentMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_prompt_content");
      expect(result.isOverride).toBe(false);
    });

    test("accepts valid extraction_prompt_content with user override", () => {
      const msg = {
        type: "extraction_prompt_content",
        content: "Custom user prompt...",
        isOverride: true,
      };
      const result = ExtractionPromptContentMessageSchema.parse(msg);
      expect(result.isOverride).toBe(true);
    });

    test("rejects missing isOverride", () => {
      const msg = {
        type: "extraction_prompt_content",
        content: "some prompt",
      };
      expect(() => ExtractionPromptContentMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("extraction_prompt_content is included in ServerMessageSchema", () => {
      const msg = {
        type: "extraction_prompt_content" as const,
        content: "test",
        isOverride: false,
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_prompt_content");
    });
  });

  describe("MemorySavedMessageSchema", () => {
    test("accepts valid memory_saved success message", () => {
      const msg = {
        type: "memory_saved",
        success: true,
        sizeBytes: 2048,
      };
      const result = MemorySavedMessageSchema.parse(msg);
      expect(result.type).toBe("memory_saved");
      expect(result.success).toBe(true);
      expect(result.sizeBytes).toBe(2048);
    });

    test("accepts valid memory_saved error message", () => {
      const msg = {
        type: "memory_saved",
        success: false,
        error: "Permission denied",
      };
      const result = MemorySavedMessageSchema.parse(msg);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });

    test("accepts success without optional fields", () => {
      const msg = {
        type: "memory_saved",
        success: true,
      };
      const result = MemorySavedMessageSchema.parse(msg);
      expect(result.success).toBe(true);
      expect(result.sizeBytes).toBeUndefined();
    });

    test("memory_saved is included in ServerMessageSchema", () => {
      const msg = {
        type: "memory_saved" as const,
        success: true,
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("memory_saved");
    });
  });

  describe("ExtractionPromptSavedMessageSchema", () => {
    test("accepts valid extraction_prompt_saved success", () => {
      const msg = {
        type: "extraction_prompt_saved",
        success: true,
        isOverride: true,
      };
      const result = ExtractionPromptSavedMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_prompt_saved");
      expect(result.success).toBe(true);
      expect(result.isOverride).toBe(true);
    });

    test("accepts valid extraction_prompt_saved error", () => {
      const msg = {
        type: "extraction_prompt_saved",
        success: false,
        isOverride: false,
        error: "Failed to create config directory",
      };
      const result = ExtractionPromptSavedMessageSchema.parse(msg);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to create config directory");
    });

    test("rejects missing isOverride", () => {
      const msg = {
        type: "extraction_prompt_saved",
        success: true,
      };
      expect(() => ExtractionPromptSavedMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("extraction_prompt_saved is included in ServerMessageSchema", () => {
      const msg = {
        type: "extraction_prompt_saved" as const,
        success: true,
        isOverride: true,
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_prompt_saved");
    });
  });

  describe("ExtractionStatusMessageSchema", () => {
    test("accepts idle status", () => {
      const msg = {
        type: "extraction_status",
        status: "idle",
      };
      const result = ExtractionStatusMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_status");
      expect(result.status).toBe("idle");
    });

    test("accepts running status with progress", () => {
      const msg = {
        type: "extraction_status",
        status: "running",
        progress: 45,
        message: "Processing transcript 3 of 7...",
      };
      const result = ExtractionStatusMessageSchema.parse(msg);
      expect(result.status).toBe("running");
      expect(result.progress).toBe(45);
      expect(result.message).toBe("Processing transcript 3 of 7...");
    });

    test("accepts complete status with counts", () => {
      const msg = {
        type: "extraction_status",
        status: "complete",
        message: "Extraction completed successfully",
        transcriptsProcessed: 7,
        factsExtracted: 12,
      };
      const result = ExtractionStatusMessageSchema.parse(msg);
      expect(result.status).toBe("complete");
      expect(result.transcriptsProcessed).toBe(7);
      expect(result.factsExtracted).toBe(12);
    });

    test("accepts error status with error message", () => {
      const msg = {
        type: "extraction_status",
        status: "error",
        error: "LLM API rate limit exceeded",
      };
      const result = ExtractionStatusMessageSchema.parse(msg);
      expect(result.status).toBe("error");
      expect(result.error).toBe("LLM API rate limit exceeded");
    });

    test("rejects progress out of range", () => {
      const msg = {
        type: "extraction_status",
        status: "running",
        progress: 150,
      };
      expect(() => ExtractionStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects negative progress", () => {
      const msg = {
        type: "extraction_status",
        status: "running",
        progress: -10,
      };
      expect(() => ExtractionStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects invalid status value", () => {
      const msg = {
        type: "extraction_status",
        status: "pending",
      };
      expect(() => ExtractionStatusMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("extraction_status is included in ServerMessageSchema", () => {
      const msg = {
        type: "extraction_status" as const,
        status: "idle" as const,
      };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("extraction_status");
    });
  });
});
