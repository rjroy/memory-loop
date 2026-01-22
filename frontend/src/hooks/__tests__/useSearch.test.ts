/**
 * useSearch Hook Tests
 *
 * Tests for the search REST API hook.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "../useSearch.js";
import type { FetchFn } from "../../api/types.js";

/**
 * Creates a mock fetch function that returns a successful response.
 */
function createMockFetch(responseData: unknown, options: { ok?: boolean; status?: number } = {}): FetchFn {
  const { ok = true, status = 200 } = options;
  return () =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(responseData),
    } as Response);
}

/**
 * Creates a mock fetch that returns an error response.
 */
function createErrorFetch(code: string, message: string, status = 400): FetchFn {
  return () =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: { code, message } }),
    } as Response);
}

describe("useSearch", () => {
  const mockVaultId = "test-vault-123";

  describe("initial state", () => {
    it("starts with isLoading false", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));
      expect(result.current.error).toBeNull();
    });
  });

  describe("searchFiles", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(undefined, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchFiles("test");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if query is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchFiles("");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("Search query is required");
    });

    it("returns null if query is whitespace only", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchFiles("   ");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("Search query is required");
    });

    it("fetches from correct endpoint with query", async () => {
      const mockResults = {
        results: [
          { path: "notes/readme.md", name: "readme.md", score: 100, matchPositions: [0, 1, 2] },
        ],
        totalMatches: 1,
        searchTimeMs: 15,
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResults),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchFiles("readme");
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/search/files?q=readme`);
      expect(searchResult).toEqual(mockResults);
    });

    it("includes limit parameter when provided", async () => {
      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], totalMatches: 0, searchTimeMs: 5 }),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.searchFiles("test", 20);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/search/files?q=test&limit=20`);
    });

    it("encodes query parameter correctly", async () => {
      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], totalMatches: 0, searchTimeMs: 5 }),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.searchFiles("test file.md");
      });

      // URLSearchParams handles encoding
      expect(capturedUrl).toContain("q=test+file.md");
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Search index unavailable", 500);
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchFiles("test");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("Search index unavailable");
    });
  });

  describe("searchContent", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(undefined, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchContent("test");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if query is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchContent("");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("Search query is required");
    });

    it("fetches from correct endpoint with query", async () => {
      const mockResults = {
        results: [
          { path: "notes/meeting.md", name: "meeting.md", matchCount: 3 },
        ],
        totalMatches: 1,
        searchTimeMs: 25,
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResults),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchContent("agenda");
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/search/content?q=agenda`);
      expect(searchResult).toEqual(mockResults);
    });

    it("includes limit parameter when provided", async () => {
      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], totalMatches: 0, searchTimeMs: 5 }),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.searchContent("TODO", 50);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/search/content?q=TODO&limit=50`);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Content indexing failed", 500);
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let searchResult: unknown;
      await act(async () => {
        searchResult = await result.current.searchContent("test");
      });

      expect(searchResult).toBeNull();
      expect(result.current.error).toBe("Content indexing failed");
    });
  });

  describe("getSnippets", () => {
    it("returns empty array if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(undefined, { fetch: mockFetch }));

      let snippets: unknown[];
      await act(async () => {
        snippets = await result.current.getSnippets("file.md", "test");
      });

      expect(snippets!).toEqual([]);
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns empty array if path is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let snippets: unknown[];
      await act(async () => {
        snippets = await result.current.getSnippets("", "test");
      });

      expect(snippets!).toEqual([]);
      expect(result.current.error).toBe("File path is required");
    });

    it("returns empty array if query is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let snippets: unknown[];
      await act(async () => {
        snippets = await result.current.getSnippets("file.md", "");
      });

      expect(snippets!).toEqual([]);
      expect(result.current.error).toBe("Search query is required");
    });

    it("fetches from correct endpoint with path and query", async () => {
      const mockSnippets = [
        {
          lineNumber: 10,
          line: "This is a test line",
          contextBefore: ["Line 8", "Line 9"],
          contextAfter: ["Line 11", "Line 12"],
        },
      ];

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ path: "notes/file.md", snippets: mockSnippets }),
        } as Response);
      };

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let snippets: unknown[];
      await act(async () => {
        snippets = await result.current.getSnippets("notes/file.md", "test");
      });

      expect(capturedUrl).toBe(
        `/api/vaults/${mockVaultId}/search/snippets?path=notes%2Ffile.md&q=test`
      );
      expect(snippets!).toEqual(mockSnippets);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("FILE_NOT_FOUND", "File not found", 404);
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      let snippets: unknown[];
      await act(async () => {
        snippets = await result.current.getSnippets("missing.md", "test");
      });

      expect(snippets!).toEqual([]);
      expect(result.current.error).toBe("File not found");
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      const mockFetch = createErrorFetch("VALIDATION_ERROR", "Test error", 400);
      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.searchFiles("test");
      });

      expect(result.current.error).toBe("Test error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("loading state", () => {
    it("sets isLoading during operations", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useSearch(mockVaultId, { fetch: mockFetch }));

      expect(result.current.isLoading).toBe(false);

      let searchPromise: Promise<unknown>;
      act(() => {
        searchPromise = result.current.searchFiles("test");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], totalMatches: 0, searchTimeMs: 5 }),
        } as Response);
        await searchPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("vaultId changes", () => {
    it("uses updated vaultId for operations", async () => {
      const capturedUrls: string[] = [];
      const mockFetch: FetchFn = (url) => {
        capturedUrls.push(url as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], totalMatches: 0, searchTimeMs: 5 }),
        } as Response);
      };

      const { result, rerender } = renderHook(
        ({ vaultId }) => useSearch(vaultId, { fetch: mockFetch }),
        { initialProps: { vaultId: "vault-1" } }
      );

      await act(async () => {
        await result.current.searchFiles("test");
      });

      expect(capturedUrls[0]).toContain("vault-1");

      rerender({ vaultId: "vault-2" });

      await act(async () => {
        await result.current.searchFiles("test");
      });

      expect(capturedUrls[1]).toContain("vault-2");
    });
  });
});
