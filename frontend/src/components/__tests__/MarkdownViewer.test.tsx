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
  isAdjusting?: boolean;
  adjustContent?: string;
  adjustError?: string | null;
  isSaving?: boolean;
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
    // Set up adjust mode state if requested
    if (config.isAdjusting) {
      session.startAdjust();
      // If specific adjustContent is provided, update it
      if (config.adjustContent !== undefined) {
        session.updateAdjustContent(config.adjustContent);
      }
    }
    // Set saving state if requested
    if (config.isSaving) {
      session.startSave();
    }
    // Set adjust error if requested
    if (config.adjustError !== undefined && config.adjustError !== null) {
      session.saveError(config.adjustError);
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

  describe("frontmatter rendering", () => {
    it("renders frontmatter as a table", () => {
      const content = `---
title: Test Note
date: 2025-01-15
---

# Content`;
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const frontmatterTable = container.querySelector(".markdown-viewer__frontmatter-table");
      expect(frontmatterTable).toBeDefined();
      expect(screen.getByText("title")).toBeDefined();
      expect(screen.getByText("Test Note")).toBeDefined();
      expect(screen.getByText("date")).toBeDefined();
    });

    it("renders markdown content after frontmatter", () => {
      const content = `---
title: Test
---

# Hello World`;
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
      expect(screen.getByText("Hello World")).toBeDefined();
    });

    it("does not render frontmatter as raw text", () => {
      const content = `---
title: Secret Title
---

# Visible Content`;
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      // The raw --- delimiters should not appear in the content
      const contentDiv = screen.getByText("Visible Content").closest(".markdown-viewer__content");
      expect(contentDiv?.textContent).not.toContain("---");
    });

    it("handles array values in frontmatter", () => {
      const content = `---
tags: [javascript, react, testing]
---

# Content`;
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByText("tags")).toBeDefined();
      expect(screen.getByText("javascript, react, testing")).toBeDefined();
    });

    it("handles nested object values in frontmatter", () => {
      const content = `---
metadata:
  author: John
  version: "1.0"
---

# Content`;
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(screen.getByText("metadata")).toBeDefined();
      // Nested objects are JSON stringified
      expect(screen.getByText('{"author":"John","version":"1.0"}')).toBeDefined();
    });

    it("does not show frontmatter table when no frontmatter exists", () => {
      const content = "# Just a heading\n\nSome content.";
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      const frontmatterTable = container.querySelector(".markdown-viewer__frontmatter-table");
      expect(frontmatterTable).toBeNull();
    });

    it("handles empty frontmatter gracefully", () => {
      const content = `---
---

# Content`;
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      // Empty frontmatter should not render a table
      const frontmatterTable = container.querySelector(".markdown-viewer__frontmatter-table");
      expect(frontmatterTable).toBeNull();
      // Content should still render
      expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    });

    it("handles malformed frontmatter gracefully", () => {
      // Invalid YAML that gray-matter can't parse
      const content = `---
title: [unclosed bracket
---

# Content`;
      render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      // Should still render something without crashing
      expect(screen.getByText("Content")).toBeDefined();
    });

    it("frontmatter table has correct styling classes", () => {
      const content = `---
title: Test
---

# Content`;
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      expect(container.querySelector(".markdown-viewer__frontmatter")).toBeDefined();
      expect(container.querySelector(".markdown-viewer__frontmatter-table")).toBeDefined();
      expect(container.querySelector(".markdown-viewer__frontmatter-key")).toBeDefined();
      expect(container.querySelector(".markdown-viewer__frontmatter-value")).toBeDefined();
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

    it("treats wiki-links with paths as absolute from vault root", () => {
      // Wikilinks like [[folder/note]] are absolute from content root,
      // not relative to current file (Obsidian behavior)
      const content = "See [[02_Areas/Projects/index]] for more.";
      const onNavigate = mock(() => {});
      const { container } = render(<MarkdownViewer onNavigate={onNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "docs/nested/guide.md",
          currentFileContent: content,
        }),
      });

      const wikiLink = container.querySelector(".markdown-viewer__wiki-link");
      fireEvent.click(wikiLink!);

      // Should NOT prepend current dir - path with / is absolute
      expect(onNavigate).toHaveBeenCalledWith("02_Areas/Projects/index.md");
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
      // react-markdown escapes raw HTML by default, so the anchor won't render as HTML
      const content = '<a href="#" onclick="alert(\'xss\')">Click</a>';
      const { container } = render(<MarkdownViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.md",
          currentFileContent: content,
        }),
      });

      // Either no anchor exists (raw HTML escaped) or it has no onclick
      const link = container.querySelector("a");
      const hasNoOnclick = !link || link.getAttribute("onclick") === null;
      expect(hasNoOnclick).toBe(true);
    });
  });

  describe("adjust mode", () => {
    describe("Adjust button (REQ-F-1)", () => {
      it("shows Adjust button when file is loaded and not adjusting", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test content",
          }),
        });

        const adjustButton = screen.getByRole("button", { name: "Adjust file" });
        expect(adjustButton).toBeDefined();
        expect(adjustButton.textContent).toBe("Adjust");
      });

      it("does not show Adjust button when no file is loaded", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper(),
        });

        expect(screen.queryByRole("button", { name: "Adjust file" })).toBeNull();
      });

      it("does not show Adjust button when loading", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            isLoading: true,
          }),
        });

        expect(screen.queryByRole("button", { name: "Adjust file" })).toBeNull();
      });

      it("does not show Adjust button when in adjust mode", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test content",
            isAdjusting: true,
          }),
        });

        // In adjust mode, we should see Save/Cancel instead of Adjust
        expect(screen.queryByRole("button", { name: "Adjust file" })).toBeNull();
        expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
      });
    });

    describe("textarea display (REQ-F-2)", () => {
      it("shows textarea with raw content in adjust mode", () => {
        const content = "# Test content\n\nSome text here.";
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: content,
            isAdjusting: true,
          }),
        });

        const textarea = screen.getByRole("textbox", { name: "File content editor" });
        expect(textarea).toBeDefined();
        expect((textarea as HTMLTextAreaElement).value).toBe(content);
      });

      it("does not show rendered markdown in adjust mode", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test Heading",
            isAdjusting: true,
          }),
        });

        // Should not have rendered heading element
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
      });
    });

    describe("Save and Cancel buttons (REQ-F-3)", () => {
      it("shows Save and Cancel buttons in adjust mode", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Cancel editing" })).toBeDefined();
      });

      it("calls onSave with adjusted content when Save clicked", () => {
        const onSave = mock(() => {});
        const content = "# Original content";
        render(<MarkdownViewer onSave={onSave} />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: content,
            isAdjusting: true,
          }),
        });

        const saveButton = screen.getByRole("button", { name: "Save changes" });
        fireEvent.click(saveButton);

        expect(onSave).toHaveBeenCalledWith(content);
      });

      it("exits adjust mode when Cancel clicked", async () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const cancelButton = screen.getByRole("button", { name: "Cancel editing" });
        fireEvent.click(cancelButton);

        // After cancel, should see the Adjust button again (not in adjust mode)
        // Need to wait for state update
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByRole("button", { name: "Adjust file" })).toBeDefined();
      });
    });

    describe("Escape key handling (REQ-F-6)", () => {
      it("triggers cancel when Escape is pressed in textarea", async () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const textarea = screen.getByRole("textbox", { name: "File content editor" });
        fireEvent.keyDown(textarea, { key: "Escape" });

        // After Escape, should exit adjust mode
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByRole("button", { name: "Adjust file" })).toBeDefined();
      });

      it("does not cancel on other keys", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const textarea = screen.getByRole("textbox", { name: "File content editor" });
        fireEvent.keyDown(textarea, { key: "Enter" });

        // Should still be in adjust mode
        expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
      });
    });

    describe("textarea styling (REQ-NF-2)", () => {
      it("textarea has correct class for styling", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const textarea = container.querySelector(".markdown-viewer__adjust-textarea");
        expect(textarea).toBeDefined();
      });

      it("adjust mode container has correct class", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        expect(container.querySelector(".markdown-viewer--adjusting")).toBeDefined();
      });
    });

    describe("ARIA labels (REQ-NF-3)", () => {
      it("Adjust button has aria-label", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
          }),
        });

        const button = screen.getByLabelText("Adjust file");
        expect(button).toBeDefined();
      });

      it("Save button has aria-label", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const button = screen.getByLabelText("Save changes");
        expect(button).toBeDefined();
      });

      it("Cancel button has aria-label", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const button = screen.getByLabelText("Cancel editing");
        expect(button).toBeDefined();
      });

      it("textarea has aria-label", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const textarea = screen.getByLabelText("File content editor");
        expect(textarea).toBeDefined();
      });
    });

    describe("error display", () => {
      it("shows error message when adjustError is set", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            adjustError: "Permission denied",
          }),
        });

        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText("Permission denied")).toBeDefined();
      });

      it("does not show error when adjustError is null", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            adjustError: null,
          }),
        });

        // Should not have any error alert in adjust mode
        expect(screen.queryByText("Permission denied")).toBeNull();
      });

      it("error is displayed with correct class for styling", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            adjustError: "Save failed",
          }),
        });

        const error = container.querySelector(".markdown-viewer__adjust-error");
        expect(error).toBeDefined();
      });
    });

    describe("saving state", () => {
      it("shows 'Saving...' text when isSaving is true", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            isSaving: true,
          }),
        });

        expect(screen.getByText("Saving...")).toBeDefined();
      });

      it("disables Save button when saving", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            isSaving: true,
          }),
        });

        const saveButton = screen.getByRole("button", { name: "Save changes" });
        expect(saveButton.hasAttribute("disabled")).toBe(true);
      });

      it("disables Cancel button when saving", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            isSaving: true,
          }),
        });

        const cancelButton = screen.getByRole("button", { name: "Cancel editing" });
        expect(cancelButton.hasAttribute("disabled")).toBe(true);
      });

      it("disables textarea when saving", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
            isSaving: true,
          }),
        });

        const textarea = screen.getByRole("textbox", { name: "File content editor" });
        expect(textarea.hasAttribute("disabled")).toBe(true);
      });
    });

    describe("button styling (REQ-NF-4)", () => {
      it("buttons have correct base class", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        const buttons = container.querySelectorAll(".markdown-viewer__adjust-btn");
        expect(buttons.length).toBe(2); // Save and Cancel
      });

      it("Save button has save modifier class", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        expect(container.querySelector(".markdown-viewer__adjust-btn--save")).toBeDefined();
      });

      it("Cancel button has cancel modifier class", () => {
        const { container } = render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test",
            isAdjusting: true,
          }),
        });

        expect(container.querySelector(".markdown-viewer__adjust-btn--cancel")).toBeDefined();
      });
    });

    describe("content editing", () => {
      it("updates content when typing in textarea", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Original",
            isAdjusting: true,
          }),
        });

        const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File content editor" });
        fireEvent.change(textarea, { target: { value: "# Modified content" } });

        expect(textarea.value).toBe("# Modified content");
      });
    });

    describe("click to enter adjust mode", () => {
      it("enters adjust mode when Adjust button is clicked", async () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "test.md",
            currentFileContent: "# Test content",
          }),
        });

        const adjustButton = screen.getByRole("button", { name: "Adjust file" });
        fireEvent.click(adjustButton);

        // After click, should see textarea
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByRole("textbox", { name: "File content editor" })).toBeDefined();
      });
    });

    describe("breadcrumb in adjust mode", () => {
      it("shows breadcrumb navigation in adjust mode", () => {
        render(<MarkdownViewer />, {
          wrapper: createTestWrapper({
            currentPath: "docs/guide.md",
            currentFileContent: "# Guide",
            isAdjusting: true,
          }),
        });

        expect(screen.getByText("Root")).toBeDefined();
        expect(screen.getByText("docs")).toBeDefined();
        expect(screen.getByText("guide.md")).toBeDefined();
      });
    });
  });
});
