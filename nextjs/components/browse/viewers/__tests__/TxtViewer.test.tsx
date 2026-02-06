/**
 * Tests for TxtViewer component
 *
 * Tests plain text display, editing, breadcrumb navigation,
 * and mobile menu button functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { TxtViewer } from "../TxtViewer";
import { SessionProvider, useSession } from "../../../../contexts/SessionContext";

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
    if (config.isAdjusting) {
      session.startAdjust();
      if (config.adjustContent !== undefined) {
        session.updateAdjustContent(config.adjustContent);
      }
    }
    if (config.isSaving) {
      session.startSave();
    }
    if (config.adjustError !== undefined && config.adjustError !== null) {
      session.saveError(config.adjustError);
    }
  }, []);

  return <>{children}</>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("TxtViewer", () => {
  describe("empty state", () => {
    it("shows empty message when no file is selected", () => {
      render(<TxtViewer />, { wrapper: createTestWrapper() });

      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("shows loading skeleton when loading", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({ isLoading: true, currentPath: "test.txt" }),
      });

      expect(screen.getByLabelText("Loading content")).toBeDefined();
    });
  });

  describe("error state", () => {
    it("shows error message on file error", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "missing.txt",
          fileError: "File not found",
        }),
      });

      expect(screen.getByText("File not found")).toBeDefined();
    });
  });

  describe("text rendering", () => {
    it("renders plain text content", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "notes.txt",
          currentFileContent: "Hello, world!\nLine 2",
        }),
      });

      expect(screen.getByText(/Hello, world!/)).toBeDefined();
      expect(screen.getByText(/Line 2/)).toBeDefined();
    });

    it("renders text in pre/code elements", () => {
      const { container } = render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "notes.txt",
          currentFileContent: "Some text content",
        }),
      });

      const preElement = container.querySelector("pre.txt-viewer__text");
      expect(preElement).toBeDefined();
      const codeElement = preElement?.querySelector("code");
      expect(codeElement).toBeDefined();
      expect(codeElement?.textContent).toBe("Some text content");
    });
  });

  describe("breadcrumb navigation", () => {
    it("renders breadcrumb for file path", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "notes/readme.txt",
          currentFileContent: "text",
        }),
      });

      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByText("notes")).toBeDefined();
      expect(screen.getByText("readme.txt")).toBeDefined();
    });

    it("calls onNavigate when breadcrumb is clicked", () => {
      let navigatedPath: string | undefined;
      const handleNavigate = (path: string) => {
        navigatedPath = path;
      };

      render(<TxtViewer onNavigate={handleNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "notes/readme.txt",
          currentFileContent: "text",
        }),
      });

      fireEvent.click(screen.getByText("Root"));
      expect(navigatedPath).toBe("");
    });

    it("collapses breadcrumb when path has more than 3 segments", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "a/b/c/d/file.txt",
          currentFileContent: "text",
        }),
      });

      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByLabelText("Show full path")).toBeDefined();
      expect(screen.getByText("d")).toBeDefined();
      expect(screen.getByText("file.txt")).toBeDefined();

      expect(screen.queryByText("a")).toBeNull();
      expect(screen.queryByText("b")).toBeNull();
      expect(screen.queryByText("c")).toBeNull();
    });

    it("expands breadcrumb when ellipsis is clicked", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "a/b/c/d/file.txt",
          currentFileContent: "text",
        }),
      });

      const ellipsisBtn = screen.getByLabelText("Show full path");
      fireEvent.click(ellipsisBtn);

      expect(screen.getByText("a")).toBeDefined();
      expect(screen.getByText("b")).toBeDefined();
      expect(screen.getByText("c")).toBeDefined();
      expect(screen.getByText("d")).toBeDefined();
      expect(screen.getByText("file.txt")).toBeDefined();
      expect(screen.queryByLabelText("Show full path")).toBeNull();
    });
  });

  describe("truncation warning", () => {
    it("shows warning when file was truncated", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "large.txt",
          currentFileContent: "content",
          currentFileTruncated: true,
        }),
      });

      expect(screen.getByText(/This file was truncated/)).toBeDefined();
    });
  });

  describe("mobile menu button", () => {
    it("does not render mobile menu button when onMobileMenuClick is not provided", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const menuBtn = screen.queryByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeNull();
    });

    it("renders mobile menu button when onMobileMenuClick is provided", () => {
      const handleClick = () => {};
      render(<TxtViewer onMobileMenuClick={handleClick} />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeDefined();
    });

    it("calls onMobileMenuClick when mobile menu button is clicked", () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };
      render(<TxtViewer onMobileMenuClick={handleClick} />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      expect(clicked).toBe(true);
    });
  });

  describe("adjust mode", () => {
    it("shows Adjust button in normal view", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      expect(screen.getByRole("button", { name: /adjust file/i })).toBeDefined();
    });

    it("shows Save and Cancel buttons in adjust mode", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: /adjust file/i }));

      expect(screen.getByRole("button", { name: /save changes/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /cancel editing/i })).toBeDefined();
    });

    it("shows textarea with content in adjust mode", () => {
      const content = "Original text content";
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: content,
          isAdjusting: true,
        }),
      });

      const textarea = screen.getByRole("textbox", { name: "File content editor" });
      expect(textarea).toBeDefined();
      expect((textarea as HTMLTextAreaElement).value).toBe(content);
    });

    it("calls onSave with adjusted content when Save clicked", () => {
      let savedContent: string | undefined;
      const onSave = (content: string) => {
        savedContent = content;
      };
      const content = "Original text";
      render(<TxtViewer onSave={onSave} />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: content,
          isAdjusting: true,
        }),
      });

      const saveButton = screen.getByRole("button", { name: "Save changes" });
      fireEvent.click(saveButton);

      expect(savedContent).toBe(content);
    });

    it("exits adjust mode when Cancel clicked", async () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
          isAdjusting: true,
        }),
      });

      const cancelButton = screen.getByRole("button", { name: "Cancel editing" });
      fireEvent.click(cancelButton);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByRole("button", { name: /adjust file/i })).toBeDefined();
    });

    it("triggers cancel when Escape is pressed in textarea", async () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
          isAdjusting: true,
        }),
      });

      const textarea = screen.getByRole("textbox", { name: "File content editor" });
      fireEvent.keyDown(textarea, { key: "Escape" });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByRole("button", { name: /adjust file/i })).toBeDefined();
    });

    it("shows error message when adjustError is set", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
          isAdjusting: true,
          adjustError: "Permission denied",
        }),
      });

      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Permission denied")).toBeDefined();
    });

    it("disables Save button when saving", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
          isAdjusting: true,
          isSaving: true,
        }),
      });

      const saveButton = screen.getByRole("button", { name: "Save changes" });
      expect(saveButton.hasAttribute("disabled")).toBe(true);
    });

    it("shows 'Saving...' text when isSaving is true", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
          isAdjusting: true,
          isSaving: true,
        }),
      });

      expect(screen.getByText("Saving...")).toBeDefined();
    });
  });

  describe("delete button", () => {
    it("does not render delete button when onDelete is not provided", () => {
      render(<TxtViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const deleteBtn = screen.queryByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeNull();
    });

    it("renders delete button when onDelete is provided", () => {
      const handleDelete = () => {};
      render(<TxtViewer onDelete={handleDelete} />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeDefined();
    });

    it("calls onDelete when delete button is clicked", () => {
      let deleted = false;
      const handleDelete = () => {
        deleted = true;
      };
      render(<TxtViewer onDelete={handleDelete} />, {
        wrapper: createTestWrapper({
          currentPath: "test.txt",
          currentFileContent: "text",
        }),
      });

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      fireEvent.click(deleteBtn);

      expect(deleted).toBe(true);
    });
  });
});
