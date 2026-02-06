/**
 * useCapture Hook Tests
 *
 * Tests for the note capture REST API hook.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useCapture } from "../useCapture.js";
import type { FetchFn } from "@/lib/api/types";

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

describe("useCapture", () => {
  const mockVaultId = "test-vault-123";

  describe("initial state", () => {
    it("starts with isLoading false", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));
      expect(result.current.error).toBeNull();
    });
  });

  describe("captureNote", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(undefined, { fetch: mockFetch }));

      let captureResult: unknown;
      await act(async () => {
        captureResult = await result.current.captureNote("test note");
      });

      expect(captureResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if text is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let captureResult: unknown;
      await act(async () => {
        captureResult = await result.current.captureNote("");
      });

      expect(captureResult).toBeNull();
      expect(result.current.error).toBe("Note text is required");
    });

    it("sets isLoading during capture", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      expect(result.current.isLoading).toBe(false);

      let capturePromise: Promise<unknown>;
      act(() => {
        capturePromise = result.current.captureNote("test note");
      });

      // Should be loading now
      expect(result.current.isLoading).toBe(true);

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              timestamp: "12:34",
              notePath: "00_Inbox/2026-01-22.md",
            }),
        } as Response);
        await capturePromise;
      });

      // Should be done loading
      expect(result.current.isLoading).toBe(false);
    });

    it("posts to correct endpoint and returns result on success", async () => {
      const expectedResponse = {
        success: true,
        timestamp: "12:34",
        notePath: "00_Inbox/2026-01-22.md",
      };

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;
      const mockFetch: FetchFn = (url, options) => {
        capturedUrl = url as string;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(expectedResponse),
        } as Response);
      };

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let captureResult: unknown;
      await act(async () => {
        captureResult = await result.current.captureNote("my test note");
      });

      // Verify endpoint and request
      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/capture`);
      expect(capturedOptions?.method).toBe("POST");
      expect(JSON.parse(capturedOptions?.body as string)).toEqual({ text: "my test note" });

      // Verify response
      expect(captureResult).toEqual(expectedResponse);
      expect(result.current.error).toBeNull();
    });

    it("sets error on API error response", async () => {
      const mockFetch = createErrorFetch("NOTE_CAPTURE_FAILED", "Failed to capture note", 500);
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let captureResult: unknown;
      await act(async () => {
        captureResult = await result.current.captureNote("test note");
      });

      expect(captureResult).toBeNull();
      expect(result.current.error).toBe("Failed to capture note");
    });

    it("sets error on network failure", async () => {
      const mockFetch: FetchFn = () => {
        return Promise.reject(new Error("Network error"));
      };

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let captureResult: unknown;
      await act(async () => {
        captureResult = await result.current.captureNote("test note");
      });

      expect(captureResult).toBeNull();
      expect(result.current.error).toBe("Network error");
    });
  });

  describe("getRecentNotes", () => {
    it("returns empty array if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(undefined, { fetch: mockFetch }));

      let notes: unknown[];
      await act(async () => {
        notes = await result.current.getRecentNotes();
      });

      expect(notes!).toEqual([]);
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches recent notes from correct endpoint", async () => {
      const mockNotes = [
        { id: "1", text: "First note", time: "12:30", date: "2026-01-22" },
        { id: "2", text: "Second note", time: "12:31", date: "2026-01-22" },
      ];

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ notes: mockNotes }),
        } as Response);
      };

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let notes: unknown[];
      await act(async () => {
        notes = await result.current.getRecentNotes();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/recent-notes`);
      expect(notes!).toEqual(mockNotes);
    });

    it("includes limit parameter when provided", async () => {
      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ notes: [] }),
        } as Response);
      };

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.getRecentNotes(10);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/recent-notes?limit=10`);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Database error", 500);
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let notes: unknown[];
      await act(async () => {
        notes = await result.current.getRecentNotes();
      });

      expect(notes!).toEqual([]);
      expect(result.current.error).toBe("Database error");
    });
  });

  describe("getRecentActivity", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCapture(undefined, { fetch: mockFetch }));

      let activity: unknown;
      await act(async () => {
        activity = await result.current.getRecentActivity();
      });

      expect(activity).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches recent activity from correct endpoint", async () => {
      const mockActivity = {
        captures: [{ id: "1", text: "Note", time: "12:30", date: "2026-01-22" }],
        discussions: [
          {
            sessionId: "sess-1",
            preview: "Test discussion",
            time: "12:31",
            date: "2026-01-22",
            messageCount: 5,
          },
        ],
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockActivity),
        } as Response);
      };

      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let activity: unknown;
      await act(async () => {
        activity = await result.current.getRecentActivity();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/recent-activity`);
      expect(activity).toEqual(mockActivity);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Failed to load activity", 500);
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      let activity: unknown;
      await act(async () => {
        activity = await result.current.getRecentActivity();
      });

      expect(activity).toBeNull();
      expect(result.current.error).toBe("Failed to load activity");
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      const mockFetch = createErrorFetch("VALIDATION_ERROR", "Test error", 400);
      const { result } = renderHook(() => useCapture(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.captureNote("test");
      });

      expect(result.current.error).toBe("Test error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
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
          json: () =>
            Promise.resolve({
              success: true,
              timestamp: "12:34",
              notePath: "00_Inbox/2026-01-22.md",
            }),
        } as Response);
      };

      const { result, rerender } = renderHook(
        ({ vaultId }) => useCapture(vaultId, { fetch: mockFetch }),
        { initialProps: { vaultId: "vault-1" } }
      );

      await act(async () => {
        await result.current.captureNote("note 1");
      });

      expect(capturedUrls[0]).toContain("vault-1");

      rerender({ vaultId: "vault-2" });

      await act(async () => {
        await result.current.captureNote("note 2");
      });

      expect(capturedUrls[1]).toContain("vault-2");
    });
  });
});
