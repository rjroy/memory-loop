---
title: Claude Agent SDK and agent-sdk-dev Plugin
date: 2026-02-11
status: archived
tags: [agent-sdk, mcp, frontend, python, typescript]
related: [.lore/research/claude-agent-sdk-ref-typescript.md]
modules: [guild-hall]
---

# Research: Claude Agent SDK and agent-sdk-dev Plugin

## Summary

The Claude Agent SDK is Anthropic's library for building production AI agents programmatically. It provides the same tools, agent loop, and context management that power Claude Code, available in both Python and TypeScript. The `agent-sdk-dev` plugin is the official Claude Code plugin that streamlines creating and verifying Agent SDK applications.

Guild Hall is being redesigned from a multi-agent orchestration system to a frontend application with MCP tools (agents may be spawned but are not the primary goal). This research documents the SDK's architecture, capabilities, and tooling. The MCP integration, hooks, permissions, and custom tools sections are most directly relevant to the new direction.

## Key Findings

### 1. SDK Architecture

The Agent SDK wraps Claude Code's CLI as a subprocess, communicating via JSON over stdin/stdout. The key insight: the SDK does not implement tool execution itself. It delegates to the bundled Claude Code CLI, which handles all tool orchestration, context management, and the agent loop.

**Two primary interfaces (Python):**

| Interface | Session Model | Hooks/Custom Tools | Interrupts | Use Case |
|-----------|--------------|-------------------|------------|----------|
| `query()` | New session per call | Not supported | Not supported | One-off tasks, CI/CD |
| `ClaudeSDKClient` | Persistent session | Supported | Supported | Conversations, interactive apps |

TypeScript has `query()` that returns a `Query` object (async generator with additional methods like `interrupt()`, `setPermissionMode()`, etc.). A V2 preview with `send()`/`receive()` patterns is also available.

**Current versions (as of 2026-02-11):**
- TypeScript: `@anthropic-ai/claude-agent-sdk@0.2.39` (npm)
- Python: `claude-agent-sdk` (PyPI, version TBD)

### 2. Built-in Tools

The SDK provides the same tools available in Claude Code:

| Tool | Description |
|------|-------------|
| Read | Read any file in the working directory |
| Write | Create new files |
| Edit | Precise string replacement edits |
| Bash | Run terminal commands, scripts, git |
| Glob | File pattern matching |
| Grep | Content search with regex (ripgrep) |
| WebSearch | Web search for current information |
| WebFetch | Fetch and parse web page content |
| AskUserQuestion | Ask the user clarifying questions |
| Task | Launch subagents for focused subtasks |
| NotebookEdit | Edit Jupyter notebooks |
| TodoWrite | Manage structured task lists |
| BashOutput / KillBash | Background process management |
| ListMcpResources / ReadMcpResource | MCP resource access |
| ExitPlanMode | Exit planning mode |

### 3. Permissions Model

Permissions are evaluated in a strict order:

1. **Hooks** (can allow, deny, or pass through)
2. **Permission rules** (declarative allow/deny in settings.json)
3. **Permission mode** (global setting)
4. **`canUseTool` callback** (runtime custom logic)

**Permission modes:**

| Mode | Behavior |
|------|----------|
| `default` | No auto-approvals; unmatched tools trigger `canUseTool` |
| `acceptEdits` | Auto-approves file edits and filesystem operations |
| `dontAsk` | All tools run without prompts (dangerous, inherits to subagents) |
| `plan` | No tool execution; Claude plans only |

The `canUseTool` callback can modify tool inputs (e.g., redirect file paths to a sandbox), deny with messages, or interrupt execution entirely.

### 4. MCP Integration

Three transport types for MCP servers:

- **stdio**: Local processes communicating via stdin/stdout
- **HTTP/SSE**: Remote servers over HTTP
- **SDK MCP servers**: In-process custom tools (no separate process needed)

**In-process custom tools (Python):**
```python
@tool("greet", "Greet a user", {"name": str})
async def greet(args):
    return {"content": [{"type": "text", "text": f"Hello, {args['name']}!"}]}

server = create_sdk_mcp_server(name="mytools", tools=[greet])
```

**TypeScript uses Zod schemas** for tool input validation instead of Python's dict-based approach.

MCP tool naming convention: `mcp__<server-name>__<tool-name>`. Wildcard support: `mcp__github__*`.

**Tool search**: Auto-activates when MCP tools exceed 10% of context window, dynamically loading tools on demand rather than preloading all.

### 5. Subagents

Subagents are specialized agents spawned via the `Task` tool. They can be defined:
- **Programmatically**: via the `agents` option in `ClaudeAgentOptions`
- **Via filesystem**: `.claude/agents/` markdown files (requires `settingSources: ["project"]`)

Each subagent definition includes:
- `description`: When to use this agent (natural language)
- `prompt`: The agent's system prompt
- `tools`: Allowed tools (inherits all if omitted)
- `model`: Optional model override (`sonnet`, `opus`, `haiku`, `inherit`)

