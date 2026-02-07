/**
 * useChat Hook
 *
 * Manages chat communication with the backend via SSE.
 *
 * Features:
 * - Start new sessions
 * - Resume existing sessions
 * - Stream responses via SSE
 * - Resolve tool permissions and questions mid-stream
 * - Abort in-flight requests
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ServerMessage, VaultInfo } from "@/lib/schemas";
import { createLogger } from "@/lib/logger";

const log = createLogger("useChat");

/**
 * Streaming state for the chat hook.
 */
export type ChatStreamingState =
  | "idle" // No active streaming
  | "starting" // Request sent, waiting for SSE stream to start
  | "streaming" // Actively receiving events
  | "error"; // Error occurred

/**
 * Return type for the useChat hook.
 */
export interface UseChatResult {
  /** Send a message to start/continue a conversation */
  sendMessage: (text: string) => Promise<void>;
  /** Abort the current streaming response */
  abort: () => Promise<void>;
  /** Resolve a pending tool permission request */
  resolvePermission: (toolUseId: string, allowed: boolean) => Promise<void>;
  /** Resolve a pending AskUserQuestion request */
  resolveQuestion: (
    toolUseId: string,
    answers: Record<string, string>
  ) => Promise<void>;
  /** Current streaming state */
  streamingState: ChatStreamingState;
  /** Whether currently streaming (convenience alias) */
  isStreaming: boolean;
  /** Current session ID (if any) */
  sessionId: string | null;
  /** Last error message (if any) */
  lastError: string | null;
}

/**
 * Configuration options for the useChat hook.
 */
export interface UseChatOptions {
  /** API base URL (defaults to /api) */
  apiBase?: string;
  /** Initial session ID for resuming a previous session */
  initialSessionId?: string | null;
  /** Callback for each received event */
  onEvent?: (event: ServerMessage) => void;
  /** Callback when streaming starts */
  onStreamStart?: () => void;
  /** Callback when streaming ends */
  onStreamEnd?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/**
 * SSE event data format from the backend.
 */
interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Parses SSE data lines into events.
 * Handles the "data: {json}" format.
 */
function parseSSE(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = chunk.split("\n");

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const json = line.slice(6); // Remove "data: " prefix
        const event = JSON.parse(json) as SSEEvent;
        events.push(event);
      } catch {
        log.warn("Failed to parse SSE event", line);
      }
    }
  }

  return events;
}

/**
 * React hook for managing chat via SSE.
 *
 * @param vault - The current vault (required for new sessions)
 * @param options - Configuration options
 * @returns Chat state and controls
 */
