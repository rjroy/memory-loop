import { describe, expect, test } from "bun:test";
import {
  COMMANDS,
  findCommand,
  getCommandGroups,
  getGroupCommands,
} from "../registry";

describe("command registry", () => {
  test("contains all expected commands", () => {
    // 19 from the plan command table + help + mcp tools + mcp config = 22
    // but "browse" and "browse read" share the browse group so it's:
    // vault(3) + capture(1) + chat(4) + browse(2) + search(1) + cards(2) +
    // extract(2) + config(2) + health(1) + help(1) + mcp(2) = 21
    expect(COMMANDS.length).toBe(21);
  });

  test("every command has required metadata", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(cmd.group).toBeTruthy();
      expect(cmd.examples.length).toBeGreaterThan(0);
      expect(cmd.outputSchema.type).toBeTruthy();
      expect(cmd.outputSchema.description).toBeTruthy();
    }
  });

  test("every command name is unique", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("getCommandGroups returns all unique groups", () => {
    const groups = getCommandGroups();
    expect(groups).toContain("vault");
    expect(groups).toContain("chat");
    expect(groups).toContain("browse");
    expect(groups).toContain("search");
    expect(groups).toContain("cards");
    expect(groups).toContain("extract");
    expect(groups).toContain("config");
    expect(groups).toContain("health");
    expect(groups).toContain("capture");
    expect(groups).toContain("mcp");
    expect(groups).toContain("help");
  });

  test("getGroupCommands returns commands for a group", () => {
    const vaultCmds = getGroupCommands("vault");
    expect(vaultCmds.length).toBe(3);
    expect(vaultCmds.map((c) => c.name)).toEqual([
      "vault list",
      "vault info",
      "vault create",
    ]);
  });
});

describe("findCommand", () => {
  test("matches two-word commands", () => {
    const result = findCommand(["vault", "list"]);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("vault list");
  });

  test("matches single-word commands", () => {
    const result = findCommand(["health"]);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("health");
  });

  test("matches capture with positional args", () => {
    const result = findCommand(["capture", "my-vault", "hello world"]);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("capture");
    expect(result!.args.vault).toBe("my-vault");
    expect(result!.args.text).toBe("hello world");
  });

  test("parses flags", () => {
    const result = findCommand([
      "chat",
      "send",
      "my-vault",
      "hello",
      "--stream",
    ]);
    expect(result).not.toBeNull();
    expect(result!.flags.stream).toBe(true);
  });

  test("parses short flags", () => {
    const result = findCommand([
      "chat",
      "send",
      "my-vault",
      "hello",
      "-s",
    ]);
    expect(result).not.toBeNull();
    expect(result!.flags.stream).toBe(true);
  });

  test("parses string flags", () => {
    const result = findCommand([
      "chat",
      "send",
      "my-vault",
      "hello",
      "--session",
      "abc123",
    ]);
    expect(result).not.toBeNull();
    expect(result!.flags.session).toBe("abc123");
  });

  test("parses search with limit flag", () => {
    const result = findCommand([
      "search",
      "my-vault",
      "query",
      "--limit",
      "5",
    ]);
    expect(result).not.toBeNull();
    expect(result!.flags.limit).toBe(5);
  });

  test("returns null for unknown commands", () => {
    expect(findCommand(["nonexistent"])).toBeNull();
    expect(findCommand(["vault", "nonexistent"])).toBeNull();
  });

  test("sets flag defaults", () => {
    const result = findCommand(["chat", "send", "v", "msg"]);
    expect(result).not.toBeNull();
    expect(result!.flags.stream).toBe(false);
  });
});
