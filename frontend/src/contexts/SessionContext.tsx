/**
 * Session Context
 *
 * Manages application session state: current vault, session ID, mode, and messages.
 * Persists session ID to localStorage for resume across page refreshes.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { VaultInfo, ServerMessage } from "@memory-loop/shared";

/**
 * Application mode: note capture or discussion.
 */
export type AppMode = "note" | "discussion";

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
 * localStorage key for persisting session ID.
 */
const STORAGE_KEY_SESSION = "memory-loop:sessionId";
const STORAGE_KEY_VAULT = "memory-loop:vaultId";

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
  | { type: "START_NEW_SESSION" };

/**
 * Generates a unique message ID.
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
      };

    case "SET_SESSION_ID":
      return {
        ...state,
        sessionId: action.sessionId,
      };

    case "SET_MODE":
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
};

/**
 * Loads persisted session ID from localStorage.
 */
function loadPersistedSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_SESSION);
  } catch {
    return null;
  }
}

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
 * Persists session ID to localStorage.
 */
function persistSessionId(sessionId: string | null): void {
  try {
    if (sessionId) {
      localStorage.setItem(STORAGE_KEY_SESSION, sessionId);
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  } catch {
    // Ignore storage errors
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

  // Persist session ID when it changes
  useEffect(() => {
    persistSessionId(state.sessionId);
  }, [state.sessionId]);

  // Persist vault ID when it changes
  useEffect(() => {
    if (state.vault) {
      persistVaultId(state.vault.id);
    }
  }, [state.vault]);

  // Load persisted state on mount only
  useEffect(() => {
    // Load persisted session ID
    const persistedSessionId = loadPersistedSessionId();
    if (persistedSessionId) {
      dispatch({ type: "SET_SESSION_ID", sessionId: persistedSessionId });
    }

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
  }, []);

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
    persistSessionId(null);
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
  const { setSessionId, addMessage, updateLastMessage } = useSession();

  return useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session_ready":
          if (message.sessionId) {
            setSessionId(message.sessionId);
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
    [setSessionId, addMessage, updateLastMessage]
  );
}
