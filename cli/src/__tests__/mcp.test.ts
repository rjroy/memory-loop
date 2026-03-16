import { describe, expect, test } from "bun:test";
import { generateMcpToolDefinitions, generateMcpConfig } from "../mcp";
import { COMMANDS } from "../registry";

describe("MCP tool projection", () => {
  test("generates one tool per command", () => {
    const tools = generateMcpToolDefinitions();
    expect(tools.length).toBe(COMMANDS.length);
  });

  test("tool names use underscores not spaces", () => {
    const tools = generateMcpToolDefinitions();
    for (const tool of tools) {
      expect(tool.name).not.toContain(" ");
    }
  });

  test("each tool has name, description, and inputSchema", () => {
    const tools = generateMcpToolDefinitions();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("required fields match required args", () => {
    const tools = generateMcpToolDefinitions();
    for (const tool of tools) {
      const cmd = COMMANDS.find(
        (c) => c.name.replace(/ /g, "_") === tool.name,
      );
      expect(cmd).toBeTruthy();
      const expectedRequired = cmd!.args
        .filter((a) => a.required)
        .map((a) => a.name);
      expect(tool.inputSchema.required).toEqual(expectedRequired);
    }
  });

  test("streaming commands note streaming in description", () => {
    const tools = generateMcpToolDefinitions();
    const streamTool = tools.find((t) => t.name === "chat_stream");
    expect(streamTool).toBeTruthy();
    expect(streamTool!.description).toContain("streamed");
  });

  test("vault_list tool has correct schema", () => {
    const tools = generateMcpToolDefinitions();
    const tool = tools.find((t) => t.name === "vault_list");
    expect(tool).toBeTruthy();
    expect(tool!.inputSchema.required).toEqual([]);
    expect(Object.keys(tool!.inputSchema.properties)).toEqual([]);
  });

  test("chat_send tool includes args and flags", () => {
    const tools = generateMcpToolDefinitions();
    const tool = tools.find((t) => t.name === "chat_send");
    expect(tool).toBeTruthy();
    expect(tool!.inputSchema.required).toEqual(["vault", "message"]);
    expect(tool!.inputSchema.properties).toHaveProperty("stream");
    expect(tool!.inputSchema.properties).toHaveProperty("session");
  });
});

describe("MCP config generation", () => {
  test("generates valid config block", () => {
    const config = generateMcpConfig() as {
      mcpServers: Record<string, { command: string; tools: unknown[] }>;
    };
    expect(config.mcpServers).toBeTruthy();
    expect(config.mcpServers["memory-loop"]).toBeTruthy();
    expect(config.mcpServers["memory-loop"].command).toBe("memory-loop");
    expect(config.mcpServers["memory-loop"].tools.length).toBe(
      COMMANDS.length,
    );
  });
});
