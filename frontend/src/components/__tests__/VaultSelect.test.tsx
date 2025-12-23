/**
 * Tests for VaultSelect component
 *
 * Tests loading, empty, error states, and vault selection.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { VaultSelect } from "../VaultSelect";
import { SessionProvider } from "../../contexts/SessionContext";
import type { VaultInfo, ServerMessage, ClientMessage } from "@memory-loop/shared";

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
    wsInstances.push(this);
    // Simulate connection
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

  simulateMessage(msg: ServerMessage): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(msg) }));
    }
  }
}

let wsInstances: MockWebSocket[] = [];
let sentMessages: ClientMessage[] = [];
const originalWebSocket = globalThis.WebSocket;

// Mock fetch
let mockFetchResponse: { ok: boolean; status: number; json: () => Promise<VaultInfo[]> };
const originalFetch = globalThis.fetch;

// Test data
const testVaults: VaultInfo[] = [
  {
    id: "vault-1",
    name: "Personal Notes",
    path: "/home/user/notes",
    hasClaudeMd: true,
    inboxPath: "/home/user/notes/inbox",
  },
  {
    id: "vault-2",
    name: "Work",
    path: "/home/user/work",
    hasClaudeMd: false,
    inboxPath: "/home/user/work/inbox",
  },
];

// Wrapper with providers
function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();

  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;

  // Default mock fetch response
  mockFetchResponse = {
    ok: true,
    status: 200,
    json: () => Promise.resolve(testVaults),
  };

  // @ts-expect-error - mocking fetch
  globalThis.fetch = () => Promise.resolve(mockFetchResponse);
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

describe("VaultSelect", () => {
  describe("loading state", () => {
    it("shows loading spinner on initial render", () => {
      // Make fetch hang
      // @ts-expect-error - mocking fetch
      globalThis.fetch = () => new Promise(() => {});

      render(<VaultSelect />, { wrapper: TestWrapper });

      expect(screen.getByText("Loading vaults...")).toBeDefined();
      expect(screen.getByLabelText("Loading vaults")).toBeDefined();
    });
  });

  describe("loaded state", () => {
    it("displays vault cards after loading", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
        expect(screen.getByText("Work")).toBeDefined();
      });
    });

    it("shows vault paths", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("/home/user/notes")).toBeDefined();
        expect(screen.getByText("/home/user/work")).toBeDefined();
      });
    });

    it("shows CLAUDE.md badge for vaults with CLAUDE.md", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        // Use getAllByText since there might be multiple badges
        const badges = screen.getAllByText("CLAUDE.md");
        expect(badges.length).toBeGreaterThan(0);
      });
    });

    it("shows connection status", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        const statusElements = screen.getAllByText("Connected");
        expect(statusElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe("empty state", () => {
    it("shows empty state when no vaults", async () => {
      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        const emptyHeading = screen.queryByText("No Vaults Configured");
        expect(emptyHeading).not.toBeNull();
      }, { timeout: 500 });
    });
  });

  describe("error state", () => {
    it("shows error when fetch fails", async () => {
      mockFetchResponse = {
        ok: false,
        status: 500,
        json: () => Promise.resolve([]),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Failed to Load Vaults")).toBeDefined();
      });
    });

    it("shows retry button on error", async () => {
      mockFetchResponse = {
        ok: false,
        status: 500,
        json: () => Promise.resolve([]),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Retry")).toBeDefined();
      });
    });
  });

  describe("vault selection", () => {
    it("sends select_vault message when vault is clicked", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      const vaultCard = screen.getByText("Personal Notes").closest("button");
      expect(vaultCard).toBeDefined();

      fireEvent.click(vaultCard!);

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });

    it("disables cards while selecting", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      const vaultCard = screen.getByText("Personal Notes").closest("button");
      fireEvent.click(vaultCard!);

      await waitFor(() => {
        const allCards = screen.getAllByRole("option");
        allCards.forEach((card) => {
          expect(card.hasAttribute("disabled")).toBe(true);
        });
      });
    });

    it("calls onReady when session_ready is received", async () => {
      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      // Click vault
      const vaultCard = screen.getByText("Personal Notes").closest("button");
      fireEvent.click(vaultCard!);

      // Simulate session_ready from server
      await waitFor(() => {
        const ws = wsInstances[0];
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "session-123",
          vaultId: "vault-1",
        });
      });

      await waitFor(() => {
        expect(onReady).toHaveBeenCalled();
      });
    });
  });
});
