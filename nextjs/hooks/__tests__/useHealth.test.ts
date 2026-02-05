/**
 * useHealth Hook Tests
 *
 * Tests for the health issues REST API hook.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHealth } from "../useHealth.js";
import type { FetchFn } from "../@/lib/api/types";
import type { HealthIssue } from "@memory-loop/shared";

/**
 * Creates a mock fetch function that returns health issues.
 */
function createMockFetch(issues: HealthIssue[] = []): FetchFn {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issues }),
    } as Response);
}

/**
 * Creates a mock fetch that returns an error response.
 */
function createErrorFetch(code: string, message: string, status = 500): FetchFn {
  return () =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: { code, message } }),
    } as Response);
}

/**
 * Creates a test health issue.
 */
function createTestIssue(overrides: Partial<HealthIssue> = {}): HealthIssue {
  return {
    id: "test-issue-1",
    severity: "error",
    category: "vault_config",
    message: "Test error message",
    timestamp: new Date().toISOString(),
    dismissible: true,
    ...overrides,
  };
}

describe("useHealth", () => {
  const mockVaultId = "test-vault-123";

  describe("initial state", () => {
    it("starts with empty issues", () => {
      const mockFetch = createMockFetch([]);
      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );
      expect(result.current.issues).toEqual([]);
    });

    it("starts with isLoading false when no vaultId", () => {
      const mockFetch = createMockFetch([]);
      const { result } = renderHook(() =>
        useHealth(null, { fetch: mockFetch, disablePolling: true })
      );
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const mockFetch = createMockFetch([]);
      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );
      expect(result.current.error).toBeNull();
    });
  });

  describe("fetching health issues", () => {
    it("fetches issues when vaultId is provided", async () => {
      const testIssues = [createTestIssue({ id: "issue-1", message: "First error" })];
      const mockFetch = createMockFetch(testIssues);

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.issues).toEqual(testIssues);
      });
    });

    it("does not fetch when vaultId is null", async () => {
      let fetchCalled = false;
      const mockFetch: FetchFn = () => {
        fetchCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues: [] }),
        } as Response);
      };

      const { result } = renderHook(() =>
        useHealth(null, { fetch: mockFetch, disablePolling: true })
      );

      // Wait a tick to ensure no fetch was triggered
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchCalled).toBe(false);
      expect(result.current.issues).toEqual([]);
    });

    it("does not fetch when vaultId is undefined", async () => {
      let fetchCalled = false;
      const mockFetch: FetchFn = () => {
        fetchCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues: [] }),
        } as Response);
      };

      const { result } = renderHook(() =>
        useHealth(undefined, { fetch: mockFetch, disablePolling: true })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(fetchCalled).toBe(false);
      expect(result.current.issues).toEqual([]);
    });

    it("sets error on fetch failure", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Server error");

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.error).toBe("Server error");
      });
    });

    it("clears error on successful fetch", async () => {
      const mockFetch = createMockFetch([createTestIssue()]);

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.error).toBeNull();
        expect(result.current.issues.length).toBe(1);
      });
    });
  });

  describe("refresh", () => {
    it("provides a refresh function", () => {
      const mockFetch = createMockFetch([]);
      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );
      expect(typeof result.current.refresh).toBe("function");
    });

    it("refresh fetches new issues", async () => {
      let callCount = 0;
      const mockFetch: FetchFn = () => {
        callCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              issues: [createTestIssue({ id: `issue-${callCount}` })],
            }),
        } as Response);
      };

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.issues[0]?.id).toBe("issue-1");
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.issues[0]?.id).toBe("issue-2");
    });

    it("refresh does nothing when vaultId is null", async () => {
      let fetchCalled = false;
      const mockFetch: FetchFn = () => {
        fetchCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues: [] }),
        } as Response);
      };

      const { result } = renderHook(() =>
        useHealth(null, { fetch: mockFetch, disablePolling: true })
      );

      await act(async () => {
        await result.current.refresh();
      });

      expect(fetchCalled).toBe(false);
    });
  });

  describe("dismissIssue", () => {
    it("removes issue from local state", async () => {
      const testIssues = [
        createTestIssue({ id: "issue-1", message: "First" }),
        createTestIssue({ id: "issue-2", message: "Second" }),
      ];
      const mockFetch = createMockFetch(testIssues);

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.issues.length).toBe(2);
      });

      act(() => {
        result.current.dismissIssue("issue-1");
      });

      expect(result.current.issues.length).toBe(1);
      expect(result.current.issues[0].id).toBe("issue-2");
    });

    it("does nothing for non-existent issue ID", async () => {
      const testIssues = [createTestIssue({ id: "issue-1" })];
      const mockFetch = createMockFetch(testIssues);

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      await waitFor(() => {
        expect(result.current.issues.length).toBe(1);
      });

      act(() => {
        result.current.dismissIssue("nonexistent");
      });

      expect(result.current.issues.length).toBe(1);
    });
  });

  describe("vaultId changes", () => {
    it("fetches new issues when vaultId changes", async () => {
      let fetchedVaultId = "";
      const mockFetch: FetchFn = (url) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        // Extract vault ID from URL
        const match = urlStr.match(/\/api\/vaults\/([^/]+)\/health/);
        if (match) {
          fetchedVaultId = match[1];
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues: [] }),
        } as Response);
      };

      const { rerender } = renderHook(
        ({ vaultId }) => useHealth(vaultId, { fetch: mockFetch, disablePolling: true }),
        { initialProps: { vaultId: "vault-a" } }
      );

      await waitFor(() => {
        expect(fetchedVaultId).toBe("vault-a");
      });

      rerender({ vaultId: "vault-b" });

      await waitFor(() => {
        expect(fetchedVaultId).toBe("vault-b");
      });
    });

    it("clears issues when vaultId becomes null", async () => {
      const testIssues = [createTestIssue()];
      const mockFetch = createMockFetch(testIssues);

      const { result, rerender } = renderHook(
        ({ vaultId }) => useHealth(vaultId, { fetch: mockFetch, disablePolling: true }),
        { initialProps: { vaultId: mockVaultId as string | null } }
      );

      await waitFor(() => {
        expect(result.current.issues.length).toBe(1);
      });

      rerender({ vaultId: null });

      await waitFor(() => {
        expect(result.current.issues).toEqual([]);
      });
    });
  });

  describe("loading state", () => {
    it("sets isLoading during fetch", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() =>
        useHealth(mockVaultId, { fetch: mockFetch, disablePolling: true })
      );

      // Should be loading after initial effect triggers
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Resolve the fetch
      act(() => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues: [] }),
        } as Response);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
