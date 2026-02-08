/**
 * useChat Hook
 *
 * Manages chat communication with the backend via two-phase flow:
 * 1. POST /api/chat - Submit message, get session ID (or 409 if processing)
 * 2. GET /api/chat/stream - Attach SSE viewport for snapshot + live events
 *
 * Session ID is owned by SessionContext and passed in as a parameter.
 * This hook does NOT maintain its own session ID state. When a session_ready
 * event arrives, it's forwarded via onEvent to useServerMessageHandler which
 * updates context. The next render passes the updated session ID back in.
 *
 * Features:
 * - Start new sessions (sessionId is null)
 * - Resume existing sessions (sessionId is set)
 * - Stream responses via SSE (separate GET endpoint)
 * - Resolve tool permissions and questions mid-stream
 * - Abort in-flight requests
 * - Reconnect to active stream on mount (via snapshot)
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
  /** Last error message (if any) */
  lastError: string | null;
}

/**
 * Configuration options for the useChat hook.
 */
export interface UseChatOptions {
  /** API base URL (defaults to /api) */
  apiBase?: string;
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
 * React hook for managing chat via two-phase SSE.
 *
 * Phase 1: POST /api/chat submits the message and returns { sessionId }.
 * Phase 2: GET /api/chat/stream connects to the SSE viewport for events.
 *
 * Session ID is caller-owned (from SessionContext). This hook reads
 * it via a ref so callbacks always use the latest value without
 * needing to be recreated on every session ID change.
 *
 * @param vault - The current vault (required for new sessions)
 * @param sessionId - Current session ID from context (null = new session)
 * @param options - Configuration options
 * @returns Chat state and controls
 */
export function useChat(
  vault: VaultInfo | null,
  sessionId: string | null,
  options: UseChatOptions = {}
): UseChatResult {
  const { apiBase = "/api", onEvent, onStreamStart, onStreamEnd, onError } =
    options;

  // State (session ID is NOT here, it's owned by the caller)
  const [streamingState, setStreamingState] = useState<ChatStreamingState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  // Ref for session ID so callbacks always read the latest value
  // without needing to be recreated when session ID changes
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Refs for cleanup and stable callback references
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
   * Processes a single SSE event from the stream.
   *
   * Handles snapshot events (first event from stream), translates
   * prompt_pending events into the ServerMessage types the frontend
   * components expect, and forwards everything else via onEvent.
   */
  function handleStreamEvent(event: SSEEvent): void {
    // Handle snapshot event (first event from stream)
    if (event.type === "snapshot") {
      onEventRef.current?.(event as unknown as ServerMessage);
      return;
    }

    // Handle errors
    if (event.type === "error") {
      const errorMessage = typeof event.message === "string" ? event.message : "Unknown error";
      setLastError(errorMessage);
      onErrorRef.current?.(errorMessage);
    }

    // Log session_ready (context update happens via onEvent -> useServerMessageHandler)
    if (event.type === "session_ready" && typeof event.sessionId === "string" && event.sessionId) {
      log.info(`Session ready: ${event.sessionId}`);
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
      return;
    }

    // Forward all other events to callback
    onEventRef.current?.(event as unknown as ServerMessage);
  }

  /**
   * Connects to GET /api/chat/stream and reads SSE events.
   *
   * The stream starts with a snapshot event containing current state,
   * then sends live events while processing continues. Callable from
   * sendMessage (after the POST) or from a reconnection effect.
   *
   * This is fire-and-forget: it launches an async reader internally.
   * The AbortController in abortControllerRef controls its lifecycle.
   */
  function connectToStream(): void {
    // Abort any existing stream connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStreamingState("streaming");

    // Fire-and-forget async reader
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/chat/stream`, {
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed: HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse complete events from buffer (SSE events separated by double newlines)
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            if (!part.trim()) continue;
            const events = parseSSE(part);
            for (const event of events) {
              handleStreamEvent(event);
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          const events = parseSSE(buffer);
          for (const event of events) {
            handleStreamEvent(event);
          }
        }

        setStreamingState("idle");
        onStreamEndRef.current?.();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStreamingState("idle");
          onStreamEndRef.current?.();
          return;
        }
        const error = err instanceof Error ? err.message : "Stream connection failed";
        setLastError(error);
        setStreamingState("error");
        onErrorRef.current?.(error);
        onStreamEndRef.current?.();
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    })();
  }

  /**
   * Sends a message via two-phase flow:
   * 1. POST /api/chat (submit message, get session ID or 409)
   * 2. connectToStream() (attach SSE viewport)
   */
  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!vault) {
        const error = "No vault selected";
        setLastError(error);
        onErrorRef.current?.(error);
        return;
      }

      setStreamingState("starting");
      setLastError(null);
      onStreamStartRef.current?.();

      const currentSessionId = sessionIdRef.current;

      try {
        // Phase 1: Submit message via REST
        const body: Record<string, string> = {
          vaultId: vault.id,
          vaultPath: vault.path,
          prompt: text,
        };
        if (currentSessionId) {
          body.sessionId = currentSessionId;
        }

        log.info(`sendMessage: session=${currentSessionId ?? "new"}, vault=${vault.id}`);

        const postResponse = await fetch(`${apiBase}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!postResponse.ok) {
          const errorBody = await postResponse.json().catch(() => ({})) as {
            error?: { code?: string; message?: string };
          };
          if (postResponse.status === 409) {
            const error = errorBody.error?.message ?? "Processing in progress, please wait";
            setLastError(error);
            setStreamingState("error");
            onErrorRef.current?.(error);
            return;
          }
          throw new Error(errorBody.error?.message ?? `HTTP ${postResponse.status}`);
        }

        // Phase 2: Connect to SSE stream
        connectToStream();
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setLastError(error);
        setStreamingState("error");
        onErrorRef.current?.(error);
        onStreamEndRef.current?.();
      }
    },
    [vault, apiBase]
  );

  /**
   * Aborts the current streaming response.
   *
   * Sends the abort request to the server first so the controller can
   * emit terminal events, then closes the SSE connection as cleanup.
   */
  const abort = useCallback(async (): Promise<void> => {
    // Notify server to abort (best-effort, before closing stream)
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId) {
      try {
        await fetch(`${apiBase}/chat/${currentSessionId}/abort`, {
          method: "POST",
        });
      } catch {
        // Ignore errors, server may have already ended
      }
    }

    // Close the SSE stream connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setStreamingState("idle");
    onStreamEndRef.current?.();
  }, [apiBase]);

  /**
   * Resolves a pending tool permission request.
   */
  const resolvePermission = useCallback(
    async (toolUseId: string, allowed: boolean): Promise<void> => {
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        log.warn("Cannot resolve permission: no session");
        return;
      }

      try {
        const response = await fetch(
          `${apiBase}/chat/${currentSessionId}/permission/${toolUseId}`,
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
    [apiBase]
  );

  /**
   * Resolves a pending AskUserQuestion request.
   */
  const resolveQuestion = useCallback(
    async (toolUseId: string, answers: Record<string, string>): Promise<void> => {
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        log.warn("Cannot resolve question: no session");
        return;
      }

      try {
        const response = await fetch(
          `${apiBase}/chat/${currentSessionId}/answer/${toolUseId}`,
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
    [apiBase]
  );

  // Abort in-flight requests on vault change
  const prevVaultIdRef = useRef(vault?.id);
  useEffect(() => {
    if (prevVaultIdRef.current === vault?.id) return;
    prevVaultIdRef.current = vault?.id;

    setLastError(null);
    setStreamingState("idle");

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
    lastError,
  };
}
