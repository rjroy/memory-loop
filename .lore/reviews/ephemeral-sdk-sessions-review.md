---
title: "Ephemeral SDK Sessions: Spec Validation Review"
date: 2026-03-15
status: complete
reviewer: Thorne
spec: .lore/specs/ephemeral-sdk-sessions.md
plan: .lore/plans/ephemeral-sdk-sessions.md
tags: [review, ephemeral-sessions, spec-validation, session]
---

# Ephemeral SDK Sessions: Spec Validation Review

## Verdict

**Ready to ship.** All 21 REQ-ESS requirements are satisfied. All 18 REQ-SDC guarantees are preserved. No blocking findings.

Two non-blocking findings noted below.

---

## REQ-ESS Requirements

### REQ-ESS-1: Per-turn subprocess (no long-lived SDK session)

**PASS.**

`active-session-controller.ts:293-569`: `runStreaming()` creates the translator, iterates SDK events, and in its `finally` block (line 551-568) nulls `queryResult`, sets `isProcessing = false`, `isStreamingActive = false`, and calls `queryResult.close()`. No subprocess reference survives between turns.

The `finally` block uses the generation guard (`gen === currentGeneration`) to avoid clobbering state from a newer run (line 552).

### REQ-ESS-2: Resume via SDK session ID

**PASS.**

`session-manager.ts:964`: `prepareTurnOptions()` is called with `resume: sessionId` in `resumeSession()`. The session ID is loaded from metadata on disk (line 944).

### REQ-ESS-3: Resume failure emits RESUME_FAILED, not generic error

**PASS.** Both failure modes are covered.

**Mode 1 (SDK exception):** `session-manager.ts:1030-1035`: The catch block checks `isSessionExpiryError()` and throws `SessionError` with code `"RESUME_FAILED"`.

**Mode 2 (Session ID mismatch):** `session-manager.ts:1000-1009`: When `resumedId \!== sessionId`, calls `queryResult.close()` before throwing `SessionError("RESUME_FAILED")`. The close-before-throw prevents subprocess leak (Risk 3 from the plan).

**Controller propagation:** `active-session-controller.ts:632-635`: The `sendMessage` catch handler checks `err.code === "RESUME_FAILED"` and emits the error event with that code.

**Tests:** `session-manager.test.ts:142-167` (expiry), `session-manager.test.ts:170-216` (mismatch), `active-session-controller.test.ts:606-641` (end-to-end).

### REQ-ESS-4: SDK events go through intermediate schema before SSE

**PASS.**

`active-session-controller.ts:372-478`: SDK events enter the `for await` loop, each passed through `translate(sdkMessage)`, and the resulting `SdkRunnerEvent[]` are processed in the inner `switch`. No raw SDK event reaches the emitter.

`event-translator.ts:41-74`: `createStreamTranslator()` returns a stateful closure. No I/O, no persistence.

### REQ-ESS-5: Intermediate event types match spec

**PASS.**

`types.ts:29-38`: The `SdkRunnerEvent` union includes all spec-required types: `session`, `text_delta`, `tool_use`, `tool_input`, `tool_result`, `turn_end`, `error`, `aborted`, plus `compact_boundary` (added during implementation for context compaction support).

The `compact_boundary` type is not in the original spec but is documented in the plan (Step 1) and serves a legitimate purpose (resetting cumulative tokens on SDK context compaction). Not a deviation; it is an additive internal event that never reaches the SSE layer.

### REQ-ESS-6: input_json_delta chunks accumulated, single tool_input emitted

**PASS.**

`event-translator.ts:144-151`: `input_json_delta` chunks are pushed to `blockInputChunks` map, returning empty array.

`event-translator.ts:156-178`: On `content_block_stop`, accumulated chunks are joined and parsed into a single `tool_input` event.

**Test:** `event-translator.test.ts:127-171` (full lifecycle), `event-translator.test.ts:173-200` (invalid JSON fallback), `event-translator.test.ts:202-221` (empty chunks).

