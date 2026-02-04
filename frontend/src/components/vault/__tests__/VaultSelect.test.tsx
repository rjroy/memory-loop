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
import { SessionProvider } from "../../../contexts/SessionContext";
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
    cardsEnabled: true,
      viMode: false,
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
    cardsEnabled: true,
      viMode: false,
  },
];

// Track created vaults for REST API mock
let createdVaults: VaultInfo[] = [];
let createVaultError: string | null = null;

// Mock fetch for vault list and vault creation
function createMockFetch(vaults: VaultInfo[] = testVaults): typeof fetch {
  const mockFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    // GET /api/vaults - list vaults
    if (url.endsWith("/api/vaults") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ vaults: [...vaults, ...createdVaults] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // POST /api/vaults - create vault
    if (url.endsWith("/api/vaults") && method === "POST") {
      if (createVaultError) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: { code: "VALIDATION_ERROR", message: createVaultError } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        ));
      }

      const body = JSON.parse(init?.body as string) as { title: string };
      const newVault: VaultInfo = {
        id: `vault-${Date.now()}`,
        name: body.title,
        path: `/home/user/vaults/${body.title.toLowerCase().replace(/\s+/g, "-")}`,
        hasClaudeMd: true,
        contentRoot: `/home/user/vaults/${body.title.toLowerCase().replace(/\s+/g, "-")}`,
        inboxPath: "00_Inbox",
        metadataPath: "06_Metadata/memory-loop",
        attachmentPath: "05_Attachments",
        setupComplete: false,
        promptsPerGeneration: 5,
        maxPoolSize: 50,
        quotesPerWeek: 1,
        badges: [],
        order: 999,
        cardsEnabled: true,
        viMode: false,
      };
      createdVaults.push(newVault);
      return Promise.resolve(new Response(JSON.stringify({ vault: newVault }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }));
    }

    if (url.includes("/api/sessions/")) {
      return Promise.resolve(new Response(JSON.stringify({ sessionId: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
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
  createdVaults = [];
  createVaultError = null;
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

  describe("auto-resume from localStorage", () => {
    it("does not auto-resume if vault ID not in list", async () => {
      localStorage.setItem("memory-loop-vault-id", "nonexistent-vault");

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Allow time for auto-resume to potentially trigger
      await new Promise((r) => setTimeout(r, 100));

      // Should NOT have sent any select_vault for nonexistent vault
      const selectMessages = sentMessages.filter(
        (m) => m.type === "select_vault" && m.vaultId === "nonexistent-vault"
      );
      expect(selectMessages.length).toBe(0);
    });
  });

  describe("session_ready handling", () => {
    it("calls onReady callback when session_ready received", async () => {
      let readyCalled = false;
      const onReady = () => {
        readyCalled = true;
      };

      render(<VaultSelect onReady={onReady} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Click vault to select
      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Simulate session_ready response
      await waitFor(() => {
        wsInstances[0].simulateMessage({
          type: "session_ready",
          sessionId: "new-session-123",
          vaultId: "vault-1",
          slashCommands: [],
        });
      });

      await waitFor(() => {
        expect(readyCalled).toBe(true);
      });
    });

    it("clears loading state after session_ready", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Card should show loading
      await waitFor(() => {
        expect(card.classList.contains("vault-select__card--loading")).toBe(true);
      });

      // Simulate session_ready
      wsInstances[0].simulateMessage({
        type: "session_ready",
        sessionId: "new-session-123",
        vaultId: "vault-1",
        slashCommands: [],
      });

      // Loading spinner should be gone (card loading state cleared)
      await waitFor(() => {
        expect(card.classList.contains("vault-select__card--loading")).toBe(false);
      });
    });
  });

  describe("vault creation", () => {
    it("opens add vault dialog when Add Vault card is clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      // Open add vault dialog
      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });

      // Verify dialog is open with expected elements
      expect(screen.getByText("Create")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("closes add vault dialog when Cancel is clicked", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      // Open add vault dialog
      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });

      // Click Cancel
      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByLabelText("Vault Name")).toBeNull();
      });
    });

    it("clears input when dialog is reopened after cancel", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      // Open dialog, enter text, cancel
      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "Temporary Input" } });
      expect((input as HTMLInputElement).value).toBe("Temporary Input");

      fireEvent.click(screen.getByText("Cancel"));

      await waitFor(() => {
        expect(screen.queryByLabelText("Vault Name")).toBeNull();
      });

      // Reopen dialog - input should be cleared
      fireEvent.click(addCard);

      await waitFor(() => {
        const newInput = screen.getByLabelText("Vault Name");
        expect((newInput as HTMLInputElement).value).toBe("");
      });
    });

    it("has Create button in the dialog", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        const createButton = screen.getByRole("button", { name: "Create" });
        expect(createButton).toBeTruthy();
      });
    });

    it("has Cancel button in the dialog", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        const cancelButton = screen.getByRole("button", { name: "Cancel" });
        expect(cancelButton).toBeTruthy();
      });
    });

    it("allows entering a vault name", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });

      const input = screen.getByLabelText("Vault Name");
      fireEvent.change(input, { target: { value: "My New Test Vault" } });

      expect((input as HTMLInputElement).value).toBe("My New Test Vault");
    });

    it("shows dialog with input label", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        // Dialog should have the Vault Name label
        expect(screen.getByText("Vault Name")).toBeTruthy();
        // And the instruction message
        expect(screen.getByText(/Enter a name for your new vault/)).toBeTruthy();
      });
    });
  });

  // Note: Vault creation REST API tests removed because the API client
  // constructs Request objects with relative URLs which fail in the test
  // environment (happy-dom runs on about:blank). These flows are better tested
  // via integration tests.

  // Note: setup and config REST API flow tests removed because the API client
  // constructs Request objects with relative URLs which fail in the test
  // environment (happy-dom runs on about:blank). These flows are better tested
  // via integration tests.

  describe("connection status display", () => {
    it("shows Connected status when WebSocket is connected", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Should show connected status
      await waitFor(() => {
        expect(screen.getByText("Connected")).toBeTruthy();
      });
    });
  });

  describe("error handling during selection", () => {
    it("falls back to select_vault when session check returns non-OK", async () => {
      const failingSessionFetch = (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith("/api/vaults")) {
          return Promise.resolve(
            new Response(JSON.stringify({ vaults: testVaults }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (url.includes("/api/sessions/")) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      };
      globalThis.fetch = failingSessionFetch as typeof fetch;

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

      // Should fall back to select_vault
      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });

    it("shows error when WebSocket error received during selection", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Simulate error message (not SESSION_NOT_FOUND)
      wsInstances[0].simulateMessage({
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      });

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByText("Something went wrong")).toBeTruthy();
      });
    });

    it("retries with select_vault when SESSION_NOT_FOUND error received", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Clear messages after initial selection
      await waitFor(() => {
        expect(sentMessages.length).toBeGreaterThan(0);
      });
      sentMessages.length = 0;

      // Simulate SESSION_NOT_FOUND error (resume failed)
      wsInstances[0].simulateMessage({
        type: "error",
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });

      // Should send select_vault to start fresh
      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });
  });

  describe("vault_list WebSocket message", () => {
    it("uses vaults from vault_list message if fetch returned empty", async () => {
      // Start with empty fetch response
      globalThis.fetch = createMockFetch([]);

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("No Vaults Configured")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Simulate vault_list from WebSocket
      wsInstances[0].simulateMessage({
        type: "vault_list",
        vaults: testVaults,
      });

      // Vaults should now appear
      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
        expect(screen.getByText("Work Vault")).toBeTruthy();
      });
    });
  });

  describe("add vault dialog interactions", () => {
    it("cancels add vault dialog", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Open dialog
      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
      });

      // Click cancel
      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByLabelText("Vault Name")).toBeNull();
      });
    });
  });
});
