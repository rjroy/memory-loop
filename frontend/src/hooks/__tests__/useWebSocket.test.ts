/**
 * Tests for useWebSocket hook
 *
 * Tests connection state machine, message sending/receiving,
 * and auto-reconnect with exponential backoff.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWebSocket, buildWebSocketUrl } from "../useWebSocket";
import type { ServerMessage, ClientMessage } from "@memory-loop/shared";

// Mock WebSocket class
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private _sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this._sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: ServerMessage): void {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent("message", { data: JSON.stringify(data) })
      );
    }
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  getSentMessages(): string[] {
    return this._sentMessages;
  }

  getParsedMessages(): ClientMessage[] {
    return this._sentMessages.map((m) => JSON.parse(m) as ClientMessage);
  }
}

// Track all WebSocket instances for testing
let instances: MockWebSocket[] = [];

// Store original WebSocket
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  instances = [];

  // Mock WebSocket globally
  // @ts-expect-error - replacing global WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  // Restore originals
  globalThis.WebSocket = originalWebSocket;
});

describe("buildWebSocketUrl", () => {
  it("builds URL using current location", () => {
    // The URL will use whatever location happy-dom provides
    const url = buildWebSocketUrl("/ws");
    expect(url).toContain("/ws");
    expect(url.startsWith("ws://") || url.startsWith("wss://")).toBe(true);
  });
});

describe("useWebSocket", () => {
  describe("connection lifecycle", () => {
    it("connects on mount with 'connecting' status", () => {
      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connectionStatus).toBe("connecting");
      expect(instances.length).toBe(1);
    });

    it("transitions to 'connected' when WebSocket opens", () => {
      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connectionStatus).toBe("connecting");

      act(() => {
        instances[0].simulateOpen();
      });

      expect(result.current.connectionStatus).toBe("connected");
    });

    it("transitions to 'disconnected' when WebSocket closes", () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      expect(result.current.connectionStatus).toBe("connected");

      act(() => {
        instances[0].simulateClose();
      });

      expect(result.current.connectionStatus).toBe("disconnected");
    });

    it("closes WebSocket on unmount", () => {
      const { unmount } = renderHook(() => useWebSocket());

      const ws = instances[0];
      act(() => {
        ws.simulateOpen();
      });

      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      unmount();

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it("uses custom URL from options", () => {
      renderHook(() => useWebSocket({ url: "/api/ws" }));

      expect(instances[0].url).toContain("/api/ws");
    });
  });

  describe("message handling", () => {
    it("sends messages when connected", () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      const message: ClientMessage = { type: "ping" };
      act(() => {
        result.current.sendMessage(message);
      });

      const sent = instances[0].getParsedMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual({ type: "ping" });
    });

    it("logs warning when sending while disconnected", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useWebSocket());

      // Don't open the connection
      const message: ClientMessage = { type: "ping" };
      act(() => {
        result.current.sendMessage(message);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "Cannot send message: WebSocket not connected"
      );

      warnSpy.mockRestore();
    });

    it("receives and parses server messages", () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      const serverMessage: ServerMessage = { type: "pong" };
      act(() => {
        instances[0].simulateMessage(serverMessage);
      });

      expect(result.current.lastMessage).toEqual({ type: "pong" });
    });

    it("updates lastMessage on each received message", () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      act(() => {
        instances[0].simulateMessage({ type: "pong" });
      });
      expect(result.current.lastMessage).toEqual({ type: "pong" });

      const vaultList: ServerMessage = {
        type: "vault_list",
        vaults: [
          {
            id: "v1",
            name: "Test",
            path: "/test",
            hasClaudeMd: false,
            contentRoot: "/test",
            inboxPath: "inbox",
            metadataPath: "06_Metadata/memory-loop",
            attachmentPath: "05_Attachments",
            setupComplete: false,
            promptsPerGeneration: 5,
            maxPoolSize: 50,
            quotesPerWeek: 1,
            badges: [],
            order: 999999,
          },
        ],
      };
      act(() => {
        instances[0].simulateMessage(vaultList);
      });
      expect(result.current.lastMessage).toEqual(vaultList);
    });

    it("ignores invalid server messages", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      // Send invalid message (not matching schema)
      act(() => {
        if (instances[0].onmessage) {
          instances[0].onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({ invalid: "message" }),
            })
          );
        }
      });

      expect(result.current.lastMessage).toBeNull();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("handles malformed JSON gracefully", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateOpen();
      });

      act(() => {
        if (instances[0].onmessage) {
          instances[0].onmessage(
            new MessageEvent("message", { data: "not json" })
          );
        }
      });

      expect(result.current.lastMessage).toBeNull();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("auto-reconnect", () => {
    it("attempts to reconnect after disconnect", async () => {
      const { result } = renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: true })
      );

      act(() => {
        instances[0].simulateOpen();
      });

      expect(instances.length).toBe(1);

      act(() => {
        instances[0].simulateClose();
      });

      expect(result.current.connectionStatus).toBe("disconnected");

      // Wait for reconnect
      await waitFor(
        () => {
          expect(instances.length).toBe(2);
        },
        { timeout: 100 }
      );
    });

    it("does not reconnect when autoReconnect is false", async () => {
      renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: false })
      );

      act(() => {
        instances[0].simulateOpen();
        instances[0].simulateClose();
      });

      // Wait and verify no reconnect
      await new Promise((r) => setTimeout(r, 50));

      expect(instances.length).toBe(1);
    });

    it("does not reconnect after unmount", async () => {
      const { unmount } = renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: true })
      );

      act(() => {
        instances[0].simulateOpen();
      });

      // Unmount before close
      unmount();

      // Wait and verify no new instances
      await new Promise((r) => setTimeout(r, 50));

      expect(instances.length).toBe(1);
    });
  });

  describe("error handling", () => {
    it("logs WebSocket errors", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      renderHook(() => useWebSocket());

      act(() => {
        instances[0].simulateError();
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "WebSocket error:",
        expect.any(Event)
      );

      warnSpy.mockRestore();
    });
  });

  // Note: search methods tests removed - functionality migrated to REST API (useSearch hook)

  describe("visibility-aware reconnect", () => {
    it("defers reconnect when page is hidden", async () => {
      // Mock visibilityState inline for test isolation
      let visibility = "visible";
      Object.defineProperty(document, "visibilityState", {
        get: () => visibility,
        configurable: true,
      });

      const { unmount } = renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: true })
      );

      act(() => {
        instances[0].simulateOpen();
      });

      expect(instances.length).toBe(1);

      // Page becomes hidden before disconnect
      visibility = "hidden";

      act(() => {
        instances[0].simulateClose();
      });

      // Wait - should NOT create new instance while hidden
      await new Promise((r) => setTimeout(r, 50));
      expect(instances.length).toBe(1);

      // Cleanup
      unmount();
    });

    it("reconnects when page becomes visible after deferred disconnect", async () => {
      // Mock visibilityState inline for test isolation
      let visibility = "visible";
      Object.defineProperty(document, "visibilityState", {
        get: () => visibility,
        configurable: true,
      });

      const { result, unmount } = renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: true })
      );

      act(() => {
        instances[0].simulateOpen();
      });

      expect(result.current.connectionStatus).toBe("connected");

      // Page becomes hidden
      visibility = "hidden";

      act(() => {
        instances[0].simulateClose();
      });

      expect(result.current.connectionStatus).toBe("disconnected");

      // Verify no reconnect while hidden
      await new Promise((r) => setTimeout(r, 30));
      expect(instances.length).toBe(1);

      // Page becomes visible and dispatch event
      visibility = "visible";

      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Should reconnect now (connect is called synchronously on visibility change)
      await waitFor(
        () => {
          expect(instances.length).toBe(2);
        },
        { timeout: 100 }
      );

      // Cleanup to ensure event listeners are removed
      unmount();
    });

    it("calls onReconnect callback on reconnection", async () => {
      let reconnectCount = 0;
      const onReconnect = () => {
        reconnectCount++;
      };

      renderHook(() =>
        useWebSocket({ initialDelay: 10, autoReconnect: true, onReconnect })
      );

      // First connection - onReconnect should NOT be called
      act(() => {
        instances[0].simulateOpen();
      });
      expect(reconnectCount).toBe(0);

      // Disconnect and reconnect
      act(() => {
        instances[0].simulateClose();
      });

      await waitFor(
        () => {
          expect(instances.length).toBe(2);
        },
        { timeout: 100 }
      );

      // Open the new connection
      act(() => {
        instances[1].simulateOpen();
      });

      // onReconnect should be called on reconnection
      expect(reconnectCount).toBe(1);
    });
  });
});
