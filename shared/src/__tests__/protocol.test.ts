/**
 * Protocol Schema Tests
 *
 * Comprehensive tests for WebSocket message validation using Zod schemas.
 * Tests cover valid messages, invalid messages, and edge cases.
 *
 * Note: Many message types have been migrated to REST API (TASK-017).
 * This file tests only the remaining WebSocket message schemas.
 */

import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import {
  // Client message schemas
  ClientMessageSchema,
  SelectVaultMessageSchema,
  DiscussionMessageSchema,
  ResumeSessionMessageSchema,
  NewSessionMessageSchema,
  AbortMessageSchema,
  PingMessageSchema,
  ToolPermissionResponseMessageSchema,
  AskUserQuestionResponseMessageSchema,
  DismissHealthIssueMessageSchema,
  // Server message schemas
  ServerMessageSchema,
  VaultListMessageSchema,
  SessionReadyMessageSchema,
  ResponseStartMessageSchema,
  ResponseChunkMessageSchema,
  ResponseEndMessageSchema,
  ToolStartMessageSchema,
  ToolInputMessageSchema,
  ToolEndMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
  ToolPermissionRequestMessageSchema,
  AskUserQuestionRequestMessageSchema,
  // Health schemas
  HealthSeveritySchema,
  HealthCategorySchema,
  HealthIssueSchema,
  HealthReportMessageSchema,
  // AskUserQuestion schemas
  AskUserQuestionOptionSchema,
  AskUserQuestionItemSchema,
  // Memory Extraction schemas
  ExtractionStatusValueSchema,
  GetExtractionPromptMessageSchema,
  SaveExtractionPromptMessageSchema,
  TriggerExtractionMessageSchema,
  ExtractionPromptContentMessageSchema,
  ExtractionPromptSavedMessageSchema,
  ExtractionStatusMessageSchema,
  // Data schemas (used by REST API but still exported)
  InspirationItemSchema,
  MeetingStateSchema,
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
      promptsPerGeneration: 5,
      maxPoolSize: 50,
      quotesPerWeek: 3,
      badges: [],
      order: 0,
      cardsEnabled: true,
      viMode: false,
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

    validCodes.forEach((code) => {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    });
  });

  test("rejects invalid error codes", () => {
    expect(() => ErrorCodeSchema.parse("INVALID_CODE")).toThrow(ZodError);
    expect(() => ErrorCodeSchema.parse("")).toThrow(ZodError);
    expect(() => ErrorCodeSchema.parse(null)).toThrow(ZodError);
  });
});

// =============================================================================
// FileEntry Schema Tests
// =============================================================================

describe("FileEntrySchema", () => {
  test("accepts valid file entry", () => {
    const validFile = {
      name: "test.md",
      type: "file",
      path: "folder/test.md",
    };

    const result = FileEntrySchema.parse(validFile);
    expect(result.name).toBe("test.md");
    expect(result.type).toBe("file");
    expect(result.path).toBe("folder/test.md");
  });

  test("accepts valid directory entry", () => {
    const validDir = {
      name: "subfolder",
      type: "directory",
      path: "folder/subfolder",
    };

    const result = FileEntrySchema.parse(validDir);
    expect(result.name).toBe("subfolder");
    expect(result.type).toBe("directory");
  });

  test("rejects invalid type", () => {
    const invalidEntry = {
      name: "test.md",
      type: "symlink",
      path: "test.md",
    };

    expect(() => FileEntrySchema.parse(invalidEntry)).toThrow(ZodError);
  });
});

// =============================================================================
// TaskEntry Schema Tests
// =============================================================================

