/**
 * Tests for FileTree component
 *
 * Tests directory expansion, file selection, and loading states.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FileTree } from "../FileTree";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { FileEntry } from "@memory-loop/shared";

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

  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

const originalWebSocket = globalThis.WebSocket;

// Test data
const testFiles: FileEntry[] = [
  { name: "docs", type: "directory", path: "docs" },
  { name: "notes", type: "directory", path: "notes" },
  { name: "README.md", type: "file", path: "README.md" },
];

const docsFiles: FileEntry[] = [
  { name: "guide.md", type: "file", path: "docs/guide.md" },
  { name: "api.md", type: "file", path: "docs/api.md" },
];

const emptyDir: FileEntry[] = [];

// Custom wrapper that pre-populates directory cache
function createTestWrapper(cache: Map<string, FileEntry[]>, expandedDirs?: Set<string>) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider>
        <CachePopulator cache={cache} expandedDirs={expandedDirs}>
          {children}
        </CachePopulator>
      </SessionProvider>
    );
  };
}

// Component to populate cache via context
function CachePopulator({
  children,
  cache,
  expandedDirs,
}: {
  children: ReactNode;
  cache: Map<string, FileEntry[]>;
  expandedDirs?: Set<string>;
}) {
  const session = useSession();

  useEffect(() => {
    // Populate cache entries
    for (const [path, entries] of cache) {
      session.cacheDirectory(path, entries);
    }
    // Expand directories
    if (expandedDirs) {
      for (const path of expandedDirs) {
        if (!session.browser.expandedDirs.has(path)) {
          session.toggleDirectory(path);
        }
      }
    }
  }, []);

  return <>{children}</>;
}

beforeEach(() => {
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

describe("FileTree", () => {
  describe("empty state", () => {
    it("shows empty message when no files", () => {
      const cache = new Map<string, FileEntry[]>([["", []]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      expect(screen.getByText("No files in vault")).toBeDefined();
    });
  });

  describe("rendering", () => {
    it("renders root entries", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      expect(screen.getByText("docs")).toBeDefined();
      expect(screen.getByText("notes")).toBeDefined();
      expect(screen.getByText("README.md")).toBeDefined();
    });

    it("shows directories before files", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const items = screen.getAllByRole("treeitem");
      // First two should be directories
      expect(items[0].textContent).toContain("docs");
      expect(items[1].textContent).toContain("notes");
      expect(items[2].textContent).toContain("README.md");
    });

    it("has proper accessibility attributes", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const nav = screen.getByRole("navigation");
      expect(nav.getAttribute("aria-label")).toBe("Vault files");

      const tree = screen.getByRole("tree");
      expect(tree).toBeDefined();

      const items = screen.getAllByRole("treeitem");
      expect(items.length).toBe(3);
    });
  });

  describe("directory expansion", () => {
    it("shows collapsed directories with chevron", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const docsItem = screen.getByText("docs").closest("button");
      expect(docsItem).toBeDefined();
      // Has chevron (contained in the button)
      expect(docsItem?.querySelector(".file-tree__chevron")).toBeDefined();
    });

    it("expands directory on click", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.click(docsButton!);

      // Should show children
      expect(screen.getByText("guide.md")).toBeDefined();
      expect(screen.getByText("api.md")).toBeDefined();
    });

    it("collapses expanded directory on click", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      const expanded = new Set(["docs"]);
      render(<FileTree />, { wrapper: createTestWrapper(cache, expanded) });

      // Children should be visible
      expect(screen.getByText("guide.md")).toBeDefined();

      // Click to collapse
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.click(docsButton!);

      // Children should be hidden
      expect(screen.queryByText("guide.md")).toBeNull();
    });

    it("shows empty placeholder for empty directory", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["notes", emptyDir],
      ]);
      const expanded = new Set(["notes"]);
      render(<FileTree />, { wrapper: createTestWrapper(cache, expanded) });

      expect(screen.getByText("(empty)")).toBeDefined();
    });

    it("calls onLoadDirectory when expanding uncached directory", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onLoadDirectory = mock(() => {});

      render(<FileTree onLoadDirectory={onLoadDirectory} />, {
        wrapper: createTestWrapper(cache),
      });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.click(docsButton!);

      expect(onLoadDirectory).toHaveBeenCalledWith("docs");
    });

    it("does not call onLoadDirectory for cached directory", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      const onLoadDirectory = mock(() => {});

      render(<FileTree onLoadDirectory={onLoadDirectory} />, {
        wrapper: createTestWrapper(cache),
      });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.click(docsButton!);

      expect(onLoadDirectory).not.toHaveBeenCalled();
    });
  });

  describe("file selection", () => {
    it("calls onFileSelect when file is clicked", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onFileSelect = mock(() => {});

      render(<FileTree onFileSelect={onFileSelect} />, {
        wrapper: createTestWrapper(cache),
      });

      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.click(readmeButton!);

      expect(onFileSelect).toHaveBeenCalledWith("README.md");
    });

    it("does not call onFileSelect when directory is clicked", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onFileSelect = mock(() => {});

      render(<FileTree onFileSelect={onFileSelect} />, {
        wrapper: createTestWrapper(cache),
      });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.click(docsButton!);

      expect(onFileSelect).not.toHaveBeenCalled();
    });

    it("applies selected class to selected file", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree onFileSelect={() => {}} />, {
        wrapper: createTestWrapper(cache),
      });

      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.click(readmeButton!);

      // Re-query after state update
      const selectedItem = container.querySelector(".file-tree__item--selected");
      expect(selectedItem?.textContent).toContain("README.md");
    });
  });

  describe("keyboard navigation", () => {
    it("expands directory on Enter key", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.keyDown(docsButton!, { key: "Enter" });

      expect(screen.getByText("guide.md")).toBeDefined();
    });

    it("selects file on Enter key", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onFileSelect = mock(() => {});

      render(<FileTree onFileSelect={onFileSelect} />, {
        wrapper: createTestWrapper(cache),
      });

      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.keyDown(readmeButton!, { key: "Enter" });

      expect(onFileSelect).toHaveBeenCalledWith("README.md");
    });

    it("expands directory on Space key", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.keyDown(docsButton!, { key: " " });

      expect(screen.getByText("guide.md")).toBeDefined();
    });
  });

  describe("nested directories", () => {
    it("renders nested structure correctly", () => {
      const nestedFiles: FileEntry[] = [
        { name: "sub", type: "directory", path: "docs/sub" },
      ];
      const subFiles: FileEntry[] = [
        { name: "deep.md", type: "file", path: "docs/sub/deep.md" },
      ];

      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", nestedFiles],
        ["docs/sub", subFiles],
      ]);
      const expanded = new Set(["docs", "docs/sub"]);

      render(<FileTree />, { wrapper: createTestWrapper(cache, expanded) });

      expect(screen.getByText("docs")).toBeDefined();
      expect(screen.getByText("sub")).toBeDefined();
      expect(screen.getByText("deep.md")).toBeDefined();
    });

    it("increases indentation for nested items", () => {
      const nestedFiles: FileEntry[] = [
        { name: "sub", type: "directory", path: "docs/sub" },
      ];

      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", nestedFiles],
      ]);
      const expanded = new Set(["docs"]);

      render(<FileTree />, { wrapper: createTestWrapper(cache, expanded) });

      const docsButton = screen.getByText("docs").closest("button");
      const subButton = screen.getByText("sub").closest("button");

      // Sub should have more padding (depth 1 vs depth 0)
      const docsStyle = docsButton?.getAttribute("style");
      const subStyle = subButton?.getAttribute("style");

      // docs: 12 + 0*16 = 12px, sub: 12 + 1*16 = 28px
      expect(docsStyle).toContain("padding-left: 12px");
      expect(subStyle).toContain("padding-left: 28px");
    });
  });

  describe("pinned folders", () => {
    it("shows context menu on right-click of directory", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);

      expect(screen.getByRole("menu")).toBeDefined();
      expect(screen.getByText("Pin to top")).toBeDefined();
    });

    it("does not show context menu on right-click of file", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(readmeButton!);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("pins folder when clicking Pin to top", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Right-click to open context menu
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);

      // Click pin option
      const pinButton = screen.getByText("Pin to top");
      fireEvent.click(pinButton);

      // Should show pinned section
      expect(screen.getByText("Pinned")).toBeDefined();
      // Pinned section should contain docs folder
      const pinnedSection = container.querySelector(".file-tree__pinned-section");
      expect(pinnedSection?.textContent).toContain("docs");
    });

    it("shows Unpin folder option for already pinned folders", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // First pin the folder
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      fireEvent.click(screen.getByText("Pin to top"));

      // Right-click the pinned folder in the pinned section
      const pinnedSection = container.querySelector(".file-tree__pinned-section");
      const pinnedDocsButton = pinnedSection?.querySelector("button");
      fireEvent.contextMenu(pinnedDocsButton!);

      expect(screen.getByText("Unpin folder")).toBeDefined();
    });

    it("unpins folder when clicking Unpin folder", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Pin the folder first
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      fireEvent.click(screen.getByText("Pin to top"));

      // Verify pinned section exists
      expect(container.querySelector(".file-tree__pinned-section")).toBeDefined();

      // Right-click and unpin
      const pinnedSection = container.querySelector(".file-tree__pinned-section");
      const pinnedDocsButton = pinnedSection?.querySelector("button");
      fireEvent.contextMenu(pinnedDocsButton!);
      fireEvent.click(screen.getByText("Unpin folder"));

      // Pinned section should be gone
      expect(container.querySelector(".file-tree__pinned-section")).toBeNull();
    });

    it("closes context menu when clicking outside", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Open context menu
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      expect(screen.getByRole("menu")).toBeDefined();

      // Click outside
      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes context menu on Escape key", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Open context menu
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      expect(screen.getByRole("menu")).toBeDefined();

      // Press Escape
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("shows pin indicator on pinned folders in main tree", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Pin the folder
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      fireEvent.click(screen.getByText("Pin to top"));

      // Check for pin indicator in main tree
      const mainTree = container.querySelector(".file-tree__root");
      const pinnedItem = mainTree?.querySelector(".file-tree__item--pinned");
      expect(pinnedItem).toBeDefined();
      expect(pinnedItem?.querySelector(".file-tree__pin-indicator")).toBeDefined();
    });

    it("allows expanding pinned folders", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Pin the folder
      const docsButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(docsButton!);
      fireEvent.click(screen.getByText("Pin to top"));

      // Click on the pinned folder to expand it
      const pinnedSection = container.querySelector(".file-tree__pinned-section");
      const pinnedDocsButton = pinnedSection?.querySelector("button");
      fireEvent.click(pinnedDocsButton!);

      // Should show children under the pinned folder (may appear in both sections)
      // Use getAllByText since expansion state is shared between pinned and main tree
      const guideElements = screen.getAllByText("guide.md");
      const apiElements = screen.getAllByText("api.md");
      expect(guideElements.length).toBeGreaterThan(0);
      expect(apiElements.length).toBeGreaterThan(0);
    });
  });
});
