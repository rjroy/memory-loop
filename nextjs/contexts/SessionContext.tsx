/**
 * Session Context
 *
 * Manages application session state: current vault, session ID, mode, and messages.
 * Messages are sourced from the server on session resume - no localStorage persistence.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  VaultInfo,
  ServerMessage,
  FileEntry,
  RecentNoteEntry,
  RecentDiscussionEntry,
  ConversationMessageProtocol,
  TaskEntry,
  SlashCommand,
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,

  MeetingState,
  EditableVaultConfig,
} from "@/lib/schemas";

import {
  type AppMode,
  type BrowseViewMode,
  type SearchMode,
  type ConversationMessage,
  type SessionContextValue,
  sessionReducer,
  createInitialSessionState,
  generateMessageId,
  loadPersistedVaultId,
  loadPersistedBrowserPath,
  persistVaultId,
  persistBrowserPath,
  persistViewMode,
} from "./session/index";

// Re-export types for consumers
export type {
  AppMode,
  BrowseViewMode,
  SearchMode,
  SearchState,

  BrowserState,
  ConversationMessage,
  PendingToolUpdate,
  SessionState,
  SessionActions,
  SessionContextValue,
} from "./session/types";
export { STORAGE_KEY_VAULT } from "./session/storage";

/**
 * Session context instance.
 */
const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Props for SessionProvider.
 */
export interface SessionProviderProps {
  children: ReactNode;
  /** Optional initial vault list for auto-selecting persisted vault */
  initialVaults?: VaultInfo[];
  /** Optional initial recent notes (for testing) */
  initialRecentNotes?: RecentNoteEntry[];
  /** Optional initial recent discussions (for testing) */
  initialRecentDiscussions?: RecentDiscussionEntry[];
  /** Optional initial goals markdown content (for testing) */
  initialGoals?: string | null;
  /** Optional initial session ID (for testing) */
  initialSessionId?: string | null;
}

// ----------------------------------------------------------------------------
// SessionProvider component
// ----------------------------------------------------------------------------

/**
 * Session context provider component.
 */
