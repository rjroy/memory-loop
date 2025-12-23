/**
 * useWebSocket Hook
 *
 * Manages WebSocket connection to the backend with:
 * - Automatic connection on mount
 * - Message sending with type-safe protocol
 * - Auto-reconnect with exponential backoff
 * - Connection status tracking
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import { safeParseServerMessage } from "@memory-loop/shared";

/**
 * Connection status for the WebSocket.
 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Return type for the useWebSocket hook.
 */
export interface UseWebSocketResult {
  /** Send a message to the server */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message */
  lastMessage: ServerMessage | null;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
}

/**
 * Configuration options for the WebSocket hook.
 */
export interface UseWebSocketOptions {
  /** WebSocket URL (defaults to /ws) */
  url?: string;
  /** Initial reconnect delay in ms (default: 1000) */
  initialDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxDelay?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
}

/**
 * Default configuration values.
 */
const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  url: "/ws",
  initialDelay: 1000,
  maxDelay: 30000,
  autoReconnect: true,
};

/**
 * Builds the WebSocket URL from a path.
 * Converts /ws to ws://host/ws or wss://host/ws based on protocol.
 */
export function buildWebSocketUrl(path: string): string {
  const loc = globalThis.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = loc.host;
  return `${protocol}//${host}${path}`;
}

/**
 * React hook for managing WebSocket connections.
 *
 * Features:
 * - Connects automatically on mount
 * - Sends typed ClientMessage messages
 * - Receives and parses ServerMessage responses
 * - Auto-reconnects with exponential backoff on disconnect
 * - Cleans up connection on unmount
 *
 * @param options - Configuration options
 * @returns WebSocket state and controls
 */
export function useWebSocket(
  options: UseWebSocketOptions = {}
): UseWebSocketResult {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // State
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  // Refs for mutable state that shouldn't trigger re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectDelayRef = useRef(config.initialDelay);
  const mountedRef = useRef(true);

  /**
   * Clears any pending reconnect timeout.
   */
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /**
   * Schedules a reconnection attempt with exponential backoff.
   */
  const scheduleReconnect = useCallback(
    (connect: () => void) => {
      if (!config.autoReconnect || !mountedRef.current) {
        return;
      }

      clearReconnectTimeout();

      const delay = reconnectDelayRef.current;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);

      // Exponential backoff: double the delay, up to max
      reconnectDelayRef.current = Math.min(delay * 2, config.maxDelay);
    },
    [config.autoReconnect, config.maxDelay, clearReconnectTimeout]
  );

  /**
   * Resets the reconnect delay to initial value.
   * Called on successful connection.
   */
  const resetReconnectDelay = useCallback(() => {
    reconnectDelayRef.current = config.initialDelay;
  }, [config.initialDelay]);

  /**
   * Establishes a WebSocket connection.
   */
  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    setConnectionStatus("connecting");

    const url = buildWebSocketUrl(config.url);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setConnectionStatus("connected");
      resetReconnectDelay();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const data: unknown = JSON.parse(event.data as string);
        const result = safeParseServerMessage(data);

        if (result.success) {
          setLastMessage(result.data);
        } else {
          console.warn("Invalid server message:", result.error);
        }
      } catch (error) {
        console.warn("Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      setConnectionStatus("disconnected");
      wsRef.current = null;
      scheduleReconnect(connect);
    };

    ws.onerror = (error) => {
      console.warn("WebSocket error:", error);
      // onclose will be called after onerror, which handles reconnection
    };

    wsRef.current = ws;
  }, [config.url, resetReconnectDelay, scheduleReconnect]);

  /**
   * Sends a message to the server.
   * Silently fails if not connected.
   */
  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("Cannot send message: WebSocket not connected");
    }
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();

      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimeout]);

  return {
    sendMessage,
    lastMessage,
    connectionStatus,
  };
}
