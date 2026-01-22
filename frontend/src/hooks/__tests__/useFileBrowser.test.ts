/**
 * useFileBrowser Hook Tests
 *
 * Tests file browser operations using dependency injection for fetch.
 * No mock.module() - uses injected fetch functions.
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useFileBrowser } from "../useFileBrowser.js";
import type { FetchFn } from "../../api/types.js";

/* eslint-disable @typescript-eslint/require-await */

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a mock fetch that returns the given response.
 */
function createMockFetch(response: {
  status?: number;
  ok?: boolean;
  data?: unknown;
}): FetchFn {
  const { status = 200, ok = true, data = {} } = response;
  return async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => data,
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: () => ({} as Response),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(data),
    bytes: async () => new Uint8Array(),
  });
}

/**
 * Creates a mock fetch that throws an error.
 */
function createErrorFetch(message: string): FetchFn {
  return async () => {
    throw new Error(message);
  };
}

/**
 * Creates a mock fetch that captures request details for verification.
 */
function createCapturingFetch(
  response: { status?: number; ok?: boolean; data?: unknown },
  captured: { url?: string; options?: RequestInit }
): FetchFn {
  const { status = 200, ok = true, data = {} } = response;
  return async (url: RequestInfo | URL, options?: RequestInit) => {
    // Extract URL string from the various input types
    if (typeof url === "string") {
      captured.url = url;
    } else if (url instanceof URL) {
      captured.url = url.href;
    } else if (url instanceof Request) {
      captured.url = url.url;
    }
    captured.options = options;
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => data,
      headers: new Headers(),
      redirected: false,
      type: "basic",
      url: "",
      clone: () => ({} as Response),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => JSON.stringify(data),
      bytes: async () => new Uint8Array(),
    };
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("useFileBrowser", () => {
  const mockVaultId = "test-vault";

  describe("initial state", () => {
    it("starts with isLoading false", () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );
      expect(result.current.error).toBeNull();
    });
  });

  describe("listDirectory", () => {
    it("fetches directory listing from correct endpoint", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = {
        path: "",
        entries: [
          { name: "folder", type: "directory", path: "folder" },
          { name: "file.md", type: "file", path: "file.md" },
        ],
      };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      let listing: Awaited<ReturnType<typeof result.current.listDirectory>>;
      await act(async () => {
        listing = await result.current.listDirectory("");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files`);
      expect(captured.options?.method).toBe("GET");
      expect(listing!.entries).toHaveLength(2);
    });

    it("encodes path in query parameter", async () => {
      const captured: { url?: string } = {};
      const mockData = { path: "my folder", entries: [] };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      await act(async () => {
        await result.current.listDirectory("my folder");
      });

      expect(captured.url).toContain("?path=my%20folder");
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.listDirectory("");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
      expect(result.current.error?.message).toBe("No vault selected");
    });

    it("handles 404 error", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createMockFetch({
            status: 404,
            ok: false,
            data: { error: { code: "DIRECTORY_NOT_FOUND", message: "Directory not found" } },
          }),
        })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.listDirectory("nonexistent");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(result.current.error?.isNotFound()).toBe(true);
      expect(error).toBeDefined();
    });

    it("sets isLoading during request", async () => {
      let resolveRequest: ((value: Response) => void) | undefined;
      const slowFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        });

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: slowFetch })
      );

      expect(result.current.isLoading).toBe(false);

      let promise: Promise<unknown>;
      act(() => {
        promise = result.current.listDirectory("");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveRequest!({
          ok: true,
          status: 200,
          json: async () => ({ path: "", entries: [] }),
        } as Response);
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("readFile", () => {
    it("fetches file content from correct endpoint", async () => {
      const captured: { url?: string } = {};
      const mockData = {
        path: "notes/test.md",
        content: "# Test\n\nContent here",
        truncated: false,
      };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      let content: Awaited<ReturnType<typeof result.current.readFile>>;
      await act(async () => {
        content = await result.current.readFile("notes/test.md");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/notes/test.md`);
      expect(content!.content).toBe("# Test\n\nContent here");
      expect(content!.truncated).toBe(false);
    });

    it("encodes special characters in path", async () => {
      const captured: { url?: string } = {};
      const mockData = { path: "my notes/file name.md", content: "", truncated: false };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      await act(async () => {
        await result.current.readFile("my notes/file name.md");
      });

      // Each segment should be encoded separately
      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/my%20notes/file%20name.md`);
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.readFile("test.md");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.readFile("");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File path is required");
    });

    it("handles 404 error", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createMockFetch({
            status: 404,
            ok: false,
            data: { error: { code: "FILE_NOT_FOUND", message: "File not found" } },
          }),
        })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.readFile("nonexistent.md");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(result.current.error?.isNotFound()).toBe(true);
      expect(error).toBeDefined();
    });

    it("handles 403 forbidden error", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createMockFetch({
            status: 403,
            ok: false,
            data: { error: { code: "PATH_TRAVERSAL", message: "Path traversal detected" } },
          }),
        })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.readFile("../../../etc/passwd");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(result.current.error?.isForbidden()).toBe(true);
      expect(error).toBeDefined();
    });
  });

  describe("writeFile", () => {
    it("sends PUT request with content", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = { path: "test.md", success: true };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      await act(async () => {
        await result.current.writeFile("test.md", "# Updated content");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/test.md`);
      expect(captured.options?.method).toBe("PUT");
      expect(JSON.parse(captured.options?.body as string)).toEqual({
        content: "# Updated content",
      });
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.writeFile("test.md", "content");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.writeFile("", "content");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File path is required");
    });
  });

  describe("deleteFile", () => {
    it("sends DELETE request to correct endpoint", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = { path: "test.md" };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      await act(async () => {
        await result.current.deleteFile("test.md");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/test.md`);
      expect(captured.options?.method).toBe("DELETE");
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.deleteFile("test.md");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.deleteFile("");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File path is required");
    });
  });

  describe("createFile", () => {
    it("sends POST request with path and name", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = { path: "notes/new-file.md" };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData, status: 201 }, captured),
        })
      );

      let createdPath: string;
      await act(async () => {
        createdPath = await result.current.createFile("notes", "new-file");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files`);
      expect(captured.options?.method).toBe("POST");
      expect(JSON.parse(captured.options?.body as string)).toEqual({
        path: "notes",
        name: "new-file",
      });
      expect(createdPath!).toBe("notes/new-file.md");
    });

    it("supports empty parent path for root directory", async () => {
      const captured: { options?: RequestInit } = {};
      const mockData = { path: "new-file.md" };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData, status: 201 }, captured),
        })
      );

      await act(async () => {
        await result.current.createFile("", "new-file");
      });

      expect(JSON.parse(captured.options?.body as string)).toEqual({
        path: "",
        name: "new-file",
      });
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.createFile("", "new-file");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when name is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.createFile("notes", "");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File name is required");
    });

    it("handles validation error for invalid name", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createMockFetch({
            status: 400,
            ok: false,
            data: {
              error: {
                code: "VALIDATION_ERROR",
                message: "File name must be alphanumeric with - and _ only",
              },
            },
          }),
        })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.createFile("notes", "invalid name!");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(result.current.error?.isValidationError()).toBe(true);
      expect(error).toBeDefined();
    });
  });

  describe("createDirectory", () => {
    it("sends POST request to directories endpoint", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = { path: "notes/new-folder" };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData, status: 201 }, captured),
        })
      );

      let createdPath: string;
      await act(async () => {
        createdPath = await result.current.createDirectory("notes", "new-folder");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/directories`);
      expect(captured.options?.method).toBe("POST");
      expect(JSON.parse(captured.options?.body as string)).toEqual({
        path: "notes",
        name: "new-folder",
      });
      expect(createdPath!).toBe("notes/new-folder");
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.createDirectory("", "new-folder");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when name is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.createDirectory("notes", "");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("Directory name is required");
    });
  });

  describe("deleteDirectory", () => {
    it("sends DELETE request to directories endpoint", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = { path: "old-folder", filesDeleted: 5, directoriesDeleted: 2 };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      let response: Awaited<ReturnType<typeof result.current.deleteDirectory>>;
      await act(async () => {
        response = await result.current.deleteDirectory("old-folder");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/directories/old-folder`);
      expect(captured.options?.method).toBe("DELETE");
      expect(response!.filesDeleted).toBe(5);
      expect(response!.directoriesDeleted).toBe(2);
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.deleteDirectory("folder");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.deleteDirectory("");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("Directory path is required");
    });
  });

  describe("renameFile", () => {
    it("sends PATCH request with newName", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = {
        oldPath: "old-name.md",
        newPath: "new-name.md",
        referencesUpdated: 3,
      };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      let response: Awaited<ReturnType<typeof result.current.renameFile>>;
      await act(async () => {
        response = await result.current.renameFile("old-name.md", "new-name");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/old-name.md`);
      expect(captured.options?.method).toBe("PATCH");
      expect(JSON.parse(captured.options?.body as string)).toEqual({
        newName: "new-name",
      });
      expect(response!.newPath).toBe("new-name.md");
      expect(response!.referencesUpdated).toBe(3);
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.renameFile("old.md", "new");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.renameFile("", "new");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File path is required");
    });

    it("throws error when newName is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.renameFile("old.md", "");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("New name is required");
    });
  });

  describe("moveFile", () => {
    it("sends PATCH request with newPath", async () => {
      const captured: { url?: string; options?: RequestInit } = {};
      const mockData = {
        oldPath: "inbox/note.md",
        newPath: "archive/note.md",
        referencesUpdated: 1,
      };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createCapturingFetch({ data: mockData }, captured),
        })
      );

      let response: Awaited<ReturnType<typeof result.current.moveFile>>;
      await act(async () => {
        response = await result.current.moveFile("inbox/note.md", "archive/note.md");
      });

      expect(captured.url).toBe(`/api/vaults/${mockVaultId}/files/inbox/note.md`);
      expect(captured.options?.method).toBe("PATCH");
      expect(JSON.parse(captured.options?.body as string)).toEqual({
        newPath: "archive/note.md",
      });
      expect(response!.newPath).toBe("archive/note.md");
      expect(response!.referencesUpdated).toBe(1);
    });

    it("throws error when no vault selected", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.moveFile("old.md", "new/old.md");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("No vault selected");
    });

    it("throws error when path is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.moveFile("", "new/location.md");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("File path is required");
    });

    it("throws error when newPath is empty", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: createMockFetch({}) })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.moveFile("old.md", "");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe("New path is required");
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(undefined, { fetch: createMockFetch({}) })
      );

      // Trigger an error
      await act(async () => {
        try {
          await result.current.listDirectory("");
        } catch {
          // Expected
        }
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("network errors", () => {
    it("handles network errors gracefully", async () => {
      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, {
          fetch: createErrorFetch("Network error"),
        })
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.listDirectory("");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error).toBeDefined();
      expect(result.current.error).not.toBeNull();
    });
  });

  describe("vaultId changes", () => {
    it("uses updated vaultId for requests", async () => {
      const captured: { url?: string } = {};

      const { result, rerender } = renderHook(
        ({ vaultId }) =>
          useFileBrowser(vaultId, {
            fetch: createCapturingFetch(
              { data: { path: "", entries: [] } },
              captured
            ),
          }),
        { initialProps: { vaultId: "vault-1" } }
      );

      await act(async () => {
        await result.current.listDirectory("");
      });

      expect(captured.url).toContain("vault-1");

      rerender({ vaultId: "vault-2" });

      await act(async () => {
        await result.current.listDirectory("");
      });

      expect(captured.url).toContain("vault-2");
    });
  });

  describe("error recovery", () => {
    it("clears error on successful request after failure", async () => {
      let shouldFail = true;

      const dynamicFetch: FetchFn = async () => {
        if (shouldFail) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Server error" } }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: "", entries: [] }),
        } as Response;
      };

      const { result } = renderHook(() =>
        useFileBrowser(mockVaultId, { fetch: dynamicFetch })
      );

      // First request fails
      await act(async () => {
        try {
          await result.current.listDirectory("");
        } catch {
          // Expected
        }
      });

      expect(result.current.error).not.toBeNull();

      // Second request succeeds
      shouldFail = false;
      await act(async () => {
        await result.current.listDirectory("");
      });

      expect(result.current.error).toBeNull();
    });
  });
});