describe("TaskEntrySchema", () => {
  test("accepts valid task entry with all fields", () => {
    const validTask = {
      text: "Complete the documentation",
      state: " ",
      filePath: "00_Inbox/2024-01-15.md",
      lineNumber: 42,
      fileMtime: 1705320000000,
      category: "inbox",
    };

    const result = TaskEntrySchema.parse(validTask);
    expect(result.text).toBe("Complete the documentation");
    expect(result.state).toBe(" ");
    expect(result.filePath).toBe("00_Inbox/2024-01-15.md");
    expect(result.lineNumber).toBe(42);
    expect(result.fileMtime).toBe(1705320000000);
    expect(result.category).toBe("inbox");
  });

  test("accepts valid completed task", () => {
    const completedTask = {
      text: "Review pull request",
      state: "x",
      filePath: "01_Projects/memory-loop/tasks.md",
      lineNumber: 15,
      fileMtime: 1705320000000,
      category: "projects",
    };

    const result = TaskEntrySchema.parse(completedTask);
    expect(result.state).toBe("x");
    expect(result.category).toBe("projects");
  });

  test("rejects invalid category", () => {
    const invalidTask = {
      text: "Task text",
      state: " ",
      filePath: "path/to/file.md",
      lineNumber: 1,
      fileMtime: 0,
      category: "invalid",
    };

    expect(() => TaskEntrySchema.parse(invalidTask)).toThrow(ZodError);
  });

  test("rejects multi-character state", () => {
    const invalidTask = {
      text: "Task text",
      state: "xx",
      filePath: "path/to/file.md",
      lineNumber: 1,
      fileMtime: 0,
      category: "inbox",
    };

    expect(() => TaskEntrySchema.parse(invalidTask)).toThrow(ZodError);
  });
});

// =============================================================================
// SlashCommand Schema Tests
// =============================================================================

describe("SlashCommandSchema", () => {
  test("accepts valid slash command", () => {
    const validCommand = {
      name: "/commit",
      description: "Commit changes to the repository",
    };

    const result = SlashCommandSchema.parse(validCommand);
    expect(result.name).toBe("/commit");
    expect(result.description).toBe("Commit changes to the repository");
  });

  test("accepts command with argument hint", () => {
    const commandWithHint = {
      name: "/search",
      description: "Search for files",
      argumentHint: "<query>",
    };

    const result = SlashCommandSchema.parse(commandWithHint);
    expect(result.argumentHint).toBe("<query>");
  });

  test("rejects command name without /", () => {
    const invalidCommand = {
      name: "c",
      description: "Description",
    };

    expect(() => SlashCommandSchema.parse(invalidCommand)).toThrow(ZodError);
  });
});

// =============================================================================
// InspirationItem Schema Tests (used by REST API)
// =============================================================================

describe("InspirationItemSchema", () => {
  test("accepts valid inspiration with attribution", () => {
    const validInspiration = {
      text: "The best time to plant a tree was 20 years ago.",
      attribution: "Chinese Proverb",
    };

    const result = InspirationItemSchema.parse(validInspiration);
    expect(result.text).toBe("The best time to plant a tree was 20 years ago.");
    expect(result.attribution).toBe("Chinese Proverb");
  });

  test("accepts inspiration without attribution", () => {
    const noAttribution = {
      text: "What have you learned recently?",
    };

    const result = InspirationItemSchema.parse(noAttribution);
    expect(result.text).toBe("What have you learned recently?");
    expect(result.attribution).toBeUndefined();
  });

  test("rejects empty text", () => {
    const emptyText = {
      text: "",
    };

    expect(() => InspirationItemSchema.parse(emptyText)).toThrow(ZodError);
  });
});

// =============================================================================
// MeetingState Schema Tests (used by REST API)
// =============================================================================

describe("MeetingStateSchema", () => {
  test("accepts active meeting state", () => {
    const activeMeeting = {
      isActive: true,
      title: "Sprint Planning",
      filePath: "00_Inbox/meetings/2024-01-15-sprint-planning.md",
      startedAt: "2024-01-15T10:00:00.000Z",
    };

    const result = MeetingStateSchema.parse(activeMeeting);
    expect(result.isActive).toBe(true);
    expect(result.title).toBe("Sprint Planning");
    expect(result.filePath).toBe("00_Inbox/meetings/2024-01-15-sprint-planning.md");
  });

  test("accepts inactive meeting state", () => {
    const inactiveMeeting = {
      isActive: false,
    };

    const result = MeetingStateSchema.parse(inactiveMeeting);
    expect(result.isActive).toBe(false);
    expect(result.title).toBeUndefined();
  });
});

