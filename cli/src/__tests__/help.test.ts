import { describe, expect, test } from "bun:test";
import { isGroupHelpRequest } from "../help";

describe("isGroupHelpRequest", () => {
  test("returns null for empty argv", () => {
    expect(isGroupHelpRequest([])).toBeNull();
  });

  test("returns group name for multi-command groups", () => {
    expect(isGroupHelpRequest(["vault"])).toBe("vault");
    expect(isGroupHelpRequest(["chat"])).toBe("chat");
    expect(isGroupHelpRequest(["cards"])).toBe("cards");
    expect(isGroupHelpRequest(["mcp"])).toBe("mcp");
    expect(isGroupHelpRequest(["extract"])).toBe("extract");
    expect(isGroupHelpRequest(["config"])).toBe("config");
  });

  test("returns group for 'group help' pattern", () => {
    expect(isGroupHelpRequest(["vault", "help"])).toBe("vault");
    expect(isGroupHelpRequest(["chat", "help"])).toBe("chat");
  });

  test("returns null for top-level commands that are also group names", () => {
    // "health", "help", "capture", "search" are both group names and command names
    expect(isGroupHelpRequest(["health"])).toBeNull();
    expect(isGroupHelpRequest(["help"])).toBeNull();
    expect(isGroupHelpRequest(["capture"])).toBeNull();
    expect(isGroupHelpRequest(["search"])).toBeNull();
  });

  test("returns null for unknown groups", () => {
    expect(isGroupHelpRequest(["nonexistent"])).toBeNull();
  });

  test("returns null for command with subcommand", () => {
    expect(isGroupHelpRequest(["vault", "list"])).toBeNull();
  });
});
