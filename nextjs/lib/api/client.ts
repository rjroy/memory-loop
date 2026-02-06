/**
 * REST API Client
 *
 * Base fetch wrapper with error handling for Memory Loop REST API.
 * Provides typed request/response handling with consistent error formatting.
 *
 * Requirements:
 * - REQ-NF-3: Consistent error format across REST and SSE
 * - Uses dependency injection for fetch (testable without mock.module)
 */

import type { ErrorCode } from "@/lib/schemas";
import {
  ApiError,
  isApiErrorResponse,
  type ApiRequestOptions,
  type ApiClientConfig,
  type FetchFn,
} from "./types";

/**
 * Default fetch function, bound to globalThis.
 */
const defaultFetch: FetchFn = globalThis.fetch.bind(globalThis);

/**
 * Default configuration for the API client.
 */
const DEFAULT_CONFIG: Required<ApiClientConfig> = {
  baseUrl: "",
  fetch: defaultFetch,
};

/**
 * Creates an API client with the given configuration.
 *
 * @param config - Optional configuration overrides
 * @returns API client instance with request methods
 *
 * @example
 * ```ts
 * // Default client using browser fetch
 * const api = createApiClient();
 *
 * // Custom fetch for testing
 * const api = createApiClient({ fetch: mockFetch });
 * ```
 */
export function createApiClient(config: ApiClientConfig = {}) {
  const finalConfig: Required<ApiClientConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  /**
   * Makes a request to the API and returns typed response data.
   *
   * @param path - API path (e.g., /api/vaults/my-vault/files)
   * @param options - Request options
   * @returns Parsed response data
   * @throws ApiError if the request fails
   */
  async function request<T>(
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const { method = "GET", body, headers = {}, signal } = options;

    const url = `${finalConfig.baseUrl}${path}`;

    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      signal,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await finalConfig.fetch(url, fetchOptions);
    } catch (err) {
      // Network error or request aborted
      if (err instanceof Error && err.name === "AbortError") {
        throw err; // Re-throw abort errors as-is
      }
      throw new ApiError(
        0,
        "INTERNAL_ERROR" as ErrorCode,
        err instanceof Error ? err.message : "Network request failed"
      );
    }

    // Handle non-2xx responses
    if (!response.ok) {
      await handleErrorResponse(response);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    // Parse JSON response
    try {
      const data = (await response.json()) as T;
      return data;
    } catch {
      throw new ApiError(
        response.status,
        "INTERNAL_ERROR" as ErrorCode,
        "Failed to parse response JSON"
      );
    }
  }

  /**
   * Handles error responses by parsing the error body and throwing ApiError.
   */
  async function handleErrorResponse(response: Response): Promise<never> {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON error response
      throw new ApiError(
        response.status,
        mapStatusToErrorCode(response.status),
        response.statusText || `Request failed with status ${response.status}`
      );
    }

    // Check if it matches our expected error format
    if (isApiErrorResponse(errorData)) {
      throw new ApiError(
        response.status,
        errorData.error.code,
        errorData.error.message
      );
    }

    // Unknown error format
    throw new ApiError(
      response.status,
      mapStatusToErrorCode(response.status),
      typeof errorData === "object" && errorData !== null && "message" in errorData
        ? String((errorData as { message: unknown }).message)
        : `Request failed with status ${response.status}`
    );
  }

  return {
    /**
     * GET request.
     */
    get<T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">): Promise<T> {
      return request<T>(path, { ...options, method: "GET" });
    },

    /**
     * POST request.
     */
    post<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">): Promise<T> {
      return request<T>(path, { ...options, method: "POST", body });
    },

    /**
     * PUT request.
     */
    put<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">): Promise<T> {
      return request<T>(path, { ...options, method: "PUT", body });
    },

    /**
     * PATCH request.
     */
    patch<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">): Promise<T> {
      return request<T>(path, { ...options, method: "PATCH", body });
    },

    /**
     * DELETE request.
     */
    delete<T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">): Promise<T> {
      return request<T>(path, { ...options, method: "DELETE" });
    },

    /**
     * Raw request with full options control.
     */
    request,
  };
}

/**
 * Maps HTTP status codes to ErrorCode values.
 * Used as fallback when response doesn't include structured error.
 */
function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 403:
      return "PATH_TRAVERSAL";
    case 404:
      return "FILE_NOT_FOUND";
    case 500:
    default:
      return "INTERNAL_ERROR";
  }
}

/**
 * Default API client instance.
 * Use this for most cases; create custom instances only for testing.
 */
export const api = createApiClient();

/**
 * Builds the API path for vault-scoped endpoints.
 *
 * @param vaultId - The vault ID
 * @param path - Path within the vault (e.g., "files", "goals")
 * @returns Full API path (e.g., "/api/vaults/my-vault/files")
 *
 * @example
 * ```ts
 * const path = vaultPath("my-vault", "files");
 * // => "/api/vaults/my-vault/files"
 *
 * const path = vaultPath("my-vault", `files/${encodeURIComponent("path/to/file.md")}`);
 * // => "/api/vaults/my-vault/files/path%2Fto%2Ffile.md"
 * ```
 */
export function vaultPath(vaultId: string, path: string): string {
  return `/api/vaults/${encodeURIComponent(vaultId)}/${path}`;
}

/**
 * Re-export types for convenience.
 */
export { ApiError, isApiErrorResponse } from "./types";
export type {
  ApiErrorResponse,
  ApiRequestOptions,
  ApiClientConfig,
  ApiResult,
  EmptyResponse,
  FetchFn,
} from "./types";
