/**
 * Tests for BrowseMode Component
 *
 * Tests rendering, layout, view mode toggle, tree collapse, and mobile overlay.
 * Uses mock WebSocket and fetch for API responses.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { VaultInfo, ServerMessage, ClientMessage, FileEntry } from "@memory-loop/shared";

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
const originalMatchMedia = globalThis.matchMedia;

const testVault: VaultInfo = {
  id: "vault-1",
  name: "Test Vault",
  path: "/test/vault",
  hasClaudeMd: true,
  contentRoot: "/test/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: true,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
};

const mockDirectoryEntries: FileEntry[] = [
  { name: "folder1", type: "directory", path: "folder1" },
  { name: "folder2", type: "directory", path: "folder2" },
  { name: "README.md", type: "file", path: "README.md" },
  { name: "notes.md", type: "file", path: "notes.md" },
];

// Mock matchMedia for mobile detection
function createMatchMediaMock(matches: boolean) {
  return (query: string): MediaQueryList => ({
    matches: query === "(hover: none)" ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
}

// Mock fetch for REST API calls
function createMockFetch(): typeof fetch {
  const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // List directory
    if (url.includes("/browse")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: "",
            entries: mockDirectoryEntries,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Read file
    if (url.includes("/file/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: "# Test File\n\nThis is test content.",
            truncated: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Tasks
    if (url.includes("/tasks")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tasks: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Pinned assets
    if (url.includes("/config/pinned-assets")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  // Cast to fetch type to satisfy TypeScript
  return mockFetch as typeof fetch;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SessionProvider initialVaults={[testVault]}>{children}</SessionProvider>
  );
}

// Wrapper that pre-selects the vault
function WrapperWithVault({ children }: { children: ReactNode }) {
  return (
    <SessionProvider initialVaults={[testVault]}>
      <VaultSelector>{children}</VaultSelector>
    </SessionProvider>
  );
}

// Helper component that selects the vault
function VaultSelector({ children }: { children: ReactNode }) {
  const { selectVault } = useSession();

  React.useEffect(() => {
    selectVault(testVault);
  }, [selectVault]);

  return <>{children}</>;
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();

  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
  globalThis.fetch = createMockFetch();
  // Default to desktop
  globalThis.matchMedia = createMatchMediaMock(false);
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  globalThis.matchMedia = originalMatchMedia;
  localStorage.clear();
});

describe("BrowseMode", () => {
  describe("rendering", () => {
    it("renders tree pane and viewer pane", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      // Tree pane header should be visible
      await waitFor(() => {
        expect(screen.getByText("Files")).toBeTruthy();
      });
    });

    it("shows 'No file selected' when no file is selected", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByText("No file selected")).toBeTruthy();
      });
    });

    it("renders collapse button for tree", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Collapse file tree")).toBeTruthy();
      });
    });

    it("renders reload button", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Reload file tree")).toBeTruthy();
      });
    });

    it("renders search button", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Search files")).toBeTruthy();
      });
    });
  });

  describe("view mode toggle", () => {
    it("shows Files view mode by default", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByText("Files")).toBeTruthy();
      });
    });

    it("toggles to Tasks view when clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByText("Files")).toBeTruthy();
      });

      const toggleButton = screen.getByText("Files");
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByText("Tasks")).toBeTruthy();
      });
    });

    it("toggles back to Files from Tasks", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByText("Files")).toBeTruthy();
      });

      // Toggle to Tasks
      const filesButton = screen.getByText("Files");
      fireEvent.click(filesButton);

      await waitFor(() => {
        expect(screen.getByText("Tasks")).toBeTruthy();
      });

      // Toggle back to Files
      const tasksButton = screen.getByText("Tasks");
      fireEvent.click(tasksButton);

      await waitFor(() => {
        expect(screen.getByText("Files")).toBeTruthy();
      });
    });

    it("has proper aria-label for view mode toggle", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText(/switch to tasks view/i)).toBeTruthy();
      });
    });
  });

  describe("tree collapse", () => {
    it("collapses tree when collapse button is clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Collapse file tree")).toBeTruthy();
      });

      const collapseButton = screen.getByLabelText("Collapse file tree");
      fireEvent.click(collapseButton);

      // Button label should change to Expand
      await waitFor(() => {
        expect(screen.getByLabelText("Expand file tree")).toBeTruthy();
      });
    });

    it("expands tree when expand button is clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Collapse file tree")).toBeTruthy();
      });

      // Collapse first
      const collapseButton = screen.getByLabelText("Collapse file tree");
      fireEvent.click(collapseButton);

      await waitFor(() => {
        expect(screen.getByLabelText("Expand file tree")).toBeTruthy();
      });

      // Expand
      const expandButton = screen.getByLabelText("Expand file tree");
      fireEvent.click(expandButton);

      await waitFor(() => {
        expect(screen.getByLabelText("Collapse file tree")).toBeTruthy();
      });
    });

    it("has proper aria-expanded attribute", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        const button = screen.getByLabelText("Collapse file tree");
        expect(button.getAttribute("aria-expanded")).toBe("true");
      });

      // Collapse
      const collapseButton = screen.getByLabelText("Collapse file tree");
      fireEvent.click(collapseButton);

      await waitFor(() => {
        const button = screen.getByLabelText("Expand file tree");
        expect(button.getAttribute("aria-expanded")).toBe("false");
      });
    });

    it("hides search and reload buttons when collapsed", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Search files")).toBeTruthy();
        expect(screen.getByLabelText("Reload file tree")).toBeTruthy();
      });

      // Collapse
      const collapseButton = screen.getByLabelText("Collapse file tree");
      fireEvent.click(collapseButton);

      // Search and reload buttons should be hidden
      await waitFor(() => {
        expect(screen.queryByLabelText("Search files")).toBeNull();
        expect(screen.queryByLabelText("Reload file tree")).toBeNull();
      });
    });
  });

  describe("search activation", () => {
    it("activates search mode when search button is clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Search files")).toBeTruthy();
      });

      const searchButton = screen.getByLabelText("Search files");
      fireEvent.click(searchButton);

      // Search input should appear
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
      });
    });
  });

  describe("mobile tree overlay", () => {
    it("shows mobile menu button in viewer header when no file selected", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Open file browser")).toBeTruthy();
      });
    });

    it("opens mobile tree overlay when menu button is clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Open file browser")).toBeTruthy();
      });

      const menuButton = screen.getByLabelText("Open file browser");
      fireEvent.click(menuButton);

      // Close button should appear in mobile overlay
      await waitFor(() => {
        expect(screen.getByLabelText("Close file browser")).toBeTruthy();
      });
    });

    it("closes mobile tree overlay when close button is clicked", async () => {
      render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Open file browser")).toBeTruthy();
      });

      // Open overlay
      const menuButton = screen.getByLabelText("Open file browser");
      fireEvent.click(menuButton);

      await waitFor(() => {
        expect(screen.getByLabelText("Close file browser")).toBeTruthy();
      });

      // Close overlay
      const closeButton = screen.getByLabelText("Close file browser");
      fireEvent.click(closeButton);

      // Close button should be gone
      await waitFor(() => {
        expect(screen.queryByLabelText("Close file browser")).toBeNull();
      });
    });
  });

  describe("without vault", () => {
    it("renders without crash when no vault is selected", () => {
      render(<BrowseMode />, { wrapper: Wrapper });

      // Should render the basic structure
      expect(screen.getByText("Files")).toBeTruthy();
    });
  });

  describe("CSS classes", () => {
    it("has browse-mode root class", async () => {
      const { container } = render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(container.querySelector(".browse-mode")).toBeTruthy();
      });
    });

    it("adds collapsed class when tree is collapsed", async () => {
      const { container } = render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(screen.getByLabelText("Collapse file tree")).toBeTruthy();
      });

      // Collapse
      const collapseButton = screen.getByLabelText("Collapse file tree");
      fireEvent.click(collapseButton);

      await waitFor(() => {
        expect(
          container.querySelector(".browse-mode--tree-collapsed")
        ).toBeTruthy();
      });
    });
  });

  describe("article landmark", () => {
    it("has article element for viewer content", async () => {
      const { container } = render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(container.querySelector("article")).toBeTruthy();
      });
    });
  });

  describe("aside landmark", () => {
    it("has aside element for tree pane", async () => {
      const { container } = render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(container.querySelector("aside")).toBeTruthy();
      });
    });
  });

  describe("main landmark", () => {
    it("has main element for viewer pane", async () => {
      const { container } = render(<BrowseMode />, { wrapper: WrapperWithVault });

      await waitFor(() => {
        expect(container.querySelector("main")).toBeTruthy();
      });
    });
  });
});
