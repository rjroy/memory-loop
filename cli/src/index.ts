#!/usr/bin/env bun
/**
 * Memory Loop CLI entry point.
 *
 * Routes commands to executors, handles global flags,
 * formats output, and manages exit codes.
 */

import { findCommand } from "./registry";
import { formatOutput, formatError } from "./formatter";
import {
  showTopLevelHelp,
  showGroupHelp,
  showCommandHelp,
  isGroupHelpRequest,
} from "./help";
import { setConnectionOverrides, DaemonConnectionError, DaemonApiError } from "./client";
import type { GlobalFlags, CommandResult } from "./types";
import { EXIT_USAGE_ERROR, EXIT_APP_ERROR, EXIT_CONNECTION_ERROR } from "./types";

// Command executors
import {
  executeVaultList,
  executeVaultInfo,
  executeVaultCreate,
} from "./commands/vault";
import { executeCapture } from "./commands/capture";
import {
  executeChatSend,
  executeChatStream,
  executeChatAbort,
  executeChatHistory,
} from "./commands/chat";
import { executeBrowse, executeBrowseRead } from "./commands/browse";
import { executeSearch } from "./commands/search";
import { executeCardsDue, executeCardsReview } from "./commands/cards";
import { executeExtractTrigger, executeExtractStatus } from "./commands/extract";
import { executeConfigGet, executeConfigSet } from "./commands/config";
import { executeHealth } from "./commands/health";
import { executeMcpTools, executeMcpConfig } from "./commands/mcp";

// ---------------------------------------------------------------------------
// Parse global flags and extract command argv
// ---------------------------------------------------------------------------

function parseGlobalFlags(rawArgv: string[]): {
  flags: GlobalFlags;
  argv: string[];
} {
  const flags: GlobalFlags = { human: false };
  const argv: string[] = [];

  for (let i = 0; i < rawArgv.length; i++) {
    const arg = rawArgv[i];
    if (arg === "--human" || arg === "-H") {
      flags.human = true;
    } else if (arg === "--socket" && i + 1 < rawArgv.length) {
      i++;
      flags.socket = rawArgv[i];
    } else if (arg === "--port" && i + 1 < rawArgv.length) {
      i++;
      flags.port = parseInt(rawArgv[i], 10);
    } else if (arg === "--help") {
      // Keep as-is for command-level help detection
      argv.push(arg);
    } else {
      argv.push(arg);
    }
  }

  return { flags, argv };
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

const COMMAND_EXECUTORS: Record<
  string,
  (
    args: Record<string, string>,
    flags: Record<string, unknown>,
    globalFlags: GlobalFlags,
  ) => Promise<CommandResult> | CommandResult
> = {
  "vault list": () => executeVaultList(),
  "vault info": (args) => executeVaultInfo(args),
  "vault create": (args) => executeVaultCreate(args),
  capture: (args) => executeCapture(args),
  "chat send": (args, flags, gf) => executeChatSend(args, flags, gf),
  "chat stream": (args, flags, gf) => executeChatStream(args, flags, gf),
  "chat abort": (args) => executeChatAbort(args),
  "chat history": (args) => executeChatHistory(args),
  browse: (args) => executeBrowse(args),
  "browse read": (args) => executeBrowseRead(args),
  search: (args, flags) => executeSearch(args, flags),
  "cards due": (args) => executeCardsDue(args),
  "cards review": (args) => executeCardsReview(args),
  "extract trigger": () => executeExtractTrigger(),
  "extract status": () => executeExtractStatus(),
  "config get": (args) => executeConfigGet(args),
  "config set": (args) => executeConfigSet(args),
  health: () => executeHealth(),
  help: () => ({ data: {}, exitCode: 0 }), // Handled specially below
  "mcp tools": () => executeMcpTools(),
  "mcp config": () => executeMcpConfig(),
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  const { flags: globalFlags, argv } = parseGlobalFlags(rawArgv);

  // Apply connection overrides from flags
  setConnectionOverrides({
    socket: globalFlags.socket,
    port: globalFlags.port,
  });

  // No arguments -> top-level help
  if (argv.length === 0) {
    showTopLevelHelp(globalFlags);
    return;
  }

  // "help" command
  if (argv[0] === "help") {
    showTopLevelHelp(globalFlags);
    return;
  }

  // Group help request (e.g., "vault" with no subcommand, or "vault help")
  const groupHelp = isGroupHelpRequest(argv);
  if (groupHelp) {
    showGroupHelp(groupHelp, globalFlags);
    return;
  }

  // Try to match a command
  const parsed = findCommand(argv);

  if (!parsed) {
    process.stderr.write(`Unknown command: ${argv.join(" ")}\n`);
    process.stderr.write("Run 'memory-loop' to see available commands.\n");
    process.exit(EXIT_USAGE_ERROR);
  }

  // --help on a specific command
  if (rawArgv.includes("--help")) {
    showCommandHelp(parsed.command, globalFlags);
    return;
  }

  // Validate required args
  for (const argDef of parsed.command.args) {
    if (argDef.required && !(argDef.name in parsed.args)) {
      process.stderr.write(
        `Missing required argument: <${argDef.name}>\n`,
      );
      showCommandHelp(parsed.command, globalFlags);
      process.exit(EXIT_USAGE_ERROR);
    }
  }

  // Execute the command
  const executor = COMMAND_EXECUTORS[parsed.command.name];
  if (!executor) {
    process.stderr.write(`Command not implemented: ${parsed.command.name}\n`);
    process.exit(EXIT_USAGE_ERROR);
  }

  // "help" command is handled specially (no daemon needed)
  if (parsed.command.name === "help") {
    showTopLevelHelp(globalFlags);
    return;
  }

  try {
    const result = await executor(parsed.args, parsed.flags, globalFlags);

    if (result.exitCode !== 0) {
      // Error result, write to stderr in human mode, stdout in JSON mode
      if (globalFlags.human) {
        const errData = result.data as { error: string; code?: string; detail?: string };
        process.stderr.write(
          formatError(
            {
              error: errData.error ?? "Unknown error",
              code: errData.code ?? "ERROR",
              detail: errData.detail,
            },
            globalFlags,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatOutput(result.data, globalFlags) + "\n");
      }
      process.exit(result.exitCode);
    }

    // Streaming commands handle their own output
    if (parsed.command.streaming) {
      return;
    }

    process.stdout.write(formatOutput(result.data, globalFlags) + "\n");
  } catch (error) {
    if (error instanceof DaemonConnectionError) {
      if (globalFlags.human) {
        process.stderr.write(error.message + "\n");
      } else {
        process.stdout.write(
          JSON.stringify({
            error: "Cannot connect to daemon",
            code: "CONNECTION_ERROR",
            detail: error.message,
          }, null, 2) + "\n",
        );
      }
      process.exit(EXIT_CONNECTION_ERROR);
    }

    if (error instanceof DaemonApiError) {
      if (globalFlags.human) {
        process.stderr.write(
          formatError(error.errorBody, globalFlags) + "\n",
        );
      } else {
        process.stdout.write(
          JSON.stringify(error.errorBody, null, 2) + "\n",
        );
      }
      process.exit(EXIT_APP_ERROR);
    }

    // Unexpected error
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(EXIT_APP_ERROR);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(EXIT_APP_ERROR);
});