// =============================================================================
// Client -> Server Messages
// =============================================================================

describe("Client -> Server Messages", () => {
  describe("SelectVaultMessageSchema", () => {
    test("accepts valid vault selection", () => {
      const validMessage = {
        type: "select_vault",
        vaultId: "my-vault",
      };

      const result = SelectVaultMessageSchema.parse(validMessage);
      expect(result.type).toBe("select_vault");
      expect(result.vaultId).toBe("my-vault");
    });

    test("rejects empty vaultId", () => {
      const invalidMessage = {
        type: "select_vault",
        vaultId: "",
      };

      expect(() => SelectVaultMessageSchema.parse(invalidMessage)).toThrow(ZodError);
    });
  });

  describe("DiscussionMessageSchema", () => {
    test("accepts valid discussion message", () => {
      const validMessage = {
        type: "discussion_message",
        text: "What are my goals for this week?",
      };

      const result = DiscussionMessageSchema.parse(validMessage);
      expect(result.type).toBe("discussion_message");
      expect(result.text).toBe("What are my goals for this week?");
    });

    test("rejects empty text", () => {
      const invalidMessage = {
        type: "discussion_message",
        text: "",
      };

      expect(() => DiscussionMessageSchema.parse(invalidMessage)).toThrow(ZodError);
    });
  });

  describe("ResumeSessionMessageSchema", () => {
    test("accepts valid resume message", () => {
      const validMessage = {
        type: "resume_session",
        sessionId: "session-123",
      };

      const result = ResumeSessionMessageSchema.parse(validMessage);
      expect(result.sessionId).toBe("session-123");
    });
  });

  describe("NewSessionMessageSchema", () => {
    test("accepts valid new session message", () => {
      const validMessage = {
        type: "new_session",
      };

      const result = NewSessionMessageSchema.parse(validMessage);
      expect(result.type).toBe("new_session");
    });
  });

  describe("AbortMessageSchema", () => {
    test("accepts valid abort message", () => {
      const validMessage = { type: "abort" };
      const result = AbortMessageSchema.parse(validMessage);
      expect(result.type).toBe("abort");
    });
  });

  describe("PingMessageSchema", () => {
    test("accepts valid ping message", () => {
      const validMessage = { type: "ping" };
      const result = PingMessageSchema.parse(validMessage);
      expect(result.type).toBe("ping");
    });
  });

  describe("ToolPermissionResponseMessageSchema", () => {
    test("accepts allowed response", () => {
      const validMessage = {
        type: "tool_permission_response",
        toolUseId: "tool-123",
        allowed: true,
      };

      const result = ToolPermissionResponseMessageSchema.parse(validMessage);
      expect(result.allowed).toBe(true);
    });

    test("accepts denied response", () => {
      const validMessage = {
        type: "tool_permission_response",
        toolUseId: "tool-123",
        allowed: false,
      };

      const result = ToolPermissionResponseMessageSchema.parse(validMessage);
      expect(result.allowed).toBe(false);
    });
  });

  describe("AskUserQuestionResponseMessageSchema", () => {
    test("accepts valid response", () => {
      const validMessage = {
        type: "ask_user_question_response",
        toolUseId: "tool-123",
        answers: {
          "Question 1": "Answer 1",
          "Question 2": "Answer 2",
        },
      };

      const result = AskUserQuestionResponseMessageSchema.parse(validMessage);
      expect(result.answers["Question 1"]).toBe("Answer 1");
    });
  });

  describe("DismissHealthIssueMessageSchema", () => {
    test("accepts valid dismiss message", () => {
      const validMessage = {
        type: "dismiss_health_issue",
        issueId: "issue-123",
      };

      const result = DismissHealthIssueMessageSchema.parse(validMessage);
      expect(result.issueId).toBe("issue-123");
    });
  });

  describe("ClientMessageSchema (discriminated union)", () => {
    test("parses select_vault message", () => {
      const message = {
        type: "select_vault",
        vaultId: "my-vault",
      };

      const result = ClientMessageSchema.parse(message);
      expect(result.type).toBe("select_vault");
    });

    test("parses discussion_message", () => {
      const message = {
        type: "discussion_message",
        text: "Hello!",
      };

      const result = ClientMessageSchema.parse(message);
      expect(result.type).toBe("discussion_message");
    });

    test("parses ping message", () => {
      const message = { type: "ping" };
      const result = ClientMessageSchema.parse(message);
      expect(result.type).toBe("ping");
    });

    test("rejects unknown message type", () => {
      const invalidMessage = {
        type: "unknown_type",
        data: "test",
      };

      expect(() => ClientMessageSchema.parse(invalidMessage)).toThrow(ZodError);
    });
  });
});

