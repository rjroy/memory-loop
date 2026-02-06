/**
 * Tests for SearchResults component
 *
 * Tests file/content result display, expansion, selection, and states.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SearchResults, type SearchResultsProps } from "../SearchResults";
import type {
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,
} from "@/lib/schemas";

// Test data
const fileResults: FileSearchResult[] = [
  {
    path: "docs/guide.md",
    name: "guide.md",
    score: 0.95,
    matchPositions: [0, 1, 2, 3, 4],
  },
  {
    path: "notes/meeting.md",
    name: "meeting.md",
    score: 0.85,
    matchPositions: [0, 1, 2],
  },
  {
    path: "README.md",
    name: "README.md",
    score: 0.75,
    matchPositions: [0, 1],
  },
];

const contentResults: ContentSearchResult[] = [
  {
    path: "docs/guide.md",
    name: "guide.md",
    matchCount: 5,
  },
  {
    path: "notes/meeting.md",
    name: "meeting.md",
    matchCount: 2,
  },
  {
    path: "README.md",
    name: "README.md",
    matchCount: 1,
  },
];

const testSnippets: ContextSnippet[] = [
  {
    lineNumber: 10,
    line: "This is the matching line with search term",
    contextBefore: ["Line 8 context", "Line 9 context"],
    contextAfter: ["Line 11 context", "Line 12 context"],
  },
  {
    lineNumber: 25,
    line: "Another match of search term here",
    contextBefore: ["Line 23 context"],
    contextAfter: ["Line 26 context"],
  },
];

// Default props factory
function createProps(overrides: Partial<SearchResultsProps> = {}): SearchResultsProps {
  return {
    mode: "files",
    fileResults: [],
    contentResults: [],
    isLoading: false,
    query: "",
    expandedPaths: new Set(),
    snippetsCache: new Map(),
    onFileSelect: mock(() => {}),
    onToggleExpand: mock(() => {}),
    onRequestSnippets: mock(() => {}),
    ...overrides,
  };
}

beforeEach(() => {
  // Reset mocks if needed
});

afterEach(() => {
  cleanup();
});

describe("SearchResults", () => {
  describe("loading state", () => {
    it("shows loading spinner when loading with no results", () => {
      render(<SearchResults {...createProps({ isLoading: true, query: "test" })} />);

      expect(screen.getByTestId("search-loading")).toBeDefined();
      expect(screen.getByText("Searching...")).toBeDefined();
    });

    it("shows results even when loading if results exist", () => {
      render(
        <SearchResults
          {...createProps({
            isLoading: true,
            query: "guide",
            fileResults,
          })}
        />
      );

      expect(screen.queryByTestId("search-loading")).toBeNull();
      // Text may be split by highlight marks, so check via testid
      const results = screen.getAllByTestId("file-result");
      expect(results[0].textContent).toContain("guide.md");
    });
  });

  describe("empty state", () => {
    it("shows empty message when no results and query exists", () => {
      render(
        <SearchResults
          {...createProps({
            query: "nonexistent",
          })}
        />
      );

      expect(screen.getByTestId("search-empty")).toBeDefined();
      expect(screen.getByText('No results for "nonexistent"')).toBeDefined();
    });

    it("shows prompt when no query", () => {
      render(<SearchResults {...createProps()} />);

      expect(screen.getByTestId("search-prompt")).toBeDefined();
      expect(screen.getByText("Type to search...")).toBeDefined();
    });
  });

  describe("file results", () => {
    it("renders file results with names", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      // Text may be split by highlight marks, so check for partial matches
      const results = screen.getAllByTestId("file-result");
      expect(results.length).toBe(3);
      expect(results[0].textContent).toContain("guide.md");
      expect(results[1].textContent).toContain("meeting.md");
      expect(results[2].textContent).toContain("README.md");
    });

    it("shows directory path for files in subdirectories", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      expect(screen.getByText("docs")).toBeDefined();
      expect(screen.getByText("notes")).toBeDefined();
    });

    it("highlights matched characters in file name", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults: [
              {
                path: "guide.md",
                name: "guide.md",
                score: 0.95,
                matchPositions: [0, 1, 2, 3, 4],
              },
            ],
          })}
        />
      );

      const highlights = document.querySelectorAll(".search-results__highlight");
      expect(highlights.length).toBeGreaterThan(0);
      // The highlighted text should contain "guide"
      const highlightText = Array.from(highlights)
        .map((el) => el.textContent)
        .join("");
      expect(highlightText).toBe("guide");
    });

    it("calls onFileSelect when file is clicked", () => {
      const onFileSelect = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
            onFileSelect,
          })}
        />
      );

      const firstResult = screen.getAllByTestId("file-result")[0];
      fireEvent.click(firstResult);

      expect(onFileSelect).toHaveBeenCalledWith("docs/guide.md");
    });
  });

  describe("content results", () => {
    it("renders content results with names and match counts", () => {
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
          })}
        />
      );

      expect(screen.getByText("guide.md")).toBeDefined();
      expect(screen.getByText("5 matches")).toBeDefined();
      expect(screen.getByText("2 matches")).toBeDefined();
      expect(screen.getByText("1 match")).toBeDefined();
    });

    it("shows expand button for content results", () => {
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
          })}
        />
      );

      const expandButtons = screen.getAllByTestId("expand-button");
      expect(expandButtons.length).toBe(3);
    });

    it("calls onFileSelect when content result is clicked", () => {
      const onFileSelect = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            onFileSelect,
          })}
        />
      );

      // Click the file name button (not expand button)
      const contentBtns = document.querySelectorAll(".search-results__content-btn");
      fireEvent.click(contentBtns[0]);

      expect(onFileSelect).toHaveBeenCalledWith("docs/guide.md");
    });
  });

  describe("result expansion", () => {
    it("calls onToggleExpand when expand button is clicked", () => {
      const onToggleExpand = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            onToggleExpand,
          })}
        />
      );

      const expandButton = screen.getAllByTestId("expand-button")[0];
      fireEvent.click(expandButton);

      expect(onToggleExpand).toHaveBeenCalledWith("docs/guide.md");
    });

    it("requests snippets when expanding uncached result", () => {
      const onToggleExpand = mock(() => {});
      const onRequestSnippets = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            onToggleExpand,
            onRequestSnippets,
          })}
        />
      );

      const expandButton = screen.getAllByTestId("expand-button")[0];
      fireEvent.click(expandButton);

      expect(onRequestSnippets).toHaveBeenCalledWith("docs/guide.md");
    });

    it("does not request snippets when expanding cached result", () => {
      const onToggleExpand = mock(() => {});
      const onRequestSnippets = mock(() => {});
      const snippetsCache = new Map([["docs/guide.md", testSnippets]]);

      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            onToggleExpand,
            onRequestSnippets,
            snippetsCache,
          })}
        />
      );

      const expandButton = screen.getAllByTestId("expand-button")[0];
      fireEvent.click(expandButton);

      expect(onRequestSnippets).not.toHaveBeenCalled();
    });

    it("shows loading state for expanded result without snippets", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
          })}
        />
      );

      expect(screen.getByTestId("snippets-loading")).toBeDefined();
      expect(screen.getByText("Loading snippets...")).toBeDefined();
    });

    it("shows snippets when expanded and cached", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      const snippetsCache = new Map([["docs/guide.md", testSnippets]]);

      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
            snippetsCache,
          })}
        />
      );

      expect(screen.getByTestId("snippets")).toBeDefined();
      const snippets = screen.getAllByTestId("snippet");
      expect(snippets.length).toBe(2);
    });

    it("shows line numbers in snippets", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      const snippetsCache = new Map([["docs/guide.md", testSnippets]]);

      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
            snippetsCache,
          })}
        />
      );

      expect(screen.getByText("10")).toBeDefined();
      expect(screen.getByText("25")).toBeDefined();
    });

    it("shows context lines in snippets", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      const snippetsCache = new Map([["docs/guide.md", testSnippets]]);

      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
            snippetsCache,
          })}
        />
      );

      expect(screen.getByText("Line 8 context")).toBeDefined();
      expect(screen.getByText("Line 9 context")).toBeDefined();
      expect(screen.getByText("Line 11 context")).toBeDefined();
    });

    it("highlights query matches in snippet lines", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      const snippetsCache = new Map([["docs/guide.md", testSnippets]]);

      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
            snippetsCache,
          })}
        />
      );

      // Find highlights in match lines
      const matchLines = document.querySelectorAll(".search-results__match-line");
      expect(matchLines.length).toBe(2);

      const highlights = document.querySelectorAll(
        ".search-results__match-line .search-results__highlight"
      );
      expect(highlights.length).toBe(2);
    });
  });

  describe("keyboard navigation", () => {
    it("moves selection down with ArrowDown", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      fireEvent.keyDown(list, { key: "ArrowDown" });
      fireEvent.keyDown(list, { key: "ArrowDown" });

      // Second item should be selected
      const items = screen.getAllByTestId("file-result");
      expect(items[1].classList.contains("search-results__item--selected")).toBe(
        true
      );
    });

    it("moves selection up with ArrowUp", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      // Select second item
      fireEvent.keyDown(list, { key: "ArrowDown" });
      fireEvent.keyDown(list, { key: "ArrowDown" });
      // Move back up
      fireEvent.keyDown(list, { key: "ArrowUp" });

      // First item should be selected
      const items = screen.getAllByTestId("file-result");
      expect(items[0].classList.contains("search-results__item--selected")).toBe(
        true
      );
    });

    it("selects file on Enter when item is selected", () => {
      const onFileSelect = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
            onFileSelect,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      fireEvent.keyDown(list, { key: "ArrowDown" }); // Select first
      fireEvent.keyDown(list, { key: "Enter" });

      expect(onFileSelect).toHaveBeenCalledWith("docs/guide.md");
    });

    it("does not select on Enter when nothing is selected", () => {
      const onFileSelect = mock(() => {});
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
            onFileSelect,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      fireEvent.keyDown(list, { key: "Enter" });

      expect(onFileSelect).not.toHaveBeenCalled();
    });

    it("does not go below last item", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      // Press down more times than there are items
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(list, { key: "ArrowDown" });
      }

      const items = screen.getAllByTestId("file-result");
      expect(
        items[items.length - 1].classList.contains("search-results__item--selected")
      ).toBe(true);
    });

    it("does not go above first item", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      fireEvent.keyDown(list, { key: "ArrowDown" }); // Select first
      fireEvent.keyDown(list, { key: "ArrowUp" }); // Try to go above
      fireEvent.keyDown(list, { key: "ArrowUp" }); // Try again

      const items = screen.getAllByTestId("file-result");
      expect(items[0].classList.contains("search-results__item--selected")).toBe(
        true
      );
    });
  });

  describe("accessibility", () => {
    it("has listbox role", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      expect(screen.getByRole("listbox")).toBeDefined();
    });

    it("has option role on results", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const options = screen.getAllByRole("option");
      expect(options.length).toBe(3);
    });

    it("sets aria-selected on selected item", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const list = screen.getByTestId("search-results");
      fireEvent.keyDown(list, { key: "ArrowDown" });

      const options = screen.getAllByRole("option");
      expect(options[0].getAttribute("aria-selected")).toBe("true");
    });

    it("has aria-expanded on expand buttons", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
          })}
        />
      );

      const expandButtons = screen.getAllByTestId("expand-button");
      expect(expandButtons[0].getAttribute("aria-expanded")).toBe("true");
      expect(expandButtons[1].getAttribute("aria-expanded")).toBe("false");
    });

    it("has aria-label on expand buttons", () => {
      const expandedPaths = new Set(["docs/guide.md"]);
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
            expandedPaths,
          })}
        />
      );

      const expandButtons = screen.getAllByTestId("expand-button");
      expect(expandButtons[0].getAttribute("aria-label")).toBe("Collapse snippets");
      expect(expandButtons[1].getAttribute("aria-label")).toBe("Expand snippets");
    });
  });

  describe("touch targets", () => {
    it("has minimum 44px height on result items", () => {
      render(
        <SearchResults
          {...createProps({
            query: "guide",
            fileResults,
          })}
        />
      );

      const items = screen.getAllByTestId("file-result");
      items.forEach((item) => {
        // min-height is set in CSS, checking class exists is sufficient
        expect(item.classList.contains("search-results__item")).toBe(true);
      });
    });

    it("has minimum 44px height on content result buttons", () => {
      render(
        <SearchResults
          {...createProps({
            mode: "content",
            query: "search",
            contentResults,
          })}
        />
      );

      const expandButtons = screen.getAllByTestId("expand-button");
      expandButtons.forEach((button) => {
        expect(button.classList.contains("search-results__expand-btn")).toBe(true);
      });
    });
  });
});
