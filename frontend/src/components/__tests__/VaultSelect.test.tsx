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
let mockFetchResponse: { ok: boolean; status: number; json: () => Promise<{ vaults: VaultInfo[] }> };
const originalFetch = globalThis.fetch;

// Test data
const testVaults: VaultInfo[] = [
  {
    id: "vault-1",
    name: "Personal Notes",
    path: "/home/user/notes",
    hasClaudeMd: true,
    contentRoot: "/home/user/notes",
    inboxPath: "inbox",
    metadataPath: "06_Metadata/memory-loop",
    setupComplete: true,
  },
  {
    id: "vault-2",
    name: "Work",
    path: "/home/user/work",
    hasClaudeMd: false,
    contentRoot: "/home/user/work",
    inboxPath: "inbox",
    metadataPath: "06_Metadata/memory-loop",
    setupComplete: false,
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

  // Default mock fetch response - must match { vaults: VaultInfo[] } shape
  mockFetchResponse = {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ vaults: testVaults }),
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
        json: () => Promise.resolve({ vaults: [] }),
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
        json: () => Promise.resolve({ vaults: [] }),
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
        json: () => Promise.resolve({ vaults: [] }),
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

      // Vault cards are now divs with role="option"
      const vaultCard = screen.getByText("Personal Notes").closest("[role='option']");
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

      // Vault cards are now divs with role="option"
      const vaultCard = screen.getByText("Personal Notes").closest("[role='option']");
      fireEvent.click(vaultCard!);

      await waitFor(() => {
        const allCards = screen.getAllByRole("option");
        allCards.forEach((card) => {
          // Divs use aria-disabled instead of disabled attribute
          expect(card.getAttribute("aria-disabled")).toBe("true");
        });
      });
    });

    it("calls onReady when session_ready is received", async () => {
      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      // Click vault (cards are now divs with role="option")
      const vaultCard = screen.getByText("Personal Notes").closest("[role='option']");
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

    it("auto-resumes session from localStorage on page refresh", async () => {
      // Set persisted vault ID before rendering
      localStorage.setItem("memory-loop:vaultId", "vault-1");

      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: TestWrapper });

      // Wait for vaults to load and auto-resume to trigger
      await waitFor(() => {
        // Should have sent select_vault for auto-resume
        const selectMessages = sentMessages.filter(
          (m) => m.type === "select_vault" && m.vaultId === "vault-1"
        );
        expect(selectMessages.length).toBeGreaterThan(0);
      });

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

    it("does not auto-resume if no vault in localStorage", async () => {
      // Ensure localStorage is empty
      localStorage.clear();

      render(<VaultSelect />, { wrapper: TestWrapper });

      // Wait for vaults to load
      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      // Give time for auto-resume effect to run (if it would)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have sent any messages automatically
      expect(sentMessages.length).toBe(0);
    });

    it("does not auto-resume if localStorage vault ID is not in vault list", async () => {
      // Set a vault ID that doesn't exist in testVaults
      localStorage.setItem("memory-loop:vaultId", "nonexistent-vault");

      render(<VaultSelect />, { wrapper: TestWrapper });

      // Wait for vaults to load
      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      // Give time for auto-resume effect to run (if it would)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have sent any messages automatically
      expect(sentMessages.length).toBe(0);
    });

    it("sends resume_session when existing session found during auto-resume", async () => {
      localStorage.setItem("memory-loop:vaultId", "vault-1");

      // Mock both vaults API and sessions API
      // @ts-expect-error - mocking fetch with URL handling
      globalThis.fetch = (url: string) => {
        if (url === "/api/vaults") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ vaults: testVaults }),
          });
        }
        if (url === "/api/sessions/vault-1") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessionId: "existing-session-123" }),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      };

      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: TestWrapper });

      // Wait for auto-resume to send resume_session
      await waitFor(() => {
        const resumeMessages = sentMessages.filter(
          (m) => m.type === "resume_session"
        );
        expect(resumeMessages.length).toBe(1);
        expect(resumeMessages[0]).toEqual({
          type: "resume_session",
          sessionId: "existing-session-123",
        });
      });
    });
  });

  describe("setup button", () => {
    it("shows Setup button for vaults with CLAUDE.md but not setupComplete", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        // vault-2 has hasClaudeMd: false, so no setup button
        // vault-1 has hasClaudeMd: true and setupComplete: true
        const setupButton = screen.getByText("Reconfigure");
        expect(setupButton).toBeDefined();
      });
    });

    it("shows Reconfigure button for vaults that are already setup", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        // vault-1 has setupComplete: true
        const reconfigureButton = screen.getByText("Reconfigure");
        expect(reconfigureButton).toBeDefined();
        expect(reconfigureButton.closest("button")).toBeDefined();
      });
    });

    it("shows Setup button for vaults not yet setup", async () => {
      // Create a vault that has CLAUDE.md but not setupComplete
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        const setupButton = screen.getByText("Setup");
        expect(setupButton).toBeDefined();
      });
    });

    it("clicking setup button does not select the vault", async () => {
      // Create a vault with setup needed
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Click the setup button
      const setupButton = screen.getByText("Setup");
      fireEvent.click(setupButton);

      // Should send setup_vault, not select_vault
      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "setup_vault",
          vaultId: "vault-unconfigured",
        });
      });

      // Should NOT have sent select_vault
      const selectMessages = sentMessages.filter((m) => m.type === "select_vault");
      expect(selectMessages.length).toBe(0);
    });

    it("shows loading state on setup button during setup", async () => {
      // Create a vault with setup needed
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Click the setup button
      const setupButton = screen.getByText("Setup");
      fireEvent.click(setupButton);

      // Button should have loading class
      await waitFor(() => {
        expect(setupButton.className).toContain("vault-select__setup-btn--loading");
      });
    });

    it("updates vault to setupComplete after successful setup", async () => {
      // Create a vault with setup needed
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Click the setup button
      fireEvent.click(screen.getByText("Setup"));

      // Simulate setup_complete success from server
      await waitFor(() => {
        const ws = wsInstances[0];
        ws.simulateMessage({
          type: "setup_complete",
          vaultId: "vault-unconfigured",
          success: true,
          summary: ["Installed 6 commands", "Created 4 directories"],
        });
      });

      // Button should now say "Reconfigure"
      await waitFor(() => {
        expect(screen.getByText("Reconfigure")).toBeDefined();
      });
    });

    it("shows toast notification on successful setup", async () => {
      // Create a vault with setup needed
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Click the setup button
      fireEvent.click(screen.getByText("Setup"));

      // Simulate setup_complete success from server
      await waitFor(() => {
        const ws = wsInstances[0];
        ws.simulateMessage({
          type: "setup_complete",
          vaultId: "vault-unconfigured",
          success: true,
          summary: ["Installed 6 commands", "Created 4 directories"],
        });
      });

      // Toast should appear with success message
      await waitFor(() => {
        const toast = document.querySelector("[role='alert']");
        expect(toast).toBeDefined();
        expect(toast?.textContent).toContain("Installed 6 commands");
      });
    });

    it("shows error toast on failed setup", async () => {
      // Create a vault with setup needed
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Click the setup button
      fireEvent.click(screen.getByText("Setup"));

      // Simulate setup_complete failure from server
      await waitFor(() => {
        const ws = wsInstances[0];
        ws.simulateMessage({
          type: "setup_complete",
          vaultId: "vault-unconfigured",
          success: false,
          summary: [],
          errors: ["Failed to install commands", "Permission denied"],
        });
      });

      // Toast should appear with error message
      await waitFor(() => {
        const toast = document.querySelector("[role='alert']");
        expect(toast).toBeDefined();
        expect(toast?.textContent).toContain("Failed to install commands");
      });
    });

    it("disables setup button during any vault operation", async () => {
      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Notes")).toBeDefined();
      });

      // Click a vault card to start selection
      const vaultCard = screen.getByText("Personal Notes").closest("[role='option']");
      fireEvent.click(vaultCard!);

      // Setup button should be disabled
      await waitFor(() => {
        const setupButton = screen.getByText("Reconfigure");
        expect((setupButton as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it("handles setup_complete even when server responds before state update (race condition fix)", async () => {
      // This tests the fix for issue #169: vault card doesn't update if server is too fast
      // The setup_complete handler should use vaultId from message, not depend on setupVaultId state
      const vaultsWithUnconfigured: VaultInfo[] = [
        {
          id: "vault-unconfigured",
          name: "Unconfigured Vault",
          path: "/home/user/unconfigured",
          hasClaudeMd: true,
          contentRoot: "/home/user/unconfigured",
          inboxPath: "inbox",
          metadataPath: "06_Metadata/memory-loop",
          setupComplete: false,
        },
      ];

      mockFetchResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ vaults: vaultsWithUnconfigured }),
      };

      render(<VaultSelect />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText("Setup")).toBeDefined();
      });

      // Get the WebSocket instance
      const ws = wsInstances[0];

      // Simulate the race condition: server sends setup_complete immediately
      // (before the setupVaultId state update from handleSetupClick completes)
      // We do this by sending the message without clicking the button first
      ws.simulateMessage({
        type: "setup_complete",
        vaultId: "vault-unconfigured",
        success: true,
        summary: ["Fast setup complete"],
      });

      // The vault card should still update to show "Reconfigure"
      await waitFor(() => {
        expect(screen.getByText("Reconfigure")).toBeDefined();
      });

      // Toast should still appear
      await waitFor(() => {
        const toast = document.querySelector("[role='alert']");
        expect(toast).toBeDefined();
        expect(toast?.textContent).toContain("Fast setup complete");
      });
    });
  });
});