export function SessionProvider({
  children,
  initialVaults,
  initialRecentNotes,
  initialRecentDiscussions,
  initialGoals,
  initialSessionId,
}: SessionProviderProps): React.ReactNode {
  const [state, dispatch] = useReducer(sessionReducer, undefined, () => ({
    ...createInitialSessionState(),
    recentNotes: initialRecentNotes ?? [],
    recentDiscussions: initialRecentDiscussions ?? [],
    goals: initialGoals ?? null,
    sessionId: initialSessionId ?? null,
  }));

  // Persist vault ID when it changes
  useEffect(() => {
    if (state.vault) {
      persistVaultId(state.vault.id);
    }
  }, [state.vault]);

  // Persist browser path when it changes
  useEffect(() => {
    persistBrowserPath(state.browser.currentPath);
  }, [state.browser.currentPath]);

  // Load persisted state on mount
  useEffect(() => {
    if (initialVaults && initialVaults.length > 0) {
      const persistedVaultId = loadPersistedVaultId();
      if (persistedVaultId) {
        const vault = initialVaults.find((v) => v.id === persistedVaultId);
        if (vault) {
          dispatch({ type: "SELECT_VAULT", vault });
        }
      }
    }

    const persistedBrowserPath = loadPersistedBrowserPath();
    if (persistedBrowserPath) {
      dispatch({ type: "SET_CURRENT_PATH", path: persistedBrowserPath });
    }
  }, [initialVaults]);

  // Action creators using useCallback for stable references
  const selectVault = useCallback((vault: VaultInfo) => {
    dispatch({ type: "SELECT_VAULT", vault });
  }, []);

  const clearVault = useCallback(() => {
    dispatch({ type: "CLEAR_VAULT" });
    persistVaultId(null);
  }, []);

  const setSessionId = useCallback((sessionId: string) => {
    dispatch({ type: "SET_SESSION_ID", sessionId });
  }, []);

  const setSessionStartTime = useCallback((timestamp: Date) => {
    dispatch({ type: "SET_SESSION_START_TIME", timestamp });
  }, []);

  const setMode = useCallback((mode: AppMode) => {
    dispatch({ type: "SET_MODE", mode });
  }, []);

  const addMessage = useCallback(
    (message: Omit<ConversationMessage, "id" | "timestamp">) => {
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          ...message,
          id: generateMessageId(),
          timestamp: new Date(),
        },
      });
    },
    []
  );

  const updateLastMessage = useCallback(
    (content: string, isStreaming?: boolean) => {
      dispatch({ type: "UPDATE_LAST_MESSAGE", content, isStreaming });
    },
    []
  );

  const clearMessages = useCallback(() => {
    dispatch({ type: "CLEAR_MESSAGES" });
  }, []);

  const startNewSession = useCallback(() => {
    dispatch({ type: "START_NEW_SESSION" });
  }, []);

  const setMessages = useCallback(
    (messages: ConversationMessageProtocol[]) => {
      dispatch({ type: "SET_MESSAGES", messages });
    },
    []
  );

  // Browser actions
  const setCurrentPath = useCallback((path: string) => {
    dispatch({ type: "SET_CURRENT_PATH", path });
  }, []);

  const toggleDirectory = useCallback((path: string) => {
    dispatch({ type: "TOGGLE_DIRECTORY", path });
  }, []);

  const cacheDirectory = useCallback((path: string, entries: FileEntry[]) => {
    dispatch({ type: "CACHE_DIRECTORY", path, entries });
  }, []);

  const setFileContent = useCallback((content: string, truncated: boolean) => {
    dispatch({ type: "SET_FILE_CONTENT", content, truncated });
  }, []);

  const setFileError = useCallback((error: string) => {
    dispatch({ type: "SET_FILE_ERROR", error });
  }, []);

  const setFileLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: "SET_FILE_LOADING", isLoading });
  }, []);

  const clearBrowserState = useCallback(() => {
    dispatch({ type: "CLEAR_BROWSER_STATE" });
  }, []);

  const clearDirectoryCache = useCallback(() => {
    dispatch({ type: "CLEAR_DIRECTORY_CACHE" });
  }, []);

  const setRecentNotes = useCallback((notes: RecentNoteEntry[]) => {
    dispatch({ type: "SET_RECENT_NOTES", notes });
  }, []);

  const pinFolder = useCallback((path: string) => {
    dispatch({ type: "PIN_FOLDER", path });
  }, []);

  const unpinFolder = useCallback((path: string) => {
    dispatch({ type: "UNPIN_FOLDER", path });
  }, []);

  const setPinnedAssets = useCallback((paths: string[]) => {
    dispatch({ type: "SET_PINNED_FOLDERS", paths });
  }, []);

  const setRecentDiscussions = useCallback(
    (discussions: RecentDiscussionEntry[]) => {
      dispatch({ type: "SET_RECENT_DISCUSSIONS", discussions });
    },
    []
  );

  const removeDiscussion = useCallback((sessionId: string) => {
    dispatch({ type: "REMOVE_DISCUSSION", sessionId });
  }, []);

  const setGoals = useCallback((goals: string | null) => {
    dispatch({ type: "SET_GOALS", goals });
  }, []);

  const setDiscussionPrefill = useCallback((text: string | null) => {
    dispatch({ type: "SET_DISCUSSION_PREFILL", text });
  }, []);

  const setPendingSessionId = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_PENDING_SESSION_ID", sessionId });
  }, []);

  const setShowNewSessionDialog = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_NEW_SESSION_DIALOG", show });
  }, []);

  // Adjust mode actions
  const startAdjust = useCallback(() => {
    dispatch({ type: "START_ADJUST" });
  }, []);

  const updateAdjustContent = useCallback((content: string) => {
    dispatch({ type: "UPDATE_ADJUST_CONTENT", content });
  }, []);

  const cancelAdjust = useCallback(() => {
    dispatch({ type: "CANCEL_ADJUST" });
  }, []);

  const startSave = useCallback(() => {
    dispatch({ type: "START_SAVE" });
  }, []);

  const saveSuccess = useCallback(() => {
    dispatch({ type: "SAVE_SUCCESS" });
  }, []);

  const saveError = useCallback((error: string) => {
    dispatch({ type: "SAVE_ERROR", error });
  }, []);

  // Task actions
  const setViewMode = useCallback((mode: BrowseViewMode) => {
    dispatch({ type: "SET_VIEW_MODE", mode });
    persistViewMode(mode);
  }, []);

  const setTasks = useCallback((tasks: TaskEntry[]) => {
    dispatch({ type: "SET_TASKS", tasks });
  }, []);

  const setTasksLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: "SET_TASKS_LOADING", isLoading });
  }, []);

  const setTasksError = useCallback((error: string | null) => {
    dispatch({ type: "SET_TASKS_ERROR", error });
  }, []);

  const updateTask = useCallback(
    (filePath: string, lineNumber: number, newState: string) => {
      dispatch({ type: "UPDATE_TASK", filePath, lineNumber, newState });
    },
    []
  );

  // Tool invocation actions
  const addToolToLastMessage = useCallback(
    (toolUseId: string, toolName: string) => {
      dispatch({ type: "ADD_TOOL_TO_LAST_MESSAGE", toolUseId, toolName });
    },
    []
  );

  const updateToolInput = useCallback((toolUseId: string, input: unknown) => {
    dispatch({ type: "UPDATE_TOOL_INPUT", toolUseId, input });
  }, []);

  const completeToolInvocation = useCallback(
    (toolUseId: string, output: unknown) => {
      dispatch({ type: "COMPLETE_TOOL_INVOCATION", toolUseId, output });
    },
    []
  );

  const setSlashCommands = useCallback((commands: SlashCommand[]) => {
    dispatch({ type: "SET_SLASH_COMMANDS", commands });
  }, []);

  const setLastMessageContextUsage = useCallback((contextUsage: number) => {
    dispatch({ type: "SET_LAST_MESSAGE_CONTEXT_USAGE", contextUsage });
  }, []);

  const setLastMessageDuration = useCallback((durationMs: number) => {
    dispatch({ type: "SET_LAST_MESSAGE_DURATION", durationMs });
  }, []);

  const replaceLastMessageContent = useCallback(
    (content: string, isStreaming: boolean) => {
      dispatch({ type: "REPLACE_LAST_MESSAGE_CONTENT", content, isStreaming });
    },
    []
  );

  const ensureStreamingMessage = useCallback(() => {
    dispatch({ type: "ENSURE_STREAMING_MESSAGE" });
  }, []);

  const appendStreamingChunk = useCallback((content: string) => {
    dispatch({ type: "APPEND_STREAMING_CHUNK", content });
  }, []);

  const setMessagesIfEmpty = useCallback(
    (messages: ConversationMessageProtocol[]) => {
      dispatch({ type: "SET_MESSAGES_IF_EMPTY", messages });
    },
    []
  );

  const handleSnapshot = useCallback(
    (sessionId: string | undefined, content: string, isProcessing: boolean, contextUsage?: number) => {
      dispatch({ type: "HANDLE_SNAPSHOT", sessionId, content, isProcessing, contextUsage });
    },
    []
  );

  // Search actions
  const setSearchActive = useCallback((isActive: boolean) => {
    dispatch({ type: "SET_SEARCH_ACTIVE", isActive });
  }, []);

  const setSearchMode = useCallback((mode: SearchMode) => {
    dispatch({ type: "SET_SEARCH_MODE", mode });
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_SEARCH_QUERY", query });
  }, []);

  const setSearchResults = useCallback(
    (
      mode: SearchMode,
      fileResults?: FileSearchResult[],
      contentResults?: ContentSearchResult[]
    ) => {
      dispatch({ type: "SET_SEARCH_RESULTS", mode, fileResults, contentResults });
    },
    []
  );

  const setSearchLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: "SET_SEARCH_LOADING", isLoading });
  }, []);

  const toggleResultExpanded = useCallback((path: string) => {
    dispatch({ type: "TOGGLE_RESULT_EXPANDED", path });
  }, []);

  const setSnippets = useCallback(
    (path: string, snippets: ContextSnippet[]) => {
      dispatch({ type: "SET_SNIPPETS", path, snippets });
    },
    []
  );

  const clearSearch = useCallback(() => {
    dispatch({ type: "CLEAR_SEARCH" });
  }, []);

  // Meeting actions
  const setMeetingState = useCallback((meetingState: MeetingState) => {
    dispatch({ type: "SET_MEETING_STATE", state: meetingState });
  }, []);

  const clearMeeting = useCallback(() => {
    dispatch({ type: "CLEAR_MEETING" });
  }, []);

  // Vault config actions
  const updateVaultConfig = useCallback((config: EditableVaultConfig) => {
    dispatch({ type: "UPDATE_VAULT_CONFIG", config });
  }, []);

  const value: SessionContextValue = {
    ...state,
    selectVault,
    clearVault,
    setSessionId,
    setSessionStartTime,
    setMode,
    addMessage,
    updateLastMessage,
    clearMessages,
    startNewSession,
    setMessages,
    setCurrentPath,
    toggleDirectory,
    cacheDirectory,
    setFileContent,
    setFileError,
    setFileLoading,
    clearBrowserState,
    clearDirectoryCache,
    setRecentNotes,
    pinFolder,
    unpinFolder,
    setPinnedAssets,
    setRecentDiscussions,
    removeDiscussion,
    setGoals,
    setDiscussionPrefill,
    setPendingSessionId,
    setShowNewSessionDialog,
    startAdjust,
    updateAdjustContent,
    cancelAdjust,
    startSave,
    saveSuccess,
    saveError,
    setViewMode,
    setTasks,
    setTasksLoading,
    setTasksError,
    updateTask,
    addToolToLastMessage,
    updateToolInput,
    completeToolInvocation,
    setSlashCommands,
    setLastMessageContextUsage,
    setLastMessageDuration,
    replaceLastMessageContent,
    ensureStreamingMessage,
    appendStreamingChunk,
    setMessagesIfEmpty,
    handleSnapshot,
    setSearchActive,
    setSearchMode,
    setSearchQuery,
    setSearchResults,
    setSearchLoading,
    toggleResultExpanded,
    setSnippets,
    clearSearch,

    setMeetingState,
    clearMeeting,
    updateVaultConfig,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/**
 * Hook to access session context.
 * @throws Error if used outside SessionProvider
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}

/**
 * Hook to process incoming server messages and update session state.
 * Call this in a component that has access to useSession.
 */
export function useServerMessageHandler(): (message: ServerMessage) => void {
  const {
    setSessionId,
    setSessionStartTime,
    setMessagesIfEmpty,
    ensureStreamingMessage,
    appendStreamingChunk,
    updateLastMessage,
    handleSnapshot,
    setPendingSessionId,
    setSlashCommands,
    setLastMessageContextUsage,
    setLastMessageDuration,
  } = useSession();

  return useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session_ready":
          if (message.sessionId) {
            setSessionId(message.sessionId);
            // Only clear pendingSessionId when a session is actually established.
            // Empty sessionId means vault was selected but no session yet (e.g., from select_vault).
            // We need to preserve pendingSessionId so Discussion can send resume_session.
            setPendingSessionId(null);
          }
          if (message.createdAt) {
            setSessionStartTime(new Date(message.createdAt));
          }
          // Only restore server history when local state is empty (fresh
          // session load). The emptiness check is inside the reducer to avoid
          // the stale-ref race that caused message fragmentation.
          if (message.messages && message.messages.length > 0) {
            setMessagesIfEmpty(message.messages);
          }
          setSlashCommands(message.slashCommands ?? []);
          break;

        case "response_start":
          ensureStreamingMessage();
          break;

        case "response_chunk":
          appendStreamingChunk(message.content);
          break;

        case "response_end":
          updateLastMessage("", false);
          if (message.contextUsage !== undefined) {
            setLastMessageContextUsage(message.contextUsage);
          }
          if (message.durationMs !== undefined) {
            setLastMessageDuration(message.durationMs);
          }
          break;

        // Note: search_results, snippets, index_progress, pinned_assets, meeting_started,
        // meeting_stopped, meeting_state handlers removed - now handled by REST API hooks

        default: {
          // Handle snapshot event (not in ServerMessage union, sent by SSE stream endpoint)
          const rawMessage = message as unknown as Record<string, unknown>;
          if (rawMessage.type === "snapshot") {
            const sessionId = typeof rawMessage.sessionId === "string" && rawMessage.sessionId
              ? rawMessage.sessionId
              : undefined;
            const content = typeof rawMessage.content === "string" ? rawMessage.content : "";
            const isProcessing = !!rawMessage.isProcessing;
            const contextUsage = typeof rawMessage.contextUsage === "number"
              ? rawMessage.contextUsage
              : undefined;

            handleSnapshot(sessionId, content, isProcessing, contextUsage);
          }
          break;
        }
      }
    },
    [
      setSessionId,
      setSessionStartTime,
      setMessagesIfEmpty,
      ensureStreamingMessage,
      appendStreamingChunk,
      updateLastMessage,
      handleSnapshot,
      setPendingSessionId,
      setSlashCommands,
      setLastMessageContextUsage,
      setLastMessageDuration,
    ]
  );
}
