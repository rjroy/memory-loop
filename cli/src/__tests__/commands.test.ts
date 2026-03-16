import { describe, expect, test, afterEach } from "bun:test";
import { configureClientForTesting, type FetchFn } from "../client";
import { executeVaultList, executeVaultInfo, executeVaultCreate } from "../commands/vault";
import { executeCapture } from "../commands/capture";
import { executeChatSend, executeChatAbort, executeChatHistory } from "../commands/chat";
import { executeBrowse, executeBrowseRead } from "../commands/browse";
import { executeSearch } from "../commands/search";
import { executeCardsDue, executeCardsReview } from "../commands/cards";
import { executeExtractTrigger, executeExtractStatus } from "../commands/extract";
import { executeConfigGet, executeConfigSet } from "../commands/config";
import { executeHealth } from "../commands/health";
import { executeMcpTools, executeMcpConfig } from "../commands/mcp";
import { EXIT_SUCCESS, EXIT_APP_ERROR, EXIT_USAGE_ERROR } from "../types";

function mockFetch(
  handlers: Record<string, (init?: RequestInit) => Response>,
): FetchFn {
  return async (path: string, init?: RequestInit) => {
    // Sort patterns by length descending so longer/more specific patterns match first
    const sortedPatterns = Object.keys(handlers).sort(
      (a, b) => b.length - a.length,
    );

    for (const pattern of sortedPatterns) {
      if (
        path === pattern ||
        path.startsWith(pattern + "?") ||
        path.startsWith(pattern + "/")
      ) {
        return handlers[pattern](init);
      }
    }
    return new Response(
      JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
      { status: 404 },
    );
  };
}

describe("vault commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("vault list calls GET /vaults", async () => {
    const vaults = [{ id: "v1", title: "Test" }];
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults": () => new Response(JSON.stringify({ vaults })),
      }),
    );

    const result = await executeVaultList();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect((result.data as { vaults: unknown[] }).vaults).toEqual(vaults);
  });

  test("vault info calls GET /vaults/:id", async () => {
    const vault = { id: "v1", title: "Test", path: "/path" };
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () => new Response(JSON.stringify(vault)),
      }),
    );

    const result = await executeVaultInfo({ vault: "v1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect((result.data as { id: string }).id).toBe("v1");
  });

  test("vault create calls POST /vaults", async () => {
    let postedBody = "";
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults": (init) => {
          if (init?.method === "POST") {
            postedBody = init.body as string;
            return new Response(
              JSON.stringify({ id: "new-vault", title: "New" }),
            );
          }
          return new Response(JSON.stringify({ vaults: [] }));
        },
      }),
    );

    const result = await executeVaultCreate({ title: "New" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(postedBody).toContain('"New"');
  });
});

describe("capture command", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("sends text to capture endpoint", async () => {
    let capturedBody = "";
    cleanup = configureClientForTesting(async (path, init) => {
      if (path === "/vaults/v1") {
        return new Response(JSON.stringify({ id: "v1", title: "Test" }));
      }
      if (path === "/vaults/v1/capture") {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ path: "daily/2026-03-15.md" }));
      }
      return new Response(
        JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        { status: 404 },
      );
    });

    const result = await executeCapture({ vault: "v1", text: "hello world" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(capturedBody).toContain("hello world");
  });
});

describe("chat commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("chat send calls POST /session/chat/send", async () => {
    let sentBody = "";
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(
            JSON.stringify({ id: "v1", title: "Test", path: "/path/v1" }),
          ),
        "/session/chat/send": (init) => {
          sentBody = init?.body as string;
          return new Response(JSON.stringify({ sessionId: "sess-1" }));
        },
      }),
    );

    const result = await executeChatSend(
      { vault: "v1", message: "hello" },
      {},
      { human: false },
    );
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect((result.data as { sessionId: string }).sessionId).toBe("sess-1");
    expect(sentBody).toContain("hello");
  });

  test("chat send handles 409 conflict", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(
            JSON.stringify({ id: "v1", title: "Test", path: "/path/v1" }),
          ),
        "/session/chat/send": () =>
          new Response(
            JSON.stringify({
              error: "Session active",
              code: "SESSION_ACTIVE",
            }),
            { status: 409 },
          ),
      }),
    );

    const result = await executeChatSend(
      { vault: "v1", message: "hello" },
      {},
      { human: false },
    );
    expect(result.exitCode).toBe(EXIT_APP_ERROR);
    expect((result.data as { error: string }).error).toContain(
      "already active",
    );
  });

  test("chat abort calls POST /session/chat/abort", async () => {
    let abortBody = "";
    cleanup = configureClientForTesting(
      mockFetch({
        "/session/chat/abort": (init) => {
          abortBody = init?.body as string;
          return new Response(JSON.stringify({ aborted: true }));
        },
      }),
    );

    const result = await executeChatAbort({ session: "sess-1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(abortBody).toContain("sess-1");
  });

  test("chat history calls GET /session/lookup/:vaultId", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
        "/session/lookup/v1": () =>
          new Response(
            JSON.stringify({ sessionId: "sess-1", vaultId: "v1" }),
          ),
      }),
    );

    const result = await executeChatHistory({ vault: "v1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });
});

