/**
 * Session state reducer.
 *
 * Handles all state transitions for the session context.
 */

import type {
  FileEntry,
  RecentNoteEntry,
  RecentDiscussionEntry,
  TaskEntry,
  SlashCommand,
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,
  WidgetResult,
  VaultInfo,
  ConversationMessageProtocol,
  ToolInvocation,
  HealthIssue,
  MeetingState,
} from "@memory-loop/shared";

import type {
  SessionState,
  ConversationMessage,
  BrowserState,
  SearchState,
  AppMode,
  BrowseViewMode,
  SearchMode,
} from "./types.js";
import {
  createInitialBrowserState,
  createInitialWidgetState,
  createInitialHealthState,
  createInitialSyncState,
  createInitialSearchState,
  generateMessageId,
} from "./initial-state.js";

/**
 * Action types for reducer.
 */
export type SessionAction =
  | { type: "SELECT_VAULT"; vault: VaultInfo }
  | { type: "CLEAR_VAULT" }
  | { type: "SET_SESSION_ID"; sessionId: string }
  | { type: "SET_SESSION_START_TIME"; timestamp: Date }
  | { type: "SET_MODE"; mode: AppMode }
  | { type: "ADD_MESSAGE"; message: ConversationMessage }
  | { type: "UPDATE_LAST_MESSAGE"; content: string; isStreaming?: boolean }
  | { type: "CLEAR_MESSAGES" }
  | { type: "START_NEW_SESSION" }
  | { type: "SET_MESSAGES"; messages: ConversationMessageProtocol[] }
  | { type: "SET_CURRENT_PATH"; path: string }
  | { type: "TOGGLE_DIRECTORY"; path: string }
  | { type: "CACHE_DIRECTORY"; path: string; entries: FileEntry[] }
  | { type: "SET_FILE_CONTENT"; content: string; truncated: boolean }
  | { type: "SET_FILE_ERROR"; error: string }
  | { type: "SET_FILE_LOADING"; isLoading: boolean }
  | { type: "CLEAR_BROWSER_STATE" }
  | { type: "CLEAR_DIRECTORY_CACHE" }
  | { type: "SET_RECENT_NOTES"; notes: RecentNoteEntry[] }
  | { type: "SET_RECENT_DISCUSSIONS"; discussions: RecentDiscussionEntry[] }
  | { type: "REMOVE_DISCUSSION"; sessionId: string }
  | { type: "PIN_FOLDER"; path: string }
  | { type: "UNPIN_FOLDER"; path: string }
  | { type: "SET_PINNED_FOLDERS"; paths: string[] }
  | { type: "SET_GOALS"; goals: string | null }
  | { type: "SET_DISCUSSION_PREFILL"; text: string | null }
  | { type: "SET_PENDING_SESSION_ID"; sessionId: string | null }
  | { type: "SET_SHOW_NEW_SESSION_DIALOG"; show: boolean }
  | { type: "START_ADJUST" }
  | { type: "UPDATE_ADJUST_CONTENT"; content: string }
  | { type: "CANCEL_ADJUST" }
  | { type: "START_SAVE" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "SET_VIEW_MODE"; mode: BrowseViewMode }
  | { type: "SET_TASKS"; tasks: TaskEntry[] }
  | { type: "SET_TASKS_LOADING"; isLoading: boolean }
  | { type: "SET_TASKS_ERROR"; error: string | null }
  | { type: "UPDATE_TASK"; filePath: string; lineNumber: number; newState: string }
  | { type: "ADD_TOOL_TO_LAST_MESSAGE"; toolUseId: string; toolName: string }
  | { type: "UPDATE_TOOL_INPUT"; toolUseId: string; input: unknown }
  | { type: "COMPLETE_TOOL_INVOCATION"; toolUseId: string; output: unknown }
  | { type: "SET_SLASH_COMMANDS"; commands: SlashCommand[] }
  | { type: "SET_LAST_MESSAGE_CONTEXT_USAGE"; contextUsage: number }
  | { type: "SET_LAST_MESSAGE_DURATION"; durationMs: number }
  | { type: "SET_SEARCH_ACTIVE"; isActive: boolean }
  | { type: "SET_SEARCH_MODE"; mode: SearchMode }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; mode: SearchMode; fileResults?: FileSearchResult[]; contentResults?: ContentSearchResult[] }
  | { type: "SET_SEARCH_LOADING"; isLoading: boolean }
  | { type: "TOGGLE_RESULT_EXPANDED"; path: string }
  | { type: "SET_SNIPPETS"; path: string; snippets: ContextSnippet[] }
  | { type: "CLEAR_SEARCH" }
  | { type: "SET_GROUND_WIDGETS"; widgets: WidgetResult[] }
  | { type: "SET_RECALL_WIDGETS"; widgets: WidgetResult[]; filePath: string }
  | { type: "SET_GROUND_WIDGETS_LOADING"; isLoading: boolean }
  | { type: "SET_RECALL_WIDGETS_LOADING"; isLoading: boolean }
  | { type: "SET_GROUND_WIDGETS_ERROR"; error: string | null }
  | { type: "SET_RECALL_WIDGETS_ERROR"; error: string | null }
  | { type: "ADD_PENDING_EDIT"; filePath: string; fieldPath: string; value: unknown }
  | { type: "REMOVE_PENDING_EDIT"; filePath: string; fieldPath: string }
  | { type: "CLEAR_WIDGET_STATE" }
  // Health actions
  | { type: "SET_HEALTH_ISSUES"; issues: HealthIssue[] }
  | { type: "TOGGLE_HEALTH_EXPANDED" }
  | { type: "DISMISS_HEALTH_ISSUE"; issueId: string }
  // Sync actions
  | { type: "UPDATE_SYNC_STATUS"; status: "idle" | "syncing" | "success" | "error"; progress?: { current: number; total: number; currentFile?: string }; message?: string; errorCount?: number }
  | { type: "RESET_SYNC_STATE" }
  // Meeting actions
  | { type: "SET_MEETING_STATE"; state: MeetingState }
  | { type: "CLEAR_MEETING" };

