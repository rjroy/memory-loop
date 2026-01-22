/**
 * Error Handling Middleware
 *
 * Hono error handler that maps domain exceptions to HTTP status codes
 * with JSON error bodies matching the WebSocket error schema.
 *
 * Requirements:
 * - REQ-F-55-59: REST endpoints return appropriate HTTP status codes
 * - REQ-NF-3: Error response schemas match WebSocket format
 * - TD-4: JSON error responses with { error: { code, message } } format
 */

import type { Context, ErrorHandler } from "hono";
import type { ErrorCode } from "@memory-loop/shared";
import { FileBrowserError } from "../file-browser";
import { createLogger } from "../logger";
import { type RestErrorResponse, jsonError } from "./vault-resolution";

const log = createLogger("ErrorHandler");

/**
 * Maps FileBrowserError codes to HTTP status codes.
 *
 * - PATH_TRAVERSAL: 403 Forbidden (security violation)
 * - FILE_NOT_FOUND, DIRECTORY_NOT_FOUND: 404 Not Found
 * - INVALID_FILE_TYPE, VALIDATION_ERROR: 400 Bad Request
 * - INTERNAL_ERROR and unknown: 500 Internal Server Error
 */
function mapErrorCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case "PATH_TRAVERSAL":
      return 403;
    case "FILE_NOT_FOUND":
    case "DIRECTORY_NOT_FOUND":
      return 404;
    case "INVALID_FILE_TYPE":
    case "VALIDATION_ERROR":
      return 400;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}

/**
 * Determines if an error is a FileBrowserError.
 *
 * Checks for the presence of a `code` property with a valid ErrorCode value,
 * since instanceof checks can fail across module boundaries.
 */
function isFileBrowserError(error: unknown): error is FileBrowserError {
  if (error instanceof FileBrowserError) {
    return true;
  }

  // Fallback check for cross-module scenarios
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    // Verify it's a known error code
    const code = (error as { code: string }).code;
    const knownCodes: ErrorCode[] = [
      "VAULT_NOT_FOUND",
      "VAULT_ACCESS_DENIED",
      "SESSION_NOT_FOUND",
      "SESSION_INVALID",
      "SDK_ERROR",
      "NOTE_CAPTURE_FAILED",
      "VALIDATION_ERROR",
      "INTERNAL_ERROR",
      "FILE_NOT_FOUND",
      "DIRECTORY_NOT_FOUND",
      "PATH_TRAVERSAL",
      "INVALID_FILE_TYPE",
    ];
    return knownCodes.includes(code as ErrorCode);
  }

  return false;
}

/**
 * Logs error details server-side with context.
 *
 * Includes HTTP method, path, error code/message, and stack trace for debugging.
 * Stack traces are logged but never exposed in responses.
 */
function logError(c: Context, error: unknown, isKnown: boolean): void {
  const method = c.req.method;
  const path = c.req.path;

  if (isKnown && isFileBrowserError(error)) {
    // Known domain errors: log at warn level
    log.warn(`${method} ${path} - ${error.code}: ${error.message}`);
  } else if (error instanceof Error) {
    // Unknown errors: log at error level with stack
    log.error(`${method} ${path} - Unexpected error: ${error.message}`, {
      stack: error.stack,
    });
  } else {
    // Non-Error thrown: log what we can
    log.error(`${method} ${path} - Unknown error type`, { error });
  }
}

/**
 * Hono error handler for REST API routes.
 *
 * Usage:
 * ```typescript
 * app.onError(restErrorHandler);
 * ```
 *
 * Handles:
 * - FileBrowserError and subclasses: mapped to appropriate 4xx/5xx codes
 * - Unknown errors: 500 with safe message (no stack traces)
 *
 * All errors are logged server-side with context before returning the response.
 */
export const restErrorHandler: ErrorHandler = (err, c) => {
  // Handle FileBrowserError and its subclasses
  if (isFileBrowserError(err)) {
    logError(c, err, true);
    const status = mapErrorCodeToStatus(err.code);
    return jsonError(c, status, err.code, err.message);
  }

  // Handle unknown errors
  logError(c, err, false);

  // Return safe error message (no internal details or stack traces)
  return jsonError(
    c,
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred. Please try again later."
  );
};

// Re-export RestErrorResponse for consumers
export type { RestErrorResponse };
