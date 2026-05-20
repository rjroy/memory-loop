---
title: "Research: pi-agent SDK API surface"
date: 2026-05-19
status: active
tags: [pi-agent, sdk, migration, api-surface, types]
modules: [daemon, session-manager, event-translator, fact-extractor, vault-transfer]
related: [.lore/plans/pi-agent-migration.md]
---

# Research: pi-agent SDK API Surface

## Summary

Type-level audit of `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent` to answer open questions before implementing the daemon migration. All findings are from `.d.ts` files at the globally-installed package path.

**Package path**: `/home/rjroy/.local/share/mise/installs/node/25.2.1/lib/node_modules/@earendil-works/pi-coding-agent/`

## Key Findings

### Built-in Tool Names

Built-in tools use lowercase strings. The confirmed list from the extension types:

```
"bash"  "read"  "edit"  "write"  "grep"  "find"  "ls"
```

**Not available as built-ins**: `"glob"`, `"task"`, `"web-fetch"`, `"web-search"`. These come from user-level extensions (`pi-subagents`, `pi-web-access`) and are not available to daemon sessions without user installing them.

**Impact on plan Step 1**: The discussion mode allowlist from the current SDK maps as follows:
- `Read` → `"read"` ✓
- `Glob` → not available (drop from allowlist or implement as custom tool)
- `Grep` → `"grep"` ✓
- `WebFetch` / `WebSearch` → not available as built-ins
- `Task` → not available as built-in
- `AskUserQuestion` → custom tool (as designed)
- `TodoWrite` / `TodoRead` → not available as built-ins

For the initial migration, the discussion session allowlist should be `["read", "grep", "bash"]` plus any custom tools (AskUserQuestion, vault-transfer tools).

---

### SessionManager Path API

`SessionManager` is a class on `@earendil-works/pi-agent-core`. The path to the persisted JSONL file is accessible two ways:

```typescript
// On the manager instance, before session starts:
manager.getSessionFile(): string | undefined

// On the session object, after createAgentSession():
session.sessionFile: string | undefined  // getter
```

Both return `undefined` for `inMemory` sessions. For `create()` and `open()` sessions, the path is set immediately.

Static factory methods:
```typescript
SessionManager.create(cwd: string, sessionDir?: string): SessionManager
SessionManager.open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager
SessionManager.continueRecent(cwd: string, sessionDir?: string): SessionManager
SessionManager.inMemory(cwd?: string): SessionManager
```

Default session directory: `~/.pi/agent/sessions/<encoded-cwd>/` via `getDefaultSessionDir(cwd, agentDir?)`.

**Impact on plan Step 3**: Use `session.sessionFile` (not `manager.path` — that property doesn't exist). The factory result captures it as:
```typescript
const jsonlPath = result.session.sessionFile ?? null;
```

---

### ToolCallEvent Has toolCallId

The plan Step 6 is **wrong**. It generates a local ID because it assumed `tool_call` events don't carry one. They do.

`ToolCallEventBase` (from `extensions/types.d.ts`):
```typescript
interface ToolCallEventBase {
  toolCallId: string;  // present on all tool_call event variants
  toolName: string;
}
```

The permission extension should use `event.toolCallId` directly — no local ID generation needed:

```typescript
function createPermissionExtension(callback: ToolPermissionCallback): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const allowed = await callback(event.toolCallId, event.toolName, event.args ?? {});
      if (!allowed) return { block: true, reason: `User denied permission for ${event.toolName}` };
    });
  };
}
```

Same correction applies to `createAskUserQuestionTool` — the `toolCallId` passed to `execute()` is the first argument:
```typescript
async execute(toolCallId: string, params, signal, onUpdate, ctx) {
  const answers = await callback(toolCallId, params.questions);
  return { content: [{ type: "text", text: JSON.stringify({ answers }) }] };
}
```

---

### Compaction Events (replaces compact_boundary)

The old SDK emitted `compact_boundary`. Pi-agent has two events:

```typescript
{
  type: "compaction_start";
  reason: "manual" | "threshold" | "overflow";
}

{
  type: "compaction_end";
  reason: "manual" | "threshold" | "overflow";
  result: CompactionResult | undefined;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}
```

These are `AgentSessionEvent` variants (not base `AgentEvent`). They fire when pi-agent compacts the context window automatically or when `session.compact()` is called manually.

**Impact on plan Step 4**: The event adapter should map `compaction_start` to `{ type: "compact_boundary" }` to maintain the existing SSE contract with the frontend. `compaction_end` has no current frontend consumer (the frontend only renders `compact_boundary` as a visual separator), so it can be ignored or emitted as informational.

---

### Auto-Retry Is Built In

Pi-agent's `AgentSession` handles transient errors internally and exposes events:

```typescript
{
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

{
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}
```

The documentation note in `agent-session.d.ts` confirms: "Context overflow errors are NOT retryable (handled by compaction instead)."

**Impact on plan Step 8**: The outer retry loop in `fact-extractor.ts` may be redundant for transient API errors. However, pi-agent's built-in retry scope is unknown (may only cover specific error types). The conservative approach: keep the outer loop for now and remove it in a follow-up after observing what errors survive pi-agent's retry.

---

### ContextUsage

Available inside extension event handlers via the `ExtensionContext` parameter:

```typescript
interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

// Available on ExtensionContext passed to tool execute and tool_call handlers
ctx.getContextUsage(): ContextUsage | undefined
```

**Not available** from the session subscription events. Token count is not in `AgentSessionEvent` variants.

**Impact on plan Step 4**: The token usage regression noted in the plan stands. There is no way to populate `TurnUsageData` from subscription events. Usage is accessible inside extension handlers only.

---

### AgentSession.prompt() Signature

Takes a plain string, not an `AgentMessage`:

```typescript
prompt(text: string, options?: PromptOptions): Promise<void>
```

`PromptOptions`:
```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean;  // default: true
  images?: ImageContent[];
}
```

`prompt()` resolves when the entire tool loop finishes — no outer loop needed.

---

### ToolDefinition.execute() Signature

Custom tools use:
```typescript
execute(
  toolCallId: string,
  params: T,            // typed by inputSchema
  signal: AbortSignal,
  onUpdate: (partialResult: ToolResult) => void,
  ctx: ExtensionContext
): Promise<ToolResult>
```

The `toolCallId` passed to execute is the same ID from `ToolCallEventBase`. This is the ID to use when calling `callback(toolCallId, ...)` inside `AskUserQuestion`.

---

### getAgentDir Export

```typescript
// From @earendil-works/pi-coding-agent (re-exported from ./config.js)
export function getAgentDir(): string
```

Returns `~/.pi/agent/` by default. Import from `@earendil-works/pi-coding-agent`, not from `pi-agent-core`.

---

### createAgentSession Options (Confirmed)

```typescript
interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  model?: string;
  tools?: string[];            // allowlist of built-in tool names
  customTools?: ToolDefinition[];
  noTools?: "all" | "builtin";
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
}
```

The `model:` option does NOT wire up the model. Call `session.setModel()` after `bindExtensions()`.

---

## Sources

- `@earendil-works/pi-coding-agent/dist/core/sdk.d.ts`
- `@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`
- `@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts`
- `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `@earendil-works/pi-agent-core/dist/types.d.ts`
- `@earendil-works/pi-agent-core/dist/agent.d.ts`
- `@earendil-works/pi-agent-core/dist/index.d.ts`
