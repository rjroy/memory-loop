/**
 * useHome Hook Tests
 *
 * Tests for the home dashboard REST API hook.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useHome } from "../useHome.js";
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

describe("useHome", () => {
  const mockVaultId = "test-vault-123";

  describe("initial state", () => {
    it("starts with isLoading false", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));
      expect(result.current.error).toBeNull();
    });
  });

  describe("getGoals", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(undefined, { fetch: mockFetch }));

      let goals: unknown;
      await act(async () => {
        goals = await result.current.getGoals();
      });

      expect(goals).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches goals from correct endpoint", async () => {
      const goalsContent = "# Goals\n\n- Complete project\n- Learn new skill";

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: goalsContent }),
        } as Response);
      };

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let goals: unknown;
      await act(async () => {
        goals = await result.current.getGoals();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/goals`);
      expect(goals).toBe(goalsContent);
    });

    it("returns null content when goals file does not exist", async () => {
      const mockFetch = createMockFetch({ content: null });
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let goals: unknown;
      await act(async () => {
        goals = await result.current.getGoals();
      });

      expect(goals).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Failed to read goals", 500);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let goals: unknown;
      await act(async () => {
        goals = await result.current.getGoals();
      });

      expect(goals).toBeNull();
      expect(result.current.error).toBe("Failed to read goals");
    });
  });

  describe("getInspiration", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(undefined, { fetch: mockFetch }));

      let inspiration: unknown;
      await act(async () => {
        inspiration = await result.current.getInspiration();
      });

      expect(inspiration).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches inspiration from correct endpoint", async () => {
      const mockInspiration = {
        contextual: { text: "What inspired you today?", attribution: undefined },
        quote: { text: "The journey is the reward.", attribution: "Steve Jobs" },
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockInspiration),
        } as Response);
      };

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let inspiration: unknown;
      await act(async () => {
        inspiration = await result.current.getInspiration();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/inspiration`);
      expect(inspiration).toEqual(mockInspiration);
    });

    it("handles null contextual inspiration", async () => {
      const mockInspiration = {
        contextual: null,
        quote: { text: "Default quote", attribution: "Unknown" },
      };
      const mockFetch = createMockFetch(mockInspiration);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let inspiration: unknown;
      await act(async () => {
        inspiration = await result.current.getInspiration();
      });

      expect(inspiration).toEqual(mockInspiration);
    });
  });

  describe("getTasks", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(undefined, { fetch: mockFetch }));

      let tasks: unknown;
      await act(async () => {
        tasks = await result.current.getTasks();
      });

      expect(tasks).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches tasks from correct endpoint", async () => {
      const mockTasks = {
        tasks: [
          {
            text: "Complete task",
            state: " ",
            filePath: "00_Inbox/2026-01-22.md",
            lineNumber: 5,
            fileMtime: 1737590400000,
            category: "inbox",
          },
        ],
        incomplete: 1,
        total: 1,
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTasks),
        } as Response);
      };

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let tasks: unknown;
      await act(async () => {
        tasks = await result.current.getTasks();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/tasks`);
      expect(tasks).toEqual(mockTasks);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Failed to load tasks", 500);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let tasks: unknown;
      await act(async () => {
        tasks = await result.current.getTasks();
      });

      expect(tasks).toBeNull();
      expect(result.current.error).toBe("Failed to load tasks");
    });
  });

  describe("toggleTask", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(undefined, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("file.md", 5);
      });

      expect(toggleResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if filePath is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("", 5);
      });

      expect(toggleResult).toBeNull();
      expect(result.current.error).toBe("File path is required");
    });

    it("returns null if lineNumber is less than 1", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("file.md", 0);
      });

      expect(toggleResult).toBeNull();
      expect(result.current.error).toBe("Line number must be at least 1");
    });

    it("sends PATCH to correct endpoint without newState", async () => {
      const mockResponse = {
        filePath: "00_Inbox/2026-01-22.md",
        lineNumber: 5,
        newState: "x",
      };

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;
      const mockFetch: FetchFn = (url, options) => {
        capturedUrl = url as string;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response);
      };

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("00_Inbox/2026-01-22.md", 5);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/tasks`);
      expect(capturedOptions?.method).toBe("PATCH");
      expect(JSON.parse(capturedOptions?.body as string)).toEqual({
        filePath: "00_Inbox/2026-01-22.md",
        lineNumber: 5,
      });
      expect(toggleResult).toEqual(mockResponse);
    });

    it("sends PATCH with newState when provided", async () => {
      const mockResponse = {
        filePath: "file.md",
        lineNumber: 10,
        newState: "/",
      };

      let capturedOptions: RequestInit | undefined;
      const mockFetch: FetchFn = (_url, options) => {
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response);
      };

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.toggleTask("file.md", 10, "/");
      });

      expect(JSON.parse(capturedOptions?.body as string)).toEqual({
        filePath: "file.md",
        lineNumber: 10,
        newState: "/",
      });
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("FILE_NOT_FOUND", "File not found", 404);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("missing.md", 5);
      });

      expect(toggleResult).toBeNull();
      expect(result.current.error).toBe("File not found");
    });

    it("sets error on path traversal attempt", async () => {
      const mockFetch = createErrorFetch("PATH_TRAVERSAL", "Path outside vault root", 403);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      let toggleResult: unknown;
      await act(async () => {
        toggleResult = await result.current.toggleTask("../etc/passwd", 1);
      });

      expect(toggleResult).toBeNull();
      expect(result.current.error).toBe("Path outside vault root");
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      const mockFetch = createErrorFetch("VALIDATION_ERROR", "Test error", 400);
      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.getGoals();
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

      const { result } = renderHook(() => useHome(mockVaultId, { fetch: mockFetch }));

      expect(result.current.isLoading).toBe(false);

      let goalsPromise: Promise<unknown>;
      act(() => {
        goalsPromise = result.current.getGoals();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: "# Goals" }),
        } as Response);
        await goalsPromise;
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
          json: () => Promise.resolve({ content: "# Goals" }),
        } as Response);
      };

      const { result, rerender } = renderHook(
        ({ vaultId }) => useHome(vaultId, { fetch: mockFetch }),
        { initialProps: { vaultId: "vault-1" } }
      );

      await act(async () => {
        await result.current.getGoals();
      });

      expect(capturedUrls[0]).toContain("vault-1");

      rerender({ vaultId: "vault-2" });

      await act(async () => {
        await result.current.getGoals();
      });

      expect(capturedUrls[1]).toContain("vault-2");
    });
  });
});
