/**
 * MCP tool definition projection.
 *
 * Generates MCP tool definitions from the CLI command registry.
 * This is the bridge between CLI commands and agent-discoverable tools.
 */

import { COMMANDS, type CommandDefinition } from "./registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function projectToMcpTool(cmd: CommandDefinition): McpToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const arg of cmd.args) {
    properties[arg.name] = {
      type: arg.type,
      description: arg.description,
    };
    if (arg.required) {
      required.push(arg.name);
    }
  }

  for (const flag of cmd.flags) {
    properties[flag.name] = {
      type: flag.type,
      description: flag.description,
    };
    // Flags are never required
  }

  let description = cmd.description;
  if (cmd.streaming) {
    description += " (output is streamed)";
  }

  return {
    name: cmd.name.replace(/ /g, "_"),
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
    },
  };
}

/**
 * Generate MCP tool definitions for all CLI commands.
 */
export function generateMcpToolDefinitions(): McpToolDefinition[] {
  return COMMANDS.map(projectToMcpTool);
}

/**
 * Generate an MCP server configuration block.
 */
export function generateMcpConfig(): object {
  return {
    mcpServers: {
      "memory-loop": {
        command: "memory-loop",
        args: ["mcp", "serve"],
        description:
          "Memory Loop personal knowledge management. Provides vault operations, AI chat, file browsing, search, spaced repetition, and memory extraction.",
        tools: generateMcpToolDefinitions(),
      },
    },
  };
}
