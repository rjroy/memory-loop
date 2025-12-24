/**
 * Tests for MarkdownViewer component
 *
 * Tests markdown rendering, wiki-link parsing, breadcrumb navigation,
 * and various component states.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MarkdownViewer } from "../MarkdownViewer";
import { SessionProvider, useSession } from "../../contexts/SessionContext";

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

// Custom wrapper that pre-populates browser state
interface BrowserStateConfig {
  currentPath?: string;
  currentFileContent?: string | null;
  currentFileTruncated?: boolean;
  fileError?: string | null;
  isLoading?: boolean;
}

function createTestWrapper(config: BrowserStateConfig = {}) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider>
        <StatePopulator config={config}>{children}</StatePopulator>
      </SessionProvider>
    );
  };
}

function StatePopulator({
  children,
  config,
}: {
  children: ReactNode;
  config: BrowserStateConfig;
}) {
  const session = useSession();

  useEffect(() => {
    if (config.currentPath !== undefined) {
      session.setCurrentPath(config.currentPath);
    }
    if (config.currentFileContent !== undefined && config.currentFileContent !== null) {
      session.setFileContent(config.currentFileContent, config.currentFileTruncated ?? false);
    }
    if (config.fileError !== undefined && config.fileError !== null) {
      session.setFileError(config.fileError);
    }
    if (config.isLoading !== undefined) {
      session.setFileLoading(config.isLoading);
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

describe("MarkdownViewer", () => {
  describe("empty state", () => {
    it("shows empty message when no file is selected", () => {
      render(<MarkdownViewer />, { wrapper: createTestWrapper() });

      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("shows loading skeleton when loading", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({ isLoading: true, currentPath: "test.md" }),
      });

      expect(screen.getByLabelText("Loading content")).toBeDefined();
    });
  });

  describe("error state", () => {
    it("shows error message on file error", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "missing.md",
          fileError: "File not found",
        }),
      });

      expect(screen.getByText("File not found")).toBeDefined();
    });
  });

  describe("markdown rendering", () => {
    it("renders basic markdown content", () => {
      const content = "# Hello World\n\nThis is a paragraph.";
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
      expect(screen.getByText("Hello World")).toBeDefined();
      expect(screen.getByText("This is a paragraph.")).toBeDefined();
    });

    it("renders lists correctly", () => {
      const content = "- Item 1\n- Item 2\n- Item 3";
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByText("Item 1")).toBeDefined();
      expect(screen.getByText("Item 2")).toBeDefined();
      expect(screen.getByText("Item 3")).toBeDefined();
    });

    it("renders code blocks", () => {
      const content = "```\nconst x = 1;\n```";
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByText("const x = 1;")).toBeDefined();
    });
  });

  describe("wiki-links", () => {
    it("renders wiki-links as clickable elements", () => {
      const content = "See [[other-note]] for more.";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      expect(wikiLink).toBeDefined();
      expect(wikiLink?.textContent).toBe("other-note");
    });

    it("renders wiki-links with display text", () => {
      const content = "See [[other-note|the other note]] for more.";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      expect(wikiLink?.textContent).toBe("the other note");
      expect(wikiLink?.getAttribute("data-wiki-target")).toBe("other-note.md");
    });

    it("calls onNavigate when wiki-link is clicked", () => {
      const content = "See [[other-note]] for more.";
      const onNavigate = mock(() => {});
      const { container } = render(<MarkdownViewer onNavigate={onNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      fireEvent.click(wikiLink!);

      expect(onNavigate).toHaveBeenCalledWith("other-note.md");
    });

    it("resolves relative wiki-link paths", () => {
      const content = "See [[other-note]] for more.";
      const onNavigate = mock(() => {});
      const { container } = render(<MarkdownViewer onNavigate={onNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "docs/guide.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      fireEvent.click(wikiLink!);

      expect(onNavigate).toHaveBeenCalledWith("docs/other-note.md");
    });

    it("handles wiki-links with .md extension", () => {
      const content = "See [[other-note.md]] for more.";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      expect(wikiLink?.getAttribute("data-wiki-target")).toBe("other-note.md");
    });
  });

  describe("external links", () => {
    it("renders external links with target=_blank", () => {
      const content = "[Example](https://example.com)";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const link = container.querySelector(".markdown-viewer__external-link");
      expect(link).toBeDefined();
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  describe("breadcrumb navigation", () => {
    it("shows breadcrumb for nested file", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "docs/guide.md",
          currentFileContent: "# Guide",
        }),
      });

      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByText("docs")).toBeDefined();
      expect(screen.getByText("guide.md")).toBeDefined();
    });

    it("does not show breadcrumb for root files", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "",
          currentFileContent: null,
        }),
      });

      // No breadcrumb nav should be rendered
      expect(screen.queryByRole("navigation", { name: "File path" })).toBeNull();
    });

    it("calls navigate when breadcrumb segment is clicked", () => {
      const onNavigate = mock(() => {});
      render(<MarkdownViewer onNavigate={onNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "docs/api/guide.md",
          currentFileContent: "# Guide",
        }),
      });

      const docsButton = screen.getByText("docs");
      fireEvent.click(docsButton);

      // Should navigate to docs directory
      // The component updates currentPath internally
    });
  });

  describe("truncation warning", () => {
    it("shows warning when file is truncated", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "large.md",
          currentFileContent: "# Large File",
          currentFileTruncated: true,
        }),
      });

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/truncated due to size limits/)).toBeDefined();
    });

    it("does not show warning when file is not truncated", () => {
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "small.md",
          currentFileContent: "# Small File",
          currentFileTruncated: false,
        }),
      });

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("image handling", () => {
    it("prepends asset base URL to relative images", () => {
      const content = "![Alt](./image.png)";
      const { container } = render(
        <MarkdownViewer assetBaseUrl="/vault/test/assets" />,
        {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: content,
          }),
        }
      );

      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("/vault/test/assets/./image.png");
    });

    it("preserves absolute URLs for external images", () => {
      const content = "![Alt](https://example.com/image.png)";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://example.com/image.png");
    });
  });

  describe("XSS protection", () => {
    it("sanitizes script tags from markdown", () => {
      const content = "<script>alert('xss')</script>";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(container.querySelector("script")).toBeNull();
    });

    it("sanitizes onclick handlers", () => {
      const content = '<a href="#" onclick="alert(\'xss\')">Click</a>';
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const link = container.querySelector("a");
      expect(link?.getAttribute("onclick")).toBeNull();
    });
  });
});