export function useChat(
  vault: VaultInfo | null,
  options: UseChatOptions = {}
): UseChatResult {
  const { apiBase = "/api", initialSessionId, onEvent, onStreamStart, onStreamEnd, onError } =
    options;

  // State
  const [streamingState, setStreamingState] = useState<ChatStreamingState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Refs for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);
  const onEventRef = useRef(onEvent);
  const onStreamStartRef = useRef(onStreamStart);
  const onStreamEndRef = useRef(onStreamEnd);
  const onErrorRef = useRef(onError);

  // Keep callback refs in sync
  useEffect(() => {
    onEventRef.current = onEvent;
    onStreamStartRef.current = onStreamStart;
    onStreamEndRef.current = onStreamEnd;
    onErrorRef.current = onError;
  }, [onEvent, onStreamStart, onStreamEnd, onError]);

  /**
   * Sends a message to start/continue a conversation.
   */
  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!vault) {
        const error = "No vault selected";
        setLastError(error);
        onErrorRef.current?.(error);
        return;
      }

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStreamingState("starting");
      setLastError(null);
      onStreamStartRef.current?.();

      try {
        // Build request body - always include vault info
        const body: Record<string, string> = {
          vaultId: vault.id,
          vaultPath: vault.path,
          prompt: text,
        };
        if (sessionId) {
          body.sessionId = sessionId;
        }

        log.info(`sendMessage: session=${sessionId ?? "new"}, vault=${vault.id}`);

        const response = await fetch(`${apiBase}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
          const error = errorBody.error ?? `HTTP ${response.status}`;
          throw new Error(error);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        setStreamingState("streaming");

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Parse complete events from buffer
          // SSE events are separated by double newlines
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? ""; // Keep incomplete part in buffer

          for (const part of parts) {
            if (!part.trim()) continue;

            const events = parseSSE(part);
            for (const event of events) {
              // Handle session_ready to capture session ID
              if (event.type === "session_ready" && typeof event.sessionId === "string" && event.sessionId) {
                log.info(`Session ready: ${event.sessionId}`);
                setSessionId(event.sessionId);
              }

              // Handle errors
              if (event.type === "error") {
                const errorMessage = typeof event.message === "string" ? event.message : "Unknown error";
                setLastError(errorMessage);
                onErrorRef.current?.(errorMessage);
              }

              // Translate prompt_pending events to the ServerMessage types
              // the frontend components expect
              if (event.type === "prompt_pending") {
                const prompt = event.prompt as {
                  id: string;
                  type: string;
                  toolName?: string;
                  input?: unknown;
                  questions?: unknown[];
                };
                if (prompt.type === "tool_permission") {
                  onEventRef.current?.({
                    type: "tool_permission_request",
                    toolUseId: prompt.id,
                    toolName: prompt.toolName ?? "",
                    input: prompt.input,
                  } as unknown as ServerMessage);
                } else if (prompt.type === "ask_user_question") {
                  onEventRef.current?.({
                    type: "ask_user_question_request",
                    toolUseId: prompt.id,
                    questions: prompt.questions ?? [],
                  } as unknown as ServerMessage);
                }
                continue;
              }

              // Forward all other events to callback
              onEventRef.current?.(event as unknown as ServerMessage);
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          const events = parseSSE(buffer);
          for (const event of events) {
            onEventRef.current?.(event as unknown as ServerMessage);
          }
        }

        setStreamingState("idle");
        onStreamEndRef.current?.();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Request was aborted, not an error
          setStreamingState("idle");
          onStreamEndRef.current?.();
          return;
        }

        const error = err instanceof Error ? err.message : "Unknown error";
        setLastError(error);
        setStreamingState("error");
        onErrorRef.current?.(error);
        onStreamEndRef.current?.();
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [vault, sessionId, apiBase]
  );

  /**
   * Aborts the current streaming response.
   */
  const abort = useCallback(async (): Promise<void> => {
    // Abort the fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Also notify server (best-effort)
    if (sessionId) {
      try {
        await fetch(`${apiBase}/chat/${sessionId}/abort`, {
          method: "POST",
        });
      } catch {
        // Ignore errors - server may have already ended
      }
    }

    setStreamingState("idle");
    onStreamEndRef.current?.();
  }, [sessionId, apiBase]);

  /**
   * Resolves a pending tool permission request.
   */
  const resolvePermission = useCallback(
    async (toolUseId: string, allowed: boolean): Promise<void> => {
      if (!sessionId) {
        log.warn("Cannot resolve permission: no session");
        return;
      }

      try {
        const response = await fetch(
          `${apiBase}/chat/${sessionId}/permission/${toolUseId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allowed }),
          }
        );

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
          log.error("Permission resolution failed", errorBody.error ?? response.status);
        }
      } catch (err) {
        log.error("Failed to resolve permission", err);
      }
    },
    [sessionId, apiBase]
  );

  /**
   * Resolves a pending AskUserQuestion request.
   */
  const resolveQuestion = useCallback(
    async (toolUseId: string, answers: Record<string, string>): Promise<void> => {
      if (!sessionId) {
        log.warn("Cannot resolve question: no session");
        return;
      }

      try {
        const response = await fetch(
          `${apiBase}/chat/${sessionId}/answer/${toolUseId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers }),
          }
        );

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
          log.error("Question resolution failed", errorBody.error ?? response.status);
        }
      } catch (err) {
        log.error("Failed to resolve question", err);
      }
    },
    [sessionId, apiBase]
  );

  /**
   * Clear session on vault change (but not on initial mount).
   */
  const prevVaultIdRef = useRef(vault?.id);
  useEffect(() => {
    if (prevVaultIdRef.current === vault?.id) return;
    prevVaultIdRef.current = vault?.id;

    setSessionId(null);
    setLastError(null);
    setStreamingState("idle");

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [vault?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    sendMessage,
    abort,
    resolvePermission,
    resolveQuestion,
    streamingState,
    isStreaming: streamingState === "streaming" || streamingState === "starting",
    sessionId,
    lastError,
  };
}