Messages from subagents include `parent_tool_use_id` for tracking.

### 6. Sessions

Sessions maintain context across multiple exchanges:
- Capture `session_id` from the `init` system message
- Resume via `resume` option with the session ID
- Fork sessions with `fork_session: true` to explore different approaches
- `ClaudeSDKClient` maintains sessions automatically across `query()` calls

### 7. Hooks System

SDK hooks use callback functions (not shell commands like CLI hooks):

| Hook Event | Description | Python Support |
|------------|-------------|---------------|
| PreToolUse | Before tool execution | Yes |
| PostToolUse | After tool execution | Yes |
| PostToolUseFailure | After tool failure | TS only |
| UserPromptSubmit | When user submits prompt | Yes |
| Stop | When stopping execution | Yes |
| SubagentStop | When subagent stops | Yes |
| SubagentStart | When subagent starts | TS only |
| SessionStart | Session initialization | TS only |
| SessionEnd | Session termination | TS only |
| PreCompact | Before message compaction | Yes |
| Notification | System notifications | TS only |
| PermissionRequest | Permission prompt | TS only |

Hooks use matchers (regex patterns) to target specific tools. They can block actions, add system messages, modify inputs, or log activity.

**Important limitation**: `query()` in Python does NOT support hooks. Must use `ClaudeSDKClient` for hooks.

### 8. Configuration and Settings

`settingSources` controls which filesystem settings the SDK loads:

| Value | Location | Description |
|-------|----------|-------------|
| `"user"` | `~/.claude/settings.json` | Global user settings |
| `"project"` | `.claude/settings.json` | Shared project settings |
| `"local"` | `.claude/settings.local.json` | Local (gitignored) settings |

**Default behavior**: SDK loads NO filesystem settings (isolation). Must explicitly set `settingSources: ["project"]` to load CLAUDE.md, skills, slash commands, or agents from the filesystem.

Programmatic options always override filesystem settings.

### 9. Sandbox Configuration

The SDK supports sandboxed command execution:
- `enabled`: Turn on sandbox mode
- `autoAllowBashIfSandboxed`: Auto-approve bash when sandboxed
- `excludedCommands`: Commands that bypass sandbox (static list)
- `allowUnsandboxedCommands`: Let the model request unsandboxed execution (falls back to permissions)
- Network configuration: local binding, Unix sockets, proxy ports

### 10. Additional Capabilities

- **Structured outputs**: `outputFormat` with JSON Schema validation
- **System prompt presets**: Use Claude Code's built-in system prompt with optional append
- **Budget control**: `maxBudgetUsd` caps spending per session
- **Max turns**: `maxTurns` limits conversation rounds
- **Model selection**: `model` and `fallbackModel` for primary and fallback
- **Extended context**: Beta `context-1m-2025-08-07` for 1M token window
- **File checkpointing**: `enableFileCheckpointing` + `rewindFiles()` to restore file state
- **Plugins**: Load local plugins via `plugins` option

### 11. Comparison with Client SDK

| Feature | Agent SDK | Client SDK |
|---------|-----------|------------|
| Tool execution | Built-in, autonomous | You implement the loop |
| Agent loop | Handled by SDK | Manual implementation |
| File/code operations | Built-in tools | You build everything |
| Use case | Autonomous agents | Direct API access |

### 12. Authentication