### REQ-ESS-7: Pending prompts work within per-turn subprocess

**PASS.**

`active-session-controller.ts:149-195`: `createToolPermissionCallback()` and `createAskUserQuestionCallback()` create promises that block the SDK's `canUseTool` callback. The subprocess stays alive while the promise is unresolved. The promise is stored in `pendingPermissions`/`pendingQuestions` maps.

### REQ-ESS-8: Pending prompts appear in snapshot

**PASS.**

`active-session-controller.ts:719-739`: `getSnapshot()` reads pending prompts from both maps and includes them in the snapshot. Reconnecting clients receive the snapshot as the first SSE event (`stream.ts:31`).

### REQ-ESS-9: Pending prompt resolution continues processing

**PASS.**

`active-session-controller.ts:745-779`: `respondToPrompt()` resolves the blocked promise (`pending.resolve(response.allowed)` for permissions, `pending.resolve(response.answers)` for questions). The SDK subprocess, blocked on the promise, resumes processing.

### REQ-ESS-10: Subprocess crash during pending prompt emits error + clears prompt

**PASS.**

`active-session-controller.ts:506-524`: The catch block checks `hasPendingPrompts()`, calls `discardPendingPrompts()`, then emits error with a specific crash message. The pending prompts are cleared from the snapshot so reconnecting clients don't see a stale form.

**Test:** `active-session-controller.test.ts:494-573`.

### REQ-ESS-11: Controller state matches spec

**PASS.**

The controller tracks: `isProcessing` (line 105), `currentSessionId` (line 99), `currentVaultId` (line 100), pending prompts (lines 122-123), subscribers (line 126). It does NOT hold a persistent SDK subprocess reference between turns (nulled in `finally` at line 564).

The `queryResult` variable exists but is scoped to the current turn's `runStreaming()` and nulled on completion.

### REQ-ESS-12: Between-turns state is minimal

**PASS.**

After `runStreaming()` completes, the `finally` block (lines 552-567) nulls `queryResult` and `abortController`, sets `isProcessing = false` and `isStreamingActive = false`. What remains: `currentSessionId`, `currentVaultId`, `currentVaultPath`, `streamerState` (cumulative tokens, context window, active model), `slashCommands`, `subscribers`.

The spec says "session ID and vault ID" for between-turns. The additional `streamerState` data is observational (REQ-ESS-13 explicitly allows it), and `slashCommands`/`subscribers` are infrastructure. This satisfies the requirement.

**Test:** `active-session-controller.test.ts:346-389`.

### REQ-ESS-13: Cumulative token tracking preserved

**PASS.**

`active-session-controller.ts:433-454`: The `turn_end` handler adds turn tokens to `streamerState.cumulativeTokens` and computes `currentContextUsage`. The `compact_boundary` handler (lines 457-466) resets cumulative tokens to an estimated post-compact value.

`getState()` (line 712) and `getSnapshot()` (line 736) both expose cumulative tokens.

**Test:** `active-session-controller.test.ts:259-338` (compact boundary resets cumulative tokens across turns).

### REQ-ESS-14: Two-phase chat preserved

**PASS.** No changes to the REST API routes. `POST /session/chat/send` submits a message, `GET /session/chat/stream` opens an SSE viewport. Verified: `stream.ts` (the SSE route) is unchanged in structure.

### REQ-ESS-15: SSE snapshot-on-connect preserved

**PASS.** `stream.ts:30-33`: Sends snapshot as first event. If not processing, closes immediately (line 36). If processing, subscribes to live events (line 53). Terminal events include `aborted` (line 67).

### REQ-ESS-16: Fire-and-forget sendMessage preserved

**PASS.** `active-session-controller.ts:629`: `void runStreaming(...)` fires and forgets. The `sendMessage()` method returns after creating the session and launching the streaming loop, not after processing completes.

