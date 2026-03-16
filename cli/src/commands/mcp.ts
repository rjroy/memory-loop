/**
 * MCP meta-commands: tools, config
 */

import { generateMcpToolDefinitions, generateMcpConfig } from "../mcp";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export function executeMcpTools(): CommandResult {
  return {
    data: { tools: generateMcpToolDefinitions() },
    exitCode: EXIT_SUCCESS,
  };
}

export function executeMcpConfig(): CommandResult {
  return {
    data: generateMcpConfig(),
    exitCode: EXIT_SUCCESS,
  };
}