describe("browse commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("browse lists directory", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
        "/vaults/v1/files": () =>
          new Response(
            JSON.stringify({
              entries: [{ name: "test.md", type: "file" }],
            }),
          ),
      }),
    );

    const result = await executeBrowse({ vault: "v1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });

  test("browse read returns file content", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1/files/test.md": () =>
          new Response("# Hello", {
            headers: { "Content-Type": "text/plain" },
          }),
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
      }),
    );

    const result = await executeBrowseRead({ vault: "v1", path: "test.md" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect((result.data as { content: string }).content).toBe("# Hello");
  });
});

describe("search command", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("search calls content search endpoint", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
        "/vaults/v1/search": () =>
          new Response(
            JSON.stringify({ results: [], totalMatches: 0 }),
          ),
      }),
    );

    const result = await executeSearch({ vault: "v1", query: "test" }, {});
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });
});

describe("cards commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("cards due calls GET /vaults/:id/cards/due", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
        "/vaults/v1/cards": () =>
          new Response(JSON.stringify({ cards: [] })),
      }),
    );

    const result = await executeCardsDue({ vault: "v1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });

  test("cards review accepts word ratings", async () => {
    let reviewBody = "";
    cleanup = configureClientForTesting(async (path, init) => {
      if (path === "/vaults/v1") {
        return new Response(JSON.stringify({ id: "v1", title: "Test" }));
      }
      if (path.startsWith("/vaults/v1/cards/")) {
        reviewBody = (init?.body as string) ?? "";
        return new Response(JSON.stringify({ reviewed: true }));
      }
      return new Response(
        JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        { status: 404 },
      );
    });

    const result = await executeCardsReview({
      vault: "v1",
      id: "card-1",
      rating: "good",
    });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(reviewBody).toContain('"good"');
  });

  test("cards review accepts numeric ratings", async () => {
    cleanup = configureClientForTesting(async (path) => {
      if (path === "/vaults/v1") {
        return new Response(JSON.stringify({ id: "v1", title: "Test" }));
      }
      if (path.startsWith("/vaults/v1/cards/")) {
        return new Response(JSON.stringify({ reviewed: true }));
      }
      return new Response(
        JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        { status: 404 },
      );
    });

    const result = await executeCardsReview({
      vault: "v1",
      id: "card-1",
      rating: "2",
    });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });

  test("cards review rejects invalid ratings", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
      }),
    );

    const result = await executeCardsReview({
      vault: "v1",
      id: "card-1",
      rating: "invalid",
    });
    expect(result.exitCode).toBe(EXIT_USAGE_ERROR);
  });
});

describe("extract commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("extract trigger calls POST", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/config/extraction/trigger": () =>
          new Response(JSON.stringify({ triggered: true })),
      }),
    );

    const result = await executeExtractTrigger();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });

  test("extract status calls GET", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/config/extraction/status": () =>
          new Response(JSON.stringify({ running: false })),
      }),
    );

    const result = await executeExtractStatus();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });
});

describe("config commands", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("config get calls GET /vaults/:id/config", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": () =>
          new Response(JSON.stringify({ id: "v1", title: "Test" })),
        "/vaults/v1/config": () =>
          new Response(JSON.stringify({ cardsEnabled: true })),
      }),
    );

    const result = await executeConfigGet({ vault: "v1" });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
  });

  test("config set sends PUT with expanded dot notation", async () => {
    let putBody = "";
    cleanup = configureClientForTesting(
      mockFetch({
        "/vaults/v1": (init) => {
          if (init?.method === "PUT") {
            putBody = init.body as string;
            return new Response(JSON.stringify({ updated: true }));
          }
          return new Response(JSON.stringify({ id: "v1", title: "Test" }));
        },
        "/vaults/v1/config": (init) => {
          if (init?.method === "PUT") {
            putBody = init.body as string;
            return new Response(JSON.stringify({ updated: true }));
          }
          return new Response(JSON.stringify({ cardsEnabled: true }));
        },
      }),
    );

    const result = await executeConfigSet({
      vault: "v1",
      key: "discussion.model",
      value: "claude-sonnet-4-5-20241022",
    });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(putBody);
    expect(parsed.discussion.model).toBe("claude-sonnet-4-5-20241022");
  });

  test("config set parses boolean values", async () => {
    let putBody = "";
    cleanup = configureClientForTesting(async (path, init) => {
      if (path === "/vaults/v1/config" && init?.method === "PUT") {
        putBody = init.body as string;
        return new Response(JSON.stringify({ updated: true }));
      }
      if (path === "/vaults/v1") {
        return new Response(JSON.stringify({ id: "v1", title: "Test" }));
      }
      return new Response(JSON.stringify({}));
    });

    await executeConfigSet({ vault: "v1", key: "cardsEnabled", value: "true" });
    expect(JSON.parse(putBody).cardsEnabled).toBe(true);
  });
});

describe("health command", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  test("health calls GET /health", async () => {
    cleanup = configureClientForTesting(
      mockFetch({
        "/health": () =>
          new Response(
            JSON.stringify({ status: "ok", uptime: 100, vaultCount: 2 }),
          ),
      }),
    );

    const result = await executeHealth();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect((result.data as { status: string }).status).toBe("ok");
  });
});

describe("mcp commands", () => {
  test("mcp tools returns tool definitions", () => {
    const result = executeMcpTools();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    const tools = (result.data as { tools: unknown[] }).tools;
    expect(tools.length).toBeGreaterThan(0);
  });

  test("mcp config returns server configuration", () => {
    const result = executeMcpConfig();
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    const data = result.data as { mcpServers: Record<string, unknown> };
    expect(data.mcpServers["memory-loop"]).toBeTruthy();
  });
});
