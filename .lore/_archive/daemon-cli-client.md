---
title: "Stage 7: CLI client"
date: 2026-03-14
status: executed
tags: [daemon, cli, mcp, progressive-discovery, agent-interaction, migration, stage-7]
modules: [cli, daemon]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/_archive/daemon-skeleton-shared-package.md
  - .lore/_archive/daemon-vault-foundation.md
  - .lore/_archive/daemon-stateless-file-operations.md
  - .lore/_archive/daemon-background-schedulers.md
  - .lore/_archive/daemon-session-lifecycle-chat.md
  - .lore/_archive/daemon-web-app-conversion.md
---

# Plan: Stage 7 - CLI Client

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 7 section)
**API conventions**: `.lore/research/daemon-rest-api.md`
**Previous stage plans**: `.lore/_archive/daemon-skeleton-shared-package.md` through `daemon-web-app-conversion.md`

Requirements addressed:
- REQ-DAB-7: CLI is a first-class client of the daemon API -> Steps 1-8
- REQ-DAB-8: Progressive discovery of capabilities -> Steps 2, 4, 5
- REQ-DAB-9: CLI commands cover same domain operations as web app -> Steps 3, 5
- REQ-DAB-10: Machine-readable output (JSON default, human flag) -> Steps 2, 5
- REQ-DAB-11: Agent interacts by invoking CLI commands -> Step 7
- REQ-DAB-12: Agent discovery via MCP tool definitions -> Steps 6, 7
- REQ-DAB-13: MCP tool definitions generated from CLI command metadata -> Steps 3, 6
- REQ-DAB-14: MCP server wraps CLI commands -> Deferred to [STUB: mcp-tool-projection]. This plan builds the projection mechanism (Step 6) and metadata commands (`mcp tools`, `mcp config`). The server that hosts these definitions is a separate deliverable.
- REQ-DAB-15: Human-agent parity at the application boundary -> Steps 5, 7
- REQ-DAB-25: Single-session concurrency constraint -> Enforced by the daemon, not the CLI. The CLI must handle 409 Conflict responses gracefully when a session is already active (Step 5a, tested in Step 8).

## Codebase Context

### Daemon API Surface (Stages 1-5)

The daemon serves ~50 endpoints by the time Stages 1-5 complete. The CLI maps to a curated subset. Here is the complete mapping from the REQ-DAB-9 command table to daemon endpoints, with a few additions drawn from the daemon's actual API surface:

| CLI Command | Daemon Endpoint | Stage |
|-------------|-----------------|-------|
| `vault list` | `GET /vaults` | 2 |
| `vault info <id>` | `GET /vaults/:id` | 2 |
| `vault create <title>` | `POST /vaults` | 2 |
| `capture <vault> <text>` | `POST /vaults/:id/capture` | 3 |
| `chat send <vault> <message>` | `POST /session/chat/send` | 5 |
| `chat stream <session>` | `GET /session/chat/stream` | 5 |
| `chat abort <session>` | `POST /session/chat/abort` | 5 |
| `chat history <vault>` | `GET /session/lookup/:vaultId` | 5 |
| `browse <vault> [path]` | `GET /vaults/:id/files` | 3 |
| `browse read <vault> <path>` | `GET /vaults/:id/files/*` | 3 |
| `search <vault> <query>` | `GET /vaults/:id/search/content` | 3 |
| `cards due <vault>` | `GET /vaults/:id/cards/due` | 4 |
| `cards review <vault> <id> <rating>` | `POST /vaults/:id/cards/:cardId/review` | 4 |
| `extract trigger <vault>` | `POST /vaults/:id/extract/trigger` | 4 |
| `extract status <vault>` | `GET /vaults/:id/extract/status` | 4 |
| `config get <vault>` | `GET /vaults/:id/config` | 2 |
| `config set <vault> <key> <value>` | `PUT /vaults/:id/config` | 2 |
| `health` | `GET /health` | 1 |
| `help` | `GET /help` | 1 |

That's 19 commands. The spec's table listed ~16; the additions (`browse read`, `extract status`, `help`) fill obvious gaps.

### Project Structure

The CLI will be a new workspace package at `cli/` alongside `daemon/` and `nextjs/`. It depends on `@memory-loop/shared` for types and schemas. It does not import from `daemon/` or `nextjs/`. Its only runtime communication with the daemon is HTTP over the Unix socket (or TCP fallback).

```
cli/
  package.json
  tsconfig.json
  src/
    index.ts              # Entry point, argument routing
    client.ts             # HTTP client for daemon API
    commands/             # One file per command group
      vault.ts
      capture.ts
      chat.ts
      browse.ts
      search.ts
      cards.ts
      extract.ts
      config.ts
      health.ts
    registry.ts           # Command metadata registry
    formatter.ts          # Output formatting (JSON/human)
    mcp.ts                # MCP tool definition projection
    types.ts              # CLI-specific types
  tests/
    *.test.ts
```

