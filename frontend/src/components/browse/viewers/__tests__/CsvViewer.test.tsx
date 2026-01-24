/**
 * Tests for CsvViewer component
 *
 * Tests CSV/TSV parsing, table rendering, edge cases,
 * and various component states.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { CsvViewer } from "../CsvViewer";
import { SessionProvider, useSession } from "../../../../contexts/SessionContext";

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

describe("CsvViewer", () => {
  describe("empty state", () => {
    it("shows empty message when no file is selected", () => {
      render(<CsvViewer />, { wrapper: createTestWrapper() });

      expect(screen.getByText("Select a file to view its content")).toBeDefined();
    });

    it("shows empty message for empty CSV content", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "",
        }),
      });

      expect(screen.getByText("This file appears to be empty.")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("shows loading skeleton when loading", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({ isLoading: true, currentPath: "test.csv" }),
      });

      expect(screen.getByLabelText("Loading content")).toBeDefined();
    });
  });

  describe("error state", () => {
    it("shows error message on file error", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "missing.csv",
          fileError: "File not found",
        }),
      });

      expect(screen.getByText("File not found")).toBeDefined();
    });
  });

  describe("basic CSV rendering", () => {
    it("renders simple CSV as table", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "Name,Age,City\nAlice,30,NYC\nBob,25,LA",
        }),
      });

      // Check headers
      expect(screen.getByText("Name")).toBeDefined();
      expect(screen.getByText("Age")).toBeDefined();
      expect(screen.getByText("City")).toBeDefined();

      // Check data
      expect(screen.getByText("Alice")).toBeDefined();
      expect(screen.getByText("30")).toBeDefined();
      expect(screen.getByText("NYC")).toBeDefined();
      expect(screen.getByText("Bob")).toBeDefined();
      expect(screen.getByText("25")).toBeDefined();
      expect(screen.getByText("LA")).toBeDefined();
    });

    it("renders CSV with CRLF line endings", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B\r\n1,2\r\n3,4",
        }),
      });

      expect(screen.getByText("A")).toBeDefined();
      expect(screen.getByText("B")).toBeDefined();
      expect(screen.getByText("1")).toBeDefined();
      expect(screen.getByText("4")).toBeDefined();
    });
  });

  describe("TSV rendering", () => {
    it("renders TSV files with tab delimiter", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.tsv",
          currentFileContent: "Name\tValue\nfoo\tbar",
        }),
      });

      expect(screen.getByText("Name")).toBeDefined();
      expect(screen.getByText("Value")).toBeDefined();
      expect(screen.getByText("foo")).toBeDefined();
      expect(screen.getByText("bar")).toBeDefined();
    });
  });

  describe("quoted fields", () => {
    it("handles quoted fields with commas", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: 'Name,Address\nJohn,"123 Main St, Apt 4"',
        }),
      });

      expect(screen.getByText("Name")).toBeDefined();
      expect(screen.getByText("Address")).toBeDefined();
      expect(screen.getByText("John")).toBeDefined();
      expect(screen.getByText("123 Main St, Apt 4")).toBeDefined();
    });

    it("handles escaped quotes (doubled quotes)", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: 'Quote\n"He said ""hello"""',
        }),
      });

      expect(screen.getByText("Quote")).toBeDefined();
      expect(screen.getByText('He said "hello"')).toBeDefined();
    });

    it("handles quoted fields with newlines", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: 'Text\n"Line 1\nLine 2"',
        }),
      });

      expect(screen.getByText("Text")).toBeDefined();
      // Multi-line content is in a single cell
      const cells = screen.getAllByRole("cell");
      expect(cells[0].textContent).toBe("Line 1\nLine 2");
    });
  });

  describe("empty cells", () => {
    it("handles empty cells in middle of row", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B,C\n1,,3",
        }),
      });

      const cells = screen.getAllByRole("cell");
      expect(cells[0].textContent).toBe("1");
      expect(cells[1].textContent).toBe("");
      expect(cells[2].textContent).toBe("3");
    });

    it("handles trailing empty cells", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B,C\n1,2,",
        }),
      });

      const cells = screen.getAllByRole("cell");
      expect(cells[0].textContent).toBe("1");
      expect(cells[1].textContent).toBe("2");
      expect(cells[2].textContent).toBe("");
    });
  });

  describe("inconsistent column counts", () => {
    it("pads shorter rows and shows warning", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B,C\n1\n4,5,6",
        }),
      });

      // Check warning is shown
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/1 row had inconsistent column counts/)).toBeDefined();

      // Check row is padded
      const cells = screen.getAllByRole("cell");
      expect(cells.length).toBe(6); // 2 rows x 3 columns
    });

    it("shows plural warning for multiple inconsistent rows", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B,C\n1\n2\n4,5,6",
        }),
      });

      expect(screen.getByText(/2 rows had inconsistent column counts/)).toBeDefined();
    });
  });

  describe("malformed CSV", () => {
    it("shows raw content with warning for unclosed quote", () => {
      const malformedContent = 'Name\n"unclosed quote';

      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: malformedContent,
        }),
      });

      expect(screen.getByText(/Unclosed quote detected/)).toBeDefined();
      // Raw content is displayed in a <pre> element
      const preElement = document.querySelector(".csv-viewer__raw-content pre");
      expect(preElement?.textContent).toBe(malformedContent);
    });
  });

  describe("UTF-8 BOM handling", () => {
    it("strips UTF-8 BOM from content", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "\uFEFFName,Value\nfoo,bar",
        }),
      });

      expect(screen.getByText("Name")).toBeDefined();
      expect(screen.getByText("Value")).toBeDefined();
    });
  });

  describe("truncation warning", () => {
    it("shows warning when file was truncated", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B\n1,2",
          currentFileTruncated: true,
        }),
      });

      expect(screen.getByText(/This file was truncated/)).toBeDefined();
    });
  });

  describe("breadcrumb navigation", () => {
    it("renders breadcrumb for file path", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "exports/data.csv",
          currentFileContent: "A\n1",
        }),
      });

      expect(screen.getByText("Root")).toBeDefined();
      expect(screen.getByText("exports")).toBeDefined();
      expect(screen.getByText("data.csv")).toBeDefined();
    });

    it("calls onNavigate when breadcrumb is clicked", () => {
      let navigatedPath: string | undefined;
      const handleNavigate = (path: string) => {
        navigatedPath = path;
      };

      render(<CsvViewer onNavigate={handleNavigate} />, {
        wrapper: createTestWrapper({
          currentPath: "exports/data.csv",
          currentFileContent: "A\n1",
        }),
      });

      fireEvent.click(screen.getByText("Root"));
      // The component calls setCurrentPath("") and onNavigate("")
      expect(navigatedPath).toBe("");
    });
  });

  describe("table structure", () => {
    it("renders proper table with thead and tbody", () => {
      render(<CsvViewer />, {
        wrapper: createTestWrapper({
          currentPath: "data.csv",
          currentFileContent: "A,B\n1,2",
        }),
      });

      const table = screen.getByRole("table");
      expect(table).toBeDefined();

      const headers = screen.getAllByRole("columnheader");
      expect(headers.length).toBe(2);

      const cells = screen.getAllByRole("cell");
      expect(cells.length).toBe(2);
    });
  });
});
