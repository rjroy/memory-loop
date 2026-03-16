/**
 * Progressive discovery help system.
 *
 * Renders help from the local command registry without requiring
 * a running daemon. The daemon's /help endpoints are not called;
 * all help content is derived from the structured command metadata.
 */

import type { GlobalFlags } from "./types";
import {
  COMMANDS,
  getCommandGroups,
  getGroupCommands,
  type CommandDefinition,
} from "./registry";

// ---------------------------------------------------------------------------
// ANSI helpers (duplicated from formatter to avoid circular deps)
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY === true;

function bold(text: string): string {
  return isTTY ? `\x1b[1m${text}\x1b[0m` : text;
}

function dim(text: string): string {
  return isTTY ? `\x1b[2m${text}\x1b[0m` : text;
}

// ---------------------------------------------------------------------------
// Group descriptions (local metadata, no daemon needed)
// ---------------------------------------------------------------------------

const GROUP_DESCRIPTIONS: Record<string, string> = {
  vault: "Manage vaults",
  capture: "Capture text to daily notes",
  chat: "AI conversations",
  browse: "Browse vault files",
  search: "Search vault content",
  cards: "Spaced repetition",
  extract: "Memory extraction",
  config: "Vault configuration",
  health: "Daemon status",
  help: "Show this help",
  mcp: "MCP tool definitions",
};

// ---------------------------------------------------------------------------
// Help rendering
// ---------------------------------------------------------------------------

function formatCommandSignature(cmd: CommandDefinition): string {
  const parts = [cmd.name];
  for (const arg of cmd.args) {
    parts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
  }
  return parts.join(" ");
}

export function showTopLevelHelp(flags: GlobalFlags): void {
  if (!flags.human) {
    const groups = getCommandGroups().map((group) => ({
      name: group,
      description: GROUP_DESCRIPTIONS[group] ?? "",
      subcommands: getGroupCommands(group).map((cmd) => {
        const parts = cmd.name.split(" ");
        return parts.length > 1 ? parts.slice(1).join(" ") : cmd.name;
      }),
    }));
    const globalFlags = [
      { name: "human", short: "H", description: "Human-readable output" },
      { name: "socket", description: "Daemon socket path" },
      { name: "port", description: "Daemon TCP port" },
    ];
    process.stdout.write(
      JSON.stringify({ commands: groups, globalFlags }, null, 2) + "\n",
    );
    return;
  }

  const lines: string[] = [
    bold("memory-loop") + " - Personal knowledge management",
    "",
    "Commands:",
  ];

  const groups = getCommandGroups();
  const maxLen = Math.max(...groups.map((g) => g.length));

  for (const group of groups) {
    const desc = GROUP_DESCRIPTIONS[group] ?? "";
    lines.push(`  ${group.padEnd(maxLen + 2)}${desc}`);
  }

  lines.push("");
  lines.push("Run 'memory-loop <command>' to see subcommands.");
  lines.push(
    dim("Global flags: --human (-H), --socket <path>, --port <number>"),
  );

  process.stdout.write(lines.join("\n") + "\n");
}

export function showGroupHelp(group: string, flags: GlobalFlags): void {
  const commands = getGroupCommands(group);
  if (commands.length === 0) {
    process.stderr.write(`Unknown command group: ${group}\n`);
    process.stderr.write("Run 'memory-loop' to see available commands.\n");
    return;
  }

  if (!flags.human) {
    const output = {
      group,
      description: GROUP_DESCRIPTIONS[group] ?? "",
      commands: commands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        args: cmd.args,
        flags: cmd.flags,
      })),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  const desc = GROUP_DESCRIPTIONS[group] ?? "";
  const lines: string[] = [bold(group) + ` - ${desc}`, "", "Subcommands:"];

  const sigs = commands.map((cmd) => formatCommandSignature(cmd));
  const maxSig = Math.max(...sigs.map((s) => s.length));

  for (let i = 0; i < commands.length; i++) {
    lines.push(`  ${sigs[i].padEnd(maxSig + 2)}${commands[i].description}`);
  }

  // Collect examples from all commands in the group
  const examples = commands.flatMap((c) => c.examples).slice(0, 4);
  if (examples.length > 0) {
    lines.push("", "Examples:");
    for (const ex of examples) {
      lines.push(`  ${dim(ex)}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

export function showCommandHelp(
  cmd: CommandDefinition,
  flags: GlobalFlags,
): void {
  if (!flags.human) {
    process.stdout.write(
      JSON.stringify(
        {
          name: cmd.name,
          description: cmd.description,
          args: cmd.args,
          flags: cmd.flags,
          outputSchema: cmd.outputSchema,
          examples: cmd.examples,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const lines: string[] = [
    bold(formatCommandSignature(cmd)),
    "",
    cmd.description,
  ];

  if (cmd.args.length > 0) {
    lines.push("", "Arguments:");
    for (const arg of cmd.args) {
      const req = arg.required ? "(required)" : "(optional)";
      lines.push(`  ${arg.name.padEnd(12)} ${arg.description} ${dim(req)}`);
    }
  }

  if (cmd.flags.length > 0) {
    lines.push("", "Flags:");
    for (const flag of cmd.flags) {
      const shortStr = flag.short ? `-${flag.short}, ` : "    ";
      const defaultStr =
        flag.default !== undefined
          ? dim(` (default: ${typeof flag.default === "string" ? flag.default : JSON.stringify(flag.default)})`)
          : "";
      lines.push(
        `  ${shortStr}--${flag.name.padEnd(12)} ${flag.description}${defaultStr}`,
      );
    }
  }

  if (cmd.examples.length > 0) {
    lines.push("", "Examples:");
    for (const ex of cmd.examples) {
      lines.push(`  ${dim(ex)}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

/**
 * Check if argv is requesting help for a group.
 * Returns the group name if so, null otherwise.
 */
export function isGroupHelpRequest(argv: string[]): string | null {
  if (argv.length === 0) return null;

  const groups = getCommandGroups();
  const first = argv[0];

  // "memory-loop vault" (single group name, no subcommand)
  if (argv.length === 1 && groups.includes(first)) {
    // Check if it's also a top-level command (like "health", "help", "capture", "search")
    const exactCmd = COMMANDS.find((c) => c.name === first);
    if (exactCmd) return null; // It's a command, not a group help request
    return first;
  }

  // "memory-loop vault help"
  if (argv.length === 2 && argv[1] === "help" && groups.includes(first)) {
    return first;
  }

  return null;
}
