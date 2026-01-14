/**
 * Tests for App Header Gear Button (TASK-009)
 *
 * Tests that the gear button renders in the App header when a vault is selected
 * and opens the ConfigEditorDialog.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { App } from "../App";
import { createMockVault } from "../test-helpers";

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      if (this.onopen) this.onopen(new Event("open"));
    }, 0);
  }

  send(data: string): void {
    const message = JSON.parse(data) as { type: string; vaultId?: string };
    // Simulate server response for select_vault
    if (message.type === "select_vault") {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "session_ready",
                sessionId: "test-session-123",
                vaultId: message.vaultId,
              }),
            })
          );
        }
      }, 10);
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

const originalWebSocket = globalThis.WebSocket;
const mockVault = createMockVault({ name: "Test Vault", badges: [] });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

/**
 * Helper to mock fetch with vault and session API responses
 */
function mockFetchForVaults(vaults: ReturnType<typeof createMockVault>[]) {
  (globalThis.fetch as unknown) = mock((url: RequestInfo | URL) => {
    // Handle URL objects, Request objects, and string URLs
    let urlStr: string;
    if (typeof url === "string") {
      urlStr = url;
    } else if (url instanceof URL) {
      urlStr = url.href;
    } else {
      // Request object
      urlStr = url.url;
    }
    if (urlStr.includes("/api/vaults")) {
      return Promise.resolve(
        new Response(JSON.stringify({ vaults }), { status: 200 })
      );
    }
    if (urlStr.includes("/api/sessions/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ sessionId: null }), { status: 200 })
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
}

describe("App Header Gear Button", () => {
  it("does not render gear button when no vault is selected", async () => {
    mockFetchForVaults([mockVault]);

    render(<App />);

    // Wait for vault list to load
    await waitFor(() => {
      expect(screen.getByText("Test Vault")).toBeDefined();
    });

    // Gear button should not be present (no vault selected yet)
    expect(screen.queryByLabelText("Vault settings")).toBeNull();
  });

  it("renders gear button when vault is selected", async () => {
    mockFetchForVaults([mockVault]);

    render(<App />);

    // Wait for vault list to load
    await waitFor(() => {
      expect(screen.getByText("Test Vault")).toBeDefined();
    });

    // Click on the vault to select it
    fireEvent.click(screen.getByText("Test Vault"));

    // Wait for session_ready and vault to be selected
    await waitFor(
      () => {
        expect(screen.getByLabelText("Vault settings")).toBeDefined();
      },
      { timeout: 1000 }
    );
  });

  it("opens ConfigEditorDialog when gear button is clicked", async () => {
    mockFetchForVaults([mockVault]);

    render(<App />);

    // Wait for vault list to load
    await waitFor(() => {
      expect(screen.getByText("Test Vault")).toBeDefined();
    });

    // Click on the vault to select it
    fireEvent.click(screen.getByText("Test Vault"));

    // Wait for gear button to appear
    await waitFor(
      () => {
        expect(screen.getByLabelText("Vault settings")).toBeDefined();
      },
      { timeout: 1000 }
    );

    // Click the gear button
    fireEvent.click(screen.getByLabelText("Vault settings"));

    // ConfigEditorDialog should open
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Vault Settings")).toBeDefined();
    });
  });
});
