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
import type { VaultInfo, ServerMessage, FileEntry, RecentNoteEntry, ConversationMessageProtocol } from "@memory-loop/shared";

/**
 * Application mode: note capture, discussion, or browse.
 */
export type AppMode = "note" | "discussion" | "browse";

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
}

/**
 * Session state stored in context.
 */
export interface SessionState {
  /** Currently selected vault */
  vault: VaultInfo | null;
  /** Current session ID (from server) */
  sessionId: string | null;
  /** Current application mode */
  mode: AppMode;
  /** Conversation history for discussion mode */
  messages: ConversationMessage[];
  /** Browser state for file browsing mode */
  browser: BrowserState;
  /** Recent captured notes for note mode */
  recentNotes: RecentNoteEntry[];
}

/**
 * Actions for session state management.
 */
export interface SessionActions {
  /** Select a vault */
  selectVault: (vault: VaultInfo) => void;
  /** Set the session ID */
  setSessionId: (sessionId: string) => void;
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
  /** Set recent notes */
  setRecentNotes: (notes: RecentNoteEntry[]) => void;
}

/**
 * Combined context value.
 */
export type SessionContextValue = SessionState & SessionActions;

/**
 * Session context instance.
 */
const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * localStorage keys for persisting state.
 * Note: Session messages are NOT persisted locally - server is source of truth.
 */
const STORAGE_KEY_VAULT = "memory-loop:vaultId";
const STORAGE_KEY_BROWSER_PATH = "memory-loop:browserPath";

/**
 * Action types for reducer.
 */
type SessionAction =
  | { type: "SELECT_VAULT"; vault: VaultInfo }
  | { type: "SET_SESSION_ID"; sessionId: string }
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
  | { type: "SET_RECENT_NOTES"; notes: RecentNoteEntry[] };

/**
 * Generates a unique message ID.
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Creates initial browser state.
 */
function createInitialBrowserState(): BrowserState {
  return {
    currentPath: "",
    expandedDirs: new Set(),
    directoryCache: new Map(),
    currentFileContent: null,
    currentFileTruncated: false,
    fileError: null,
    isLoading: false,
  };
}

/**
 * Session state reducer.
 */
function sessionReducer(
  state: SessionState,
  action: SessionAction
): SessionState {
  switch (action.type) {
    case "SELECT_VAULT":
      return {
        ...state,
        vault: action.vault,
        // Clear session when switching vaults
        sessionId: null,
        messages: [],
        // Clear browser state when switching vaults (REQ-F-23)
        browser: createInitialBrowserState(),
        // Clear recent notes when switching vaults
        recentNotes: [],
      };

    case "SET_SESSION_ID":
      return {
        ...state,
        sessionId: action.sessionId,
      };

    case "SET_MODE":
      // Preserve browser state when switching modes (REQ-F-22)
      return {
        ...state,
        mode: action.mode,
      };

    case "ADD_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.message],
      };

    case "UPDATE_LAST_MESSAGE": {
      if (state.messages.length === 0) return state;
      const messages = [...state.messages];
      const lastMessage = messages[messages.length - 1];
      messages[messages.length - 1] = {
        ...lastMessage,
        content: lastMessage.content + action.content,
        isStreaming: action.isStreaming ?? lastMessage.isStreaming,
      };
      return {
        ...state,
        messages,
      };
    }

    case "CLEAR_MESSAGES":
      return {
        ...state,
        messages: [],
      };

    case "START_NEW_SESSION":
      return {
        ...state,
        sessionId: null,
        messages: [],
      };

    case "SET_MESSAGES":
      console.log(`[Session] Setting messages from server: ${action.messages.length}`);
      return {
        ...state,
        messages: action.messages.map((msg) => ({
          ...msg,
          // Ensure timestamps are Date objects (may be strings from JSON)
          timestamp: new Date(msg.timestamp),
        })),
      };

    case "SET_CURRENT_PATH":
      return {
        ...state,
        browser: {
          ...state.browser,
          currentPath: action.path,
          // Clear file content when changing path
          currentFileContent: null,
          currentFileTruncated: false,
          fileError: null,
        },
      };

    case "TOGGLE_DIRECTORY": {
      const newExpandedDirs = new Set(state.browser.expandedDirs);
      if (newExpandedDirs.has(action.path)) {
        newExpandedDirs.delete(action.path);
      } else {
        newExpandedDirs.add(action.path);
      }
      return {
        ...state,
        browser: {
          ...state.browser,
          expandedDirs: newExpandedDirs,
        },
      };
    }

    case "CACHE_DIRECTORY": {
      const newCache = new Map(state.browser.directoryCache);
      newCache.set(action.path, action.entries);
      return {
        ...state,
        browser: {
          ...state.browser,
          directoryCache: newCache,
        },
      };
    }

    case "SET_FILE_CONTENT":
      return {
        ...state,
        browser: {
          ...state.browser,
          currentFileContent: action.content,
          currentFileTruncated: action.truncated,
          fileError: null,
          isLoading: false,
        },
      };

    case "SET_FILE_ERROR":
      return {
        ...state,
        browser: {
          ...state.browser,
          currentFileContent: null,
          currentFileTruncated: false,
          fileError: action.error,
          isLoading: false,
        },
      };

    case "SET_FILE_LOADING":
      return {
        ...state,
        browser: {
          ...state.browser,
          isLoading: action.isLoading,
          // Clear error when starting new operation
          fileError: action.isLoading ? null : state.browser.fileError,
        },
      };

    case "CLEAR_BROWSER_STATE":
      return {
        ...state,
        browser: createInitialBrowserState(),
      };

    case "SET_RECENT_NOTES":
      return {
        ...state,
        recentNotes: action.notes,
      };

    default:
      return state;
  }
}

