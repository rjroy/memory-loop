/**
 * Tests for BrowseMode search integration
 *
 * Tests search activation, query handling, results display, and state management.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowseMode } from "../BrowseMode";
import { SessionProvider } from "../../contexts/SessionContext";
import type { ServerMessage, ClientMessage, ContentSearchResult, ContextSnippet } from "@memory-loop/shared";

// Track WebSocket instances and messages
let wsInstances: MockWebSocket[] = [];
let sentMessages: ClientMessage[] = [];

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

const originalWebSocket = globalThis.WebSocket;

function TestWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

describe("BrowseMode Search Integration", () => {
  describe("search activation", () => {
    it("has search button in tree header", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      const searchBtn = screen.getByRole("button", { name: /search files/i });
      expect(searchBtn).toBeDefined();
    });

    it("shows SearchHeader when search button is clicked", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // SearchHeader should now be visible with input
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search file names/i)).toBeDefined();
      });
    });

    it("hides file/tasks header when search is active", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Initially shows "Files" header
      expect(screen.getByText("Files")).toBeDefined();

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // "Files" header should be replaced by search header
      // The desktop header should not have "Files" button visible
      const filesButtons = screen.queryAllByRole("button", { name: /switch to tasks view/i });
      // Only mobile header should have it (1 instead of 2)
      expect(filesButtons.length).toBeLessThan(2);
    });

    it("hides search button when tree is collapsed", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Initially has 2 search buttons (desktop + mobile)
      expect(screen.queryAllByRole("button", { name: /search files/i }).length).toBeGreaterThanOrEqual(1);

      // Collapse tree
      const collapseBtn = screen.getByRole("button", { name: /collapse file tree/i });
      fireEvent.click(collapseBtn);

      // Desktop search button should be hidden, but mobile menu can still be opened
      const searchBtns = screen.queryAllByRole("button", { name: /search files/i });
      expect(searchBtns.length).toBeLessThan(2);
    });
  });

  describe("search deactivation", () => {
    it("returns to FileTree when search is closed via dropdown", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // Search should be active
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search file names/i)).toBeDefined();
      });

      // Open dropdown menu and click Close Search
      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const closeItem = screen.getByRole("menuitem", { name: /close search/i });
      fireEvent.click(closeItem);

      // FileTree should be visible again
      await waitFor(() => {
        expect(screen.getByText("No files in vault")).toBeDefined();
      });
    });

    it("clears search when Escape is pressed in input", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const input = screen.getByPlaceholderText(/search file names/i);
      fireEvent.keyDown(input, { key: "Escape" });

      // FileTree should be visible again
      await waitFor(() => {
        expect(screen.getByText("No files in vault")).toBeDefined();
      });
    });
  });

  describe("search query handling", () => {
    it("sends search_files message when typing in files mode", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      sentMessages.length = 0;

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // Type in the search input
      const input = screen.getByPlaceholderText(/search file names/i);
      fireEvent.change(input, { target: { value: "test" } });

      // Wait for debounce (250ms)
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have sent search_files message
      const searchMsg = sentMessages.find((m) => m.type === "search_files");
      expect(searchMsg).toBeDefined();
      expect(searchMsg).toEqual({ type: "search_files", query: "test" });
    });

    it("sends search_content message when in content mode", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      sentMessages.length = 0;

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // Switch to content mode via dropdown
      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const modeItem = screen.getByRole("menuitem", { name: /switch to content search/i });
      fireEvent.click(modeItem);

      // Type in the search input
      const input = screen.getByPlaceholderText(/search content/i);
      fireEvent.change(input, { target: { value: "hello" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have sent search_content message
      const searchMsg = sentMessages.find((m) => m.type === "search_content");
      expect(searchMsg).toBeDefined();
      expect(searchMsg).toEqual({ type: "search_content", query: "hello" });
    });
  });

  describe("search results display", () => {
    it("displays file search results", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // Verify SearchHeader is now visible
      const input = screen.getByPlaceholderText(/search file names/i);
      expect(input).toBeDefined();

      // Enter query and wait for debounce
      await act(async () => {
        fireEvent.change(input, { target: { value: "test" } });
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Verify search message was sent
      const searchMsg = sentMessages.find((m) => m.type === "search_files");
      expect(searchMsg).toBeDefined();

      // Simulate search results using act to ensure state updates
      await act(async () => {
        ws.simulateMessage({
          type: "search_results",
          mode: "files",
          query: "test",
          results: [
            { path: "folder/test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] },
            { path: "another/testing.md", name: "testing.md", score: 90, matchPositions: [0, 1, 2, 3] },
          ],
          totalMatches: 2,
          searchTimeMs: 5,
        });
        // Allow state update to propagate
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Results should be displayed - use container text matching because filenames
      // are split across elements for highlighting (e.g. <mark>test</mark><span>.md</span>)
      await waitFor(() => {
        expect(screen.getByTestId("search-results")).toBeDefined();
        const fileResults = screen.getAllByTestId("file-result");
        expect(fileResults.length).toBe(2);
        // Check that both filenames are present in the results
        expect(fileResults[0].textContent).toContain("test.md");
        expect(fileResults[1].textContent).toContain("testing.md");
      }, { timeout: 2000 });
    });

    it("displays content search results with match count", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search and switch to content mode via dropdown
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const modeItem = screen.getByRole("menuitem", { name: /switch to content search/i });
      fireEvent.click(modeItem);

      const input = screen.getByPlaceholderText(/search content/i);
      fireEvent.change(input, { target: { value: "hello" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Simulate search results
      const contentResults: ContentSearchResult[] = [
        { path: "notes/hello.md", name: "hello.md", matchCount: 3 },
      ];
      ws.simulateMessage({
        type: "search_results",
        mode: "content",
        query: "hello",
        results: contentResults,
        totalMatches: 3,
        searchTimeMs: 10,
      });

      // Results should be displayed
      await waitFor(() => {
        expect(screen.getByText("hello.md")).toBeDefined();
        expect(screen.getByText("3 matches")).toBeDefined();
      });
    });

    it("shows empty state when no results found", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const input = screen.getByPlaceholderText(/search file names/i);
      fireEvent.change(input, { target: { value: "nonexistent" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Simulate empty results
      ws.simulateMessage({
        type: "search_results",
        mode: "files",
        query: "nonexistent",
        results: [],
        totalMatches: 0,
        searchTimeMs: 2,
      });

      // Empty state should be displayed
      await waitFor(() => {
        expect(screen.getByText(/no results for/i)).toBeDefined();
      });
    });
  });

  describe("file selection from results", () => {
    it("sends read_file message when file result is clicked", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const input = screen.getByPlaceholderText(/search file names/i);
      fireEvent.change(input, { target: { value: "test" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Simulate search results
      await act(async () => {
        ws.simulateMessage({
          type: "search_results",
          mode: "files",
          query: "test",
          results: [{ path: "folder/test.md", name: "test.md", score: 100, matchPositions: [0, 1, 2, 3] }],
          totalMatches: 1,
          searchTimeMs: 5,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Wait for results to render
      await waitFor(() => {
        const results = screen.getAllByTestId("file-result");
        expect(results.length).toBe(1);
        expect(results[0].textContent).toContain("test.md");
      });

      // Clear sent messages
      sentMessages.length = 0;

      // Click the result
      const result = screen.getByTestId("file-result");
      fireEvent.click(result);

      // Should have sent read_file message
      const readMsg = sentMessages.find((m) => m.type === "read_file");
      expect(readMsg).toBeDefined();
      expect(readMsg).toEqual({ type: "read_file", path: "folder/test.md" });
    });
  });

  describe("snippet expansion", () => {
    it("sends get_snippets message when content result is expanded", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search and switch to content mode via dropdown
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const modeItem = screen.getByRole("menuitem", { name: /switch to content search/i });
      fireEvent.click(modeItem);

      const input = screen.getByPlaceholderText(/search content/i);
      fireEvent.change(input, { target: { value: "hello" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Simulate search results
      ws.simulateMessage({
        type: "search_results",
        mode: "content",
        query: "hello",
        results: [{ path: "notes/hello.md", name: "hello.md", matchCount: 2 }],
        totalMatches: 2,
        searchTimeMs: 10,
      });

      // Wait for results to render
      await waitFor(() => {
        expect(screen.getByText("hello.md")).toBeDefined();
      });

      // Clear sent messages
      sentMessages.length = 0;

      // Click expand button
      const expandBtn = screen.getByTestId("expand-button");
      fireEvent.click(expandBtn);

      // Should have sent get_snippets message
      const snippetsMsg = sentMessages.find((m) => m.type === "get_snippets");
      expect(snippetsMsg).toBeDefined();
      expect(snippetsMsg).toEqual({ type: "get_snippets", path: "notes/hello.md", query: "hello" });
    });

    it("displays snippets when received from server", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));
      const ws = wsInstances[0];

      // Activate search and switch to content mode via dropdown
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const modeItem = screen.getByRole("menuitem", { name: /switch to content search/i });
      fireEvent.click(modeItem);

      const input = screen.getByPlaceholderText(/search content/i);
      fireEvent.change(input, { target: { value: "hello" } });

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Simulate search results
      await act(async () => {
        ws.simulateMessage({
          type: "search_results",
          mode: "content",
          query: "hello",
          results: [{ path: "notes/hello.md", name: "hello.md", matchCount: 1 }],
          totalMatches: 1,
          searchTimeMs: 10,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      await waitFor(() => {
        const results = screen.getAllByTestId("content-result");
        expect(results.length).toBe(1);
        expect(results[0].textContent).toContain("hello.md");
      });

      // Expand result
      const expandBtn = screen.getByTestId("expand-button");
      fireEvent.click(expandBtn);

      // Simulate snippets response
      const snippets: ContextSnippet[] = [
        {
          lineNumber: 5,
          line: "Say hello to the world!",
          contextBefore: ["Line 3", "Line 4"],
          contextAfter: ["Line 6", "Line 7"],
        },
      ];
      await act(async () => {
        ws.simulateMessage({
          type: "snippets",
          path: "notes/hello.md",
          snippets,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Snippets should be displayed - look for the line text in snippet context
      await waitFor(() => {
        const snippetLines = screen.getAllByTestId("snippet");
        expect(snippetLines.length).toBeGreaterThan(0);
        // Check that the matched line content is in the snippet
        const snippetContent = snippetLines[0].textContent;
        expect(snippetContent).toContain("Say hello to the world!");
      });
    });
  });

  describe("search in mobile overlay", () => {
    it("has search button in mobile tree overlay", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Open mobile tree
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      // Find search button in mobile tree
      const searchBtns = screen.getAllByRole("button", { name: /search files/i });
      expect(searchBtns.length).toBeGreaterThanOrEqual(1);
    });

    it("shows search header in mobile overlay when search is active", () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Activate search from desktop header
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      // Open mobile tree
      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      // Mobile overlay should show search header (input field)
      const inputs = screen.getAllByPlaceholderText(/search file names/i);
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("mode switch during search", () => {
    it("re-searches with current query when mode changes", async () => {
      render(<BrowseMode />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Activate search and enter query
      const searchBtn = screen.getByRole("button", { name: /search files/i });
      fireEvent.click(searchBtn);

      const input = screen.getByPlaceholderText(/search file names/i);
      fireEvent.change(input, { target: { value: "test" } });

      // Wait for initial search
      await new Promise((resolve) => setTimeout(resolve, 300));
      sentMessages.length = 0;

      // Switch to content mode via dropdown
      const menuTrigger = screen.getByRole("button", { name: /search options/i });
      fireEvent.click(menuTrigger);
      const modeItem = screen.getByRole("menuitem", { name: /switch to content search/i });
      fireEvent.click(modeItem);

      // Should immediately send search_content with existing query
      const searchMsg = sentMessages.find((m) => m.type === "search_content");
      expect(searchMsg).toBeDefined();
      expect(searchMsg).toEqual({ type: "search_content", query: "test" });
    });
  });
});
