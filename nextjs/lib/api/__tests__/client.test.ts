/**
 * API Client Tests
 *
 * Tests for the REST API client with error handling and type validation.
 * Uses dependency injection (custom fetch) instead of mock.module().
 */

import { describe, it, expect } from "bun:test";
import { createApiClient, vaultPath, ApiError, isApiErrorResponse } from "../client.js";
import type { ApiErrorResponse } from "../types.js";

/**
 * Type for a mock fetch function.
 * Uses a simpler signature than the full fetch type (which includes preconnect).
 */
type MockFetchFn = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Creates a mock fetch function that returns the given response.
 */
function mockFetch(
  responseData: unknown,
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {}
): MockFetchFn {
  const { status = 200, statusText = "OK", headers = {} } = options;

  return (): Promise<Response> => {
    return Promise.resolve(
      new Response(JSON.stringify(responseData), {
        status,
        statusText,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      })
    );
  };
}

/**
 * Creates a mock fetch that returns a 204 No Content response.
 */
function mockFetchNoContent(): MockFetchFn {
  return (): Promise<Response> => {
    return Promise.resolve(
      new Response(null, {
        status: 204,
        statusText: "No Content",
      })
    );
  };
}

/**
 * Creates a mock fetch that throws a network error.
 */
function mockFetchNetworkError(message: string): MockFetchFn {
  return (): Promise<Response> => {
    return Promise.reject(new Error(message));
  };
}

/**
 * Creates a mock fetch that throws an AbortError.
 */
function mockFetchAbort(): MockFetchFn {
  return (): Promise<Response> => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  };
}

/**
 * Creates a mock fetch that captures the request for assertions.
 */
