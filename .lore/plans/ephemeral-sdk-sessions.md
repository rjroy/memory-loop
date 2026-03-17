---
title: "Ephemeral SDK sessions"
date: 2026-03-15
status: approved
tags: [sdk, agent-sdk, session, streaming, ephemeral-sessions, subprocess, refactor]
modules: [session-manager, active-session-controller, session-streamer, sdk-provider]
related:
  - .lore/specs/ephemeral-sdk-sessions.md
  - .lore/specs/server-driven-chat.md
  - .lore/_archive/daemon-session-lifecycle-chat.md
  - .lore/retros/discussion-multi-turn-resume.md
  - .lore/research/claude-agent-sdk.md
---

# Plan: Ephemeral SDK Sessions

## Spec Reference

**Spec**: `.lore/specs/ephemeral-sdk-sessions.md`
**Existing plan (superseded internals)**: `.lore/_archive/daemon-session-lifecycle-chat.md`
**Reference implementation**: Guild Hall's `sdk-runner.ts` + `event-translator.ts`

Requirements addressed:
- REQ-ESS-1: Per-turn subprocess → Steps 2, 4
- REQ-ESS-2: Resume via SDK session ID → Step 2
- REQ-ESS-3: Loud resume failure → Step 3
- REQ-ESS-4: Intermediate event schema → Step 1
- REQ-ESS-5: Intermediate event types → Step 1
- REQ-ESS-6: Accumulate input_json_delta, emit tool_input on block stop → Step 1
- REQ-ESS-7: Pending prompts within per-turn subprocess → Step 4 (preserved)
- REQ-ESS-8: Pending prompt in SSE snapshot → Step 4 (preserved)
- REQ-ESS-9: Pending prompt resolution continues processing → Step 4 (preserved)
- REQ-ESS-10: Subprocess crash during pending prompt → Step 5
- REQ-ESS-11: Controller state → Step 4
- REQ-ESS-12: Between-turns state → Step 4
- REQ-ESS-13: Cumulative token tracking → Step 4 (preserved)
- REQ-ESS-14: Two-phase chat preserved → No change
- REQ-ESS-15: SSE snapshot-on-connect preserved → No change
- REQ-ESS-16: Fire-and-forget sendMessage → No change
- REQ-ESS-17: Session metadata persisted after turn → No change
- REQ-ESS-18: Session ID in metadata is SDK session ID → No change
- REQ-ESS-19: Abort during pending prompt → Step 5
- REQ-ESS-20: Per-turn session preparation → Step 2
- REQ-ESS-21: Single preparation function → Step 2

## Codebase Context

### Current State

The daemon has all session modules in place (Stage 5 complete). The SDK subprocess is already per-turn in practice: `sendMessage()` creates/resumes a session, `runStreaming()` processes events, and the `finally` block calls `queryResult.close()` and nulls it. The "ephemeral" part is largely implemented. What's missing is hardening, event schema separation, and edge case handling.

### Key Files

| File | Lines | What Changes |
|------|-------|-------------|
| `daemon/src/session-manager.ts` | 1040 | Extract `prepareTurnOptions()`, improve resume failure detection |
| `daemon/src/streaming/active-session-controller.ts` | 638 | Consume intermediate events instead of raw SDK, abort/crash during prompt |
| `daemon/src/streaming/session-streamer.ts` | 636 | Replace with event translator (this file becomes the translator) |
| `daemon/src/streaming/types.ts` | ~50 | Add `SdkRunnerEvent` intermediate type |

### What Stays Unchanged

