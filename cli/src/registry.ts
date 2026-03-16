/**
 * Command registry.
 *
 * Declarative metadata for all CLI commands. Serves three purposes:
 * 1. CLI help text generation
 * 2. MCP tool definition projection
 * 3. Command routing and argument validation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArgumentDefinition {
  name: string;
  description: string;
  required: boolean;
  type: "string" | "number";
}

export interface FlagDefinition {
  name: string;
  short?: string;
  description: string;
  type: "boolean" | "string" | "number";
  default?: unknown;
}

export interface DaemonEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  pathParams: string[];
  queryParams: string[];
  bodyParams: string[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  group: string;
  args: ArgumentDefinition[];
  flags: FlagDefinition[];
  daemonEndpoint: DaemonEndpoint | null; // null for meta-commands like mcp
  outputSchema: {
    type: string;
    description: string;
    properties?: Record<string, unknown>;
  };
  examples: string[];
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export const COMMANDS: CommandDefinition[] = [
  // --- vault ---
  {
    name: "vault list",
    description: "List discovered vaults",
    group: "vault",
    args: [],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults",
      pathParams: [],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "List of discovered vaults",
      properties: {
        vaults: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              contentRoot: { type: "string" },
            },
          },
        },
      },
    },
    examples: ["memory-loop vault list", "memory-loop vault list --human"],
  },
  {
    name: "vault info",
    description: "Show vault details and configuration",
    group: "vault",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Vault details including ID, title, paths, and config",
    },
    examples: ["memory-loop vault info my-vault"],
  },
  {
    name: "vault create",
    description: "Create a new vault",
    group: "vault",
    args: [
      {
        name: "title",
        description: "Title for the new vault",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "POST",
      path: "/vaults",
      pathParams: [],
      queryParams: [],
      bodyParams: ["title"],
    },
    outputSchema: {
      type: "object",
      description: "Created vault details",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
      },
    },
    examples: ['memory-loop vault create "My New Vault"'],
  },

  // --- capture ---
  {
    name: "capture",
    description: "Capture text to today's daily note",
    group: "capture",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "text",
        description: 'Text to capture (use "-" for stdin)',
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "POST",
      path: "/vaults/:vault/capture",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: ["text"],
    },
    outputSchema: {
      type: "object",
      description: "Capture confirmation",
      properties: {
        path: { type: "string" },
      },
    },
    examples: [
      'memory-loop capture my-vault "Quick thought to remember"',
      'echo "piped thought" | memory-loop capture my-vault -',
    ],
  },

  // --- chat ---
  {
    name: "chat send",
    description:
      "Send a message to start or continue a discussion. Use the --stream flag to receive streaming output after sending.",
    group: "chat",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "message",
        description: "Message text",
        required: true,
        type: "string",
      },
    ],
    flags: [
      {
        name: "stream",
        short: "s",
        description: "Stream the response after sending",
        type: "boolean",
        default: false,
      },
      {
        name: "session",
        description: "Resume a specific session ID",
        type: "string",
      },
    ],
    daemonEndpoint: {
      method: "POST",
      path: "/session/chat/send",
      pathParams: [],
      queryParams: [],
      bodyParams: ["vaultId", "prompt"],
    },
    outputSchema: {
      type: "object",
      description: "Session identifier for the chat",
      properties: {
        sessionId: { type: "string" },
      },
    },
    examples: [
      'memory-loop chat send my-vault "What did I capture yesterday?"',
      'memory-loop chat send my-vault "Continue discussion" --stream',
    ],
  },
  {
    name: "chat stream",
    description: "Attach to a session's event stream",
    group: "chat",
    args: [
      {
        name: "session",
        description: "Session ID to stream",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/session/chat/stream",
      pathParams: [],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Stream of session events (JSONL in JSON mode)",
    },
    examples: ["memory-loop chat stream abc123"],
    streaming: true,
  },
  {
    name: "chat abort",
    description: "Stop active processing for a session",
    group: "chat",
    args: [
      {
        name: "session",
        description: "Session ID to abort",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "POST",
      path: "/session/chat/abort",
      pathParams: [],
      queryParams: [],
      bodyParams: ["sessionId"],
    },
    outputSchema: {
      type: "object",
      description: "Abort confirmation",
    },
    examples: ["memory-loop chat abort abc123"],
  },
  {
    name: "chat history",
    description: "Look up existing session for a vault",
    group: "chat",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/session/lookup/:vault",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Session info for the vault",
      properties: {
        sessionId: { type: "string" },
        vaultId: { type: "string" },
        lastActivity: { type: "string" },
      },
    },
    examples: ["memory-loop chat history my-vault"],
  },

  // --- browse ---
  {
    name: "browse",
    description: "Browse vault files and directories",
    group: "browse",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "path",
        description: "Path to list (default: root)",
        required: false,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault/files",
      pathParams: ["vault"],
      queryParams: ["path"],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Directory listing",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
            },
          },
        },
      },
    },
    examples: [
      "memory-loop browse my-vault",
      "memory-loop browse my-vault 01_Projects",
    ],
  },
  {
    name: "browse read",
    description: "Read a file from a vault",
    group: "browse",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "path",
        description: "File path to read",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault/files/:path",
      pathParams: ["vault", "path"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "File content",
      properties: {
        content: { type: "string" },
      },
    },
    examples: ['memory-loop browse read my-vault "daily/2026-03-15.md"'],
  },

  // --- search ---
  {
    name: "search",
    description: "Search vault content",
    group: "search",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "query",
        description: "Search query",
        required: true,
        type: "string",
      },
    ],
    flags: [
      {
        name: "limit",
        short: "l",
        description: "Maximum number of results",
        type: "number",
        default: 20,
      },
    ],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault/search/content",
      pathParams: ["vault"],
      queryParams: ["q", "limit"],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Search results with match context",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              context: { type: "string" },
            },
          },
        },
        totalMatches: { type: "number" },
      },
    },
    examples: [
      'memory-loop search my-vault "meeting notes"',
      'memory-loop search my-vault "project plan" --limit 5',
    ],
  },

  // --- cards ---
  {
    name: "cards due",
    description: "List cards due for spaced repetition review",
    group: "cards",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault/cards/due",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Due cards for review",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              dueDate: { type: "string" },
            },
          },
        },
      },
    },
    examples: ["memory-loop cards due my-vault"],
  },
  {
    name: "cards review",
    description: "Submit a spaced repetition card review",
    group: "cards",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "id",
        description: "Card ID",
        required: true,
        type: "string",
      },
      {
        name: "rating",
        description: "Review rating: again, hard, good, easy (or 0-3)",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "POST",
      path: "/vaults/:vault/cards/:id/review",
      pathParams: ["vault", "id"],
      queryParams: [],
      bodyParams: ["response"],
    },
    outputSchema: {
      type: "object",
      description: "Review confirmation with next review date",
    },
    examples: ['memory-loop cards review my-vault card-123 good'],
  },

  // --- extract ---
  {
    name: "extract trigger",
    description: "Trigger memory extraction now",
    group: "extract",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "POST",
      path: "/config/extraction/trigger",
      pathParams: [],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Extraction trigger confirmation",
    },
    examples: ["memory-loop extract trigger my-vault"],
  },
  {
    name: "extract status",
    description: "Show extraction scheduler status",
    group: "extract",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/config/extraction/status",
      pathParams: [],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Extraction scheduler status and metrics",
    },
    examples: ["memory-loop extract status my-vault"],
  },

  // --- config ---
  {
    name: "config get",
    description: "Show vault configuration",
    group: "config",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/vaults/:vault/config",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Vault configuration key-value pairs",
    },
    examples: ["memory-loop config get my-vault"],
  },
  {
    name: "config set",
    description: "Update vault configuration",
    group: "config",
    args: [
      {
        name: "vault",
        description: "Vault ID or name",
        required: true,
        type: "string",
      },
      {
        name: "key",
        description: "Configuration key (supports dot-notation for nested keys)",
        required: true,
        type: "string",
      },
      {
        name: "value",
        description: "New value",
        required: true,
        type: "string",
      },
    ],
    flags: [],
    daemonEndpoint: {
      method: "PUT",
      path: "/vaults/:vault/config",
      pathParams: ["vault"],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Updated configuration",
    },
    examples: [
      'memory-loop config set my-vault "discussion.model" "claude-sonnet-4-5-20241022"',
      "memory-loop config set my-vault cardsEnabled true",
    ],
  },

  // --- health ---
  {
    name: "health",
    description: "Show daemon health and status",
    group: "health",
    args: [],
    flags: [],
    daemonEndpoint: {
      method: "GET",
      path: "/health",
      pathParams: [],
      queryParams: [],
      bodyParams: [],
    },
    outputSchema: {
      type: "object",
      description: "Daemon status including uptime, vault count, schedulers",
      properties: {
        status: { type: "string" },
        uptime: { type: "number" },
        vaultCount: { type: "number" },
      },
    },
    examples: ["memory-loop health", "memory-loop health --human"],
  },

  // --- help ---
  {
    name: "help",
    description: "Show available commands and usage",
    group: "help",
    args: [],
    flags: [],
    daemonEndpoint: null,
    outputSchema: {
      type: "object",
      description: "Available commands and global flags",
    },
    examples: ["memory-loop help"],
  },

  // --- mcp ---
  {
    name: "mcp tools",
    description: "Output MCP tool definitions for all CLI commands",
    group: "mcp",
    args: [],
    flags: [],
    daemonEndpoint: null,
    outputSchema: {
      type: "object",
      description: "Array of MCP tool definitions",
    },
    examples: ["memory-loop mcp tools"],
  },
  {
    name: "mcp config",
    description: "Output MCP server configuration block",
    group: "mcp",
    args: [],
    flags: [],
    daemonEndpoint: null,
    outputSchema: {
      type: "object",
      description: "MCP server configuration for .mcp.json",
    },
    examples: ["memory-loop mcp config"],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  command: CommandDefinition;
  args: Record<string, string>;
  flags: Record<string, unknown>;
}

/**
 * Parse argv into a matched command with extracted args and flags.
 */
