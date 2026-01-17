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

    it("shows context menu on right-click of file", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(readmeButton!);

      expect(screen.getByRole("menu")).toBeDefined();
      expect(screen.getByText("Pin to top")).toBeDefined();
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

    it("pins file when clicking Pin to top", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const { container } = render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Right-click to open context menu on a file
      const readmeButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(readmeButton!);

      // Click pin option
      const pinButton = screen.getByText("Pin to top");
      fireEvent.click(pinButton);

      // Should show pinned section with the file
      expect(screen.getByText("Pinned")).toBeDefined();
      const pinnedSection = container.querySelector(".file-tree__pinned-section");
      expect(pinnedSection?.textContent).toContain("README.md");
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

  describe("delete file functionality", () => {
    it("shows delete option in context menu for files", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should show delete option
      expect(screen.getByText("Delete file")).toBeDefined();
    });

    it("does not show delete option for directories", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a directory
      const dirButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(dirButton!);

      // Should not show delete option (only pin/unpin)
      expect(screen.queryByText("Delete file")).toBeNull();
    });

    it("shows confirmation dialog when delete is clicked", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file and click delete
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);
      fireEvent.click(screen.getByText("Delete file"));

      // Should show confirmation dialog
      expect(screen.getByText("Delete File?")).toBeDefined();
      expect(screen.getByText("This cannot be undone! The file will be permanently deleted from your vault.")).toBeDefined();
    });

    it("calls onDeleteFile when deletion is confirmed", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file and click delete
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);
      fireEvent.click(screen.getByText("Delete file"));

      // Confirm deletion
      fireEvent.click(screen.getByText("Delete"));

      // Should call onDeleteFile with the file path
      expect(onDeleteFile).toHaveBeenCalledWith("README.md");
    });

    it("does not call onDeleteFile when deletion is cancelled", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file and click delete
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);
      fireEvent.click(screen.getByText("Delete file"));

      // Cancel deletion
      fireEvent.click(screen.getByText("Cancel"));

      // Should not call onDeleteFile
      expect(onDeleteFile).not.toHaveBeenCalled();
    });

    it("does not show delete option when onDeleteFile is not provided", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should not show delete option
      expect(screen.queryByText("Delete file")).toBeNull();
    });

    it("shows delete option for files in nested directories", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      const expandedDirs = new Set<string>(["docs"]);
      const onDeleteFile = mock(() => {});
      render(<FileTree onDeleteFile={onDeleteFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on a nested file
      const fileButton = screen.getByText("guide.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should show delete option
      expect(screen.getByText("Delete file")).toBeDefined();

      // Click delete and confirm
      fireEvent.click(screen.getByText("Delete file"));
      fireEvent.click(screen.getByText("Delete"));

      // Should call with the full path
      expect(onDeleteFile).toHaveBeenCalledWith("docs/guide.md");
    });
  });

  describe("think about functionality", () => {
    it("shows think about option in context menu for files", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should show think about option
      expect(screen.getByText("Think about")).toBeDefined();
    });

    it("shows think about option for directories", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a directory
      const dirButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(dirButton!);

      // Should show think about option
      expect(screen.getByText("Think about")).toBeDefined();
    });

    it("calls onThinkAbout when think about is clicked on a directory", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a directory and click think about
      const dirButton = screen.getByText("docs").closest("button");
      fireEvent.contextMenu(dirButton!);
      fireEvent.click(screen.getByText("Think about"));

      // Should call onThinkAbout with the directory path
      expect(onThinkAbout).toHaveBeenCalledWith("docs");
    });

    it("calls onThinkAbout when think about is clicked", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file and click think about
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);
      fireEvent.click(screen.getByText("Think about"));

      // Should call onThinkAbout with the file path
      expect(onThinkAbout).toHaveBeenCalledWith("README.md");
    });

    it("does not show think about option when onThinkAbout is not provided", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      render(<FileTree />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should not show think about option
      expect(screen.queryByText("Think about")).toBeNull();
    });

    it("shows think about option for files in nested directories", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", testFiles],
        ["docs", docsFiles],
      ]);
      const expandedDirs = new Set<string>(["docs"]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on a nested file
      const fileButton = screen.getByText("guide.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should show think about option
      expect(screen.getByText("Think about")).toBeDefined();

      // Click think about
      fireEvent.click(screen.getByText("Think about"));

      // Should call with the full path
      expect(onThinkAbout).toHaveBeenCalledWith("docs/guide.md");
    });

    it("closes context menu after clicking think about", () => {
      const cache = new Map<string, FileEntry[]>([["", testFiles]]);
      const onThinkAbout = mock(() => {});
      render(<FileTree onThinkAbout={onThinkAbout} />, { wrapper: createTestWrapper(cache) });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);
      expect(screen.getByRole("menu")).toBeDefined();

      // Click think about
      fireEvent.click(screen.getByText("Think about"));

      // Context menu should be closed
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("archive functionality", () => {
    // Test data for archivable directories
    const archivableTestFiles: FileEntry[] = [
      { name: "00_Inbox", type: "directory", path: "00_Inbox" },
      { name: "01_Projects", type: "directory", path: "01_Projects" },
      { name: "02_Areas", type: "directory", path: "02_Areas" },
      { name: "README.md", type: "file", path: "README.md" },
    ];

    const inboxContents: FileEntry[] = [
      { name: "chats", type: "directory", path: "00_Inbox/chats" },
      { name: "daily.md", type: "file", path: "00_Inbox/daily.md" },
    ];

    const projectsContents: FileEntry[] = [
      { name: "MyProject", type: "directory", path: "01_Projects/MyProject" },
    ];

    const areasContents: FileEntry[] = [
      { name: "Health", type: "directory", path: "02_Areas/Health" },
    ];

    it("shows archive option for chats directory under inbox", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["00_Inbox", inboxContents],
      ]);
      const expandedDirs = new Set<string>(["00_Inbox"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on chats directory
      const chatsButton = screen.getByText("chats").closest("button");
      fireEvent.contextMenu(chatsButton!);

      // Should show archive option
      expect(screen.getByText("Archive")).toBeDefined();
    });

    it("shows archive option for project directories", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);

      // Should show archive option
      expect(screen.getByText("Archive")).toBeDefined();
    });

    it("shows archive option for area directories", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["02_Areas", areasContents],
      ]);
      const expandedDirs = new Set<string>(["02_Areas"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on area directory
      const areaButton = screen.getByText("Health").closest("button");
      fireEvent.contextMenu(areaButton!);

      // Should show archive option
      expect(screen.getByText("Archive")).toBeDefined();
    });

    it("does not show archive option for non-archivable directories", () => {
      const cache = new Map<string, FileEntry[]>([["", archivableTestFiles]]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache),
      });

      // Right-click on top-level directory (not archivable - needs to be a child)
      const inboxButton = screen.getByText("00_Inbox").closest("button");
      fireEvent.contextMenu(inboxButton!);

      // Should not show archive option (top-level inbox itself is not archivable)
      expect(screen.queryByText("Archive")).toBeNull();
    });

    it("does not show archive option for files", () => {
      const cache = new Map<string, FileEntry[]>([["", archivableTestFiles]]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache),
      });

      // Right-click on a file
      const fileButton = screen.getByText("README.md").closest("button");
      fireEvent.contextMenu(fileButton!);

      // Should not show archive option
      expect(screen.queryByText("Archive")).toBeNull();
    });

    it("shows confirmation dialog when archive is clicked", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory and click archive
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);
      fireEvent.click(screen.getByText("Archive"));

      // Should show confirmation dialog
      expect(screen.getByText("Archive Directory?")).toBeDefined();
      expect(screen.getByText(/Move "MyProject" to the archive folder/)).toBeDefined();
    });

    it("calls onArchiveFile when archive is confirmed", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory and click archive
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);
      fireEvent.click(screen.getByText("Archive"));

      // Confirm archive
      fireEvent.click(screen.getByText("Archive"));

      // Should call onArchiveFile with the directory path
      expect(onArchiveFile).toHaveBeenCalledWith("01_Projects/MyProject");
    });

    it("does not call onArchiveFile when archive is cancelled", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory and click archive
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);
      fireEvent.click(screen.getByText("Archive"));

      // Cancel archive
      fireEvent.click(screen.getByText("Cancel"));

      // Should not call onArchiveFile
      expect(onArchiveFile).not.toHaveBeenCalled();
    });

    it("does not show archive option when onArchiveFile is not provided", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      render(<FileTree />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);

      // Should not show archive option
      expect(screen.queryByText("Archive")).toBeNull();
    });

    it("closes context menu after clicking archive", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["01_Projects", projectsContents],
      ]);
      const expandedDirs = new Set<string>(["01_Projects"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on project directory
      const projectButton = screen.getByText("MyProject").closest("button");
      fireEvent.contextMenu(projectButton!);
      expect(screen.getByRole("menu")).toBeDefined();

      // Click archive
      fireEvent.click(screen.getByText("Archive"));

      // Context menu should be closed (confirmation dialog is open instead)
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("calls onArchiveFile for chats directory with full path", () => {
      const cache = new Map<string, FileEntry[]>([
        ["", archivableTestFiles],
        ["00_Inbox", inboxContents],
      ]);
      const expandedDirs = new Set<string>(["00_Inbox"]);
      const onArchiveFile = mock(() => {});
      render(<FileTree onArchiveFile={onArchiveFile} />, {
        wrapper: createTestWrapper(cache, expandedDirs),
      });

      // Right-click on chats directory and click archive
      const chatsButton = screen.getByText("chats").closest("button");
      fireEvent.contextMenu(chatsButton!);
      fireEvent.click(screen.getByText("Archive"));

      // Confirm archive
      fireEvent.click(screen.getByText("Archive"));

      // Should call onArchiveFile with the full path
      expect(onArchiveFile).toHaveBeenCalledWith("00_Inbox/chats");
    });
  });
});