// ----------------------------------------------------------------------------
// Helper functions for reducer
// ----------------------------------------------------------------------------

/**
 * Updates browser state with partial changes.
 */
function updateBrowser(state: SessionState, updates: Partial<BrowserState>): SessionState {
  return {
    ...state,
    browser: { ...state.browser, ...updates },
  };
}

/**
 * Updates search state within browser state.
 */
function updateSearch(state: SessionState, updates: Partial<SearchState>): SessionState {
  return {
    ...state,
    browser: {
      ...state.browser,
      search: { ...state.browser.search, ...updates },
    },
  };
}

/**
 * Finds the index of the message containing a tool with the given ID.
 * Searches from end to beginning (most recent first).
 * Returns -1 if no message contains the tool.
 */
function findMessageWithTool(messages: ConversationMessage[], toolUseId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.toolInvocations?.some(t => t.toolUseId === toolUseId)) {
      return i;
    }
  }
  return -1;
}

/**
 * Toggles a value in a Set, returning a new Set.
 */
function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const newSet = new Set(set);
  if (newSet.has(value)) {
    newSet.delete(value);
  } else {
    newSet.add(value);
  }
  return newSet;
}

// ----------------------------------------------------------------------------
// Reducer case handlers
// ----------------------------------------------------------------------------

function handleSelectVault(state: SessionState, vault: VaultInfo): SessionState {
  return {
    ...state,
    vault,
    sessionId: null,
    messages: [],
    browser: createInitialBrowserState(),
    widgets: createInitialWidgetState(),
    health: createInitialHealthState(),
    sync: createInitialSyncState(),
    recentNotes: [],
    recentDiscussions: [],
    goals: null,
    discussionPrefill: null,
    showNewSessionDialog: false,
    wantsNewSession: false,
    slashCommands: [],
  };
}

function handleClearVault(state: SessionState): SessionState {
  return {
    ...state,
    vault: null,
    sessionId: null,
    messages: [],
    browser: createInitialBrowserState(),
    widgets: createInitialWidgetState(),
    health: createInitialHealthState(),
    sync: createInitialSyncState(),
    recentNotes: [],
    recentDiscussions: [],
    goals: null,
    discussionPrefill: null,
    showNewSessionDialog: false,
    wantsNewSession: false,
    slashCommands: [],
  };
}