### REQ-ESS-17: Session metadata persistence unchanged

**PASS.** `active-session-controller.ts:490-504`: After streaming completes normally, the assistant message (with content and tool invocations) is persisted via `sdkAppendMessage()`. On error/abort, partial results are persisted (lines 527-549).

Session metadata files are written by `saveSession()` in `session-manager.ts`, which is unchanged.

### REQ-ESS-18: Session ID in metadata is SDK session ID

**PASS.** `session-manager.ts:883`: New sessions store `id: sessionId` where `sessionId` comes from `extractSessionId()` (the SDK's session ID). Resumed sessions validate the session ID matches (line 1000) and update `lastActiveAt` (line 1013).

### REQ-ESS-19: Abort during pending prompt emits aborted (not error)

**PASS.**

`active-session-controller.ts:648-682`: `abortProcessing()` checks `hasPendingPrompts()` before aborting, calls `interrupt()`, `abortController.abort()`, `discardPendingPrompts()`, then emits `{ type: "aborted" }` if prompts were pending.

**Frontend:** `useChat.ts:170-174`: Handles `aborted` as a non-error terminal event.

**SSE route:** `stream.ts:67`: Closes stream on `aborted`.

**SessionEvent type:** `session-types.ts:38`: `{ type: "aborted" }` is in the union.

**Test:** `active-session-controller.test.ts:396-492`.

### REQ-ESS-20: Per-turn session preparation function

**PASS.**

`session-manager.ts:796-813`: `prepareTurnOptions()` assembles the complete SDK options object from vault config, model resolution, MCP server setup, and optional resume/canUseTool. It is an exported async function.

The function handles: `model` (from vault config), `cwd` (vault path), `resume` (optional), `mcpServers` (vault-transfer + additional), `canUseTool` (optional), plus all `DISCUSSION_MODE_OPTIONS` defaults.

**Tests:** `session-manager.test.ts:34-121` (6 test cases covering defaults, resume, canUseTool, model resolution, option merging, cwd precedence).

### REQ-ESS-21: Single preparation function used by both create and resume

**PASS.**

`session-manager.ts:849`: `createSession()` calls `prepareTurnOptions({ vaultPath: vault.path, canUseTool, additionalOptions: options })`.

`session-manager.ts:964`: `resumeSession()` calls `prepareTurnOptions({ vaultPath: metadata.vaultPath, resume: sessionId, canUseTool, additionalOptions: options })`.

Same function, different `resume` parameter. No duplicated option assembly.

---

## REQ-SDC Guarantees (Server-Driven Chat)

All 18 requirements verified as preserved:

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-SDC-1: Server processes to completion | PASS | `runStreaming()` runs in fire-and-forget; no client dependency |
| REQ-SDC-2: Reject messages during processing | PASS | `active-session-controller.ts:584-586` throws `AlreadyProcessingError` |
| REQ-SDC-3: User can abort | PASS | `abortProcessing()` at line 648 |
| REQ-SDC-4: Client disconnect does not abort | PASS | `stream.ts:87-89`: onAbort does NOT call abortProcessing |
| REQ-SDC-5: Single active session | PASS | One controller instance, `performClearSession()` on new session |
| REQ-SDC-6: New session clears existing | PASS | `active-session-controller.ts:589-591` |
| REQ-SDC-7: Unified sendMessage | PASS | `sendMessage()` at line 576 handles both create and resume |
| REQ-SDC-8: Snapshot on connect | PASS | `stream.ts:30-33` |
| REQ-SDC-9: Live events after snapshot | PASS | `stream.ts:53-72` |
| REQ-SDC-10: Multiple SSE connections | PASS | Subscriber set, all receive events |
| REQ-SDC-11: Pending prompts stored | PASS | Maps at lines 122-123 |
| REQ-SDC-12: Prompts in snapshot | PASS | `getSnapshot()` line 721-735 |
| REQ-SDC-13: REST resolution | PASS | `respondToPrompt()` at line 745 |
| REQ-SDC-14: No prompt timeout | PASS | Promises wait until resolved or discarded |
| REQ-SDC-15: Accumulated state for snapshots and persistence | PASS | `currentResponseChunks`, `currentToolsMap`, `getStreamingSnapshot()` |
| REQ-SDC-16: Persist result with no client | PASS | Persistence in `runStreaming()` try block, not in subscriber |
| REQ-SDC-17: No event buffering | PASS | Events are push-only to current subscribers |
| REQ-SDC-18: Concurrency safety (generation guard) | PASS | `currentGeneration` incremented on new run, `finally` checks match |

---

## Additional Checks

### session-streamer.ts deletion

**PASS.** File does not exist in `daemon/src/streaming/`. No imports to it found anywhere in the daemon package. The barrel export (`streaming/index.ts`) exports only from `active-session-controller`, `types`, and `event-translator`.

### Orphaned imports

**PASS.** Grep for `session-streamer` across the daemon package returns zero results.

### ESLint overrides for SDK .mjs types

**PASS.** `event-translator.ts:13-15` has the three `eslint-disable` directives for `@typescript-eslint/no-unsafe-member-access`, `no-unsafe-assignment`, and `no-unsafe-argument`. These match the pattern documented in `.lore/bugs/agent-sdk-mjs-type-declarations.md`.

### Silent error swallowing

**PASS (with one non-blocking observation).** The `runStreaming()` catch block (line 505-549) always emits an error event. The `finally` block (551-568) logs when `close()` fails but this is appropriate (the process is already exiting). The `discardPendingPrompts()` function (201-213) rejects all pending promises with `new Error("Session cleared")`, which prevents hung promises.

One area to watch: `supportedCommands()` failure (lines 320-330) is caught and logged, producing an empty slash commands list. This is acceptable (non-critical, UI degrades gracefully) but silent.

### Test coverage

**PASS.** Three test files cover the new and changed code:

- `event-translator.test.ts`: 24 test cases covering all SDK message types, edge cases (invalid JSON, empty chunks, multiple tools), and `isSessionExpiryError()`.
- `session-manager.test.ts`: 10 test cases covering `prepareTurnOptions()` (6 cases) and resume failure detection (4 cases including both failure modes and the non-expiry control case).
- `active-session-controller.test.ts`: 9 test cases covering intermediate event processing, between-turns state, abort during pending prompt, crash during pending prompt, subprocess cleanup, streaming crash, clearSession, and sendMessage error handling.

---

## Findings

### Finding 1: activeModel not reset between sessions (Severity: Low)

`active-session-controller.ts:270-271`: `performClearSession()` resets `streamerState.cumulativeTokens` and `streamerState.contextWindow` but does not reset `streamerState.activeModel`. If a user starts a new session after clearing, `getState().activeModel` will show the model from the previous session until the first `turn_end` arrives.

**Impact:** Cosmetic. The stale model name would appear in state queries between `session_cleared` and the first `turn_end` of the new session. Unlikely to surface in the UI since the model is not displayed during this gap.

**Fix:** Add `streamerState.activeModel = null;` to `performClearSession()` after line 271.

### Finding 2: Comment references deleted module (Severity: Trivial)

`active-session-controller.ts:5`: File header comment says "Implements the session-viewport separation spec (REQ-6)" which references the old archived spec. Should reference the current specs: server-driven-chat (REQ-SDC) and ephemeral-sdk-sessions (REQ-ESS).

**Impact:** None. Documentation-only.

---

## Summary

21/21 REQ-ESS requirements satisfied. 18/18 REQ-SDC guarantees preserved. Two non-blocking findings (stale `activeModel` on clear, outdated comment). No silent error swallowing. No orphaned imports. Tests cover all new code paths including edge cases (crash during prompt, abort during prompt, resume failure, compact boundary).

The implementation is ready to ship.