function mockFetchCapture(
  responseData: unknown,
  options: { status?: number } = {}
): { fetch: MockFetchFn; getLastRequest: () => { url: string; init: RequestInit } | null } {
  let lastRequest: { url: string; init: RequestInit } | null = null;

  const fetchFn = (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Convert URL to string safely (RequestInfo can be string or Request)
    let urlString: string;
    if (typeof url === "string") {
      urlString = url;
    } else if (url instanceof URL) {
      urlString = url.toString();
    } else {
      // url is a Request object
      urlString = url.url;
    }
    lastRequest = { url: urlString, init: init ?? {} };
    return Promise.resolve(
      new Response(JSON.stringify(responseData), {
        status: options.status ?? 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  };

  return {
    fetch: fetchFn,
    getLastRequest: () => lastRequest,
  };
}

describe("createApiClient", () => {
  describe("successful requests", () => {
    it("makes GET request and returns parsed JSON", async () => {
      const mockData = { id: 1, name: "test" };
      const api = createApiClient({ fetch: mockFetch(mockData) });

      const result = await api.get<typeof mockData>("/api/test");

      expect(result).toEqual(mockData);
    });

    it("makes POST request with body", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.post("/api/test", { name: "test" });

      const request = getLastRequest();
      expect(request).not.toBeNull();
      expect(request?.init.method).toBe("POST");
      expect(request?.init.body).toBe('{"name":"test"}');
    });

    it("makes PUT request with body", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.put("/api/test", { content: "updated" });

      const request = getLastRequest();
      expect(request?.init.method).toBe("PUT");
      expect(request?.init.body).toBe('{"content":"updated"}');
    });

    it("makes PATCH request with body", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.patch("/api/test", { field: "value" });

      const request = getLastRequest();
      expect(request?.init.method).toBe("PATCH");
    });

    it("makes DELETE request", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.delete("/api/test/123");

      const request = getLastRequest();
      expect(request?.init.method).toBe("DELETE");
    });

    it("handles 204 No Content response", async () => {
      const api = createApiClient({ fetch: mockFetchNoContent() });

      const result = await api.delete<undefined>("/api/test/123");

      expect(result).toBeUndefined();
    });

    it("includes Content-Type header", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.post("/api/test", { data: "test" });

      const request = getLastRequest();
      const headers = request?.init.headers as Record<string, string> | undefined;
      expect(headers?.["Content-Type"]).toBe("application/json");
    });

    it("uses baseUrl when configured", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch, baseUrl: "https://api.example.com" });

      await api.get("/api/test");

      const request = getLastRequest();
      expect(request?.url).toBe("https://api.example.com/api/test");
    });

    it("passes abort signal to fetch", async () => {
      const controller = new AbortController();
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.get("/api/test", { signal: controller.signal });

      const request = getLastRequest();
      expect(request?.init.signal).toBe(controller.signal);
    });

    it("allows custom headers", async () => {
      const { fetch, getLastRequest } = mockFetchCapture({ success: true });
      const api = createApiClient({ fetch });

      await api.get("/api/test", {
        headers: { Authorization: "Bearer token123" },
      });

      const request = getLastRequest();
      const headers = request?.init.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe("Bearer token123");
      expect(headers?.["Content-Type"]).toBe("application/json");
    });
  });

  describe("error handling", () => {
    it("throws ApiError with structured error response", async () => {
      const errorResponse: ApiErrorResponse = {
        error: {
          code: "FILE_NOT_FOUND",
          message: "File does not exist",
        },
      };
      const api = createApiClient({
        fetch: mockFetch(errorResponse, { status: 404 }),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(404);
      expect(caught?.code).toBe("FILE_NOT_FOUND");
      expect(caught?.message).toBe("File does not exist");
    });

    it("throws ApiError with validation error (400)", async () => {
      const errorResponse: ApiErrorResponse = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid vault ID format",
        },
      };
      const api = createApiClient({
        fetch: mockFetch(errorResponse, { status: 400 }),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(400);
      expect(caught?.code).toBe("VALIDATION_ERROR");
      expect(caught?.isValidationError()).toBe(true);
    });

    it("throws ApiError with forbidden error (403)", async () => {
      const errorResponse: ApiErrorResponse = {
        error: {
          code: "PATH_TRAVERSAL",
          message: "Access denied",
        },
      };
      const api = createApiClient({
        fetch: mockFetch(errorResponse, { status: 403 }),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(403);
      expect(caught?.code).toBe("PATH_TRAVERSAL");
      expect(caught?.isForbidden()).toBe(true);
    });

    it("throws ApiError with server error (500)", async () => {
      const errorResponse: ApiErrorResponse = {
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong",
        },
      };
      const api = createApiClient({
        fetch: mockFetch(errorResponse, { status: 500 }),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(500);
      expect(caught?.code).toBe("INTERNAL_ERROR");
      expect(caught?.isServerError()).toBe(true);
    });

    it("maps status to error code for non-structured errors", async () => {
      // Response without our structured error format
      const api = createApiClient({
        fetch: mockFetch({ message: "Not found" }, { status: 404 }),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(404);
      expect(caught?.code).toBe("FILE_NOT_FOUND");
      expect(caught?.message).toBe("Not found");
    });

    it("handles non-JSON error response", async () => {
      const fetchFn: MockFetchFn = (): Promise<Response> => {
        return Promise.resolve(
          new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain" },
          })
        );
      };
      const api = createApiClient({ fetch: fetchFn });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(500);
      expect(caught?.code).toBe("INTERNAL_ERROR");
      expect(caught?.message).toBe("Internal Server Error");
    });

    it("handles network error", async () => {
      const api = createApiClient({
        fetch: mockFetchNetworkError("Failed to connect"),
      });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(0);
      expect(caught?.code).toBe("INTERNAL_ERROR");
      expect(caught?.message).toBe("Failed to connect");
    });

    it("re-throws AbortError without wrapping", async () => {
      const api = createApiClient({ fetch: mockFetchAbort() });

      let caught: Error | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.name).toBe("AbortError");
      expect(caught).not.toBeInstanceOf(ApiError);
    });

    it("handles invalid JSON response", async () => {
      const fetchFn: MockFetchFn = (): Promise<Response> => {
        return Promise.resolve(
          new Response("not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      };
      const api = createApiClient({ fetch: fetchFn });

      let caught: ApiError | null = null;
      try {
        await api.get("/api/test");
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(200);
      expect(caught?.code).toBe("INTERNAL_ERROR");
      expect(caught?.message).toBe("Failed to parse response JSON");
    });
  });
});

describe("ApiError", () => {
  it("is method checks error code", () => {
    const error = new ApiError(404, "FILE_NOT_FOUND", "Not found");

    expect(error.is("FILE_NOT_FOUND")).toBe(true);
    expect(error.is("INTERNAL_ERROR")).toBe(false);
  });

  it("isNotFound checks status", () => {
    const notFound = new ApiError(404, "FILE_NOT_FOUND", "Not found");
    const serverError = new ApiError(500, "INTERNAL_ERROR", "Error");

    expect(notFound.isNotFound()).toBe(true);
    expect(serverError.isNotFound()).toBe(false);
  });

  it("isValidationError checks status", () => {
    const validation = new ApiError(400, "VALIDATION_ERROR", "Invalid");
    const notFound = new ApiError(404, "FILE_NOT_FOUND", "Not found");

    expect(validation.isValidationError()).toBe(true);
    expect(notFound.isValidationError()).toBe(false);
  });

  it("isForbidden checks status", () => {
    const forbidden = new ApiError(403, "PATH_TRAVERSAL", "Denied");
    const notFound = new ApiError(404, "FILE_NOT_FOUND", "Not found");

    expect(forbidden.isForbidden()).toBe(true);
    expect(notFound.isForbidden()).toBe(false);
  });

  it("isServerError checks status >= 500", () => {
    const serverError = new ApiError(500, "INTERNAL_ERROR", "Error");
    const gatewayError = new ApiError(502, "INTERNAL_ERROR", "Gateway error");
    const clientError = new ApiError(400, "VALIDATION_ERROR", "Invalid");

    expect(serverError.isServerError()).toBe(true);
    expect(gatewayError.isServerError()).toBe(true);
    expect(clientError.isServerError()).toBe(false);
  });

  it("has correct name property", () => {
    const error = new ApiError(404, "FILE_NOT_FOUND", "Not found");
    expect(error.name).toBe("ApiError");
  });
});

describe("isApiErrorResponse", () => {
  it("returns true for valid error response", () => {
    const response: ApiErrorResponse = {
      error: {
        code: "FILE_NOT_FOUND",
        message: "Not found",
      },
    };

    expect(isApiErrorResponse(response)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isApiErrorResponse(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isApiErrorResponse("string")).toBe(false);
    expect(isApiErrorResponse(123)).toBe(false);
    expect(isApiErrorResponse(undefined)).toBe(false);
  });

  it("returns false for object without error property", () => {
    expect(isApiErrorResponse({ message: "error" })).toBe(false);
  });

  it("returns false for object with non-object error", () => {
    expect(isApiErrorResponse({ error: "string" })).toBe(false);
    expect(isApiErrorResponse({ error: null })).toBe(false);
  });

  it("returns false for error missing code", () => {
    expect(isApiErrorResponse({ error: { message: "error" } })).toBe(false);
  });

  it("returns false for error missing message", () => {
    expect(isApiErrorResponse({ error: { code: "FILE_NOT_FOUND" } })).toBe(false);
  });

  it("returns false for error with non-string code", () => {
    expect(isApiErrorResponse({ error: { code: 404, message: "error" } })).toBe(false);
  });

  it("returns false for error with non-string message", () => {
    expect(isApiErrorResponse({ error: { code: "FILE_NOT_FOUND", message: 123 } })).toBe(false);
  });
});

describe("vaultPath", () => {
  it("builds path for simple vault ID", () => {
    const path = vaultPath("my-vault", "files");
    expect(path).toBe("/api/vaults/my-vault/files");
  });

  it("encodes vault ID with special characters", () => {
    const path = vaultPath("vault with spaces", "files");
    expect(path).toBe("/api/vaults/vault%20with%20spaces/files");
  });

  it("handles subpaths correctly", () => {
    const path = vaultPath("my-vault", "files/path/to/file.md");
    expect(path).toBe("/api/vaults/my-vault/files/path/to/file.md");
  });

  it("handles query parameters in path", () => {
    const path = vaultPath("my-vault", "files?path=subdir");
    expect(path).toBe("/api/vaults/my-vault/files?path=subdir");
  });

  it("handles empty path", () => {
    const path = vaultPath("my-vault", "");
    expect(path).toBe("/api/vaults/my-vault/");
  });
});