- All daemon routes (`/session/chat/send`, `/session/chat/stream`, etc.)
- Next.js proxy layer and daemon client modules
- Frontend contract (two-phase chat, SSE snapshot-on-connect)
- Session metadata persistence
- Shared schemas in `@memory-loop/shared`
- Pending prompt callback mechanics (SDK's `canUseTool` blocking pattern)

### Guild Hall Reference

Guild Hall's `event-translator.ts` (`.guild-hall/projects/guild-hall/daemon/lib/agent-sdk/event-translator.ts`) provides the proven pattern for the intermediate event schema. Key differences from Memory Loop's current session-streamer:

1. **Two-step translation**: SDK → `SdkRunnerEvent` (intermediate) → domain events. Memory Loop currently goes SDK → `SessionEvent` (final) directly.
2. **Stateful but side-effect-free translator**: `createStreamTranslator()` tracks block index → tool_use ID mapping and accumulates `input_json_delta` chunks. No I/O, no persistence.
3. **Assistant messages ignored**: When `includePartialMessages` is enabled, text arrives via both `stream_event` deltas and the finalized `assistant` message. The translator uses only stream events, ignoring assistant messages to avoid double-emit.

Memory Loop's session-streamer already handles most of these patterns but mixes them with state accumulation (content chunks, tool invocations, context usage) and event emission. The refactor separates translation from accumulation.

## Implementation Steps

### Step 1: Create intermediate event translator

**Files**: New `daemon/src/streaming/event-translator.ts`, update `daemon/src/streaming/types.ts`
**Addresses**: REQ-ESS-4, REQ-ESS-5, REQ-ESS-6

Define the `SdkRunnerEvent` discriminated union in `types.ts`:

```typescript
interface TurnUsageData {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
  model?: string;
}

type SdkRunnerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; id: string }
  | { type: "tool_input"; toolUseId: string; input: unknown }
  | { type: "tool_result"; name: string; output: string; toolUseId?: string }
  | { type: "turn_end"; cost?: number; usage?: TurnUsageData }
  | { type: "error"; reason: string }
  | { type: "aborted" };
```

Create `event-translator.ts` by porting Guild Hall's `createStreamTranslator()`. This is a function that returns a closure. The closure takes an `SDKMessage` and returns `SdkRunnerEvent[]`. Internal state:

- `blockToolIds: Map<number, string>` (block index → tool_use ID)
- `blockInputChunks: Map<number, string[]>` (accumulated JSON chunks per block)

Translation rules (from Guild Hall, adapted for Memory Loop):

- `system` init → `session` event with session ID
- `stream_event` content_block_start (tool_use) → `tool_use` event, register in maps
- `stream_event` content_block_delta (text_delta) → `text_delta` event
- `stream_event` content_block_delta (input_json_delta) → accumulate, return empty
- `stream_event` content_block_stop → if tool block with accumulated chunks, parse JSON and emit `tool_input`
- `assistant` → ignore (redundant when `includePartialMessages` is enabled)
- `user` (tool_result blocks) → `tool_result` event
- `result` success → `turn_end` with cost and usage data
- `result` error → `error` event
- Everything else → empty array

The translator also needs to carry `usage` and `modelUsage` from the `result` event through to `turn_end`. The `TurnUsageData` interface carries the raw values the controller needs to compute `contextUsage` percentage: `inputTokens`, `outputTokens`, `contextWindow` (from `modelUsage[modelName].contextWindow`), and `model` (first key of `modelUsage`). This replaces the current session-streamer's `handleResultEvent` which mutates `StreamerState` directly.

The translator must also handle `compact_boundary` events. The current session-streamer resets cumulative token counts when the SDK signals a context compaction (lines 595-618 of `session-streamer.ts`). Add a new intermediate event type for this:

```typescript
  | { type: "compact_boundary"; preTokens: number; trigger: string }
```

The controller uses this to reset `streamerState.cumulativeTokens` to an estimated post-compact value (`Math.round(preTokens * 0.3)`), preserving the current behavior.

Add `isSessionExpiryError()` to this module (ported from Guild Hall's `sdk-runner.ts`). It's used in Step 3 for resume failure detection.

**ESLint note**: The SDK's type declarations use `.mjs` specifiers that ESLint can't resolve (documented in `.lore/bugs/agent-sdk-mjs-type-declarations.md`). Add the same ESLint config overrides used by session-streamer.

### Step 2: Extract per-turn session preparation function

**Files**: `daemon/src/session-manager.ts`
**Addresses**: REQ-ESS-20, REQ-ESS-21

Extract `prepareTurnOptions()` from the duplicated option assembly in `createSession()` and `resumeSession()`:

```typescript
interface TurnPrepInput {
  vaultPath: string;
  resume?: string;
  canUseTool?: Options["canUseTool"];
  additionalOptions?: Partial<Options>;
}

async function prepareTurnOptions(input: TurnPrepInput): Promise<Partial<Options>> {
  const config = await loadVaultConfig(input.vaultPath);
  const model = resolveDiscussionModel(config);
  const vaultTransferServer = createVaultTransferServer();

  return {
    ...DISCUSSION_MODE_OPTIONS,
    model,
    ...input.additionalOptions,
    cwd: input.vaultPath,
    ...(input.resume ? { resume: input.resume } : {}),
    mcpServers: {
      ...input.additionalOptions?.mcpServers,
      "vault-transfer": vaultTransferServer,
    },
    ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
  };
}
```

Update `createSession()` and `resumeSession()` to call `prepareTurnOptions()` instead of assembling options inline. Both functions currently have ~20 lines of near-identical option construction. After extraction, each function focuses on what's different: `createSession` saves new metadata, `resumeSession` loads existing metadata and passes the session ID.

Export `prepareTurnOptions` for testing. It's a pure async function (reads vault config but has no side effects beyond that).

### Step 3: Improve resume failure detection

**Files**: `daemon/src/session-manager.ts`, `daemon/src/streaming/active-session-controller.ts`
**Addresses**: REQ-ESS-3

Two failure modes to detect:

**Mode 1: SDK exception on resume.** The SDK throws when the session is expired or not found. Currently caught by the generic `catch` in `resumeSession()` and mapped via `mapSdkError()`. Add detection:

```typescript
// In resumeSession's catch block:
if (error instanceof Error && isSessionExpiryError(error.message)) {
  throw new SessionError(
    "Could not resume previous session. The session may have expired.",
    "RESUME_FAILED"  // New error code
  );
}
```

Add `RESUME_FAILED` to `SessionError`'s code union.

**Mode 2: Silent session ID mismatch.** The SDK returns a different session ID than the one passed to `resume`. Currently detected at line 984 of `session-manager.ts` (logs error, saves metadata under new ID). Change this to throw instead of silently adapting:

```typescript
if (resumedId !== sessionId) {
  // Close the query - we're not going to use it
  queryResult.close();
  throw new SessionError(
    "Could not resume previous session. Starting a new conversation.",
    "RESUME_FAILED"
  );
}
```

This is the key behavioral change from the retro (`.lore/retros/discussion-multi-turn-resume.md`): don't adapt to mismatched IDs, surface the failure.

In `active-session-controller.ts`, make two changes:

1. **Remove the now-redundant mismatch check in `sendMessage()`** (lines 476-486). This check currently emits an error event when the SDK returns a different session ID. With the throw in `resumeSession()`, this code is dead because the exception is caught before `sendMessage()` reaches the mismatch check. Remove it to avoid confusion for future readers.

2. **Update the `sendMessage()` catch handler** to check for `RESUME_FAILED`:

```typescript
} catch (err) {
  const code = err instanceof SessionError && err.code === "RESUME_FAILED"
    ? "RESUME_FAILED"
    : "SDK_ERROR";
  emit({
    type: "error",
    code,
    message: err instanceof Error ? err.message : "Failed to send message",
  });
}
```

The frontend already renders error events. The `RESUME_FAILED` code gives the UI the option to show a "Start new conversation" action rather than a generic error.

### Step 4: Refactor controller to use intermediate events

**Files**: `daemon/src/streaming/active-session-controller.ts`, `daemon/src/streaming/session-streamer.ts`
**Addresses**: REQ-ESS-1, REQ-ESS-7 through REQ-ESS-9, REQ-ESS-11, REQ-ESS-12, REQ-ESS-13

This is the core refactor. The controller's `runStreaming()` method currently delegates to `startStreamSdkEvents()` (session-streamer), which owns the async loop and emits SessionEvents via the emitter. After this step, the controller owns the async loop and consumes intermediate events from the translator.

**New flow:**

```
SDK events → createStreamTranslator() → SdkRunnerEvent[] → controller processes each:
  - "session": store session ID (already done via extractSessionId)
  - "text_delta": accumulate content, emit response_chunk SessionEvent
  - "tool_use": track in toolsMap, emit tool_start SessionEvent
  - "tool_input": update toolsMap input, emit tool_input SessionEvent
  - "tool_result": update toolsMap status/output, emit tool_end SessionEvent
  - "turn_end": extract cost/usage, compute contextUsage, emit response_end
  - "error": emit error SessionEvent
  - "aborted": emit aborted (new, see Step 5)
```

**Concrete changes to `runStreaming()`:**

Replace the `startStreamSdkEvents()` call and `await currentStreamerHandle.result` with an inline loop.

**Note on event flow:** `result.events` is an `AsyncGenerator<SDKMessage>` that was already advanced once by `extractSessionId()` in `session-manager.ts`. The first event was consumed to extract the session ID, then re-wrapped via `wrapGenerator()` so it yields as the first item. The translator will receive this first event and produce a `session` intermediate event. The controller can ignore it (the session ID is already known from `result.sessionId`).

```typescript
const translate = createStreamTranslator();
const responseChunks: string[] = [];
const toolsMap = new Map<string, StoredToolInvocation>();

for await (const sdkMessage of result.events) {
  if (abortController.signal.aborted) break;

  for (const event of translate(sdkMessage)) {
    switch (event.type) {
      case "text_delta":
        responseChunks.push(event.text);
        emit({ type: "response_chunk", messageId, content: event.text });
        break;
      case "tool_use":
        toolsMap.set(event.id, { toolUseId: event.id, toolName: event.name, status: "running" });
        emit({ type: "tool_start", toolName: event.name, toolUseId: event.id });
        break;
      case "tool_input":
        // ... update toolsMap, emit tool_input
        break;
      case "tool_result":
        // ... update toolsMap, emit tool_end
        break;
      case "turn_end":
        // ... compute contextUsage from event.usage, update streamerState
        break;
      case "error":
        emit({ type: "error", code: "SDK_ERROR", message: event.reason });
        break;
    }
  }
}
```

**What happens to session-streamer.ts:**

The `startStreamSdkEvents()` and `streamSdkEvents()` functions are no longer called. The `StreamerHandle`, `StreamerState`, and `StreamerEmitter` interfaces are no longer needed by the controller. However, the controller still needs snapshot capability (for reconnecting clients). Move the snapshot logic (accumulated content, tool invocations, context usage) into the controller's `runStreaming()` scope as local variables, exposed via a closure on `currentStreamerHandle` (or simpler: just use controller-level variables since only one streaming loop runs at a time).

**Decision: Delete `session-streamer.ts` entirely.** The helper functions (`handleStreamEvent`, `handleResultEvent`, etc.) are subsumed by the translator + controller inline logic. No external consumers import from this file. Remove it from barrel exports in `streaming/index.ts` if one exists.

**Between-turns state (REQ-ESS-12):** After the refactor, when `runStreaming()` completes, the `finally` block nulls out `queryResult`, `abortController`, `currentStreamerHandle`. The controller holds: `currentSessionId`, `currentVaultId`, `currentVaultPath`, `streamerState` (cumulative tokens, context window, active model), `slashCommands`, `subscribers`. This matches REQ-ESS-12 (session ID and vault ID) plus REQ-ESS-13 (cumulative token data is observational, acceptable to hold).

**Pending prompts (REQ-ESS-7/8/9):** Unchanged. The `canUseTool` callback blocks the SDK subprocess. The pending prompt maps in the controller work the same way. The subprocess stays alive during the turn while the promise is unresolved.

### Step 5: Handle abort and crash during pending prompts

**Files**: `daemon/src/streaming/active-session-controller.ts`
**Addresses**: REQ-ESS-10, REQ-ESS-19

**Abort during pending prompt (REQ-ESS-19):**

Currently `abortProcessing()` calls `discardPendingPrompts()` which rejects all pending promises with `new Error("Session cleared")`. The SDK subprocess sees the rejection and stops. But the event emitted is whatever the streaming loop produces (usually an error from the rejected promise).

Change: When aborting, if pending prompts exist, emit `aborted` explicitly (not `error`):

```typescript
abortProcessing(): void {
  if (!isProcessing) return;

  const hadPendingPrompts = pendingPermissions.size > 0 || pendingQuestions.size > 0;

  // Interrupt SDK
  if (queryResult) {
    queryResult.interrupt().catch(/* ... */);
  }

  // Signal streamer loop to exit
  if (abortController) {
    abortController.abort();
  }

  // Discard pending prompts
  discardPendingPrompts();

  // If prompts were pending, the abort is the user's explicit action.
  // Emit aborted (not error) so the UI shows "Stopped" not "Error".
  if (hadPendingPrompts) {
    emit({ type: "session_cleared" }); // or a new "aborted" SessionEvent
  }
}
```

**Decision: Add `{ type: "aborted" }` to `SessionEvent` in `@memory-loop/shared`.** The spec requires abort to be distinguishable from error (REQ-ESS-19). Using `session_cleared` would be wrong because `session_cleared` means the session is gone, while abort means "stopped but resumable." The frontend should treat `aborted` as a non-error terminal event (processing stopped, session remains valid for follow-up messages). This means:
- Update `SessionEvent` union in `packages/shared/src/session-types.ts`
- Update `useChat.ts` SSE handler to recognize `aborted` as a terminal event (same as `response_end`, not an error)
- Update the SSE stream route to close on `aborted` (same as other terminal events)

**Subprocess crash during pending prompt (REQ-ESS-10):**

If the SDK subprocess dies while `canUseTool` is blocking, the pending promise will be rejected (the subprocess pipe breaks). The `for await` loop in `runStreaming()` will throw. The `catch` block should detect that pending prompts exist and handle accordingly:

```typescript
} catch (err) {
  const hadPendingPrompts = pendingPermissions.size > 0 || pendingQuestions.size > 0;

  // Clear pending prompts so the UI doesn't show a stale form
  discardPendingPrompts();

  if (hadPendingPrompts) {
    log.error("Subprocess crashed while waiting for user response", err);
    emit({
      type: "error",
      code: "SDK_ERROR",
      message: "Processing crashed while waiting for your response. Please try again.",
    });
  } else {
    // Normal error handling
    emit({ type: "error", code: "SDK_ERROR", message: /* ... */ });
  }
}
```

The key behavior: the user sees an error (not a hung interface), and pending prompts are cleared from the snapshot so reconnecting clients don't see a stale form.

### Step 6: Tests

**Files**: New and updated test files in `daemon/src/__tests__/` and `daemon/src/streaming/__tests__/`
**Addresses**: All requirements

**Unit tests:**

1. **event-translator.test.ts**: Test the `createStreamTranslator()` function in isolation.
   - Feed `system` init message → expect `session` event
   - Feed `stream_event` text_delta → expect `text_delta` event
   - Feed `stream_event` content_block_start (tool_use) + deltas + stop → expect `tool_use` then `tool_input`
   - Feed `result` success → expect `turn_end` with cost
   - Feed `result` error → expect `error` event
   - Feed `assistant` message → expect empty (ignored)
   - Feed unknown message type → expect empty
   - Verify `isSessionExpiryError()` matches known SDK error strings

2. **session-manager.test.ts** (update existing):
   - Test `prepareTurnOptions()`: given vault path and optional resume ID, returns correct options
   - Test `prepareTurnOptions()` with different vault configs (opus, sonnet, haiku models)
   - Test resume failure mode 1: SDK throws with session expiry message → `RESUME_FAILED` error code
   - Test resume failure mode 2: SDK returns different session ID → `RESUME_FAILED` error code

3. **active-session-controller.test.ts** (update existing):
   - Test abort during pending prompt: emit `aborted`, not `error`
   - Test subprocess crash during pending prompt: emit `error`, clear pending prompts
   - Test between-turns state: after processing completes, only sessionId/vaultId/tokens held
   - Test intermediate event processing: verify controller correctly maps each `SdkRunnerEvent` type to `SessionEvent`

**Integration tests:**

4. **multi-turn-resume.test.ts**: Send message, get response, send follow-up with resume, verify second turn uses same session ID. Verify resume failure emits `RESUME_FAILED`.

5. **abort-during-prompt.test.ts**: Trigger a tool permission request (via mock SDK that invokes `canUseTool`), abort while prompt is pending, verify `aborted` event emitted and session remains resumable.

6. **subprocess-cleanup.test.ts**: Send message, wait for completion, verify `queryResult` is null and no references to the subprocess remain.

### Step 7: Validate against spec

**Addresses**: All requirements
**Expertise**: spec-reviewer

Launch a sub-agent that reads `.lore/specs/ephemeral-sdk-sessions.md` and the implementation. Verify every REQ-ESS requirement is met. Specific checks:

- REQ-ESS-3: Resume failure emits `RESUME_FAILED`, not generic error
- REQ-ESS-4: SDK events go through intermediate schema before SSE
- REQ-ESS-6: `input_json_delta` chunks accumulated, single `tool_input` emitted
- REQ-ESS-10: Subprocess crash during pending prompt → error event + prompt cleared
- REQ-ESS-19: Abort during pending prompt → `aborted` event (not `error`)
- REQ-ESS-20/21: Single `prepareTurnOptions()` function used by both create and resume

Also verify all server-driven-chat guarantees (REQ-SDC-1 through REQ-SDC-18) are preserved unchanged.

## Delegation Guide

Steps requiring specialized expertise:

- **Step 1** (event translator): Use `pr-review-toolkit:type-design-analyzer` to review the `SdkRunnerEvent` type design. This is a new type that will be consumed by the controller and tested against.
- **Step 4** (controller refactor): Use `pr-review-toolkit:silent-failure-hunter` after refactoring the streaming loop. The current session-streamer has careful error handling; verify nothing is lost in translation.
- **Step 5** (abort/crash during prompts): Use `pr-review-toolkit:code-reviewer` to audit the abort/crash distinction. Getting this wrong means users see "Error" when they clicked "Stop" or see a hung form when the subprocess died.
- **Step 6** (tests): Use `pr-review-toolkit:pr-test-analyzer` to verify coverage on new code meets 90%+ target.
- **Step 7** (validation): Use `lore-development:plan-reviewer` or `lore-development:fresh-lore` agent for fresh-context validation.

Consult `.lore/lore-agents.md` for the full agent registry.

## Risks and Mitigations

### Risk 1: Session-streamer refactor breaks snapshot-on-connect

**Likelihood**: Medium. The current `StreamerHandle.getSnapshot()` is called by the controller's `getSnapshot()` method. Moving accumulation logic from streamer to controller could miss a case.

**Impact**: High. Reconnecting clients see empty or stale state.

**Mitigation**: The controller's `getSnapshot()` method is tested explicitly. The snapshot should return the same data before and after the refactor. Write a comparison test that feeds identical SDK events through both old and new paths and verifies identical snapshots.

### Risk 2: Abort-during-prompt emits wrong event type

**Likelihood**: Low. The logic is straightforward: check for pending prompts before deciding event type.

**Impact**: Medium. User sees "Error" instead of "Stopped", or vice versa.

**Mitigation**: Dedicated test case (Step 6, test 5). The distinction is: user-initiated abort → `aborted`; subprocess crash → `error`. The abort path sets a flag before clearing prompts.

### Risk 3: Resume failure throws before subprocess is closed

**Likelihood**: Medium. When detecting session ID mismatch, the code has a live `queryResult` that needs to be closed before throwing.

**Impact**: Medium. Orphaned subprocess.

**Mitigation**: Call `queryResult.close()` before throwing `RESUME_FAILED`. Test this explicitly: mock SDK returns different session ID, verify close is called.

### Risk 4: ESLint type resolution for new translator file

**Likelihood**: High (known issue). The SDK's `.mjs` type declarations trigger false-positive ESLint errors.

**Impact**: Low. Build passes, lint fails on specific rules.

**Mitigation**: Apply the same ESLint overrides documented in `.lore/bugs/agent-sdk-mjs-type-declarations.md`. Add the new file to the existing override pattern.

## Resolved Questions

1. **`aborted` as a SessionEvent type**: Resolved. Add `{ type: "aborted" }` to `SessionEvent` in `@memory-loop/shared`. See Step 5 for details. The spec requires abort and error to be distinguishable.

2. **Session-streamer file fate**: Resolved. Delete entirely. No external consumers.

3. **`turn_end` usage data shape**: Resolved. `TurnUsageData` interface defined in Step 1 with `inputTokens`, `outputTokens`, `contextWindow?`, `model?`.