// =============================================================================
// Server -> Client Messages
// =============================================================================

describe("Server -> Client Messages", () => {
  describe("VaultListMessageSchema", () => {
    test("accepts valid vault list", () => {
      const validMessage = {
        type: "vault_list",
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
            promptsPerGeneration: 5,
            maxPoolSize: 50,
            quotesPerWeek: 3,
            badges: [],
            order: 1,
            cardsEnabled: true,
            viMode: false,
          },
        ],
      };

      const result = VaultListMessageSchema.parse(validMessage);
      expect(result.vaults).toHaveLength(1);
      expect(result.vaults[0].name).toBe("Vault 1");
    });

    test("accepts empty vault list", () => {
      const emptyList = {
        type: "vault_list",
        vaults: [],
      };

      const result = VaultListMessageSchema.parse(emptyList);
      expect(result.vaults).toHaveLength(0);
    });
  });

  describe("SessionReadyMessageSchema", () => {
    test("accepts valid session ready", () => {
      const validMessage = {
        type: "session_ready",
        sessionId: "session-123",
        vaultId: "vault-1",
      };

      const result = SessionReadyMessageSchema.parse(validMessage);
      expect(result.sessionId).toBe("session-123");
      expect(result.vaultId).toBe("vault-1");
    });

    test("accepts empty sessionId", () => {
      const lazySession = {
        type: "session_ready",
        sessionId: "",
        vaultId: "vault-1",
      };

      const result = SessionReadyMessageSchema.parse(lazySession);
      expect(result.sessionId).toBe("");
    });

    test("accepts session with slash commands", () => {
      const messageWithCommands = {
        type: "session_ready",
        sessionId: "session-123",
        vaultId: "vault-1",
        slashCommands: [
          { name: "/commit", description: "Commit changes" },
          { name: "/search", description: "Search files", argumentHint: "<query>" },
        ],
      };

      const result = SessionReadyMessageSchema.parse(messageWithCommands);
      expect(result.slashCommands).toHaveLength(2);
    });
  });

  describe("Response streaming messages", () => {
    test("accepts valid response_start", () => {
      const validMessage = {
        type: "response_start",
        messageId: "msg-123",
      };

      const result = ResponseStartMessageSchema.parse(validMessage);
      expect(result.messageId).toBe("msg-123");
    });

    test("accepts valid response_chunk", () => {
      const validMessage = {
        type: "response_chunk",
        messageId: "msg-123",
        content: "Hello, ",
      };

      const result = ResponseChunkMessageSchema.parse(validMessage);
      expect(result.content).toBe("Hello, ");
    });

    test("accepts empty response_chunk content", () => {
      const emptyChunk = {
        type: "response_chunk",
        messageId: "msg-123",
        content: "",
      };

      const result = ResponseChunkMessageSchema.parse(emptyChunk);
      expect(result.content).toBe("");
    });

    test("accepts valid response_end", () => {
      const validMessage = {
        type: "response_end",
        messageId: "msg-123",
        contextUsage: 45.5,
        durationMs: 1234,
      };

      const result = ResponseEndMessageSchema.parse(validMessage);
      expect(result.contextUsage).toBe(45.5);
      expect(result.durationMs).toBe(1234);
    });
  });

  describe("Tool messages", () => {
    test("accepts valid tool_start", () => {
      const validMessage = {
        type: "tool_start",
        toolName: "read_file",
        toolUseId: "tool-123",
      };

      const result = ToolStartMessageSchema.parse(validMessage);
      expect(result.toolName).toBe("read_file");
    });

    test("accepts valid tool_input", () => {
      const validMessage = {
        type: "tool_input",
        toolUseId: "tool-123",
        input: { path: "README.md" },
      };

      const result = ToolInputMessageSchema.parse(validMessage);
      expect(result.input).toEqual({ path: "README.md" });
    });

    test("accepts valid tool_end", () => {
      const validMessage = {
        type: "tool_end",
        toolUseId: "tool-123",
        output: "File content here",
      };

      const result = ToolEndMessageSchema.parse(validMessage);
      expect(result.output).toBe("File content here");
    });
  });

  describe("ErrorMessageSchema", () => {
    test("accepts valid error message", () => {
      const validMessage = {
        type: "error",
        code: "VAULT_NOT_FOUND",
        message: "Vault 'test' not found",
      };

      const result = ErrorMessageSchema.parse(validMessage);
      expect(result.code).toBe("VAULT_NOT_FOUND");
      expect(result.message).toBe("Vault 'test' not found");
    });

    test("rejects invalid error code", () => {
      const invalidMessage = {
        type: "error",
        code: "INVALID_CODE",
        message: "Error message",
      };

      expect(() => ErrorMessageSchema.parse(invalidMessage)).toThrow(ZodError);
    });
  });

  describe("PongMessageSchema", () => {
    test("accepts valid pong message", () => {
      const validMessage = { type: "pong" };
      const result = PongMessageSchema.parse(validMessage);
      expect(result.type).toBe("pong");
    });
  });

  describe("ToolPermissionRequestMessageSchema", () => {
    test("accepts valid permission request", () => {
      const validMessage = {
        type: "tool_permission_request",
        toolUseId: "tool-123",
        toolName: "bash",
        input: { command: "rm -rf /" },
      };

      const result = ToolPermissionRequestMessageSchema.parse(validMessage);
      expect(result.toolName).toBe("bash");
    });
  });

  describe("AskUserQuestionRequestMessageSchema", () => {
    test("accepts valid question request", () => {
      const validMessage = {
        type: "ask_user_question_request",
        toolUseId: "tool-123",
        questions: [
          {
            question: "Choose a color",
            header: "Color",
            options: [
              { label: "Red", description: "A warm color" },
              { label: "Blue", description: "A cool color" },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = AskUserQuestionRequestMessageSchema.parse(validMessage);
      expect(result.questions).toHaveLength(1);
    });
  });

  describe("Health schemas", () => {
    test("HealthSeveritySchema accepts valid values", () => {
      expect(HealthSeveritySchema.parse("error")).toBe("error");
      expect(HealthSeveritySchema.parse("warning")).toBe("warning");
    });

    test("HealthCategorySchema accepts valid values", () => {
      expect(HealthCategorySchema.parse("vault_config")).toBe("vault_config");
      expect(HealthCategorySchema.parse("file_watcher")).toBe("file_watcher");
      expect(HealthCategorySchema.parse("cache")).toBe("cache");
      expect(HealthCategorySchema.parse("general")).toBe("general");
    });

    test("HealthIssueSchema accepts valid issue", () => {
      const validIssue = {
        id: "issue-123",
        severity: "error",
        category: "vault_config",
        message: "Configuration file is invalid",
        details: "JSON parse error at line 5",
        timestamp: "2024-01-15T10:00:00.000Z",
        dismissible: true,
      };

      const result = HealthIssueSchema.parse(validIssue);
      expect(result.id).toBe("issue-123");
      expect(result.severity).toBe("error");
    });

    test("HealthReportMessageSchema accepts valid report", () => {
      const validReport = {
        type: "health_report",
        issues: [
          {
            id: "issue-1",
            severity: "warning",
            category: "cache",
            message: "Cache rebuild required",
            timestamp: "2024-01-15T10:00:00.000Z",
            dismissible: true,
          },
        ],
      };

      const result = HealthReportMessageSchema.parse(validReport);
      expect(result.issues).toHaveLength(1);
    });
  });

  describe("ServerMessageSchema (discriminated union)", () => {
    test("parses vault_list message", () => {
      const message = {
        type: "vault_list",
        vaults: [],
      };

      const result = ServerMessageSchema.parse(message);
      expect(result.type).toBe("vault_list");
    });

    test("parses session_ready message", () => {
      const message = {
        type: "session_ready",
        sessionId: "sess-123",
        vaultId: "vault-1",
      };

      const result = ServerMessageSchema.parse(message);
      expect(result.type).toBe("session_ready");
    });

    test("parses error message", () => {
      const message = {
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      };

      const result = ServerMessageSchema.parse(message);
      expect(result.type).toBe("error");
    });

    test("parses pong message", () => {
      const message = { type: "pong" };
      const result = ServerMessageSchema.parse(message);
      expect(result.type).toBe("pong");
    });

    test("rejects unknown message type", () => {
      const invalidMessage = { type: "unknown_type" };
      expect(() => ServerMessageSchema.parse(invalidMessage)).toThrow(ZodError);
    });
  });
});

// =============================================================================
// Memory Extraction Schemas
// =============================================================================

describe("Memory Extraction Schemas", () => {
  describe("ExtractionStatusValueSchema", () => {
    test("accepts valid status values", () => {
      expect(ExtractionStatusValueSchema.parse("idle")).toBe("idle");
      expect(ExtractionStatusValueSchema.parse("running")).toBe("running");
      expect(ExtractionStatusValueSchema.parse("complete")).toBe("complete");
      expect(ExtractionStatusValueSchema.parse("error")).toBe("error");
    });

    test("rejects invalid status", () => {
      expect(() => ExtractionStatusValueSchema.parse("pending")).toThrow(ZodError);
    });
  });

  describe("GetExtractionPromptMessageSchema", () => {
    test("accepts valid message", () => {
      const validMessage = { type: "get_extraction_prompt" };
      const result = GetExtractionPromptMessageSchema.parse(validMessage);
      expect(result.type).toBe("get_extraction_prompt");
    });
  });

  describe("SaveExtractionPromptMessageSchema", () => {
    test("accepts valid message", () => {
      const validMessage = {
        type: "save_extraction_prompt",
        content: "# Extraction Prompt\n\nExtract key facts...",
      };

      const result = SaveExtractionPromptMessageSchema.parse(validMessage);
      expect(result.content).toBe("# Extraction Prompt\n\nExtract key facts...");
    });

    test("accepts empty content", () => {
      const emptyContent = {
        type: "save_extraction_prompt",
        content: "",
      };

      const result = SaveExtractionPromptMessageSchema.parse(emptyContent);
      expect(result.content).toBe("");
    });
  });

  describe("TriggerExtractionMessageSchema", () => {
    test("accepts valid message", () => {
      const validMessage = { type: "trigger_extraction" };
      const result = TriggerExtractionMessageSchema.parse(validMessage);
      expect(result.type).toBe("trigger_extraction");
    });
  });

  describe("ExtractionPromptContentMessageSchema", () => {
    test("accepts valid message", () => {
      const validMessage = {
        type: "extraction_prompt_content",
        content: "# Default Prompt",
        isOverride: false,
      };

      const result = ExtractionPromptContentMessageSchema.parse(validMessage);
      expect(result.content).toBe("# Default Prompt");
      expect(result.isOverride).toBe(false);
    });
  });

  describe("ExtractionPromptSavedMessageSchema", () => {
    test("accepts successful save", () => {
      const validMessage = {
        type: "extraction_prompt_saved",
        success: true,
        isOverride: true,
      };

      const result = ExtractionPromptSavedMessageSchema.parse(validMessage);
      expect(result.success).toBe(true);
    });

    test("accepts failed save with error", () => {
      const failedMessage = {
        type: "extraction_prompt_saved",
        success: false,
        isOverride: false,
        error: "Permission denied",
      };

      const result = ExtractionPromptSavedMessageSchema.parse(failedMessage);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });
  });

  describe("ExtractionStatusMessageSchema", () => {
    test("accepts idle status", () => {
      const validMessage = {
        type: "extraction_status",
        status: "idle",
      };

      const result = ExtractionStatusMessageSchema.parse(validMessage);
      expect(result.status).toBe("idle");
    });

    test("accepts running status with progress", () => {
      const runningMessage = {
        type: "extraction_status",
        status: "running",
        progress: 45,
        message: "Processing transcript 3 of 7",
      };

      const result = ExtractionStatusMessageSchema.parse(runningMessage);
      expect(result.status).toBe("running");
      expect(result.progress).toBe(45);
    });

    test("accepts complete status with counts", () => {
      const completeMessage = {
        type: "extraction_status",
        status: "complete",
        transcriptsProcessed: 7,
        factsExtracted: 42,
      };

      const result = ExtractionStatusMessageSchema.parse(completeMessage);
      expect(result.status).toBe("complete");
      expect(result.transcriptsProcessed).toBe(7);
      expect(result.factsExtracted).toBe(42);
    });
  });
});

// =============================================================================
// Validation Utilities
// =============================================================================

describe("Validation Utilities", () => {
  describe("parseClientMessage", () => {
    test("parses valid message", () => {
      const message = { type: "ping" };
      const result = parseClientMessage(message);
      expect(result.type).toBe("ping");
    });

    test("throws on invalid message", () => {
      expect(() => parseClientMessage({ type: "invalid" })).toThrow(ZodError);
    });
  });

  describe("parseServerMessage", () => {
    test("parses valid message", () => {
      const message = { type: "pong" };
      const result = parseServerMessage(message);
      expect(result.type).toBe("pong");
    });

    test("throws on invalid message", () => {
      expect(() => parseServerMessage({ type: "invalid" })).toThrow(ZodError);
    });
  });

  describe("safeParseClientMessage", () => {
    test("returns success for valid message", () => {
      const message = { type: "ping" };
      const result = safeParseClientMessage(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("ping");
      }
    });

    test("returns error for invalid message", () => {
      const result = safeParseClientMessage({ type: "invalid" });
      expect(result.success).toBe(false);
    });
  });

  describe("safeParseServerMessage", () => {
    test("returns success for valid message", () => {
      const message = { type: "pong" };
      const result = safeParseServerMessage(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("pong");
      }
    });

    test("returns error for invalid message", () => {
      const result = safeParseServerMessage({ type: "invalid" });
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  test("ClientMessage accepts all registered types", () => {
    const messageTypes = [
      { type: "select_vault", vaultId: "test" },
      { type: "discussion_message", text: "test" },
      { type: "resume_session", sessionId: "test" },
      { type: "new_session" },
      { type: "abort" },
      { type: "ping" },
      { type: "tool_permission_response", toolUseId: "test", allowed: true },
      { type: "ask_user_question_response", toolUseId: "test", answers: {} },
      { type: "dismiss_health_issue", issueId: "test" },
    ];

    messageTypes.forEach((msg) => {
      expect(() => ClientMessageSchema.parse(msg)).not.toThrow();
    });
  });

  test("ServerMessage accepts all registered types", () => {
    const messageTypes = [
      { type: "vault_list", vaults: [] },
      { type: "session_ready", sessionId: "", vaultId: "test" },
      { type: "response_start", messageId: "test" },
      { type: "response_chunk", messageId: "test", content: "" },
      { type: "response_end", messageId: "test" },
      { type: "tool_start", toolName: "test", toolUseId: "test" },
      { type: "tool_input", toolUseId: "test", input: null },
      { type: "tool_end", toolUseId: "test", output: null },
      { type: "error", code: "INTERNAL_ERROR", message: "test" },
      { type: "pong" },
      { type: "tool_permission_request", toolUseId: "test", toolName: "test", input: null },
      { type: "ask_user_question_request", toolUseId: "test", questions: [
        { question: "q", header: "h", options: [{ label: "a", description: "" }, { label: "b", description: "" }], multiSelect: false }
      ]},
      { type: "health_report", issues: [] },
    ];

    messageTypes.forEach((msg) => {
      expect(() => ServerMessageSchema.parse(msg)).not.toThrow();
    });
  });

  test("handles undefined optional fields correctly", () => {
    const message = {
      type: "response_end",
      messageId: "test",
    };

    const result = ResponseEndMessageSchema.parse(message);
    expect(result.contextUsage).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });
});

// =============================================================================
// AskUserQuestion Schemas
// =============================================================================

describe("AskUserQuestion Schemas", () => {
  describe("AskUserQuestionOptionSchema", () => {
    test("accepts valid option", () => {
      const validOption = {
        label: "Yes",
        description: "Confirm the action",
      };

      const result = AskUserQuestionOptionSchema.parse(validOption);
      expect(result.label).toBe("Yes");
      expect(result.description).toBe("Confirm the action");
    });

    test("rejects empty label", () => {
      const invalidOption = {
        label: "",
        description: "Description",
      };

      expect(() => AskUserQuestionOptionSchema.parse(invalidOption)).toThrow(ZodError);
    });
  });

  describe("AskUserQuestionItemSchema", () => {
    test("accepts valid question", () => {
      const validQuestion = {
        question: "Do you want to proceed?",
        header: "Confirm",
        options: [
          { label: "Yes", description: "Proceed with the action" },
          { label: "No", description: "Cancel the action" },
        ],
        multiSelect: false,
      };

      const result = AskUserQuestionItemSchema.parse(validQuestion);
      expect(result.question).toBe("Do you want to proceed?");
      expect(result.options).toHaveLength(2);
    });

    test("rejects header longer than 12 characters", () => {
      const longHeader = {
        question: "Question?",
        header: "VeryLongHeader",
        options: [
          { label: "A", description: "Option A" },
          { label: "B", description: "Option B" },
        ],
        multiSelect: false,
      };

      expect(() => AskUserQuestionItemSchema.parse(longHeader)).toThrow(ZodError);
    });

    test("rejects less than 2 options", () => {
      const tooFewOptions = {
        question: "Question?",
        header: "Header",
        options: [{ label: "Only", description: "Only one option" }],
        multiSelect: false,
      };

      expect(() => AskUserQuestionItemSchema.parse(tooFewOptions)).toThrow(ZodError);
    });

    test("rejects more than 4 options", () => {
      const tooManyOptions = {
        question: "Question?",
        header: "Header",
        options: [
          { label: "A", description: "A" },
          { label: "B", description: "B" },
          { label: "C", description: "C" },
          { label: "D", description: "D" },
          { label: "E", description: "E" },
        ],
        multiSelect: false,
      };

      expect(() => AskUserQuestionItemSchema.parse(tooManyOptions)).toThrow(ZodError);
    });
  });
});