### Existing Patterns

- **Daemon socket connection**: Stage 2's vault-client established the pattern: `fetch("http://localhost/path", { unix: socketPath })`. The CLI uses the same `DAEMON_SOCKET` and `DAEMON_PORT` env vars.
- **Help discovery**: Stage 1 established `GET /help` at every hierarchy level, returning structured JSON with endpoint descriptions. The CLI can consume this directly.
- **Error format**: All daemon errors return `{ "error": string, "code": string, "detail"?: string }`. The CLI displays these uniformly.
- **SSE streaming**: Stage 5 established the daemon's SSE format (unnamed events, JSON payloads with `type` discriminator). The CLI's `chat stream` command consumes this.

## Decisions

### D1: No external CLI framework

The user's TypeScript setup rules recommend "Bun scripts (no framework)" for CLI utilities. This CLI is architecturally thin: each command parses arguments, calls one daemon endpoint, and formats the response. The progressive discovery comes from the daemon's `/help` endpoints, not from the CLI's own help system.

A custom command router (~60 lines) handles subcommand dispatch. Argument parsing is manual but minimal (each command takes 1-3 positional args plus optional flags). The alternative (Commander.js, Citty) would add a dependency for a problem that's small here.

The trade-off: hand-rolled arg parsing requires more test coverage. The gain: zero dependencies beyond `@memory-loop/shared`, and the command metadata format isn't constrained by a framework's plugin model, which matters for MCP projection (D5).

### D2: JSON output by default, `--human` flag for human-readable

REQ-DAB-10 says machine-readable by default. Every command outputs JSON to stdout. A global `--human` (or `-H`) flag switches to human-readable formatting: tables for lists, indented text for content, colored status for health.

Errors go to stderr in both modes. Exit codes: 0 for success, 1 for application errors (daemon returned 4xx/5xx), 2 for CLI usage errors (bad arguments), 3 for connection errors (daemon not reachable).

This design means piping works naturally: `memory-loop vault list | jq '.vaults[].id'`. Agents consuming CLI output parse JSON directly without needing `jq`.

### D3: Progressive discovery through daemon `/help` endpoints

The CLI's `help` subcommand (and the bare `memory-loop` invocation) calls the daemon's `GET /help` endpoint and renders the result. Subcommand help (e.g., `memory-loop vault help`) calls `GET /vaults/help`. This means the daemon is the single source of truth for what operations exist.

The CLI augments daemon help with local information: argument syntax, flag descriptions, and examples. This local metadata lives in the command registry (D4) and is merged with daemon help when rendering.

Discovery flow for a user who knows nothing:
```
$ memory-loop                    # Shows top-level command groups
$ memory-loop vault              # Shows vault subcommands
$ memory-loop vault list         # Runs the command
$ memory-loop vault list --human # Same, human-readable
```

The daemon's help response already contains `path`, `method`, and `description` for each endpoint (Stage 1, Step 6). The CLI maps these to its command names for display.

### D4: Command registry as structured metadata

Each CLI command is defined in a registry with structured metadata:

```typescript
interface CommandDefinition {
  name: string;                        // e.g., "vault list"
  description: string;                 // Human-readable description
  group: string;                       // Top-level group: "vault", "chat", etc.
  args: ArgumentDefinition[];          // Positional arguments
  flags: FlagDefinition[];             // Optional flags (beyond global --human)
  daemonEndpoint: {                    // What daemon endpoint to call
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    path: string;                      // e.g., "/vaults/:id"
    pathParams: string[];              // Args that fill path params
    queryParams: string[];             // Args that become query params
    bodyParams: string[];              // Args that go in request body
  };
  outputSchema: {                      // Describes the JSON output shape
    type: string;                      // JSON Schema type
    description: string;
    properties?: Record<string, unknown>;
  };
  examples: string[];                  // Usage examples for help text
  streaming?: boolean;                 // True for chat stream
}

interface ArgumentDefinition {
  name: string;
  description: string;
  required: boolean;
  type: "string" | "number";
}

interface FlagDefinition {
  name: string;
  short?: string;                     // Single-letter alias
  description: string;
  type: "boolean" | "string" | "number";
  default?: unknown;
}
```

This registry serves three purposes:
1. CLI help text generation (from `description`, `args`, `flags`, `examples`)
2. MCP tool definition projection (from `name`, `description`, `args`, `outputSchema`)
3. Command routing and argument validation (from `args`, `flags`, `daemonEndpoint`)

The registry is declarative data, not executable code. The command execution logic is separate.

### D5: MCP tool definition projection

REQ-DAB-13 says CLI command metadata is the canonical source for MCP tool definitions. The projection works as follows:

