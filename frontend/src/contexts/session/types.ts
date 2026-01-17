/**
 * Session context types.
 *
 * Defines state shapes, action types, and interfaces for session management.
 */

import type {
  FileEntry,
  RecentNoteEntry,
  RecentDiscussionEntry,
  TaskEntry,
  ToolInvocation,
  SlashCommand,
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,
  WidgetResult,
  VaultInfo,
  ConversationMessageProtocol,
  HealthIssue,
  MeetingState,
} from "@memory-loop/shared";

/**
 * Application mode: home, note capture, discussion, or browse.
 */
export type AppMode = "home" | "note" | "discussion" | "browse";

/**
 * View mode for the browse tab: files or tasks.
 */
export type BrowseViewMode = "files" | "tasks";

/**
 * Search mode: files (fuzzy name) or content (full-text).
 */
export type SearchMode = "files" | "content";

/**
 * Search state for the browse tab.
 */
export interface SearchState {
  /** Whether search is currently active */
  isActive: boolean;
  /** Current search mode */
  mode: SearchMode;
  /** Current search query */
  query: string;
  /** File search results (when mode is "files") */
  fileResults: FileSearchResult[];
  /** Content search results (when mode is "content") */
  contentResults: ContentSearchResult[];
  /** Whether search is in progress */
  isLoading: boolean;
  /** Expanded content result paths (for showing snippets) */
  expandedPaths: Set<string>;
  /** Snippets for expanded content results, keyed by path */
  snippetsCache: Map<string, ContextSnippet[]>;
}

/**
 * Widget state for vault widgets.
 */
export interface WidgetState {
  /** Ground widgets for Home/Ground view */
  groundWidgets: WidgetResult[];
  /** Recall widgets for Browse/Recall view */
  recallWidgets: WidgetResult[];
  /** Current file path for recall widgets (null if none) */
  recallFilePath: string | null;
  /** Whether ground widgets are loading */
  isGroundLoading: boolean;
  /** Whether recall widgets are loading */
  isRecallLoading: boolean;
  /** Error message from ground widget computation */
  groundError: string | null;
  /** Error message from recall widget computation */
  recallError: string | null;
  /** Pending edits map: filePath:fieldPath -> value (for optimistic updates) */
  pendingEdits: Map<string, unknown>;
}

/**
 * Health state for backend health reporting.
 */
export interface HealthState {
  /** Current health issues from backend */
  issues: HealthIssue[];
  /** Whether the health panel is expanded */
  isExpanded: boolean;
}

/**
 * Sync status values matching protocol.
 */
export type SyncStatusValue = "idle" | "syncing" | "success" | "error";

/**
 * Sync state for external data sync operations.
 */
export interface SyncState {
  /** Current sync status */
  status: SyncStatusValue;
  /** Progress info when syncing */
  progress: {
    current: number;
    total: number;
    currentFile?: string;
  } | null;
  /** Error or summary message */
  message: string | null;
  /** Number of files that failed (for error display) */
  errorCount: number;
}

/**
 * Browser state for vault file browsing.
 */
export interface BrowserState {
  /** Current path being viewed (empty string for root) */
  currentPath: string;
  /** Set of expanded directory paths */
  expandedDirs: Set<string>;
  /** Cache of directory listings keyed by path */
  directoryCache: Map<string, FileEntry[]>;
  /** Current file content being viewed */
  currentFileContent: string | null;
  /** Whether current file content was truncated */
  currentFileTruncated: boolean;
  /** Error message if last file operation failed */
  fileError: string | null;
  /** Whether a file operation is in progress */
  isLoading: boolean;
  /** Pinned folder paths for quick access */
  pinnedFolders: string[];
  /** Whether currently in adjust (edit) mode (REQ-F-7) */
  isAdjusting: boolean;
  /** Content being edited in adjust mode (REQ-F-8) */
  adjustContent: string;
  /** Error message if save operation failed (REQ-F-14) */
  adjustError: string | null;
  /** Whether a save operation is in progress */
  isSaving: boolean;
  /** Current view mode: files or tasks */
  viewMode: BrowseViewMode;
  /** Task list from configured directories */
  tasks: TaskEntry[];
  /** Whether task loading is in progress */
  isTasksLoading: boolean;
  /** Error message from task operations */
  tasksError: string | null;
  /** Search state for the browse tab */
  search: SearchState;
}

/**
 * Message in the conversation history.
 */
