---
title: "Implementation plan: pi-agent migration"
date: 2026-05-18
status: draft
tags: [plan, pi-agent, sdk-migration, daemon, streaming, session-manager, refactor]
modules: [daemon, session-manager, event-translator, fact-extractor, vault-transfer, active-session-controller]
related: [.lore/plans/ephemeral-sdk-sessions.md, .lore/specs/ephemeral-sdk-sessions.md, .lore/retros/ephemeral-sdk-sessions.md]
---

# Plan: Migrate Daemon from claude-agent-sdk to pi-agent

## Goal

Replace all usage of `@anthropic-ai/claude-agent-sdk` in the daemon with `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent`. Three components need full migration: interactive discussion sessions (session-manager + active-session-controller), the fact extractor, and vault-transfer MCP tools.

The daemon's external API — HTTP routes, SSE event types, session lifecycle — stays unchanged. Only the AI provider layer below `active-session-controller.ts` changes. The Next.js frontend does not change at all.

**Model selection**: Vault config may specify a pi-agent `{ provider, modelId }`. If absent or not found in the registry, fall back to `session.modelRegistry.find("fallback", "text")` (pi-agent's configured default). No hardcoded model strings.

**CLAUDE.md loading**: Set `cwd` to the vault path when creating pi-agent sessions. Pi-agent's `DefaultResourceLoader` reads project-level configuration from `cwd` automatically. Do not pass `systemPrompt` for discussion sessions.

**Budget cap**: Removed. `maxBudgetUsd` had no pi-agent equivalent, and the configured providers (GitHub Copilot, local Ollama) have no per-request billing.

## Codebase Context

**Six SDK touch points — all replaced**:

| File | Current SDK usage | Migration |
|------|------------------|-----------|
| `daemon/src/sdk-provider.ts` | Singleton gateway for `query()` | Delete; replace with `pi-session-factory.ts` |
| `daemon/src/session-manager.ts` | `createSession()` / `resumeSession()` via `query()` | Rewrite session creation/resume; keep everything else |
| `daemon/src/streaming/event-translator.ts` | Stateful `SDKMessage` → `SdkRunnerEvent` translator | Rewrite as pi-agent `subscribe()` adapter |
| `daemon/src/streaming/active-session-controller.ts` | Drives query generator loop, manages pending prompts | Replace generator loop with `session.subscribe()` + `session.prompt()` |
| `daemon/src/vault-transfer.ts` | `createSdkMcpServer()` + `tool()` | Replace with `defineTool()` custom tools |
| `daemon/src/extraction/fact-extractor.ts` | Standalone `query()` call | Replace with inMemory pi-agent session |

**Unchanged**:
- All HTTP route handlers in `daemon/src/routes/`
- `daemon/src/streaming/types.ts` — `SdkRunnerEvent` internal schema stays as-is
- The upper half of `active-session-controller.ts`: pub-sub, pending prompts, state machine, `respondToPrompt()`
- `packages/shared/` — additive only: one new optional field on `SessionMetadata`

**Architecture invariants from prior incidents** (must survive the rewrite):
- Error events in `sendMessage()` catch blocks must throw after emitting. The "emit-to-zero-subscribers" bug from the ephemeral-sdk-sessions retro: if `emit()` is called but no SSE client has connected yet, errors disappear silently. The fix — `emit(errorEvent); throw err;` — must be preserved in the pi-agent version.
- Every SSE error path must produce a visible `{ type: "error" }` event. Logging is not a substitute.
- Resume failure must throw `SessionError("RESUME_FAILED")` if pi-agent can't open the JSONL. Don't silently start a new session.

## Implementation Steps

### Step 1: Swap dependencies

**Files**: `daemon/package.json`
**Expertise**: none

```bash
bun remove @anthropic-ai/claude-agent-sdk --cwd daemon
bun add @earendil-works/pi-agent-core @earendil-works/pi-coding-agent --cwd daemon
```

Built-in tool names and availability are confirmed by pre-implementation research (`.lore/research/pi-agent-sdk.md`). No additional verification needed here.

**Verify**: `bun install` succeeds; TypeScript resolves new packages without errors.

---

### Step 2: Add `piSessionPath` to shared `SessionMetadata`

**Files**: `packages/shared/src/schemas/` (wherever `SessionMetadata` is defined)
**Expertise**: `pr-review-toolkit:type-design-analyzer` for schema review

Pi-agent persists sessions as JSONL files at `~/.pi/agent/sessions/<cwd-slug>/<id>.jsonl`. The daemon needs this path to resume sessions via `SessionManager.open(path)`.

Add `piSessionPath?: string` to `SessionMetadata`. It is optional so existing session files without it still load — they just can't be resumed (handled by the `RESUME_FAILED` path already in place).

**Verify**: `bun run typecheck` passes; existing session load code handles the missing field without crashing.

---

### Step 3: Create `daemon/src/pi-session-factory.ts`; delete `sdk-provider.ts`

**Files**: new `daemon/src/pi-session-factory.ts`, delete `daemon/src/sdk-provider.ts`
**Expertise**: `pr-review-toolkit:code-reviewer` — this is the new safety seam

This module owns the mandatory pi-agent initialization sequence. It replaces the `query()` singleton with a factory function.

```typescript
export interface PiSessionOptions {
  cwd: string;
  systemPrompt?: string;          // for fact extractor only; omit for discussion sessions
  tools?: string[];               // built-in tool allowlist
  customTools?: ToolDefinition[];
  extensionFactories?: ExtensionFactory[];
  sessionManager: SessionManager; // caller chooses strategy (inMemory, create, open)
}

export interface PiSessionResult {
  session: AgentSession;
  jsonlPath: string | null;       // null for inMemory; the JSONL path for create/open
}

export async function createPiSession(opts: PiSessionOptions): Promise<PiSessionResult>
```

**`getAgentDir()`**: Import from `@earendil-works/pi-agent-core` — this is the standard export that returns the pi-agent home directory (typically `~/.pi/agent/`). Do not hardcode the path.

**Mandatory sequence** inside `createPiSession`:
1. `new DefaultResourceLoader({ cwd: opts.cwd, agentDir: getAgentDir(), systemPrompt: opts.systemPrompt })`
2. `await loader.reload()` — not optional even when no extensions are loaded
3. `const { session } = await createAgentSession({ cwd: opts.cwd, resourceLoader: loader, sessionManager: opts.sessionManager, tools: opts.tools, customTools: opts.customTools, extensionFactories: opts.extensionFactories })`
4. `await session.bindExtensions({})` — runs queued extension work; skip this and extension-registered models never appear
5. Model lookup: `session.modelRegistry.find(provider, modelId)` from vault config; fall back to `session.modelRegistry.find("fallback", "text")` if absent or not found
6. `await session.setModel(model)`

**Capture `jsonlPath`**: After `createAgentSession`, read `session.sessionFile` (a getter on `AgentSession`). This returns `string | undefined` — `undefined` for inMemory sessions, the JSONL path for create/open sessions. Store as `jsonlPath` in the result.

**Test injection**: Export `configurePiSessionForTesting(mockFn)` and `_resetPiSessionForTesting()` — matching the naming convention of the old `configureSdkForTesting` / `_resetForTesting`. Tests import these by name; consistency with the existing pattern is required so tests across the codebase don't use different conventions.

**Write a unit test** that mocks `createAgentSession` and verifies:
- `loader.reload()` is called before `createAgentSession`
- `bindExtensions({})` is called before `setModel`
- fallback model is used when vault config is absent
- `result.jsonlPath` is non-null for `SessionManager.create()` calls (not just type-correct — assert an actual path string)

---

### Step 4: Rewrite `event-translator.ts` for pi-agent subscribe API

**Files**: `daemon/src/streaming/event-translator.ts`, `daemon/src/streaming/__tests__/event-translator.test.ts`
**Expertise**: `pr-review-toolkit:silent-failure-hunter` — error paths in subscribe callbacks must not disappear

The output schema (`SdkRunnerEvent`) is unchanged. Only the input changes from `SDKMessage` to pi-agent subscription events.

**New API**:
```typescript
export function createPiEventAdapter(
  onEvent: (event: SdkRunnerEvent) => void
): (piEvent: SessionEvent) => void
```

Returns a callback to pass directly to `session.subscribe()`.

**Pi-agent event → SdkRunnerEvent mapping**:
- `event.type === "message_update"` + `assistantMessageEvent.type === "text_delta"` → `{ type: "text_delta", text: delta }`
- `event.type === "tool_execution_start"` → `{ type: "tool_use", name: event.toolName, id: event.toolCallId }`
- `event.type === "tool_execution_update"` — content is a snapshot (not delta); extract `partialResult.content[0].text` → `{ type: "tool_result", output: text, name: "", toolUseId: event.toolCallId }` — the same `toolCallId` field from `tool_execution_start`; confirmed present in `ToolCallEventBase`
- `event.type === "compaction_start"` → `{ type: "compact_boundary" }` — maintains the existing SSE contract with the frontend; `compaction_end` has no frontend consumer, ignore it
- Turn completion (the `session.prompt()` resolving, not an event) → `{ type: "turn_end" }` — emit this from the caller when `session.prompt()` resolves, not from the adapter
- Error events → `{ type: "error", reason: message }`

**Token usage / context bar**: Pi-agent does not expose per-turn token usage in subscription events. Usage is accessible only inside extension handlers via `ctx.getContextUsage()`. The `TurnUsageData` (`inputTokens`, `outputTokens`, `contextWindow`, `model`) fields will not be populated in `turn_end` events. The context bar in the UI will remain at zero for all turns. This is an accepted regression for the initial migration.

**Removed**: all `SDKMessage` handling (`stream_event`, `content_block_start/delta/stop`, `assistant`, `user`, `result`, `system` subtypes), `tool_input` accumulation (pi-agent accumulates internally).

**Session ID** is no longer extracted from events. The factory (Step 3) provides it.

Rewrite the test file to drive `createPiEventAdapter` with synthetic pi-agent events and assert the correct `SdkRunnerEvent` sequence.

**Verify**: `silent-failure-hunter` review of the adapter's catch paths; all existing `SdkRunnerEvent` types consumed by `active-session-controller.ts` are still produced.

---

### Step 5: Rewrite `vault-transfer.ts` tool wrappers

**Files**: `daemon/src/vault-transfer.ts`
**Expertise**: none

Replace `createSdkMcpServer()` + `tool()` with pi-agent `defineTool()`. The business logic functions (`transferFile`, `listTransferableVaults`) are untouched.

**Change**:
- `createVaultTransferServer()` → `createVaultTransferTools(): ToolDefinition[]`
- Tool schemas: Zod → TypeBox `Type.Object({ ... })` (only in the wrapper; underlying logic stays Zod-free)
- Import `defineTool` from `@earendil-works/pi-coding-agent`; import `Type` from `@sinclair/typebox`
- Remove `tool` and `createSdkMcpServer` imports

**Verify**: TypeScript compiles; `transferFile` and `listTransferableVaults` unit tests pass unchanged.

---

### Step 6: Rewrite `session-manager.ts` — `createSession()` and `resumeSession()`

**Files**: `daemon/src/session-manager.ts`
**Expertise**: `pr-review-toolkit:silent-failure-hunter` + `pr-review-toolkit:code-reviewer` — highest regression risk

The public function signatures stay the same. The `SessionQueryResult` return type changes: `queryResult: Query` (the async generator) becomes `piSession: AgentSession` (the pi-agent session object). Update the type and all consumers.

**Also delete in Step 6**: `querySession()` (the dispatch wrapper around createSession/resumeSession) and `prepareTurnOptions()` (the SDK options builder). Both call SDK-specific APIs and have no pi-agent equivalent. Before deleting, grep for callers outside `session-manager.ts` to confirm they can be removed or must be migrated.

**`createSession()` changes**:
1. Build extension factory for tool permission gating. The pi-agent `tool_call` event carries `toolCallId` directly on `ToolCallEventBase` — no local ID generation needed:
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
   `ToolPermissionCallback`'s signature is `(toolUseId, toolName, input)` — it stays unchanged; `event.toolCallId` is passed directly.
2. Build `AskUserQuestion` custom tool with injected callback. The `execute` function receives `toolCallId` as its first argument — use it directly:
   ```typescript
   function createAskUserQuestionTool(callback: AskUserQuestionCallback): ToolDefinition {
     return defineTool({
       name: "AskUserQuestion",
       description: "...",
       inputSchema: Type.Object({ questions: Type.Array(Type.Object({ ... })) }),
       async execute(toolCallId, args) {
         const answers = await callback(toolCallId, args.questions);
         return { content: [{ type: "text", text: JSON.stringify({ answers }) }] };
       },
     });
   }
   ```
3. Call `createPiSession({ cwd: vault.path, tools: [...], customTools: [askTool, ...vaultTransferTools], extensionFactories: [permissionExtension], sessionManager: SessionManager.create(vault.path) })`
4. Generate a local UUID as `sessionId` (don't wait for an event to extract it)
5. Store `metadata.piSessionPath = result.jsonlPath`
6. Save metadata — then return `{ sessionId, piSession: result.session }`

**`resumeSession()` changes**:
1. Load metadata; if `!metadata.piSessionPath`, throw `SessionError("Cannot resume: no pi-agent session path stored", "RESUME_FAILED")`
2. Call `createPiSession({ ..., sessionManager: SessionManager.open(metadata.piSessionPath) })`
3. Same return shape

**`DISCUSSION_MODE_OPTIONS` constant**: Remove `maxBudgetUsd`, `permissionMode`, `settingSources`, `includePartialMessages`. Keep the tool allowlist as the reference list (now passed as `tools:` to the factory). Rename to `DISCUSSION_TOOLS` if it's now just the list.

**Removed entirely**: `extractSessionId()`, `prependFirstEvent()`, `EXTRACTION_SDK_OPTIONS` (moves to fact-extractor), all `Options` and `SDKMessage` imports.

**Verify**: `silent-failure-hunter` review of all catch blocks; `code-reviewer` general review; `bun run test` on the session-manager test suite.

---

### Step 7: Update `active-session-controller.ts` — replace generator loop

**Files**: `daemon/src/streaming/active-session-controller.ts`
**Expertise**: `pr-review-toolkit:silent-failure-hunter` — the "throw after emit" invariant must survive

The upper half of the controller (pub-sub, state, pending prompts map, `respondToPrompt()`, `subscribe()`, `getSnapshot()`) is unchanged.

**Changes**:

**State**: Replace `queryResult: SessionQueryResult | null` with `piSession: AgentSession | null`. Replace `abortController: AbortController | null` with direct use of `session.abort()`.

**`sendMessage()` restructure**:

```typescript
// 1. Persist user message before calling prompt (same as current runStreaming step 1)
await sdkAppendMessage(result.sessionId, vault, userMessage);

// 2. Subscribe before calling prompt — events arrive the moment prompt() starts
const unsubscribe = result.piSession.subscribe(
  createPiEventAdapter((sdkEvent) => processSdkEvent(sdkEvent))
);

// 3. Fire and forget — use void + .finally() for guaranteed cleanup
void result.piSession.prompt(params.prompt)
  .then(async () => {
    // Persist completed assistant message (same as current runStreaming completion)
    await sdkAppendMessage(result.sessionId, vault, assembleAssistantMessage());
    emit({ type: "turn_end" });
  })
  .catch((err) => {
    // Persist partial result on error (same as current catch in runStreaming)
    void sdkAppendMessage(result.sessionId, vault, assemblePartialMessage());
    emit({ type: "error", reason: mapSdkError(err) });
    throw err;  // CRITICAL: must throw after emit
  })
  .finally(() => {
    unsubscribe();  // always clean up subscription, even if turn_end emission throws
  });
```

The `throw err` in `.catch()` is non-negotiable. Without it, when zero SSE subscribers are connected at the moment the error fires, the error disappears silently and the POST returns 200 OK with null sessionId. See the ephemeral-sdk-sessions retro.

The `.finally(() => unsubscribe())` replaces the `try/finally` block from the current `runStreaming()`. Using `.then()/.catch()` without `.finally()` would leave the subscription open if turn_end emission throws.

**Message assembly helpers**: The current `runStreaming()` accumulates `currentResponseChunks` and `currentToolsMap` from events, then assembles them into `ConversationMessage` for persistence. These accumulators live in the controller's streaming state and are populated by `processSdkEvent()`. They stay in the controller; Step 7 must verify that `assembleAssistantMessage()` and `assemblePartialMessage()` read from the same state they populated during the subscription.

**Slash commands**: The current code calls `result.supportedCommands()` to populate slash commands in the `session_ready` event. Pi-agent has no equivalent. For the initial migration, emit `session_ready` with an empty `slashCommands: []` array. The feature may be restored in a follow-up if pi-agent exposes command lists.

**Previous messages on resume**: The current code reads `result.previousMessages` from the SDK and includes them in `session_ready` to restore conversation history for reconnecting clients. With pi-agent, read `result.piSession.messages` after `SessionManager.open()` resolves. Map them to `ConversationMessage[]` format. The mapping may be lossy (pi-agent messages won't have the exact same shape as stored metadata), so compare types carefully during implementation.

**Abort**: Replace `abortController.abort()` with `piSession.abort()`. Store `piSession` reference on the controller state for use by `abortProcessing()`.

**Session ID**: No longer extracted from the first event. The `createSession()` call in session-manager now returns the UUID directly. Set `currentSessionId` from that value before calling `session.prompt()`.

**`runStreaming()` function**: Removed. The subscription callback + promise chain replaces the generator iteration loop.

**Verify**: `silent-failure-hunter` review of all catch blocks in `sendMessage()`; confirm `.finally()` unsubscribes in all paths; manual smoke test of the full chat flow; verify abort works end-to-end; verify partial message is persisted on error.

---

### Step 8: Rewrite `fact-extractor.ts`

**Files**: `daemon/src/extraction/fact-extractor.ts`, `daemon/src/extraction/__tests__/fact-extractor.test.ts`
**Expertise**: `pr-review-toolkit:pr-test-analyzer`

Replace the `query()` call with an inMemory pi-agent session:

```typescript
const { session } = await createPiSession({
  cwd: transcript.vaultPath,
  systemPrompt: extractionPrompt,  // loaded from file, same as before
  tools: ["glob", "grep", "read", "edit", "write"],  // verify names in Step 1
  sessionManager: SessionManager.inMemory(transcript.vaultPath),
});
await session.prompt(fullPrompt);
const result = finalText(session.messages);
```

**`finalText()` helper** (from the pi-agent skill):
```typescript
function finalText(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last) return "";
  return last.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}
```

**Model**: Fact extraction previously used `"haiku"` for cost efficiency. With GitHub Copilot / Ollama, there is no meaningful cost difference. Use the vault's configured model, or fall back to pi-agent's default. Remove the model override from the extraction options.

**`EXTRACTION_SDK_OPTIONS`**: Remove. Pass options directly to `createPiSession`.

**Retry logic**: The current `extractFacts()` wraps `runExtractionAttempt()` in a retry loop with `RETRY_DELAY_MS` backoff. Pi-agent does not retry internally on transient errors. Preserve the outer retry wrapper, replacing the inner `query()` call with `createPiSession()` + `session.prompt()`. Drop the retry loop only if pi-agent's error surface makes it unnecessary — verify before removing.

**Test injection**: Add a `createSessionFn` parameter to `extractFacts()` (default: real `createPiSession`). Tests pass a mock factory that returns a controlled session object. Remove all `configureSdkForTesting` calls from tests.

**Verify**: `pr-test-analyzer` review; test coverage matches current; `bun run --cwd daemon test extraction/`.

---

### Step 9: Remove `sdk-provider.ts` and clean up

**Files**: `daemon/src/sdk-provider.ts` (delete), all remaining `@anthropic-ai/claude-agent-sdk` imports
**Expertise**: none

After Steps 3-8:
1. Delete `daemon/src/sdk-provider.ts`
2. Remove any lingering `@anthropic-ai/claude-agent-sdk` type imports from session-manager and event-translator
3. Run `bun run typecheck` to confirm zero references remain
4. Run `grep -r "claude-agent-sdk" daemon/src/` — must return empty

**Verify**: `bun run typecheck && bun run lint && bun run test` all pass.

---

### Step 10: Validate against goal

Launch a sub-agent with fresh context. It reads the Goal section of this plan and the final state of the changed files, then reports:
- All six SDK touch points migrated: sdk-provider, session-manager, event-translator, active-session-controller, vault-transfer, fact-extractor
- No remaining `@anthropic-ai/claude-agent-sdk` imports anywhere in the daemon
- Session resume handles missing `piSessionPath` with `RESUME_FAILED`, not a silent new session
- Catch blocks in `sendMessage()` both emit an error event AND throw
- All changed modules have updated tests
- `bun run typecheck && bun run lint && bun run test` passes

## Delegation Guide

Steps requiring specialized review:
- **Step 3** (`pi-session-factory`): `pr-review-toolkit:code-reviewer` — equivalent to the old `sdk-provider.ts` safety seam; initialization sequence errors are silent
- **Step 4** (`event-translator`): `pr-review-toolkit:silent-failure-hunter` — subscription callback errors must surface
- **Step 6** (`session-manager`): `pr-review-toolkit:silent-failure-hunter` + `pr-review-toolkit:code-reviewer` — largest change, highest regression risk
- **Step 7** (`active-session-controller`): `pr-review-toolkit:silent-failure-hunter` — "throw after emit" invariant
- **Step 8** (`fact-extractor` tests): `pr-review-toolkit:pr-test-analyzer` — test coverage regression check
- **Step 2** (shared schema): `pr-review-toolkit:type-design-analyzer` — backward-compatible schema change

## Open Questions

All four pre-implementation open questions are resolved. See `.lore/research/pi-agent-sdk.md` for the full findings.

- **Pi-agent built-in tool names** ✓: `"bash"`, `"read"`, `"edit"`, `"write"`, `"grep"`, `"find"`, `"ls"`. No glob, no web tools, no task/subagents as built-ins.
- **Task and web tool availability** ✓: User-level extensions only (`pi-subagents`, `pi-web-access`). Not available to daemon sessions. Discussion allowlist should be `["read", "grep", "bash"]` plus custom tools.
- **SessionManager path API** ✓: Use `session.sessionFile` (getter on `AgentSession`) — not a property on the manager. Returns `string | undefined`.
- **compact_boundary equivalent** ✓: Pi-agent emits `compaction_start` / `compaction_end`. Map `compaction_start` → `{ type: "compact_boundary" }` in the event adapter (Step 4).