- **Anthropic API**: `ANTHROPIC_API_KEY` environment variable
- **Amazon Bedrock**: `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials
- **Google Vertex AI**: `CLAUDE_CODE_USE_VERTEX=1` + GCP credentials
- **Microsoft Azure**: `CLAUDE_CODE_USE_FOUNDRY=1` + Azure credentials

## agent-sdk-dev Plugin

### Overview

The `agent-sdk-dev` plugin is an official Anthropic plugin (`claude-plugins-official`) authored by Ashwin Bhat. It provides:

1. **`/new-sdk-app` command**: Interactive scaffolding for new Agent SDK projects
2. **`agent-sdk-verifier-py` agent**: Verification for Python SDK apps
3. **`agent-sdk-verifier-ts` agent**: Verification for TypeScript SDK apps

### `/new-sdk-app` Command

Interactive workflow that:
1. Asks language choice (TypeScript or Python), one question at a time
2. Asks project name
3. Asks agent type (coding, business, custom)
4. Asks starting point (minimal, basic, specific example)
5. Asks tooling preferences
6. Checks for latest SDK versions via npm/PyPI
7. Creates project files, config, environment setup
8. Runs type checking (TS) or syntax validation (Python)
9. Automatically launches the appropriate verifier agent

**Documentation references fetched by the command:**
- https://docs.claude.com/en/api/agent-sdk/overview
- Language-specific SDK reference (TypeScript or Python)
- Relevant guides (streaming, permissions, custom tools, MCP, subagents, sessions)

### Verifier Agents

Both verifiers (Python and TypeScript) run on Sonnet and check:

1. **SDK Installation**: Package installed, version current
2. **Environment Setup**: requirements.txt/pyproject.toml (Python) or tsconfig.json/package.json (TypeScript)
3. **SDK Usage Patterns**: Correct imports, initialization, configuration
4. **Type Safety** (TS only): Runs `npx tsc --noEmit`
5. **Environment Security**: `.env.example` exists, `.env` in `.gitignore`, no hardcoded keys
6. **Best Practices**: System prompts, model selection, permissions, MCP, subagents, sessions
7. **Documentation**: README, setup instructions

**Output format**: PASS / PASS WITH WARNINGS / FAIL, with categorized findings (Critical Issues, Warnings, Passed Checks, Recommendations).

**What they explicitly skip**: Code style preferences, naming conventions, import ordering, language-specific style debates.

### Plugin Observations for Guild Hall

The `agent-sdk-dev` plugin demonstrates patterns worth noting:

1. **Command fetches live docs**: The `/new-sdk-app` command uses WebFetch to read official documentation before scaffolding, ensuring it uses current API patterns rather than stale training data.

2. **Verifier as separate agent**: Verification runs as a distinct subagent (on Sonnet) rather than inline, giving it fresh context and focused instructions.

3. **One question at a time**: The command explicitly asks questions sequentially, not in batches, making it easier for users to respond.

4. **Plugin structure is minimal**: Just a `plugin.json`, `README.md`, one command file, and two agent files. No skills, no hooks, no MCP servers.

## Official Example Agents

The [claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos) repo provides:

| Demo | Description |
|------|-------------|
| Hello World | Basic getting-started example |
| Email Agent | IMAP email assistant (inbox, search, AI assistance) |
| Excel Demo | Spreadsheet/Excel file manipulation |
| Research Agent | Multi-agent system with parallel subagents for web research |

The Email Agent and Research Agent are most interesting as reference implementations: they demonstrate frontend-to-agent patterns (inbox UI, search, agent-assisted workflows).

## Relevance to Guild Hall (Redesign)

Guild Hall was originally conceived as a multi-agent orchestration system (blackboard architecture). It is now being redesigned as a **frontend application with MCP tools**. Agents may be spawned as a secondary capability, but the primary interface is a UI backed by MCP-provided tooling.

Key SDK capabilities relevant to the new direction:

1. **MCP as the integration layer**: Custom tools via in-process MCP servers, stdio servers, and HTTP/SSE servers. The frontend can expose functionality through MCP tools that the SDK agent consumes.

2. **In-process SDK MCP servers**: Define custom tools directly in the application code (`@tool` decorator in Python, Zod schemas in TypeScript). No separate server process needed. This is the likely mechanism for Guild Hall's tool surface.

3. **Hooks for UI integration**: PreToolUse/PostToolUse hooks can bridge between agent execution and frontend state (progress tracking, audit logging, user approval flows).

4. **Permission modes for safety**: `canUseTool` callback enables custom approval flows, letting the frontend mediate what agents can do.

5. **Session management**: Resume, fork, and checkpoint capabilities support long-running frontend sessions where users interact with agents over time.

6. **Structured outputs**: JSON Schema validation on agent responses enables clean data contracts between the agent and the frontend.

## Open Questions

1. **Frontend framework**: What framework will Guild Hall use? Next.js (per TypeScript setup rules) seems the default for a web application.

2. **MCP tool surface**: What tools does the frontend need to expose? This needs specification before implementation.

3. **Agent spawning model**: When agents are spawned (secondary capability), do they run server-side via the SDK, or is this Claude Code CLI-based?

4. **Cost tracking**: `ResultMessage` includes `total_cost_usd`. How does the frontend surface this to the user?

5. **Authentication flow**: The SDK supports API keys and cloud provider auth. How does the frontend handle credentials?

## Sources

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Python SDK Reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Permissions Guide](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [MCP Integration Guide](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK Demos](https://github.com/anthropics/claude-agent-sdk-demos)
- [Python SDK Repository](https://github.com/anthropics/claude-agent-sdk-python)
- [TypeScript SDK Repository](https://github.com/anthropics/claude-agent-sdk-typescript)
- agent-sdk-dev plugin source: `/home/rjroy/.claude/plugins/cache/claude-plugins-official/agent-sdk-dev/2cd88e7947b7/`

## Notes

- The SDK was recently renamed from "Claude Code SDK" to "Claude Agent SDK." A migration guide exists for breaking changes.
- Branding guidelines explicitly prohibit using "Claude Code" branding in products built with the SDK.
- The Python SDK bundles the Claude Code CLI, no separate installation required.
- TypeScript SDK V2 preview is available with simplified `send()`/`receive()` patterns.
- Anthropic does not allow third-party developers to offer claude.ai login or rate limits for SDK-built products.