export interface ConversationMessage {
  /** Unique message ID */
  id: string;
  /** Role: user or assistant */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Timestamp */
  timestamp: Date;
  /** Whether this message is still streaming */
  isStreaming?: boolean;
  /** Tool invocations for this message (assistant messages only) */
  toolInvocations?: ToolInvocation[];
  /** Percentage of context window used (0-100, assistant messages only) */
  contextUsage?: number;
  /** Turn duration in milliseconds (assistant messages only) */
  durationMs?: number;
}

/**
 * Pending tool update queued when tool_input/tool_end arrives before tool_start.
 */
export interface PendingToolUpdate {
  input?: unknown;
  output?: unknown;
  status?: "complete";
}

/**
 * Session state stored in context.
 */
export interface SessionState {
  /** Currently selected vault */
  vault: VaultInfo | null;
  /** Current session ID (from server) */
  sessionId: string | null;
  /** Session start timestamp (from server) */
  sessionStartTime: Date | null;
  /** Current application mode */
  mode: AppMode;
  /** Conversation history for discussion mode */
  messages: ConversationMessage[];
  /** Browser state for file browsing mode */
  browser: BrowserState;
  /** Widget state for vault widgets */
  widgets: WidgetState;
  /** Health state for backend health reporting */
  health: HealthState;
  /** Sync state for external data sync */
  sync: SyncState;
  /** Recent captured notes for note mode */
  recentNotes: RecentNoteEntry[];
  /** Recent discussion sessions for note mode */
  recentDiscussions: RecentDiscussionEntry[];
  /** Goals markdown content from vault's goals.md file (null if no goals file exists) */
  goals: string | null;
  /** Pre-filled text for discussion mode (from inspiration click) */
  discussionPrefill: string | null;
  /** Session ID pending resume (set by RecentActivity, consumed by Discussion) */
  pendingSessionId: string | null;
  /** Whether the new session confirmation dialog is shown (persists across tab switches) */
  showNewSessionDialog: boolean;
  /** Whether user wants a new session (skip auto-resume on reconnect) */
  wantsNewSession: boolean;
  /** Pending tool updates queued due to race conditions (tool_input/tool_end before tool_start) */
  pendingToolUpdates: Map<string, PendingToolUpdate>;
  /** Flag to prepend line break before next text chunk (set after tool completion) */
  needsLineBreakBeforeText: boolean;
  /** Available slash commands from the SDK (empty if not yet loaded or unsupported) */
  slashCommands: SlashCommand[];
  /** Meeting capture state (active meeting session info) */
  meeting: MeetingState;
}

/**
 * Actions for session state management.
 */