/**
 * Initial state for session.
 */
const initialState: SessionState = {
  vault: null,
  sessionId: null,
  mode: "note",
  messages: [],
  browser: createInitialBrowserState(),
  recentNotes: [],
};

/**
 * Loads persisted vault ID from localStorage.
 */
function loadPersistedVaultId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_VAULT);
  } catch {
    return null;
  }
}

/**
 * Persists vault ID to localStorage.
 */
function persistVaultId(vaultId: string | null): void {
  try {
    if (vaultId) {
      localStorage.setItem(STORAGE_KEY_VAULT, vaultId);
    } else {
      localStorage.removeItem(STORAGE_KEY_VAULT);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Loads persisted browser path from localStorage.
 */
function loadPersistedBrowserPath(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_BROWSER_PATH);
  } catch {
    return null;
  }
}

/**
 * Persists browser path to localStorage.
 */
function persistBrowserPath(path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_BROWSER_PATH, path);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Props for SessionProvider.
 */
export interface SessionProviderProps {
  children: ReactNode;
  /** Optional initial vault list for auto-selecting persisted vault */
  initialVaults?: VaultInfo[];
}

/**
 * Session context provider component.
 */
export function SessionProvider({
  children,
  initialVaults,
}: SessionProviderProps): React.ReactNode {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

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

  // Load persisted state on mount only
  // Note: Session restoration (sessionId + messages) is handled by VaultSelect
  // after sending resume_session to the server
  useEffect(() => {
    // Load persisted vault if vaults are provided
    if (initialVaults && initialVaults.length > 0) {
      const persistedVaultId = loadPersistedVaultId();
      if (persistedVaultId) {
        const vault = initialVaults.find((v) => v.id === persistedVaultId);
        if (vault) {
          dispatch({ type: "SELECT_VAULT", vault });
        }
      }
    }

    // Load persisted browser path
    const persistedBrowserPath = loadPersistedBrowserPath();
    if (persistedBrowserPath) {
      dispatch({ type: "SET_CURRENT_PATH", path: persistedBrowserPath });
    }
  }, [initialVaults]);

  // Action creators
  const selectVault = useCallback((vault: VaultInfo) => {
    dispatch({ type: "SELECT_VAULT", vault });
  }, []);

  const setSessionId = useCallback((sessionId: string) => {
    dispatch({ type: "SET_SESSION_ID", sessionId });
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

  // Browser action creators
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

  const setRecentNotes = useCallback((notes: RecentNoteEntry[]) => {
    dispatch({ type: "SET_RECENT_NOTES", notes });
  }, []);

  const value: SessionContextValue = {
    ...state,
    selectVault,
    setSessionId,
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
    setRecentNotes,
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
 * Call this in a component that has access to both useWebSocket and useSession.
 */
export function useServerMessageHandler(): (message: ServerMessage) => void {
  const { setSessionId, setMessages, addMessage, updateLastMessage } = useSession();

  return useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session_ready":
          if (message.sessionId) {
            setSessionId(message.sessionId);
          }
          // If server sent messages (resuming session), replace local state
          if (message.messages && message.messages.length > 0) {
            setMessages(message.messages);
          }
          break;

        case "response_start":
          // Start a new assistant message
          addMessage({
            role: "assistant",
            content: "",
            isStreaming: true,
          });
          break;

        case "response_chunk":
          // Append to current streaming message
          updateLastMessage(message.content, true);
          break;

        case "response_end":
          // Mark message as complete
          updateLastMessage("", false);
          break;

        // Other message types handled elsewhere
        default:
          break;
      }
    },
    [setSessionId, setMessages, addMessage, updateLastMessage]
  );
}
