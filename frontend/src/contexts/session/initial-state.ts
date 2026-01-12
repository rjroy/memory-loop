/**
 * Initial state factories for session context.
 *
 * Creates default state objects for browser, search, widgets, and session.
 */

import type {
  BrowserState,
  SearchState,
  WidgetState,
  SessionState,
} from "./types.js";
import { loadPersistedViewMode } from "./storage.js";

/**
 * Creates initial search state.
 */
export function createInitialSearchState(): SearchState {
  return {
    isActive: false,
    mode: "files",
    query: "",
    fileResults: [],
    contentResults: [],
    isLoading: false,
    expandedPaths: new Set(),
    snippetsCache: new Map(),
  };
}

/**
 * Creates initial widget state.
 */
export function createInitialWidgetState(): WidgetState {
  return {
    groundWidgets: [],
    recallWidgets: [],
    recallFilePath: null,
    isGroundLoading: false,
    isRecallLoading: false,
    groundError: null,
    recallError: null,
    pendingEdits: new Map(),
  };
}

/**
 * Creates initial browser state.
 */
export function createInitialBrowserState(): BrowserState {
  return {
    currentPath: "",
    expandedDirs: new Set(),
    directoryCache: new Map(),
    currentFileContent: null,
    currentFileTruncated: false,
    fileError: null,
    isLoading: false,
    pinnedFolders: [],
    isAdjusting: false,
    adjustContent: "",
    adjustError: null,
    isSaving: false,
    viewMode: loadPersistedViewMode(),
    tasks: [],
    isTasksLoading: false,
    tasksError: null,
    search: createInitialSearchState(),
  };
}

/**
 * Creates initial session state.
 */
export function createInitialSessionState(): SessionState {
  return {
    vault: null,
    sessionId: null,
    sessionStartTime: null,
    mode: "home",
    messages: [],
    browser: createInitialBrowserState(),
    widgets: createInitialWidgetState(),
    recentNotes: [],
    recentDiscussions: [],
    goals: null,
    discussionPrefill: null,
    pendingSessionId: null,
    showNewSessionDialog: false,
    wantsNewSession: false,
    pendingToolUpdates: new Map(),
    needsLineBreakBeforeText: false,
    slashCommands: [],
  };
}

/**
 * Generates a unique message ID.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
