import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  configureClientForTesting,
  daemonJson,
  daemonFetch,
  resolveVault,
  DaemonConnectionError,
  DaemonApiError,
} from "../client";

describe("daemonFetch", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  test("calls fetch with correct path", async () => {
    let calledPath = "";
    cleanup = configureClientForTesting(async (path) => {
      calledPath = path;
      return new Response(JSON.stringify({ ok: true }));
    });

    await daemonFetch("/health");
    expect(calledPath).toBe("/health");
  });

  test("wraps connection errors in DaemonConnectionError", async () => {
    cleanup = configureClientForTesting(async () => {
      throw new Error("ECONNREFUSED");
    });

    try {
      await daemonFetch("/health");
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonConnectionError);
    }
  });
});

describe("daemonJson", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  test("parses JSON response", async () => {
    cleanup = configureClientForTesting(async () => {
      return new Response(JSON.stringify({ status: "ok" }));
    });

    const result = await daemonJson<{ status: string }>("/health");
    expect(result.status).toBe("ok");
  });

  test("throws DaemonApiError on non-2xx", async () => {
    cleanup = configureClientForTesting(async () => {
      return new Response(
        JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        { status: 404 },
      );
    });

    try {
      await daemonJson("/vaults/nonexistent");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonApiError);
      const apiError = error as DaemonApiError;
      expect(apiError.statusCode).toBe(404);
      expect(apiError.errorBody.code).toBe("NOT_FOUND");
    }
  });

  test("handles non-JSON error responses", async () => {
    cleanup = configureClientForTesting(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    try {
      await daemonJson("/broken");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonApiError);
      const apiError = error as DaemonApiError;
      expect(apiError.statusCode).toBe(500);
      expect(apiError.errorBody.code).toBe("UNKNOWN_ERROR");
    }
  });
});

describe("resolveVault", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  test("returns exact ID when vault exists", async () => {
    cleanup = configureClientForTesting(async (path) => {
      if (path === "/vaults/my-vault") {
        return new Response(
          JSON.stringify({ id: "my-vault", title: "My Vault" }),
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await resolveVault("my-vault");
    expect(result).toBe("my-vault");
  });

  test("fuzzy-matches vault title when ID not found", async () => {
    cleanup = configureClientForTesting(async (path) => {
      if (path === "/vaults/My%20Vault") {
        return new Response(
          JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
          { status: 404 },
        );
      }
      if (path === "/vaults") {
        return new Response(
          JSON.stringify({
            vaults: [
              { id: "my-vault", title: "My Vault" },
              { id: "other", title: "Other Vault" },
            ],
          }),
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await resolveVault("My Vault");
    expect(result).toBe("my-vault");
  });

  test("errors on multiple matches", async () => {
    cleanup = configureClientForTesting(async (path) => {
      if (path.startsWith("/vaults/")) {
        return new Response(
          JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
          { status: 404 },
        );
      }
      return new Response(
        JSON.stringify({
          vaults: [
            { id: "vault-1", title: "Test Vault A" },
            { id: "vault-2", title: "Test Vault B" },
          ],
        }),
      );
    });

    try {
      await resolveVault("Test");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain("Multiple vaults match");
    }
  });

  test("errors when no vault found", async () => {
    cleanup = configureClientForTesting(async (path) => {
      if (path.startsWith("/vaults/")) {
        return new Response(
          JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
          { status: 404 },
        );
      }
      return new Response(JSON.stringify({ vaults: [] }));
    });

    try {
      await resolveVault("nonexistent");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain("Vault not found");
    }
  });
});