function handleUpdateLastMessage(
  state: SessionState,
  content: string,
  isStreaming?: boolean
): SessionState {
  if (state.messages.length === 0) return state;

  const messages = [...state.messages];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage.role !== "assistant") {
    console.warn(
      "[SessionContext] UPDATE_LAST_MESSAGE ignored: last message is not an assistant message"
    );
    return state;
  }

  const prefix = state.needsLineBreakBeforeText && content ? "\n\n" : "";
  messages[messages.length - 1] = {
    ...lastMessage,
    content: lastMessage.content + prefix + content,
    isStreaming: isStreaming ?? lastMessage.isStreaming,
  };

  return {
    ...state,
    messages,
    needsLineBreakBeforeText: prefix ? false : state.needsLineBreakBeforeText,
  };
}

function handleSetMessages(
  state: SessionState,
  protocolMessages: ConversationMessageProtocol[]
): SessionState {
  console.log(`[Session] Setting messages from server: ${protocolMessages.length}`);
  return {
    ...state,
    messages: protocolMessages.map((msg) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
      toolInvocations: msg.toolInvocations?.map((tool) =>
        tool.status === "running"
          ? { ...tool, status: "complete" as const, output: "[Connection closed before tool completed]" }
          : tool
      ),
    })),
    pendingToolUpdates: new Map(),
    needsLineBreakBeforeText: false,
  };
}

function handleAddToolToLastMessage(
  state: SessionState,
  toolUseId: string,
  toolName: string
): SessionState {
  const pendingUpdate = state.pendingToolUpdates.get(toolUseId);
  const newTool: ToolInvocation = {
    toolUseId,
    toolName,
    status: pendingUpdate?.status ?? "running",
    ...(pendingUpdate?.input !== undefined && { input: pendingUpdate.input }),
    ...(pendingUpdate?.output !== undefined && { output: pendingUpdate.output }),
  };

  let pendingToolUpdates = state.pendingToolUpdates;
  if (pendingUpdate) {
    pendingToolUpdates = new Map(state.pendingToolUpdates);
    pendingToolUpdates.delete(toolUseId);
  }

  const messages = [...state.messages];
  const lastMessage = messages[messages.length - 1];
  const lastIsStreamingAssistant =
    lastMessage?.role === "assistant" && lastMessage.isStreaming;

  if (lastIsStreamingAssistant) {
    messages[messages.length - 1] = {
      ...lastMessage,
      toolInvocations: [...(lastMessage.toolInvocations ?? []), newTool],
    };
  } else {
    console.warn(
      `[SessionContext] ADD_TOOL_TO_LAST_MESSAGE: no streaming assistant message, creating one for tool ${toolUseId}`
    );
    const placeholderMessage: ConversationMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
      toolInvocations: [newTool],
    };
    messages.push(placeholderMessage);
  }

  return { ...state, messages, pendingToolUpdates };
}

function handleUpdateToolInput(
  state: SessionState,
  toolUseId: string,
  input: unknown
): SessionState {
  const messages = [...state.messages];
  const foundMessageIndex = findMessageWithTool(messages, toolUseId);

  if (foundMessageIndex === -1) {
    console.warn(
      `[SessionContext] UPDATE_TOOL_INPUT: tool ${toolUseId} not found, queueing update`
    );
    const pendingToolUpdates = new Map(state.pendingToolUpdates);
    const existing = pendingToolUpdates.get(toolUseId) ?? {};
    pendingToolUpdates.set(toolUseId, { ...existing, input });
    return { ...state, pendingToolUpdates };
  }

  const targetMessage = messages[foundMessageIndex];
  const updatedTools = targetMessage.toolInvocations!.map((tool) =>
    tool.toolUseId === toolUseId ? { ...tool, input } : tool
  );
  messages[foundMessageIndex] = {
    ...targetMessage,
    toolInvocations: updatedTools,
  };
  return { ...state, messages };
}