export interface SessionActions {
  /** Select a vault */
  selectVault: (vault: VaultInfo) => void;
  /** Clear the current vault (return to vault selection) */
  clearVault: () => void;
  /** Set the session ID */
  setSessionId: (sessionId: string) => void;
  /** Set the session start time */
  setSessionStartTime: (timestamp: Date) => void;
  /** Set the application mode */
  setMode: (mode: AppMode) => void;
  /** Add a message to conversation history */
  addMessage: (message: Omit<ConversationMessage, "id" | "timestamp">) => void;
  /** Update the last message (for streaming) */
  updateLastMessage: (content: string, isStreaming?: boolean) => void;
  /** Clear all messages */
  clearMessages: () => void;
  /** Start a new session */
  startNewSession: () => void;
  /** Set messages from server (on session resume) */
  setMessages: (messages: ConversationMessageProtocol[]) => void;
  /** Set the current browsing path */
  setCurrentPath: (path: string) => void;
  /** Toggle directory expand/collapse state */
  toggleDirectory: (path: string) => void;
  /** Cache a directory listing */
  cacheDirectory: (path: string, entries: FileEntry[]) => void;
  /** Set file content from server response */
  setFileContent: (content: string, truncated: boolean) => void;
  /** Set file error from server response */
  setFileError: (error: string) => void;
  /** Set loading state for file operations */
  setFileLoading: (isLoading: boolean) => void;
  /** Clear all browser state (cache, expanded dirs, current file) */
  clearBrowserState: () => void;
  /** Clear only directory cache and expanded dirs (preserves pinned folders) */
  clearDirectoryCache: () => void;
  /** Set recent notes */
  setRecentNotes: (notes: RecentNoteEntry[]) => void;
  /** Pin a folder for quick access */
  pinFolder: (path: string) => void;
  /** Unpin a folder */
  unpinFolder: (path: string) => void;
  /** Set all pinned assets (from server response) */
  setPinnedAssets: (paths: string[]) => void;
  /** Set recent discussions */
  setRecentDiscussions: (discussions: RecentDiscussionEntry[]) => void;
  /** Remove a discussion from the recent list (after deletion) */
  removeDiscussion: (sessionId: string) => void;
  /** Set goals markdown content from vault's goals.md file */
  setGoals: (goals: string | null) => void;
  /** Set discussion prefill text (from inspiration click) */
  setDiscussionPrefill: (text: string | null) => void;
  /** Set pending session ID for resume (called by RecentActivity) */
  setPendingSessionId: (sessionId: string | null) => void;
  /** Set new session dialog visibility (persists across tab switches) */
  setShowNewSessionDialog: (show: boolean) => void;
  /** Enter adjust mode (copies currentFileContent to adjustContent) */
  startAdjust: () => void;
  /** Update the content being edited in adjust mode */
  updateAdjustContent: (content: string) => void;
  /** Cancel adjust mode and discard changes */
  cancelAdjust: () => void;
  /** Begin save operation (sets isSaving) */
  startSave: () => void;
  /** Save completed successfully */
  saveSuccess: () => void;
  /** Save failed with error (preserves adjustContent per REQ-F-15) */
  saveError: (error: string) => void;
  /** Set the browse view mode (files or tasks) */
  setViewMode: (mode: BrowseViewMode) => void;
  /** Set tasks from server response */
  setTasks: (tasks: TaskEntry[]) => void;
  /** Set tasks loading state */
  setTasksLoading: (isLoading: boolean) => void;
  /** Set tasks error message */
  setTasksError: (error: string | null) => void;
  /** Update a single task (for optimistic updates) */
  updateTask: (filePath: string, lineNumber: number, newState: string) => void;
  /** Add a tool invocation to the last assistant message */
  addToolToLastMessage: (toolUseId: string, toolName: string) => void;
  /** Update tool input for a specific tool invocation */
  updateToolInput: (toolUseId: string, input: unknown) => void;
  /** Mark a tool invocation as complete with output */
  completeToolInvocation: (toolUseId: string, output: unknown) => void;
  /** Set available slash commands from SDK */
  setSlashCommands: (commands: SlashCommand[]) => void;
  /** Set context usage percentage on the last assistant message */
  setLastMessageContextUsage: (contextUsage: number) => void;
  // Search actions
  /** Activate or deactivate search mode */
  setSearchActive: (isActive: boolean) => void;
  /** Set search mode (files or content) */
  setSearchMode: (mode: SearchMode) => void;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Set search results from server */
  setSearchResults: (mode: SearchMode, fileResults?: FileSearchResult[], contentResults?: ContentSearchResult[]) => void;
  /** Set search loading state */
  setSearchLoading: (isLoading: boolean) => void;
  /** Toggle expanded state for a content result */
  toggleResultExpanded: (path: string) => void;
  /** Set snippets for a content result */
  setSnippets: (path: string, snippets: ContextSnippet[]) => void;
  /** Clear search and return to file tree */
  clearSearch: () => void;
  // Widget actions
  /** Set ground widgets from server */
  setGroundWidgets: (widgets: WidgetResult[]) => void;
  /** Set recall widgets from server */
  setRecallWidgets: (widgets: WidgetResult[], filePath: string) => void;
  /** Set ground widgets loading state */
  setGroundWidgetsLoading: (isLoading: boolean) => void;
  /** Set recall widgets loading state */
  setRecallWidgetsLoading: (isLoading: boolean) => void;
  /** Set ground widgets error */
  setGroundWidgetsError: (error: string | null) => void;
  /** Set recall widgets error */
  setRecallWidgetsError: (error: string | null) => void;
  /** Add pending edit (optimistic update) */
  addPendingEdit: (filePath: string, fieldPath: string, value: unknown) => void;
  /** Remove pending edit (server confirmed or failed) */
  removePendingEdit: (filePath: string, fieldPath: string) => void;
  /** Clear all widget state (when switching vaults) */
  clearWidgetState: () => void;
  // Health actions
  /** Set health issues from server */
  setHealthIssues: (issues: HealthIssue[]) => void;
  /** Toggle health panel expanded state */
  toggleHealthExpanded: () => void;
  /** Dismiss a health issue (also sends to server) */
  dismissHealthIssue: (issueId: string) => void;
  // Sync actions
  /** Update sync state from server sync_status message */
  updateSyncStatus: (
    status: SyncStatusValue,
    progress?: { current: number; total: number; currentFile?: string },
    message?: string,
    errorCount?: number
  ) => void;
  /** Reset sync state to idle (for when vault changes) */
  resetSyncState: () => void;
  // Meeting actions
  /** Set meeting state from server meeting_state/meeting_started messages */
  setMeetingState: (state: MeetingState) => void;
  /** Clear meeting state (meeting stopped or vault changed) */
  clearMeeting: () => void;
}

/**
 * Combined context value.
 */
export type SessionContextValue = SessionState & SessionActions;
