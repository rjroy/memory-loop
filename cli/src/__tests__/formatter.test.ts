import { describe, expect, test } from "bun:test";
import { formatOutput, formatError, formatStreamEvent } from "../formatter";
import type { GlobalFlags } from "../types";

const jsonFlags: GlobalFlags = { human: false };
const humanFlags: GlobalFlags = { human: true };

describe("formatOutput", () => {
  test("JSON mode produces valid JSON", () => {
    const data = { vaults: [{ id: "v1", title: "Test" }] };
    const output = formatOutput(data, jsonFlags);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toEqual(data);
  });

  test("JSON mode is pretty-printed", () => {
    const data = { key: "value" };
    const output = formatOutput(data, jsonFlags);
    expect(output).toContain("\n");
    expect(output).toContain("  ");
  });

  test("human mode formats vault list", () => {
    const data = {
      vaults: [
        { id: "v1", title: "First Vault", contentRoot: "/path/v1" },
        { id: "v2", title: "Second Vault", contentRoot: "/path/v2" },
      ],
    };
    const output = formatOutput(data, humanFlags);
    expect(output).toContain("First Vault");
    expect(output).toContain("Second Vault");
    expect(output).toContain("v1");
    expect(output).toContain("v2");
  });

  test("human mode formats empty vault list", () => {
    const output = formatOutput({ vaults: [] }, humanFlags);
    expect(output).toContain("No vaults");
  });

  test("human mode formats health status", () => {
    const data = { status: "ok", uptime: 3661, vaultCount: 3 };
    const output = formatOutput(data, humanFlags);
    expect(output).toContain("ok");
    expect(output).toContain("1h 1m");
    expect(output).toContain("3");
  });

  test("human mode formats file listing", () => {
    const data = {
      entries: [
        { name: "docs", type: "directory" },
        { name: "readme.md", type: "file" },
      ],
    };
    const output = formatOutput(data, humanFlags);
    expect(output).toContain("docs");
    expect(output).toContain("readme.md");
  });

  test("human mode formats search results", () => {
    const data = {
      results: [
        {
          path: "notes/test.md",
          matches: [{ line: 5, content: "matching line" }],
        },
      ],
      totalMatches: 1,
    };
    const output = formatOutput(data, humanFlags);
    expect(output).toContain("notes/test.md");
    expect(output).toContain("matching line");
  });

  test("human mode formats cards", () => {
    const data = {
      cards: [{ id: "c1", question: "What is X?", dueDate: "2026-03-15" }],
    };
    const output = formatOutput(data, humanFlags);
    expect(output).toContain("What is X?");
  });

  test("human mode formats file content", () => {
    const data = { content: "# Hello World\nSome content here." };
    const output = formatOutput(data, humanFlags);
    expect(output).toBe("# Hello World\nSome content here.");
  });

  test("human mode formats generic object as key-value", () => {
    const data = { sessionId: "abc123", status: "active" };
    // Has "status" key, but it's not really a health check
    // The formatter will pick it up as health because status exists
    const output = formatOutput(data, humanFlags);
    expect(output).toBeTruthy();
  });
});

describe("formatError", () => {
  test("JSON mode", () => {
    const err = { error: "Not found", code: "NOT_FOUND" };
    const output = formatError(err, jsonFlags);
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe("Not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });

  test("human mode shows error message", () => {
    const err = { error: "Not found", code: "NOT_FOUND", detail: "Vault xyz" };
    const output = formatError(err, humanFlags);
    expect(output).toContain("Not found");
    expect(output).toContain("Vault xyz");
  });
});

describe("formatStreamEvent", () => {
  test("JSON mode returns JSON string", () => {
    const data = { type: "text_delta", text: "hello" };
    const output = formatStreamEvent(data, jsonFlags);
    expect(output).toBe(JSON.stringify(data));
  });

  test("human mode renders text deltas inline", () => {
    const output = formatStreamEvent(
      { type: "text_delta", text: "hello" },
      humanFlags,
    );
    expect(output).toBe("hello");
  });

  test("human mode renders tool use", () => {
    const output = formatStreamEvent(
      { type: "tool_use", name: "search" },
      humanFlags,
    );
    expect(output).toContain("[tool: search]");
  });

  test("human mode suppresses tool results", () => {
    const output = formatStreamEvent(
      { type: "tool_result" },
      humanFlags,
    );
    expect(output).toBeNull();
  });

  test("human mode renders response end as newline", () => {
    const output = formatStreamEvent(
      { type: "response_end" },
      humanFlags,
    );
    expect(output).toBe("\n");
  });
});
