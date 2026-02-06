/**
 * REST API Types
 *
 * Shared types for frontend REST API client.
 * Error format matches backend RestErrorResponse (REQ-NF-3).
 */

import type { ErrorCode } from "@memory-loop/shared";

/**
 * REST API error response format.
 * Matches backend RestErrorResponse.
 */
export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/**
 * Custom error class for API errors.
 * Provides typed access to error code and message.
 */
export class ApiError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Error code from ErrorCode enum */
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /**
   * Check if this is a specific error type.
   */
  is(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Check if this is a 404 error.
   */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * Check if this is a validation error.
   */
  isValidationError(): boolean {
    return this.status === 400;
  }

  /**
   * Check if this is a forbidden error.
   */
  isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * Check if this is a server error.
   */
  isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Type guard to check if a value is an ApiErrorResponse.
 */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorResponse).error === "object" &&
    (value as ApiErrorResponse).error !== null &&
    typeof (value as ApiErrorResponse).error.code === "string" &&
    typeof (value as ApiErrorResponse).error.message === "string"
  );
}

/**
 * Options for API requests.
 */
export interface ApiRequestOptions {
  /** HTTP method (default: GET) */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request body (will be JSON-serialized) */
  body?: unknown;
  /** Additional headers */
  headers?: Record<string, string>;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Function signature for fetch-like functions.
 * This is a simplified version that works with both native fetch and mock implementations.
 */
export type FetchFn = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Configuration for the API client.
 */
export interface ApiClientConfig {
  /** Base URL for API requests (default: empty, uses relative URLs) */
  baseUrl?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: FetchFn;
}

/**
 * Result of an API operation with loading and error state.
 * Used by hooks to track async operation status.
 */
export interface ApiResult<T> {
  /** The data if the operation succeeded */
  data: T | null;
  /** Whether the operation is in progress */
  isLoading: boolean;
  /** Error if the operation failed */
  error: ApiError | null;
}

/**
 * Empty success response (for DELETE operations, etc.)
 */
export interface EmptyResponse {
  success: true;
}