export function findCommand(
  argv: string[],
): ParsedCommand | null {
  // Try two-word match first, then single-word
  for (const cmd of COMMANDS) {
    const parts = cmd.name.split(" ");
    if (parts.length === 2) {
      if (argv[0] === parts[0] && argv[1] === parts[1]) {
        return parseArgs(cmd, argv.slice(2));
      }
    }
  }

  for (const cmd of COMMANDS) {
    const parts = cmd.name.split(" ");
    if (parts.length === 1 && argv[0] === parts[0]) {
      return parseArgs(cmd, argv.slice(1));
    }
  }

  return null;
}

function parseArgs(
  cmd: CommandDefinition,
  rest: string[],
): ParsedCommand {
  const args: Record<string, string> = {};
  const flags: Record<string, unknown> = {};

  // Set flag defaults
  for (const flag of cmd.flags) {
    if (flag.default !== undefined) {
      flags[flag.name] = flag.default;
    }
  }

  let argIndex = 0;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];

    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      const flag = cmd.flags.find((f) => f.name === flagName);
      if (flag) {
        if (flag.type === "boolean") {
          flags[flag.name] = true;
        } else {
          i++;
          flags[flag.name] = flag.type === "number" ? Number(rest[i]) : rest[i];
        }
      }
    } else if (token.startsWith("-") && token.length === 2) {
      const shortFlag = token.slice(1);
      const flag = cmd.flags.find((f) => f.short === shortFlag);
      if (flag) {
        if (flag.type === "boolean") {
          flags[flag.name] = true;
        } else {
          i++;
          flags[flag.name] = flag.type === "number" ? Number(rest[i]) : rest[i];
        }
      }
    } else {
      // Positional argument
      if (argIndex < cmd.args.length) {
        args[cmd.args[argIndex].name] = token;
        argIndex++;
      }
    }
  }

  return { command: cmd, args, flags };
}

/**
 * Get unique top-level command groups.
 */
export function getCommandGroups(): string[] {
  const groups = new Set<string>();
  for (const cmd of COMMANDS) {
    groups.add(cmd.group);
  }
  return [...groups];
}

/**
 * Get commands in a specific group.
 */
export function getGroupCommands(group: string): CommandDefinition[] {
  return COMMANDS.filter((cmd) => cmd.group === group);
}
