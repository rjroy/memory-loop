/**
 * Tests for VaultSelect Component
 *
 * Tests rendering, loading states, vault list display, and user interactions.
 * VaultSelect uses REST API for vault listing, session initialization, and config.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VaultSelect } from "../VaultSelect";
import { SessionProvider, STORAGE_KEY_VAULT } from "../../../contexts/SessionContext";
import type { VaultInfo } from "@/lib/schemas";

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

// Session initialization response (configurable per test)
let sessionInitResponse: {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  slashCommands?: Array<{ name: string; description: string }>;
} = {
  sessionId: "new-session-123",
  messages: [],
};
let sessionInitError: string | null = null;

// Mock fetch for vault list, vault creation, and session initialization
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

    // POST /api/vaults/:vaultId/sessions - initialize session
    if (url.match(/\/api\/vaults\/[^/]+\/sessions$/) && method === "POST") {
      if (sessionInitError) {
        return Promise.resolve(new Response(
          JSON.stringify({ message: sessionInitError }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        ));
      }
      return Promise.resolve(new Response(JSON.stringify(sessionInitResponse), {
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
  createdVaults = [];
  createVaultError = null;
  sessionInitResponse = { sessionId: "new-session-123", messages: [] };
  sessionInitError = null;
  localStorage.clear();

  globalThis.fetch = createMockFetch();
});

afterEach(() => {
  cleanup();
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
      globalThis.fetch = (() => Promise.reject(new Error("Network error"))) as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Failed to Load Vaults")).toBeTruthy();
      });
    });

    it("shows retry button on error", async () => {
      globalThis.fetch = (() => Promise.reject(new Error("Network error"))) as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Retry")).toBeTruthy();
      });
    });
  });

  describe("vault selection", () => {
    it("shows loading state when vault card is clicked", async () => {
      // Make session init hang so we can observe loading state
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? "GET";

        if (url.match(/\/api\/vaults\/[^/]+\/sessions$/) && method === "POST") {
          return new Promise(() => {}); // Never resolves
        }
        return createMockFetch()(input, init);
      }) as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Card should show loading state
      await waitFor(() => {
        expect(card.classList.contains("vault-select__card--loading")).toBe(true);
      });
    });

    it("calls POST /api/vaults/:vaultId/sessions on click", async () => {
      const fetchSpy = mock<typeof fetch>((input, init) => createMockFetch()(input!, init));
      globalThis.fetch = fetchSpy;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      await waitFor(() => {
        const sessionCalls = fetchSpy.mock.calls.filter(([url, init]) => {
          const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url?.url;
          return urlStr?.includes("/api/vaults/vault-1/sessions") && init?.method === "POST";
        });
        expect(sessionCalls.length).toBe(1);
      });
    });

    it("disables other cards while selection is in progress", async () => {
      // Make session init hang so we stay in loading state
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? "GET";

        if (url.match(/\/api\/vaults\/[^/]+\/sessions$/) && method === "POST") {
          return new Promise(() => {}); // Never resolves
        }
        return createMockFetch()(input, init);
      }) as typeof fetch;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const personalCard = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(personalCard);

      // Work Vault card should be disabled
      await waitFor(() => {
        const workCard = screen.getByText("Work Vault").closest("[role='option']")!;
        expect(workCard.getAttribute("aria-disabled")).toBe("true");
      });
    });

    it("calls onReady after successful session initialization", async () => {
      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      await waitFor(() => {
        expect(onReady).toHaveBeenCalled();
      });
    });

    it("clears loading state after successful session initialization", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // After session init resolves, loading state should be cleared
      await waitFor(() => {
        expect(card.classList.contains("vault-select__card--loading")).toBe(false);
      });
    });
  });

  describe("keyboard navigation", () => {
    it("allows vault selection with Enter key", async () => {
      const fetchSpy = mock<typeof fetch>((input, init) => createMockFetch()(input!, init));
      globalThis.fetch = fetchSpy;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.keyDown(card, { key: "Enter" });

      await waitFor(() => {
        const sessionCalls = fetchSpy.mock.calls.filter(([url, init]) => {
          const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url?.url;
          return urlStr?.includes("/api/vaults/vault-1/sessions") && init?.method === "POST";
        });
        expect(sessionCalls.length).toBe(1);
      });
    });

    it("allows vault selection with Space key", async () => {
      const fetchSpy = mock<typeof fetch>((input, init) => createMockFetch()(input!, init));
      globalThis.fetch = fetchSpy;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.keyDown(card, { key: " " });

      await waitFor(() => {
        const sessionCalls = fetchSpy.mock.calls.filter(([url, init]) => {
          const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url?.url;
          return urlStr?.includes("/api/vaults/vault-1/sessions") && init?.method === "POST";
        });
        expect(sessionCalls.length).toBe(1);
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

      const addCard = screen.getByText("Add Vault").closest("[role='option']")!;
      fireEvent.click(addCard);

      // Dialog opens with input field for vault name
      await waitFor(() => {
        expect(screen.getByLabelText("Vault Name")).toBeTruthy();
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
      localStorage.setItem(STORAGE_KEY_VAULT, "nonexistent-vault");

      const fetchSpy = mock<typeof fetch>((input, init) => createMockFetch()(input!, init));
      globalThis.fetch = fetchSpy;

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      // Allow time for auto-resume to potentially trigger
      await new Promise((r) => setTimeout(r, 100));

      // Should NOT have sent any session init for nonexistent vault
      const sessionCalls = fetchSpy.mock.calls.filter(([url, init]) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url?.url;
        return urlStr?.includes("/api/vaults/nonexistent-vault/sessions") && init?.method === "POST";
      });
      expect(sessionCalls.length).toBe(0);
    });

    it("auto-resumes when persisted vault ID matches a loaded vault", async () => {
      localStorage.setItem(STORAGE_KEY_VAULT, "vault-1");

      const onReady = mock(() => {});

      render(<VaultSelect onReady={onReady} />, { wrapper: Wrapper });

      // Should auto-initialize session for vault-1 and call onReady
      await waitFor(() => {
        expect(onReady).toHaveBeenCalled();
      });
    });
  });

  describe("error handling during selection", () => {
    it("shows error when session initialization fails", async () => {
      sessionInitError = "Something went wrong";
      globalThis.fetch = createMockFetch();

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Error should be displayed
      await waitFor(() => {
        expect(screen.getByText("Something went wrong")).toBeTruthy();
      });
    });

    it("clears loading state after session initialization error", async () => {
      sessionInitError = "Server error";
      globalThis.fetch = createMockFetch();

      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Personal Vault")).toBeTruthy();
      });

      const card = screen.getByText("Personal Vault").closest("[role='option']")!;
      fireEvent.click(card);

      // Loading state should be cleared after error
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

  describe("add vault dialog interactions", () => {
    it("cancels add vault dialog", async () => {
      render(<VaultSelect />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Add Vault")).toBeTruthy();
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