```typescript
// From a CommandDefinition, generate an MCP tool definition:
function projectToMcpTool(cmd: CommandDefinition): McpToolDefinition {
  return {
    name: cmd.name.replace(/ /g, "_"),     // "vault list" -> "vault_list"
    description: cmd.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        cmd.args.map(arg => [arg.name, {
          type: arg.type,
          description: arg.description,
        }])
      ),
      required: cmd.args
        .filter(a => a.required)
        .map(a => a.name),
    },
  };
}
```

The MCP server that wraps CLI commands (REQ-DAB-14) invokes the CLI binary for each tool call, passing arguments as positional params. The JSON output becomes the tool result. This is the simplest integration path: the MCP server doesn't need to know about the daemon API or command internals. It just shells out to the CLI.

The `mcp.ts` module exports two things:
1. `generateMcpToolDefinitions()`: Returns all command definitions projected into MCP format. This can be called by a standalone MCP server adapter.
2. A `memory-loop mcp tools` command that writes the definitions to stdout. An MCP server can call this on startup to discover available tools.

The MCP server itself is out of scope for this plan (it's the [STUB: mcp-tool-projection] exit point from the spec). This plan builds the projection mechanism and the `mcp tools` command. The server that hosts these definitions is a separate piece of work.

### D6: Chat streaming in the CLI

`chat stream` is the only SSE-consuming command. The CLI opens an SSE connection to the daemon and renders events as they arrive:

- **JSON mode** (default): Each SSE event is written as a separate JSON line to stdout. The stream of lines forms a JSON Lines (JSONL) output. This is the most machine-parseable format for streaming data.
- **Human mode** (`--human`): Text deltas are printed inline (no newlines between tokens), tool use is shown as `[tool: name]`, and the final response is followed by a newline.

The `chat send` command is non-streaming: it POSTs to the daemon, gets back `{ sessionId }`, and exits. A user who wants to see the response runs `chat stream <sessionId>` in a second terminal or captures the session ID: `SESSION=$(memory-loop chat send vault "question" | jq -r .sessionId) && memory-loop chat stream $SESSION`. For convenience, a `--stream` flag on `chat send` combines both operations: send the message, then immediately open the stream and display results until completion.

### D7: Vault resolution by name or ID

Most commands take a `<vault>` argument. The daemon's vault API uses vault IDs (directory names). Users may prefer vault titles. The CLI resolves vault arguments using a simple strategy:

1. Try the argument as a vault ID first (call `GET /vaults/:id`).
2. If not found, call `GET /vaults` and fuzzy-match against vault titles.
3. If exactly one match, use it. If multiple matches, list them and exit with an error.
4. If no match, error with "vault not found."

This resolution happens in the client layer, not in each command. The resolved vault ID is passed to the daemon endpoint.

## Precondition

Stages 1-5 must be complete before beginning this plan. The daemon must serve the full API surface listed in the command mapping table. Stage 6 (web app conversion) is NOT required; the CLI and web conversion are independent (per the brainstorm's ordering section).

## Implementation Steps

### Step 1: Create CLI package skeleton

**Files**: `cli/package.json`, `cli/tsconfig.json`, `cli/src/index.ts`
**Addresses**: REQ-DAB-7

1. Create `cli/` directory at the project root.

2. Create `cli/package.json`:
   ```json
   {
     "name": "@memory-loop/cli",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "bin": {
       "memory-loop": "src/index.ts"
     },
     "scripts": {
       "dev": "bun src/index.ts",
       "test": "LOG_LEVEL=silent bun test",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@memory-loop/shared": "workspace:*"
     },
     "devDependencies": {
       "bun-types": "^1.3.4",
       "typescript": "^5.7.2"
     }
   }
   ```

   The `bin` field maps `memory-loop` to the entry point. Bun executes TypeScript directly, so no build step is needed. Users run `bun link` in the `cli/` directory to make the `memory-loop` command available globally, or invoke it as `bun run --cwd cli dev -- <args>`.

3. Create `cli/tsconfig.json`:
   ```json
   {
     "extends": "../tsconfig.json",
     "compilerOptions": {
       "rootDir": "src",
       "paths": {
         "@/*": ["./src/*"]
       }
     },
     "include": ["src", "src/**/*.test.ts"]
   }
   ```

4. Create `cli/src/index.ts` as a minimal entry point:
   - Parse `process.argv` to extract command name, args, and global flags
   - Print usage when invoked with no arguments
   - Placeholder for command routing (Step 3)

5. Update root `package.json`:
   - Add `cli` to workspaces: `["nextjs", "packages/shared", "daemon", "cli"]`
   - Add root scripts: `"cli:test"`, `"cli:typecheck"`

6. Update root quality scripts (`typecheck`, `lint`, `test`) to include the CLI package.

7. Run `bun install` to link workspace dependencies.

**Verification**: `bun run --cwd cli typecheck` passes. `bun run --cwd cli dev` prints usage text. `memory-loop` is invocable after `bun link`.

### Step 2: Implement daemon HTTP client and output formatter

**Files**: `cli/src/client.ts`, `cli/src/formatter.ts`, `cli/src/types.ts`
**Addresses**: REQ-DAB-7, REQ-DAB-10

1. Create `cli/src/types.ts` with CLI-specific types:
   - `GlobalFlags`: `{ human: boolean; socket?: string; port?: number }`
   - `CommandResult`: `{ data: unknown; exitCode: number }`
   - `DaemonError`: `{ error: string; code: string; detail?: string }`

2. Create `cli/src/client.ts`:
   - Read `DAEMON_SOCKET` env var (default: `$XDG_RUNTIME_DIR/memory-loop.sock` or `/tmp/memory-loop.sock`). Same default logic as the daemon (Stage 1, Step 5).
   - Read `DAEMON_PORT` env var for TCP fallback.
   - Export `daemonFetch(path, options?)`: wraps `fetch()` with Unix socket support. Returns the Response directly.
   - Export `daemonJson<T>(path, options?)`: calls `daemonFetch`, parses JSON, returns typed result. On non-2xx responses, throws a typed error.
   - Export `daemonSSE(path)`: calls `daemonFetch`, returns an `AsyncIterable<{ type: string; data: string }>` of parsed SSE events. Handles frame splitting (`\n\n`), `data:` line extraction, and comment filtering (keep-alive lines starting with `:`). Consumers iterate parsed event objects, not raw bytes. Used by `chat stream` and `chat send --stream`.
   - Vault resolution (D7): Export `resolveVault(idOrName: string): Promise<string>` that tries exact ID first, then fuzzy-matches against vault list.

3. Create `cli/src/formatter.ts`:
   - Export `formatOutput(data: unknown, flags: GlobalFlags): string`:
     - JSON mode (default): `JSON.stringify(data, null, 2)`
     - Human mode: dispatches to type-specific formatters based on data shape
   - Type-specific human formatters:
     - `formatVaultList(vaults)`: table with id, title, content root
     - `formatVaultInfo(vault)`: key-value pairs
     - `formatHealth(health)`: colored status, uptime, scheduler states
     - `formatFileList(entries)`: tree-style directory listing
     - `formatFileContent(content)`: raw text output
     - `formatCardsDue(cards)`: table with question preview, due date, interval
     - `formatSearchResults(results)`: file paths with match context
     - `formatConfig(config)`: key-value pairs with defaults noted
   - Export `formatError(error: DaemonError, flags: GlobalFlags): string`: uniform error display
   - Human-mode formatting uses only ANSI escape codes (no external library). Keep it simple: bold for headers, dim for secondary info, red for errors. Check `process.stdout.isTTY` before emitting color codes; suppress them when piped.

**Verification**: Unit tests for client (mocked fetch) and formatter (snapshot tests for each format).

### Step 3: Define command registry

**Files**: `cli/src/registry.ts`, `cli/src/commands/*.ts` (stubs)
**Addresses**: REQ-DAB-9, REQ-DAB-13, D4

1. Create `cli/src/registry.ts`:
   - Define the `CommandDefinition`, `ArgumentDefinition`, and `FlagDefinition` interfaces (from D4).
   - Export `COMMANDS: CommandDefinition[]` containing all 19 commands.
   - Export `findCommand(argv: string[]): { command: CommandDefinition; args: Record<string, string>; flags: Record<string, unknown> } | null` that matches argv against the registry and extracts typed arguments.
   - Export `getCommandGroups(): string[]` that returns unique top-level groups for help display.
   - Export `getGroupCommands(group: string): CommandDefinition[]` for group-level help.

2. Register all 19 commands. Each entry declares the mapping from CLI surface to daemon endpoint. Example:

   ```typescript
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
         vaults: { type: "array", items: { type: "object" } },
       },
     },
     examples: ["memory-loop vault list", "memory-loop vault list --human"],
   }
   ```

   And a more complex example:

   ```typescript
   {
     name: "chat send",
     description: "Send a message to start or continue a discussion",
     group: "chat",
     args: [
       { name: "vault", description: "Vault ID or name", required: true, type: "string" },
       { name: "message", description: "Message text", required: true, type: "string" },
     ],
     flags: [
       { name: "stream", short: "s", description: "Stream the response after sending", type: "boolean", default: false },
       { name: "session", description: "Resume a specific session ID", type: "string" },
     ],
     daemonEndpoint: {
       method: "POST",
       path: "/session/chat/send",
       pathParams: [],
       queryParams: [],
       bodyParams: ["vault", "message", "session"],
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
       'memory-loop chat send my-vault "Continue our discussion" --stream',
     ],
     streaming: false,
   }
   ```

3. Create stub command files in `cli/src/commands/` (one per group: `vault.ts`, `capture.ts`, `chat.ts`, `browse.ts`, `search.ts`, `cards.ts`, `extract.ts`, `config.ts`, `health.ts`). Each exports an `execute(command, args, flags)` function that will be filled in Step 5.

**Verification**: `findCommand(["vault", "list"])` returns the correct definition. `findCommand(["nonexistent"])` returns null. All 19 commands are registered with valid metadata.

### Step 4: Implement progressive discovery UX

**Files**: `cli/src/index.ts` (update), `cli/src/help.ts` (new)
**Addresses**: REQ-DAB-8, D3

1. Create `cli/src/help.ts`:
   - Export `showTopLevelHelp(flags: GlobalFlags)`: Calls `GET /help` from the daemon, merges with local command registry to show available command groups with descriptions.

     Human mode:
     ```
     memory-loop - Personal knowledge management

     Commands:
       vault      Manage vaults
       capture    Capture text to daily notes
       chat       AI conversations
       browse     Browse vault files
       search     Search vault content
       cards      Spaced repetition
       extract    Memory extraction
       config     Vault configuration
       health     Daemon status
       help       Show this help
       mcp        MCP tool definitions

     Run 'memory-loop <command>' to see subcommands.
     Global flags: --human (-H), --socket <path>, --port <number>
     ```

     JSON mode:
     ```json
     {
       "commands": [
         { "name": "vault", "description": "Manage vaults", "subcommands": ["list", "info", "create"] },
         ...
       ],
       "globalFlags": [...]
     }
     ```

   - Export `showGroupHelp(group: string, flags: GlobalFlags)`: Lists subcommands for a group. Pulls descriptions from the command registry.

     Human mode example for `memory-loop vault`:
     ```
     vault - Manage vaults

     Subcommands:
       list               List discovered vaults
       info <id>          Show vault details and config
       create <title>     Create a new vault

     Examples:
       memory-loop vault list --human
       memory-loop vault info my-vault
     ```

   - Export `showCommandHelp(command: CommandDefinition, flags: GlobalFlags)`: Shows full help for a specific command, including arguments, flags, examples, and output schema description.

2. Update `cli/src/index.ts` to wire help into the routing:
   - No arguments -> `showTopLevelHelp()`
   - Single argument matching a group name -> `showGroupHelp(group)`
   - `<group> help` -> `showGroupHelp(group)`
   - `<group> <subcommand> --help` -> `showCommandHelp(command)`
   - `help` -> `showTopLevelHelp()`

   The progressive discovery principle: running ANY partial command shows what's available next. `memory-loop` shows groups. `memory-loop vault` shows vault subcommands. There is never a "command not found" without a suggestion of what exists.

3. Handle the "daemon not running" case gracefully. If the daemon isn't reachable:
   - Top-level help still works (rendered from local registry, no daemon call needed for basic help)
   - Commands that need the daemon fail with a clear message: `Error: Cannot connect to Memory Loop daemon. Is it running?`
   - Suggest: `Start with: bun run --cwd daemon start`

**Verification**: `memory-loop` prints top-level help without requiring the daemon. `memory-loop vault` prints vault subcommands. `memory-loop vault list --help` prints full command help.

### Step 5a: Implement stateless commands

**Files**: `cli/src/commands/*.ts` (fill stubs from Step 3), `cli/src/index.ts` (update routing)
**Addresses**: REQ-DAB-9, REQ-DAB-15, REQ-DAB-25

Each command follows the same pattern:

```typescript
export async function execute(
  args: Record<string, string>,
  flags: Record<string, unknown>,
  globalFlags: GlobalFlags
): Promise<CommandResult> {
  // 1. Resolve vault ID if needed
  const vaultId = args.vault ? await resolveVault(args.vault) : undefined;

  // 2. Call daemon endpoint
  const data = await daemonJson("/vaults/" + vaultId + "/...");

  // 3. Return result (formatting happens in the caller)
  return { data, exitCode: 0 };
}
```

Wire the routing in `cli/src/index.ts`:
- `findCommand(argv)` returns the matched command definition and parsed args
- Look up the execute function by command group
- Call execute, pass result through `formatOutput`, write to stdout
- On error, format error, write to stderr, exit with appropriate code

Implement all non-streaming commands in this step: `vault list`, `vault info`, `vault create`, `capture`, `chat send` (without `--stream`), `chat abort`, `chat history`, `browse`, `browse read`, `search`, `cards due`, `cards review`, `extract trigger`, `extract status`, `config get`, `config set`, `health`, `help`.

**Command-specific notes:**

**`chat send`** (non-streaming case, without `--stream`):
- POSTs to `/session/chat/send`, returns `{ sessionId }`.
- If the daemon returns 409 Conflict (REQ-DAB-25, another session is active), display: `Error: A chat session is already active. Use 'chat abort <sessionId>' to stop it, or wait for it to complete.` Include the active session ID from the error detail if provided.

**`capture`** (simple POST):
- Text argument can be a string or `-` for stdin. When `-` is passed, reads all of stdin. This supports `echo "thought" | memory-loop capture my-vault -`.

**`browse`** (dual purpose):
- Without a path: lists the root directory
- With a path to a directory: lists that directory
- With a path to a file: reads the file content
- The CLI determines which endpoint to call based on the daemon's response (if listing fails with "not a directory," fall back to file read). Alternatively, always call the list endpoint first, and if the path is a file, call the read endpoint. Keep it simple.

**`browse read`** (explicit file read):
- Always reads a file. For users who know they want file content, not a listing.

**`config set`** (partial update):
- Takes `<key> <value>` and sends `PUT /vaults/:id/config` with `{ [key]: value }`.
- Supports dot-notation for nested keys: `config set vault "discussion.model" "claude-sonnet-4-5-20241022"` sends `{ "discussion": { "model": "claude-sonnet-4-5-20241022" } }`.
- Validates the value type based on the key (boolean, number, string, array). The validation uses the `EditableVaultConfig` schema from `@memory-loop/shared`.

**`cards review`** (rating submission):
- The `<rating>` argument accepts: `again`, `hard`, `good`, `easy` (or numeric 0-3). Maps to the SM-2 quality values.

**Verification**: Each command has a unit test that mocks `daemonFetch` and verifies: correct endpoint called, correct args/body sent, output formatted correctly in both JSON and human modes. Include a test for 409 Conflict handling on `chat send`.

### Step 5b: Implement streaming commands

**Files**: `cli/src/commands/chat.ts` (streaming paths), `cli/src/client.ts` (refine `daemonSSE`)
**Addresses**: REQ-DAB-9, REQ-DAB-15
**Expertise**: Use `pr-review-toolkit:code-reviewer` after this step for error handling, SIGINT cleanup, and stream lifecycle review.

This step implements the two streaming operations that consume SSE from the daemon. These are separated from 5a because they're substantially more complex (SSE parsing, SIGINT handling, streaming output) and deserve their own review checkpoint.

**`daemonSSE` contract (refine in `client.ts`):**
- `daemonSSE(path)` returns an `AsyncIterable<{ type: string; data: string }>` of parsed SSE events. It handles frame splitting (`\n\n`), `data:` line extraction, and comment filtering (keep-alive lines starting with `:`). Command code iterates parsed event objects, not raw bytes. This contract must be settled here, not left ambiguous for Step 5b and Step 8 to interpret differently.

**`chat stream`** (SSE consumer):
- Uses `daemonSSE("/session/chat/stream")` to get parsed events
- JSON mode: writes each event's data field as a separate JSON line to stdout (JSONL)
- Human mode: renders `text_delta` events inline (no newlines between tokens), `tool_use` as `[tool: name]`, errors in red
- Exits on terminal events (`response_end`, `error`, `session_cleared`)
- Handles SIGINT: sends `POST /session/chat/abort` before exiting, then closes the stream cleanly

**`chat send --stream`** (combined send + stream):
- Sends the message via POST, captures `sessionId` from response
- Opens SSE stream for that session
- Renders events until completion
- Same SIGINT handling as `chat stream`

**Verification**: Unit tests with a mock SSE source verifying both JSON and human rendering modes, SIGINT abort behavior, and terminal event handling.

### Step 6: Implement MCP tool definition projection

**Files**: `cli/src/mcp.ts`, `cli/src/commands/mcp.ts` (new command)
**Addresses**: REQ-DAB-13, D5

1. Create `cli/src/mcp.ts`:
   - Import the command registry from `registry.ts`
   - Export `generateMcpToolDefinitions(): McpToolDefinition[]`:
     - Iterates all commands in the registry
     - Projects each `CommandDefinition` into an MCP tool definition:
       - `name`: command name with spaces replaced by underscores (`vault_list`, `chat_send`)
       - `description`: from command definition
       - `inputSchema`: JSON Schema object built from `args` and `flags`
       - Required fields derived from `args.filter(a => a.required)`
     - Streaming commands (`chat stream`) include a note in their description that output is streamed
   - Export `generateMcpConfig(): object`: Returns an MCP server configuration object that can be written to an `.mcp.json` file. Includes the server command (`memory-loop mcp serve`) and tool definitions.

2. Create `cli/src/commands/mcp.ts`:
   - `memory-loop mcp tools`: Outputs all MCP tool definitions as JSON. This is the entry point for an external MCP server adapter to discover available tools.
   - `memory-loop mcp config`: Outputs an MCP server configuration block suitable for adding to an `.mcp.json` file or Claude Desktop config. This is a DX convenience beyond what REQ-DAB-12/13 strictly require, but it removes friction for agent setup.

3. Add `mcp tools` and `mcp config` to the command registry. These commands are meta-commands (they describe the CLI itself) and don't call daemon endpoints. Their `daemonEndpoint` is null; the execute function calls `generateMcpToolDefinitions()` or `generateMcpConfig()` directly.

4. The actual MCP server that wraps CLI commands (REQ-DAB-14) is out of scope for this plan. This step builds the projection mechanism and the metadata commands. The server is a separate piece of work tracked by the [STUB: mcp-tool-projection] exit point in the spec.

**Verification**: `memory-loop mcp tools` outputs valid JSON with all 19 command definitions. Each definition has `name`, `description`, and `inputSchema` with correct required/optional fields. `memory-loop mcp config` outputs a valid MCP configuration block.

### Step 7: Validate human-agent parity

**Files**: none (verification step)
**Addresses**: REQ-DAB-15

Verify that every operation available through the web app or CLI is also available to agents through MCP tool definitions:

1. Compare the MCP tool definitions from `memory-loop mcp tools` against the CLI command registry. They must be 1:1 (every CLI command has a corresponding MCP tool).

2. Compare the CLI command list against the daemon's `GET /help` response. Every daemon endpoint that maps to a user-facing operation should have a CLI command. Endpoints that are internal (transcripts/append, for instance) don't need CLI commands.

3. Verify that the JSON output of each command is parseable and actionable by an agent. An agent reading `memory-loop vault list` output should be able to extract vault IDs for subsequent commands. An agent reading `memory-loop chat send` output should be able to extract the session ID for `chat stream`.

This step is a review, not implementation. Launch a sub-agent with fresh context that reads the command registry, the MCP tool definitions, and the daemon's help output, and flags any gaps.

### Step 8: Write integration tests

**Files**: `cli/tests/integration.test.ts`, `cli/tests/commands/*.test.ts`
**Addresses**: All requirements

**Unit tests** (per-command, mocked daemon):

Each command gets a test file in `cli/tests/commands/`. Tests mock `daemonFetch` (dependency injection through the client module) and verify:

1. Correct daemon endpoint and HTTP method called
2. Correct path params, query params, and body constructed from CLI args
3. JSON output matches daemon response (pass-through)
4. Human output contains expected content (snapshot tests)
5. Error cases: daemon 404, daemon 500, daemon unreachable
6. Exit codes: 0 on success, 1 on daemon error, 2 on bad args, 3 on connection failure

**Registry tests**:

1. All 19 commands are registered
2. `findCommand` correctly parses each command's argv pattern
3. Ambiguous or partial commands return appropriate results
4. Every command has non-empty description, examples, and outputSchema

**MCP projection tests**:

1. `generateMcpToolDefinitions()` returns 19 + 2 (mcp meta-commands) definitions
2. Each definition has valid JSON Schema for inputSchema
3. Required fields match command args where `required: true`
4. Tool names use underscores, not spaces

**Formatter tests**:

1. JSON mode produces valid JSON for each output type
2. Human mode produces expected table/text format (snapshot tests)
3. Color codes suppressed when stdout is not a TTY
4. Error formatting works in both modes

**Integration tests** (real daemon, if available):

1. Start the daemon in-process (import Hono app, use `app.request()`)
2. Create a temp vaults directory with fixture data
3. Run CLI commands programmatically (import execute functions, pass args)
4. Verify end-to-end: `vault list` returns fixture vaults, `capture` creates a file, `search` finds content, `config get/set` round-trips
5. Skip `chat send`/`chat stream` in integration tests (requires SDK or mock-sdk). These are covered by daemon-level tests in Stage 5.

**SSE streaming tests** (chat stream):

1. Create a mock SSE server that emits known events
2. Verify CLI renders events in both JSON and human mode
3. Verify SIGINT triggers abort call
4. Verify stream closes on terminal events

**Verification**: `bun run --cwd cli test` passes with >90% coverage on new code.

### Step 9: Update build and test infrastructure

**Files**: Root `package.json`, `.git-hooks/pre-commit.sh`

1. Add CLI to the pre-commit hook:
   - `bun run --cwd cli typecheck`
   - `bun run --cwd cli test`

2. Update root `test` and `typecheck` scripts to include the CLI package.

3. Add a root convenience script: `"cli": "bun run --cwd cli dev --"` so users can run `bun run cli vault list` from the project root.

**Verification**: Pre-commit hook runs CLI checks. Root `bun run test` includes CLI tests.

### Step 10: Validate against spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md` (REQ-DAB-7 through REQ-DAB-15), the brainstorm at `.lore/brainstorm/daemon-migration-stages.md` (Stage 7 section), and reviews the implementation. Flag any requirements not met.

Checklist for validation:
- [ ] CLI is a workspace package at `cli/` with its own package.json and tests
- [ ] All 19 commands from the expanded command table are implemented and tested
- [ ] JSON output is the default for all commands (REQ-DAB-10)
- [ ] `--human` flag produces human-readable output for all commands (REQ-DAB-10)
- [ ] Progressive discovery works: bare invocation shows groups, group invocation shows subcommands (REQ-DAB-8)
- [ ] Help is available at every level without requiring a running daemon (REQ-DAB-8)
- [ ] MCP tool definitions are generated from command registry metadata (REQ-DAB-13)
- [ ] Every CLI command has a corresponding MCP tool definition (REQ-DAB-15)
- [ ] `chat stream` correctly consumes daemon SSE and renders in both output modes
- [ ] Vault arguments accept both ID and name (fuzzy resolution)
- [ ] Exit codes are consistent: 0 success, 1 app error, 2 usage error, 3 connection error
- [ ] No imports from `daemon/` or `nextjs/` (only `@memory-loop/shared`)
- [ ] `bun run typecheck`, `bun run lint`, `bun run test` all pass from root
- [ ] Pre-commit hook includes CLI checks

## Delegation Guide

Steps requiring specialized expertise:

- **Step 5a** (stateless commands): Review `config set` dot-notation parsing for edge cases (nested keys, array values). Review 409 Conflict handling on `chat send`.

- **Step 5b** (streaming commands): The `chat stream` SSE consumer is the most complex command. Use `pr-review-toolkit:code-reviewer` after implementing it to verify error handling, SIGINT cleanup, and stream lifecycle.

- **Step 6** (MCP projection): Use `pr-review-toolkit:code-reviewer` to verify the generated MCP tool definitions match the MCP protocol spec. Incorrect schemas will cause agent failures that are hard to diagnose.

- **Step 7** (parity validation): Use `lore-development:fresh-lore` agent with fresh context to compare CLI commands, MCP tools, and daemon endpoints. The implementer is too close to see gaps.

- **Step 8** (integration tests): Use `pr-review-toolkit:pr-test-analyzer` to verify test coverage meets the 90% target on new code.

Consult `.lore/lore-agents.md` for the full agent registry.

## Risks

**R1: Bun `fetch()` + Unix socket support.** The CLI uses the same `fetch("url", { unix: socketPath })` pattern as the Next.js transitional clients (Stage 2). If this pattern isn't supported in Bun's CLI context (it works in Next.js's server context), the fallback is `DAEMON_PORT` TCP. Test this in Step 2 before building all commands.

**R2: SSE parsing without a library.** The `chat stream` command parses SSE manually (split on `\n\n`, extract `data:` lines). SSE parsing is simple enough that a library isn't warranted, but edge cases exist: multi-line data fields, comments (keep-alive), empty events. The daemon's SSE format is controlled (Stage 1 conventions), so only the documented patterns need to be handled. Test against the daemon's actual output, not a theoretical SSE spec.

**R3: Vault name resolution ambiguity.** Fuzzy matching vault titles could match multiple vaults. The CLI handles this by listing matches and erroring, but this UX could frustrate users with similarly-named vaults. Mitigation: exact ID match is tried first, so users who know the ID bypass fuzzy matching entirely.

**R4: MCP tool definitions drift.** If a new daemon endpoint is added and a CLI command is created for it, the MCP tool definitions update automatically (they're projected from the registry). But if someone adds a daemon endpoint without a CLI command, agents won't see it. This is by design (REQ-DAB-15 says parity at the CLI level), but it means the CLI command table must stay current with the daemon API. The validation step (Step 7) catches drift.

**R5: Human output formatting maintenance.** Each new command or response shape change requires updating the human formatter. JSON mode is maintenance-free (pass-through), but human mode requires per-type formatting functions. Keep the human formatters simple and generic where possible (table for arrays, key-value for objects) to reduce the surface area.

## Acceptance Criteria

Stage 7 is complete when:

1. The CLI is a workspace package at `cli/` with `@memory-loop/shared` as its only workspace dependency
2. `memory-loop` is invocable as a CLI tool (via `bun link` or direct execution)
3. All 19 commands are implemented and produce correct JSON output
4. `--human` flag produces readable output for every command
5. Progressive discovery works at every level: no arguments, group name, subcommand, `--help`
6. Help renders from local registry without requiring a running daemon
7. `chat stream` renders SSE events in both JSON (JSONL) and human modes
8. `memory-loop mcp tools` outputs valid MCP tool definitions for all commands
9. `memory-loop mcp config` outputs a valid MCP server configuration block
10. Every CLI command has a corresponding MCP tool definition (human-agent parity)
11. Exit codes are consistent: 0/1/2/3 per the convention in D2
12. Unit tests cover all commands with >90% coverage
13. Integration tests verify end-to-end flow against a test daemon
14. `bun run typecheck`, `bun run lint`, `bun run test` all pass from root
15. Pre-commit hook includes CLI package checks
