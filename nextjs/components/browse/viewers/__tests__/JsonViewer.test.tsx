/**
 * Tests for JsonViewer component
 *
 * Tests JSON display, editing, breadcrumb navigation,
 * and mobile menu button functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { JsonViewer } from "../JsonViewer";
import { SessionProvider, useSession } from "../../../../contexts/SessionContext";

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
});

afterEach(() => {
  cleanup();
});

describe("JsonViewer", () => {
  describe("empty state", () => {
    it("shows empty message when no file is selected", () => {
      render(<JsonViewer />, { wrapper: createTestWrapper() });

      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("shows loading skeleton when loading", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({ isLoading: true, currentPath: "test.json" }),
      });

      expect(screen.getByLabelText("Loading content")).toBeDefined();
    });
  });

  describe("error state", () => {
    it("shows error message on file error", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "missing.json",
          fileError: "File not found",
        }),
      });

      expect(screen.getByText("File not found")).toBeDefined();
    });
  });

  describe("JSON rendering", () => {
    it("renders formatted JSON", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "config.json",
          currentFileContent: '{"name":"test","value":42}',
        }),
      });

      // JSON should be formatted in a pre element
      const preElement = document.querySelector("pre");
      expect(preElement).toBeDefined();
      expect(preElement?.textContent).toContain('"name"');
      expect(preElement?.textContent).toContain('"test"');
    });

    it("shows error for invalid JSON", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "broken.json",
          currentFileContent: "{invalid json",
        }),
      });

      // Should show error alert
      const errorAlert = document.querySelector(".json-viewer__invalid-json");
      expect(errorAlert).toBeDefined();
      expect(errorAlert?.textContent).toContain("invalid JSON");
    });
  });

  describe("breadcrumb navigation", () => {
    it("renders breadcrumb for file path", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "config/settings.json",
          currentFileContent: "{}",
        }),
      });

      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByText("config")).toBeDefined();
      expect(screen.getByText("settings.json")).toBeDefined();
    });

    it("calls onNavigate when breadcrumb is clicked", () => {
      let navigatedPath: string | undefined;
      const handleNavigate = (path: string) => {
        navigatedPath = path;
      };

      render(<JsonViewer onNavigate={handleNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "config/settings.json",
          currentFileContent: "{}",
        }),
      });

      fireEvent.click(screen.getByText("Root"));
      expect(navigatedPath).toBe("");
    });

    it("collapses breadcrumb when path has more than 3 segments", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "a/b/c/d/file.json",
          currentFileContent: "{}",
        }),
      });

      // Should show Root, ellipsis, and last 2 segments
      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByLabelText("Show full path")).toBeDefined(); // The ellipsis button
      expect(screen.getByText("d")).toBeDefined();
      expect(screen.getByText("file.json")).toBeDefined();

      // Middle segments should be hidden
      expect(screen.queryByText("a")).toBeNull();
      expect(screen.queryByText("b")).toBeNull();
      expect(screen.queryByText("c")).toBeNull();
    });

    it("expands breadcrumb when ellipsis is clicked", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "a/b/c/d/file.json",
          currentFileContent: "{}",
        }),
      });

      // Click ellipsis to expand
      const ellipsisBtn = screen.getByLabelText("Show full path");
      fireEvent.click(ellipsisBtn);

      // All segments should now be visible
      expect(screen.getByText("a")).toBeDefined();
      expect(screen.getByText("b")).toBeDefined();
      expect(screen.getByText("c")).toBeDefined();
      expect(screen.getByText("d")).toBeDefined();
      expect(screen.getByText("file.json")).toBeDefined();

      // Ellipsis should be gone
      expect(screen.queryByLabelText("Show full path")).toBeNull();
    });
  });

  describe("truncation warning", () => {
    it("shows warning when file was truncated", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "large.json",
          currentFileContent: "{}",
          currentFileTruncated: true,
        }),
      });

      expect(screen.getByText(/This file was truncated/)).toBeDefined();
    });
  });

  describe("mobile menu button", () => {
    it("does not render mobile menu button when onMobileMenuClick is not provided", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      const menuBtn = screen.queryByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeNull();
    });

    it("renders mobile menu button when onMobileMenuClick is provided", () => {
      const handleClick = () => {};
      render(<JsonViewer onMobileMenuClick={handleClick} />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
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
      render(<JsonViewer onMobileMenuClick={handleClick} />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      expect(clicked).toBe(true);
    });
  });

  describe("adjust mode", () => {
    it("shows Adjust button in normal view", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      expect(screen.getByRole("button", { name: /adjust file/i })).toBeDefined();
    });

    it("shows Save and Cancel buttons in adjust mode", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      // Click Adjust to enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: /adjust file/i }));

      expect(screen.getByRole("button", { name: /save changes/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /cancel editing/i })).toBeDefined();
    });

    it("shows mobile menu button in adjust mode when prop is provided", () => {
      const handleClick = () => {};
      render(<JsonViewer onMobileMenuClick={handleClick} />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      // Click Adjust to enter adjust mode
      fireEvent.click(screen.getByRole("button", { name: /adjust file/i }));

      // Mobile menu button should still be visible
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeDefined();
    });
  });

  describe("delete button", () => {
    it("does not render delete button when onDelete is not provided", () => {
      render(<JsonViewer />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      const deleteBtn = screen.queryByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeNull();
    });

    it("renders delete button when onDelete is provided", () => {
      const handleDelete = () => {};
      render(<JsonViewer onDelete={handleDelete} />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
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
      render(<JsonViewer onDelete={handleDelete} />, {
        wrapper: createTestWrapper({
          currentPath: "test.json",
          currentFileContent: "{}",
        }),
      });

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      fireEvent.click(deleteBtn);

      expect(deleted).toBe(true);
    });
  });
});