function handleCompleteToolInvocation(
  state: SessionState,
  toolUseId: string,
  output: unknown
): SessionState {
  const messages = [...state.messages];
  const foundMessageIndex = findMessageWithTool(messages, toolUseId);

  if (foundMessageIndex === -1) {
    const pendingToolUpdates = new Map(state.pendingToolUpdates);
    const existing = pendingToolUpdates.get(toolUseId) ?? {};
    pendingToolUpdates.set(toolUseId, {
      ...existing,
      output,
      status: "complete",
    });
    return { ...state, pendingToolUpdates, needsLineBreakBeforeText: true };
  }

  const targetMessage = messages[foundMessageIndex];
  const updatedTools = targetMessage.toolInvocations!.map((tool) =>
    tool.toolUseId === toolUseId
      ? { ...tool, output, status: "complete" as const }
      : tool
  );
  messages[foundMessageIndex] = {
    ...targetMessage,
    toolInvocations: updatedTools,
  };
  return { ...state, messages, needsLineBreakBeforeText: true };
}

function handleSetLastMessageContextUsage(
  state: SessionState,
  contextUsage: number
): SessionState {
  if (state.messages.length === 0) return state;
  const messages = [...state.messages];
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "assistant") return state;
  messages[messages.length - 1] = { ...lastMessage, contextUsage };
  return { ...state, messages };
}

function handleSetLastMessageDuration(
  state: SessionState,
  durationMs: number
): SessionState {
  if (state.messages.length === 0) return state;
  const messages = [...state.messages];
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "assistant") return state;
  messages[messages.length - 1] = { ...lastMessage, durationMs };
  return { ...state, messages };
}

// ----------------------------------------------------------------------------
// Main reducer
// ----------------------------------------------------------------------------

/**
 * Session state reducer.
 */
