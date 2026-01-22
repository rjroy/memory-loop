/**
 * Error Handler Middleware Tests
 *
 * Tests the REST API error handling middleware.
 * Covers:
 * - FileBrowserError subclasses map to correct HTTP status codes
 * - Unknown errors return 500 with safe message
 * - Error response format matches spec (REQ-NF-3)
 * - Errors are logged server-side with context
 */

import { describe, expect, it, beforeEach, afterEach, spyOn, type Mock } from "bun:test";
import { Hono } from "hono";
import {
  FileBrowserError,
  PathTraversalError,
  FileNotFoundError,
  DirectoryNotFoundError,
  InvalidFileTypeError,
  InvalidDirectoryNameError,
  DirectoryExistsError,
  InvalidFileNameError,
  FileExistsError,
} from "../file-browser";
import { restErrorHandler, type RestErrorResponse } from "../middleware/error-handler";
import { setLogLevel } from "../logger";

describe("restErrorHandler", () => {
  /**
   * Creates a test Hono app with error handler and a route that throws.
   */
  function createTestApp(errorToThrow: () => Error): Hono {
    const app = new Hono();
    app.onError(restErrorHandler);

    app.get("/test", () => {
      throw errorToThrow();
    });

    app.post("/test", () => {
      throw errorToThrow();
    });

    return app;
  }

  describe("FileBrowserError mapping", () => {
    it("maps PathTraversalError to 403 Forbidden", async () => {
      const app = createTestApp(
        () => new PathTraversalError("Path escapes vault boundary")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(403);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("PATH_TRAVERSAL");
      expect(json.error.message).toBe("Path escapes vault boundary");
    });

    it("maps FileNotFoundError to 404 Not Found", async () => {
      const app = createTestApp(
        () => new FileNotFoundError("File does not exist")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(404);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
      expect(json.error.message).toBe("File does not exist");
    });

    it("maps DirectoryNotFoundError to 404 Not Found", async () => {
      const app = createTestApp(
        () => new DirectoryNotFoundError("Directory does not exist")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(404);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("DIRECTORY_NOT_FOUND");
      expect(json.error.message).toBe("Directory does not exist");
    });

    it("maps InvalidFileTypeError to 400 Bad Request", async () => {
      const app = createTestApp(
        () => new InvalidFileTypeError("Only .md files allowed")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INVALID_FILE_TYPE");
      expect(json.error.message).toBe("Only .md files allowed");
    });

    it("maps InvalidDirectoryNameError (VALIDATION_ERROR) to 400 Bad Request", async () => {
      const app = createTestApp(
        () => new InvalidDirectoryNameError("Invalid directory name")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toBe("Invalid directory name");
    });

    it("maps DirectoryExistsError (VALIDATION_ERROR) to 400 Bad Request", async () => {
      const app = createTestApp(
        () => new DirectoryExistsError("Directory already exists")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toBe("Directory already exists");
    });

    it("maps InvalidFileNameError (VALIDATION_ERROR) to 400 Bad Request", async () => {
      const app = createTestApp(
        () => new InvalidFileNameError("Invalid file name")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toBe("Invalid file name");
    });

    it("maps FileExistsError (VALIDATION_ERROR) to 400 Bad Request", async () => {
      const app = createTestApp(
        () => new FileExistsError("File already exists")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(400);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toBe("File already exists");
    });

    it("maps base FileBrowserError with INTERNAL_ERROR to 500", async () => {
      const app = createTestApp(
        () => new FileBrowserError("Something went wrong", "INTERNAL_ERROR")
      );
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(500);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INTERNAL_ERROR");
      expect(json.error.message).toBe("Something went wrong");
    });
  });

  describe("unknown error handling", () => {
    it("returns 500 for generic Error", async () => {
      const app = createTestApp(() => new Error("Unexpected failure"));
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(500);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INTERNAL_ERROR");
      expect(json.error.message).toBe(
        "An unexpected error occurred. Please try again later."
      );
    });

    it("returns 500 for TypeError", async () => {
      const app = createTestApp(() => new TypeError("Cannot read property"));
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.status).toBe(500);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INTERNAL_ERROR");
      // Should NOT expose internal error message
      expect(json.error.message).not.toContain("Cannot read property");
    });

    // Note: Hono/Bun does not catch non-Error throwables in app.onError().
    // Throwing non-Error values is a JavaScript anti-pattern.
    // Our handler correctly handles all Error objects, which is the expected use case.
    // Tests for thrown string/object are omitted since they don't reach the error handler.

    it("never exposes stack traces in response", async () => {
      const app = createTestApp(() => {
        const err = new Error("Internal details");
        err.stack = "Error: Internal details\n    at secret/path/file.ts:42";
        return err;
      });
      const res = await app.fetch(new Request("http://localhost/test"));

      const text = await res.text();
      expect(text).not.toContain("secret/path");
      expect(text).not.toContain(".ts:42");
      expect(text).not.toContain("stack");
    });
  });

  describe("response format (REQ-NF-3)", () => {
    it("returns JSON content type", async () => {
      const app = createTestApp(() => new FileNotFoundError("Not found"));
      const res = await app.fetch(new Request("http://localhost/test"));

      expect(res.headers.get("Content-Type")).toContain("application/json");
    });

    it("returns error object with code and message", async () => {
      const app = createTestApp(
        () => new PathTraversalError("Access denied")
      );
      const res = await app.fetch(new Request("http://localhost/test"));
      const json = (await res.json()) as RestErrorResponse;

      expect(json).toHaveProperty("error");
      expect(json.error).toHaveProperty("code");
      expect(json.error).toHaveProperty("message");
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    });

    it("matches RestErrorResponse structure exactly", async () => {
      const app = createTestApp(() => new Error("test"));
      const res = await app.fetch(new Request("http://localhost/test"));
      const json = (await res.json()) as RestErrorResponse;

      // Should have exactly these keys
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual(["code", "message"]);
    });
  });

  describe("error logging", () => {
    // Type for console spy (Console method signature)
    type ConsoleSpy = Mock<(...args: unknown[]) => void>;
    let consoleWarnSpy: ConsoleSpy;
    let consoleErrorSpy: ConsoleSpy;

    beforeEach(() => {
      // Enable logging for these tests (test runner sets LOG_LEVEL=silent)
      setLogLevel("debug");
      consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {}) as ConsoleSpy;
      consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {}) as ConsoleSpy;
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      // Restore silent logging for other tests
      setLogLevel("silent");
    });

    it("logs known errors at warn level", async () => {
      const app = createTestApp(
        () => new FileNotFoundError("File missing")
      );
      await app.fetch(new Request("http://localhost/test"));

      expect(consoleWarnSpy).toHaveBeenCalled();
      const calls = consoleWarnSpy.mock.calls as Array<[string, ...unknown[]]>;
      const logCall = calls[0]?.[0] ?? "";
      expect(logCall).toContain("GET");
      expect(logCall).toContain("/test");
      expect(logCall).toContain("FILE_NOT_FOUND");
    });

    it("logs unknown errors at error level", async () => {
      const app = createTestApp(() => new Error("Unexpected"));
      await app.fetch(new Request("http://localhost/test"));

      expect(consoleErrorSpy).toHaveBeenCalled();
      const calls = consoleErrorSpy.mock.calls as Array<[string, ...unknown[]]>;
      const logCall = calls[0]?.[0] ?? "";
      expect(logCall).toContain("GET");
      expect(logCall).toContain("/test");
      expect(logCall).toContain("Unexpected error");
    });

    it("logs POST method correctly", async () => {
      const app = createTestApp(
        () => new PathTraversalError("Blocked")
      );
      await app.fetch(
        new Request("http://localhost/test", { method: "POST" })
      );

      expect(consoleWarnSpy).toHaveBeenCalled();
      const calls = consoleWarnSpy.mock.calls as Array<[string, ...unknown[]]>;
      const logCall = calls[0]?.[0] ?? "";
      expect(logCall).toContain("POST");
    });

    it("includes error code in log for known errors", async () => {
      const app = createTestApp(
        () => new InvalidFileTypeError("Wrong type")
      );
      await app.fetch(new Request("http://localhost/test"));

      expect(consoleWarnSpy).toHaveBeenCalled();
      const calls = consoleWarnSpy.mock.calls as Array<[string, ...unknown[]]>;
      const logCall = calls[0]?.[0] ?? "";
      expect(logCall).toContain("INVALID_FILE_TYPE");
    });
  });

  describe("edge cases", () => {
    it("handles error with code property but not FileBrowserError", async () => {
      // An error that looks like FileBrowserError but isn't
      const app = createTestApp(() => {
        const err = new Error("Fake error") as Error & { code: string };
        err.code = "FILE_NOT_FOUND";
        return err;
      });
      const res = await app.fetch(new Request("http://localhost/test"));

      // Should still be handled as a known error due to duck typing
      expect(res.status).toBe(404);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("FILE_NOT_FOUND");
    });

    it("handles error with unknown code as unknown error", async () => {
      const app = createTestApp(() => {
        const err = new Error("Unknown code") as Error & { code: string };
        err.code = "COMPLETELY_UNKNOWN_CODE";
        return err;
      });
      const res = await app.fetch(new Request("http://localhost/test"));

      // Unknown code should be treated as unknown error
      expect(res.status).toBe(500);
      const json = (await res.json()) as RestErrorResponse;
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    // Note: Hono/Bun does not route non-Error throwables (null, undefined, string, object)
    // to app.onError(). These are JavaScript anti-patterns and not supported.
    // Our handler correctly handles all Error objects, which is the expected use case.
  });
});
