/**
 * Tests for VaultSelect Component
 *
 * Tests rendering, loading states, vault list display, and user interactions.
 * Uses mock WebSocket and fetch for API responses.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
const originalFetch = globalThis.fetch;

const testVaults: VaultInfo[] = [
  {
    id: "vault-1",
    name: "Personal Vault",
    path: "/home/user/vaults/personal",
    subtitle: "My personal notes",
    hasClaudeMd: true,
    contentRoot: "/home/user/vaults/personal",
    inboxPath: "inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: true,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [{ text: "Primary", color: "blue" }],
    order: 1,
  },
  {
    id: "vault-2",
    name: "Work Vault",
    path: "/home/user/vaults/work",
    subtitle: "Work notes",
    hasClaudeMd: false,
    contentRoot: "/home/user/vaults/work",
    inboxPath: "inbox",
    metadataPath: "06_Metadata/memory-loop",
    attachmentPath: "05_Attachments",
    setupComplete: false,
    promptsPerGeneration: 5,
    maxPoolSize: 50,
    quotesPerWeek: 1,
    badges: [],
    order: 2,
  },
];

// Mock fetch for vault list
function createMockFetch(vaults: VaultInfo[] = testVaults): typeof fetch {
  const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/api/vaults")) {
      return Promise.resolve(
        new Response(JSON.stringify({ vaults }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    if (url.includes("/api/sessions/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ sessionId: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  return mockFetch as typeof fetch;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();

  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
  globalThis.fetch = createMockFetch();
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

describe("VaultSelect", () => {
  describe("loading state", () => {
    it("shows loading spinner initially", () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      expect(screen.getByText("Loading vaults...")).toBeTruthy();
    });

    it("shows loading spinner with proper aria label", () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      expect(screen.getByLabelText("Loading vaults")).toBeTruthy();
    });
  });

  describe("vault list display", () => {
    it("renders vault cards after loading", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
        expect(screen.getByText("Work Vault")).toBeTruthy();
      });
    });

    it("displays vault subtitles", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("My personal notes")).toBeTruthy();
        expect(screen.getByText("Work notes")).toBeTruthy();
      });
    });

    it("displays vault paths", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("/home/user/vaults/personal")).toBeTruthy();
        expect(screen.getByText("/home/user/vaults/work")).toBeTruthy();
      });
    });

    it("displays badges for vaults", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Primary")).toBeTruthy();
      });
    });

    it("shows Memory Loop badge for setup-complete vaults", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Memory Loop")).toBeTruthy();
      });
    });

    it("shows CLAUDE.md badge for vaults with CLAUDE.md", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("CLAUDE.md")).toBeTruthy();
      });
    });

    it("sorts vaults by order", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        const vaultNames = screen.getAllByRole("heading", { level: 2 });
        const names = vaultNames.map((h) => h.textContent);
        // Personal (order 1) should come before Work (order 2)
        const personalIndex = names.indexOf("Personal Vault");
        const workIndex = names.indexOf("Work Vault");
        expect(personalIndex).toBeLessThan(workIndex);
      });
    });
  });

  describe("header", () => {
    it("shows Select a Vault title", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Select a Vault" })).toBeTruthy();
      });
    });

    it("shows connection status", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Should show Connected status after WebSocket connects
      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeTruthy();
      });
    });

    it("shows settings button", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByLabelText("Memory settings")).toBeTruthy();
      });
    });
  });

  describe("empty state", () => {
    it("shows instructions when no vaults are configured", async () => {
      globalThis.fetch = createMockFetch([]);

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("No Vaults Configured")).toBeTruthy();
      });
    });

    it("shows setup instructions in empty state", async () => {
      globalThis.fetch = createMockFetch([]);

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup Instructions")).toBeTruthy();
        expect(screen.getByText("VAULTS_DIR")).toBeTruthy();
      });
    });
  });

  describe("error state", () => {
    it("shows error message when fetch fails", async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const errorFetch = (input: RequestInfo | URL): Promise<Response> => {
        return Promise.reject(new Error("Network error"));
      };
      globalThis.fetch = errorFetch as unknown as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Failed to Load Vaults")).toBeTruthy();
      });
    });

    it("shows retry button on error", async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const errorFetch = (input: RequestInfo | URL): Promise<Response> => {
        return Promise.reject(new Error("Network error"));
      };
      globalThis.fetch = errorFetch as unknown as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Retry")).toBeTruthy();
      });
    });
  });

  describe("vault selection", () => {
    it("shows loading state when vault card is clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      // Wait for WebSocket connection
      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Card should show loading state
      await waitFor(() => {
        expect(card.classList.contains("vault-select__card--loading")).toBe(true);
      });
    });

    it("sends select_vault message on click when no existing session", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Clear any initial messages
      sentMessages.length = 0;

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });

    it("disables other cards while selection is in progress", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const personalCard = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(personalCard);

      // Work Vault card should be disabled
      await waitFor(() => {
        const workCard = screen.getByText("Work Vault").closest("[role='option']")!;
        expect(workCard.getAttribute("aria-disabled")).toBe("true");
      });
    });
  });

  describe("keyboard navigation", () => {
    it("allows vault selection with Enter key", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      sentMessages.length = 0;

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.keyDown(card, { key: "Enter" });

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });

    it("allows vault selection with Space key", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      sentMessages.length = 0;

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.keyDown(card, { key: " " });

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });
  });

  describe("accessibility", () => {
    it("has listbox role for vault list", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByRole("listbox", { name: /available vaults/i })).toBeTruthy();
      });
    });

    it("has option role for vault cards", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        const options = screen.getAllByRole("option");
        // Should have 3 options: 2 vaults + 1 Add Vault
        expect(options.length).toBe(3);
      });
    });

    it("cards have tabindex for keyboard navigation", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        const card = screen.getByText("Personal Vault").closest("[role='option']")!;
        expect(card.getAttribute("tabindex")).toBe("0");
      });
    });
  });

  describe("setup button", () => {
    it("shows Setup button for vaults without setup", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        // Personal Vault (has CLAUDE.md and setup complete) shows Reconfigure
        // Work Vault (no CLAUDE.md) doesn't show setup button
        const setupButtons = screen.getAllByRole("button").filter(
          (b) => b.textContent === "Setup" || b.textContent === "Reconfigure"
        );
        expect(setupButtons.length).toBeGreaterThan(0);
      });
    });

    it("shows Reconfigure button for vaults with setup complete", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Reconfigure")).toBeTruthy();
      });
    });
  });

  describe("gear button (config)", () => {
    it("shows gear button on vault cards", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        const gearButtons = screen.getAllByLabelText(/configure.*settings/i);
        expect(gearButtons.length).toBeGreaterThan(0);
      });
    });

    it("opens config dialog when gear button is clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const gearButton = screen.getByLabelText("Configure Personal Vault settings");
      fireEvent.click(gearButton);

      // ConfigEditorDialog should open
      await waitFor(() => {
        expect(screen.getByText("Vault Settings")).toBeTruthy();
      });
    });
  });

  describe("add vault card", () => {
    it("shows Add Vault card", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
        expect(screen.getByText("Create a new vault directory")).toBeTruthy();
      });
    });

    it("opens add vault dialog when clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      // Dialog opens with input field for vault name
      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });
    });
  });

  describe("session resume", () => {
    it("sends resume_session when existing session found", async () => {
      const sessionFetch = (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith("/api/vaults")) {
          return Promise.resolve(
            new Response(JSON.stringify({ vaults: testVaults }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (url.includes("/api/sessions/vault-1")) {
          return Promise.resolve(
            new Response(JSON.stringify({ sessionId: "existing-session-123" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify({ sessionId: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      };
      globalThis.fetch = sessionFetch as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      sentMessages.length = 0;

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "resume_session",
          sessionId: "existing-session-123",
        });
      });
    });
  });

  describe("settings dialog", () => {
    it("opens settings dialog when header settings button is clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const settingsButton = screen.getByLabelText("Memory settings");
      fireEvent.click(settingsButton);

      await waitFor(() => {
        // SettingsDialog should be visible
        expect(screen.getByRole("dialog")).toBeTruthy();
      });
    });
  });
});