export function sessionReducer(
  state: SessionState,
  action: SessionAction
): SessionState {
  switch (action.type) {
    case "SELECT_VAULT":
      return handleSelectVault(state, action.vault);

    case "CLEAR_VAULT":
      return handleClearVault(state);

    case "SET_SESSION_ID":
      return { ...state, sessionId: action.sessionId, wantsNewSession: false };

    case "SET_SESSION_START_TIME":
      return { ...state, sessionStartTime: action.timestamp };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "UPDATE_LAST_MESSAGE":
      return handleUpdateLastMessage(state, action.content, action.isStreaming);

    case "CLEAR_MESSAGES":
      return {
        ...state,
        messages: [],
        pendingToolUpdates: new Map(),
        needsLineBreakBeforeText: false,
      };

    case "START_NEW_SESSION":
      return {
        ...state,
        sessionId: null,
        messages: [],
        pendingToolUpdates: new Map(),
        needsLineBreakBeforeText: false,
        wantsNewSession: true,
      };

    case "SET_MESSAGES":
      return handleSetMessages(state, action.messages);

    case "SET_CURRENT_PATH":
      return updateBrowser(state, {
        currentPath: action.path,
        currentFileContent: null,
        currentFileTruncated: false,
        fileError: null,
        isAdjusting: false,
        adjustContent: "",
        adjustError: null,
        isSaving: false,
      });

    case "TOGGLE_DIRECTORY":
      return updateBrowser(state, {
        expandedDirs: toggleSetValue(state.browser.expandedDirs, action.path),
      });

    case "CACHE_DIRECTORY": {
      const newCache = new Map(state.browser.directoryCache);
      newCache.set(action.path, action.entries);
      return updateBrowser(state, { directoryCache: newCache });
    }

    case "SET_FILE_CONTENT":
      return updateBrowser(state, {
        currentFileContent: action.content,
        currentFileTruncated: action.truncated,
        fileError: null,
        isLoading: false,
      });

    case "SET_FILE_ERROR":
      return updateBrowser(state, {
        currentFileContent: null,
        currentFileTruncated: false,
        fileError: action.error,
        isLoading: false,
      });

    case "SET_FILE_LOADING":
      return updateBrowser(state, {
        isLoading: action.isLoading,
        fileError: action.isLoading ? null : state.browser.fileError,
      });

    case "CLEAR_BROWSER_STATE":
      return { ...state, browser: createInitialBrowserState() };

    case "CLEAR_DIRECTORY_CACHE":
      return updateBrowser(state, {
        directoryCache: new Map(),
        expandedDirs: new Set(),
      });

    case "SET_RECENT_NOTES":
      return { ...state, recentNotes: action.notes };

    case "PIN_FOLDER":
      if (state.browser.pinnedFolders.includes(action.path)) return state;
      return updateBrowser(state, {
        pinnedFolders: [...state.browser.pinnedFolders, action.path],
      });

    case "UNPIN_FOLDER":
      return updateBrowser(state, {
        pinnedFolders: state.browser.pinnedFolders.filter((p) => p !== action.path),
      });

    case "SET_PINNED_FOLDERS":
      return updateBrowser(state, { pinnedFolders: action.paths });

    case "SET_RECENT_DISCUSSIONS":
      return { ...state, recentDiscussions: action.discussions };

    case "REMOVE_DISCUSSION":
      return {
        ...state,
        recentDiscussions: state.recentDiscussions.filter(
          (d) => d.sessionId !== action.sessionId
        ),
      };

    case "SET_GOALS":
      return { ...state, goals: action.goals };

    case "SET_DISCUSSION_PREFILL":
      return { ...state, discussionPrefill: action.text };

    case "SET_PENDING_SESSION_ID":
      return {
        ...state,
        pendingSessionId: action.sessionId,
        wantsNewSession: action.sessionId ? false : state.wantsNewSession,
      };

    case "SET_SHOW_NEW_SESSION_DIALOG":
      return { ...state, showNewSessionDialog: action.show };

    case "START_ADJUST":
      return updateBrowser(state, {
        isAdjusting: true,
        adjustContent: state.browser.currentFileContent ?? "",
        adjustError: null,
        isSaving: false,
      });

    case "UPDATE_ADJUST_CONTENT":
      return updateBrowser(state, { adjustContent: action.content });

    case "CANCEL_ADJUST":
      return updateBrowser(state, {
        isAdjusting: false,
        adjustContent: "",
        adjustError: null,
        isSaving: false,
      });

    case "START_SAVE":
      return updateBrowser(state, { isSaving: true, adjustError: null });

    case "SAVE_SUCCESS":
      return updateBrowser(state, {
        isAdjusting: false,
        adjustContent: "",
        adjustError: null,
        isSaving: false,
      });

    case "SAVE_ERROR":
      return updateBrowser(state, { isSaving: false, adjustError: action.error });

    case "SET_VIEW_MODE":
      return updateBrowser(state, { viewMode: action.mode });

    case "SET_TASKS":
      return updateBrowser(state, {
        tasks: action.tasks,
        isTasksLoading: false,
        tasksError: null,
      });

    case "SET_TASKS_LOADING":
      return updateBrowser(state, {
        isTasksLoading: action.isLoading,
        tasksError: action.isLoading ? null : state.browser.tasksError,
      });

    case "SET_TASKS_ERROR":
      return updateBrowser(state, {
        tasksError: action.error,
        isTasksLoading: false,
      });

    case "UPDATE_TASK": {
      const updatedTasks = state.browser.tasks.map((task) =>
        task.filePath === action.filePath && task.lineNumber === action.lineNumber
          ? { ...task, state: action.newState }
          : task
      );
      return updateBrowser(state, { tasks: updatedTasks });
    }

    case "ADD_TOOL_TO_LAST_MESSAGE":
      return handleAddToolToLastMessage(state, action.toolUseId, action.toolName);

    case "UPDATE_TOOL_INPUT":
      return handleUpdateToolInput(state, action.toolUseId, action.input);

    case "COMPLETE_TOOL_INVOCATION":
      return handleCompleteToolInvocation(state, action.toolUseId, action.output);

    case "SET_SLASH_COMMANDS":
      return { ...state, slashCommands: action.commands };

    case "SET_LAST_MESSAGE_CONTEXT_USAGE":
      return handleSetLastMessageContextUsage(state, action.contextUsage);

    case "SET_LAST_MESSAGE_DURATION":
      return handleSetLastMessageDuration(state, action.durationMs);

    // Search actions
    case "SET_SEARCH_ACTIVE":
      if (action.isActive) {
        return updateSearch(state, { isActive: true });
      }
      return updateSearch(state, {
        isActive: false,
        query: "",
        fileResults: [],
        contentResults: [],
        isLoading: false,
        expandedPaths: new Set<string>(),
        snippetsCache: new Map<string, ContextSnippet[]>(),
      });

    case "SET_SEARCH_MODE":
      return updateSearch(state, {
        mode: action.mode,
        fileResults: [],
        contentResults: [],
        expandedPaths: new Set<string>(),
        snippetsCache: new Map<string, ContextSnippet[]>(),
      });

    case "SET_SEARCH_QUERY":
      return updateSearch(state, { query: action.query });

    case "SET_SEARCH_RESULTS":
      if (action.mode === "files") {
        return updateSearch(state, {
          isLoading: false,
          fileResults: action.fileResults ?? [],
        });
      }
      return updateSearch(state, {
        isLoading: false,
        contentResults: action.contentResults ?? [],
      });

    case "SET_SEARCH_LOADING":
      return updateSearch(state, { isLoading: action.isLoading });

    case "TOGGLE_RESULT_EXPANDED":
      return updateSearch(state, {
        expandedPaths: toggleSetValue(state.browser.search.expandedPaths, action.path),
      });

    case "SET_SNIPPETS": {
      const newSnippetsCache = new Map(state.browser.search.snippetsCache);
      newSnippetsCache.set(action.path, action.snippets);
      return updateSearch(state, { snippetsCache: newSnippetsCache });
    }

    case "CLEAR_SEARCH":
      return updateBrowser(state, { search: createInitialSearchState() });

    // Widget actions
    case "SET_GROUND_WIDGETS":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          groundWidgets: action.widgets,
          isGroundLoading: false,
          groundError: null,
        },
      };

    case "SET_RECALL_WIDGETS":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          recallWidgets: action.widgets,
          recallFilePath: action.filePath,
          isRecallLoading: false,
          recallError: null,
        },
      };

    case "SET_GROUND_WIDGETS_LOADING":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          isGroundLoading: action.isLoading,
          groundError: action.isLoading ? null : state.widgets.groundError,
        },
      };

    case "SET_RECALL_WIDGETS_LOADING":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          isRecallLoading: action.isLoading,
          recallError: action.isLoading ? null : state.widgets.recallError,
        },
      };

    case "SET_GROUND_WIDGETS_ERROR":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          groundError: action.error,
          isGroundLoading: false,
        },
      };

    case "SET_RECALL_WIDGETS_ERROR":
      return {
        ...state,
        widgets: {
          ...state.widgets,
          recallError: action.error,
          isRecallLoading: false,
        },
      };

    case "ADD_PENDING_EDIT": {
      const key = `${action.filePath}:${action.fieldPath}`;
      const newPendingEdits = new Map(state.widgets.pendingEdits);
      newPendingEdits.set(key, action.value);
      return {
        ...state,
        widgets: { ...state.widgets, pendingEdits: newPendingEdits },
      };
    }

    case "REMOVE_PENDING_EDIT": {
      const key = `${action.filePath}:${action.fieldPath}`;
      const newPendingEdits = new Map(state.widgets.pendingEdits);
      newPendingEdits.delete(key);
      return {
        ...state,
        widgets: { ...state.widgets, pendingEdits: newPendingEdits },
      };
    }

    case "CLEAR_WIDGET_STATE":
      return { ...state, widgets: createInitialWidgetState() };

    // Health actions
    case "SET_HEALTH_ISSUES":
      return {
        ...state,
        health: { ...state.health, issues: action.issues },
      };

    case "TOGGLE_HEALTH_EXPANDED":
      return {
        ...state,
        health: { ...state.health, isExpanded: !state.health.isExpanded },
      };

    case "DISMISS_HEALTH_ISSUE":
      return {
        ...state,
        health: {
          ...state.health,
          issues: state.health.issues.filter((i) => i.id !== action.issueId),
        },
      };

    // Sync actions
    case "UPDATE_SYNC_STATUS":
      return {
        ...state,
        sync: {
          status: action.status,
          progress: action.progress ?? null,
          message: action.message ?? null,
          errorCount: action.errorCount ?? 0,
        },
      };

    case "RESET_SYNC_STATE":
      return {
        ...state,
        sync: createInitialSyncState(),
      };

    // Meeting actions
    case "SET_MEETING_STATE":
      return {
        ...state,
        meeting: action.state,
      };

    case "CLEAR_MEETING":
      return {
        ...state,
        meeting: { isActive: false },
      };

    default:
      return state;
  }
}
