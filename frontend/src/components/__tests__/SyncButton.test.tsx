/**
 * Tests for SyncButton component
 *
 * Tests sync status display and trigger functionality.
 * REQ-F-30: Sync button in Ground tab
 * REQ-F-31: Button shows sync status: idle, syncing, success, error
 * REQ-F-32: Error state shows brief message
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { SyncButton } from "../SyncButton";
import { SessionProvider } from "../../contexts/SessionContext";
import type { ClientMessage, VaultInfo } from "@memory-loop/shared";

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {
    wsInstances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen(new Event("open"));
    }, 0);
  }

  send(data: string): void {
    sentMessages.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

let wsInstances: MockWebSocket[] = [];
let sentMessages: ClientMessage[] = [];
const originalWebSocket = globalThis.WebSocket;

const testVault: VaultInfo = {
  id: "vault-1",
  name: "Test Vault",
  path: "/test/vault",
  hasClaudeMd: true,
  contentRoot: "/test/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: false,
  hasSyncConfig: true,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
};

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

// Wrapper with providers
function createTestWrapper() {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialVaults={[testVault]}>
        {children}
      </SessionProvider>
    );
  };
}

describe("SyncButton", () => {
  describe("rendering", () => {
    it("renders button with idle status by default", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      expect(screen.getByRole("button")).toBeDefined();
      expect(screen.getByText("Sync External Data")).toBeDefined();
    });

    it("has correct aria-label for idle state", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      const button = screen.getByRole("button");
      expect(button.getAttribute("aria-label")).toContain("sync external data");
    });

    it("is not disabled when idle", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      const button = screen.getByRole("button");
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    it("applies idle class by default", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      const button = screen.getByRole("button");
      expect(button.className).toContain("sync-button--idle");
    });
  });

  describe("click behavior", () => {
    it("sends trigger_sync message on click", async () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      // Wait for WebSocket to connect
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const button = screen.getByRole("button");
      act(() => {
        fireEvent.click(button);
      });

      const syncMessage = sentMessages.find((m) => m.type === "trigger_sync");
      expect(syncMessage).toBeDefined();
      expect((syncMessage as { mode: string }).mode).toBe("incremental");
    });
  });

  describe("accessibility", () => {
    it("has aria-label on button", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      const button = screen.getByRole("button");
      expect(button.hasAttribute("aria-label")).toBe(true);
    });

    it("has aria-busy attribute", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      const button = screen.getByRole("button");
      expect(button.hasAttribute("aria-busy")).toBe(true);
    });
  });

  describe("visual indicators", () => {
    it("shows sync icon", () => {
      render(<SyncButton />, {
        wrapper: createTestWrapper(),
      });

      // The icon span should be present
      expect(screen.getByText("↻")).toBeDefined();
    });
  });
});
