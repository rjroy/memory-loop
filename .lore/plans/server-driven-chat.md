---
title: Server-driven chat processing
date: 2026-02-08
status: approved
tags: [architecture, session-management, sse, streaming, chat, processing-model]
modules: [active-session-controller, session-streamer, chat-route, useChat]
related:
  - .lore/specs/server-driven-chat.md
---

# Plan: Server-Driven Chat Processing

## Spec Reference

**Spec**: `.lore/specs/server-driven-chat.md`

Requirements addressed:
- REQ-SDC-1: Server processes to completion regardless of connectivity → Steps 3, 4
- REQ-SDC-2: Reject additional messages during processing (409) → Step 5
- REQ-SDC-3: User can abort, stores partial response → Step 6
- REQ-SDC-4: Client disconnect does NOT abort → Steps 4, 7
- REQ-SDC-5: One active session at a time → Step 5
- REQ-SDC-6: New session clears existing → Step 5
- REQ-SDC-7: Unified sendMessage → Already implemented (no change)
- REQ-SDC-8: Reconnect snapshot (session ID, text, tools, prompts) → Steps 1, 2, 7
- REQ-SDC-9: Snapshot then live events; final if complete → Step 7
- REQ-SDC-10: Multiple SSE connections → Step 7
- REQ-SDC-11: Pending prompts stored, processing pauses → Already implemented (no change)
- REQ-SDC-12: Pending prompts in snapshot → Step 2
- REQ-SDC-13: Resolve prompts via REST → Already implemented (no change)
- REQ-SDC-14: No timeout on prompts → Already implemented (no change)
- REQ-SDC-15: Streamer accumulates for snapshots and final result → Step 1
- REQ-SDC-16: Results persisted without connected client → Step 4
- REQ-SDC-17: No event buffering, snapshot is reconnect mechanism → Step 7
- REQ-SDC-18: Generation guard for concurrent cleanup → Step 3

## Codebase Context

### What exists

The architecture is well-structured for this refactor. The controller's pub-sub pattern, session manager's persistence layer, and streamer's state accumulation already do most of the work.

**Active Session Controller** (`lib/streaming/active-session-controller.ts`):
- Singleton factory `createActiveSessionController()` with closure-based state
- `sendMessage()` calls `resetQueryState()` then `await runStreaming()` (this await is the coupling)
- `runStreaming()` streams SDK events, persists in finally block, resets `isStreamingActive`/`abortController`/`queryResult`
- `clearSession()` aborts, closes query, discards pending prompts, resets all state
- Already has `subscribe()`, `getPendingPrompts()`, `getState()`, `respondToPrompt()`
- State: `currentSessionId`, `currentVaultId`, `queryResult`, `abortController`, `isStreamingActive`

**Session Streamer** (`lib/streaming/session-streamer.ts`):
- `streamSdkEvents()` is a pure async function that consumes the SDK generator
- Accumulates `responseChunks[]`, `toolsMap`, `contentBlocks`, `contextUsage` in local scope
- Returns `StreamingResult` only at the end (no mid-stream access)
- Already handles abort by marking running tools as incomplete

**Chat Route** (`app/api/chat/route.ts`):
- POST handler creates ReadableStream, subscribes to controller, calls `controller.sendMessage()`
- `cancel()` callback only calls `cleanup()` which unsubscribes (good, no abort-on-disconnect)
- Stream closes on terminal events (`response_end`, `error`, `session_cleared`)
- Currently a single endpoint that both sends the message AND provides the SSE stream

**useChat Hook** (`hooks/useChat.ts`):
- `sendMessage()` POSTs to `/api/chat` and reads the SSE response from the same request
- Tracks `streamingState` (idle/starting/streaming/error)
- `abort()` aborts the fetch AND POSTs to server abort endpoint
- No reconnection logic; component unmount aborts the fetch

**Types** (`lib/streaming/types.ts`):
- `SessionEvent` union type (response_start/chunk/end, tool_start/input/end, prompt_pending/resolved, error, session_cleared, session_ready)
- `SessionState` with sessionId, vaultId, tokens, contextWindow, activeModel, isStreaming
- `ActiveSessionController` interface

### Key coupling points

1. **`await runStreaming()`** in `sendMessage()`: controller waits for completion, meaning the API route can't return until processing finishes
2. **Single POST endpoint**: message submission and SSE stream are the same request; disconnect kills the stream which was the only consumer
3. **`runStreaming()` finally block**: unconditionally resets `isStreamingActive`, `abortController`, `queryResult`; if a new run starts before the old finally executes, the old finally clobbers the new run's state
4. **Streamer state is local**: `responseChunks`, `toolsMap` exist only inside `streamSdkEvents()` scope; no way to read them mid-stream for snapshots

### What doesn't need to change

- Session manager (persistence layer, stateless CRUD)
- SDK provider (just a wrapper)
- Permission/question REST endpoints
- Pending prompts mechanism (already works correctly)
- `respondToPrompt()` logic
- `subscribe()` pub-sub pattern

## Implementation Steps

### Step 1: Expose streamer snapshot mid-stream

**Files**: `lib/streaming/session-streamer.ts`
**Addresses**: REQ-SDC-15
**Validation**: Unit test `getSnapshot()` at multiple points during mock streaming; verify partial content grows.

Change `streamSdkEvents()` to return a handle object immediately rather than awaiting completion. The handle exposes both a `getSnapshot()` method (synchronous, reads accumulated state) and a `result` promise (resolves when streaming completes).

Current signature:
```typescript
async function streamSdkEvents(...): Promise<StreamingResult>
```

New signature:
```typescript
function startStreamSdkEvents(...): {
  getSnapshot: () => StreamingResult;
  result: Promise<StreamingResult>;
}
```

Move the accumulated state (`responseChunks`, `toolsMap`, `contextUsage`) into the returned closure so `getSnapshot()` can read them at any time. The async loop runs as a detached promise stored in `result`.

`getSnapshot()` constructs `StreamingResult` from current state: `content` is `responseChunks.join("")`, `toolInvocations` is `Array.from(toolsMap.values())` (insertion order), `contextUsage` is current value. Callable at any point: during streaming, after completion, or after abort. After `result` resolves, `getSnapshot()` returns the same final state.

Unhandled rejections: `result` must have a `.catch()` attached internally (log the error) so the detached promise doesn't produce an unhandled rejection warning. Errors are also emitted as events via the emitter.

### Step 2: Add snapshot to controller

**Files**: `lib/streaming/active-session-controller.ts`, `lib/streaming/types.ts`
**Addresses**: REQ-SDC-8, REQ-SDC-12, REQ-SDC-15
**Validation**: Unit test `getSnapshot()` mid-stream, after completion, and with pending prompts present.

Add a `getSnapshot()` method to the controller interface. It combines the streamer's accumulated state with session metadata and pending prompts.

New type in `types.ts`:
```typescript
interface SessionSnapshot {
  sessionId: string | null;
  isProcessing: boolean;
  content: string;
  toolInvocations: StoredToolInvocation[];
  pendingPrompts: PendingPrompt[];
  contextUsage?: number;
  cumulativeTokens: number;
  contextWindow: number | null;
}
```

Store a reference to the current streamer handle (`let currentStreamerHandle: ... | null = null`) so `getSnapshot()` can call `handle.getSnapshot()`. The handle's `toolInvocations` array is `Array.from(toolsMap.values())` in insertion order.

When no streamer handle exists (no active processing), `getSnapshot()` returns empty content and empty tool invocations. `isProcessing` is false. Pending prompts are still included if any remain from a completed run (they shouldn't, but defensive).

Add `getSnapshot()` to the `ActiveSessionController` interface.

### Step 3: Add generation guard to controller

**Files**: `lib/streaming/active-session-controller.ts`
**Addresses**: REQ-SDC-18
**Validation**: Unit test: start message A, immediately start message B (via clearSession + sendMessage), verify A's finally block doesn't overwrite B's state. Mock delays in the SDK generator to force the overlap.

Add `let currentGeneration = 0`. Each `runStreaming()` call increments and captures it. The finally block checks `if (gen === currentGeneration)` before mutating shared state (`isStreamingActive`, `abortController`, `queryResult`, `currentStreamerHandle`).

This prevents a stale finally block from clobbering state belonging to a newer run that started while the old one was winding down. If `gen !== currentGeneration`, the finally block logs a warning and exits without touching any shared state.

### Step 4: Decouple runStreaming from sendMessage

**Files**: `lib/streaming/active-session-controller.ts`
**Addresses**: REQ-SDC-1, REQ-SDC-4, REQ-SDC-16
**Validation**: Unit test: call `sendMessage()`, verify it resolves before streaming events emit. Subscribe to events, verify `response_end` arrives later.

Change `sendMessage()` to fire-and-forget `runStreaming()`:
```typescript
// Before: await runStreaming(...)
// After: void runStreaming(...)
```

`sendMessage()` returns after starting the SDK query and kicking off streaming. Processing continues independently. The `runStreaming()` finally block still persists results and emits terminal events, even with zero subscribers.

Error handling split: errors during SDK session creation (`sdkCreateSession`/`sdkResumeSession`) are still caught by `sendMessage()` and emitted as error events before returning. Errors during streaming (inside `runStreaming()`) are caught by `runStreaming()`'s own try/catch and emitted as error events. Move the error catch from `sendMessage()`'s outer try/catch into `runStreaming()` since the await is removed.

Add a tracking flag: `let isProcessing = false`. Set true at the start of `runStreaming()`, false in the finally block (inside generation guard). This is distinct from `isStreamingActive` (which tracks the SDK event loop specifically).

### Step 5: Add processing rejection and new-session-clears-old

**Files**: `lib/streaming/active-session-controller.ts`, `lib/streaming/types.ts`
**Addresses**: REQ-SDC-2, REQ-SDC-5, REQ-SDC-6
**Validation**: Unit test: send two messages rapidly with session ID, verify second throws `AlreadyProcessingError`. Send new session (no sessionId) while processing, verify old processing is interrupted.

In `sendMessage()`, before starting a new run:
- If `isProcessing` and caller provides a `sessionId` (resume/continue), throw `AlreadyProcessingError`
- If `isProcessing` and caller omits `sessionId` (new session), call `clearSession()` first (which aborts the active run per REQ-SDC-6), then proceed

Define `AlreadyProcessingError` in `lib/streaming/types.ts`:
```typescript
export class AlreadyProcessingError extends Error {
  readonly code = "ALREADY_PROCESSING" as const;
  constructor() {
    super("A message is currently being processed. Please wait for it to complete.");
    this.name = "AlreadyProcessingError";
  }
}
```

Export from the streaming barrel so the chat route can import and use `instanceof` to catch it.

### Step 6: Separate abort from clear

**Files**: `lib/streaming/active-session-controller.ts`, `lib/streaming/types.ts`
**Addresses**: REQ-SDC-3
**Validation**: Unit test: send message, call `abortProcessing()`, verify partial result is persisted and session remains valid for next message. Separate test: call `clearSession()`, verify session identity is reset and pending prompts discarded.

Add `abortProcessing()` to the controller interface. It signals `abortController.abort()` and returns. The streamer's for-await loop exits on its next iteration when it checks `abortSignal?.aborted`, marks running tools as incomplete, and breaks out of the loop. The `runStreaming()` finally block then persists the partial result normally.

`clearSession()` remains for "start a new session" (REQ-SDC-6): it aborts, closes the SDK query immediately, discards pending prompts, and resets session identity.

`abortProcessing()` does three things:
1. Calls `queryResult.interrupt()` to cleanly stop the SDK (not `close()`, which kills the process)
2. Signals `abortController.abort()` so the streamer loop exits on next iteration
3. Discards pending prompts (same `discardPendingPrompts()` call that `clearSession()` uses)

Persistence: the `runStreaming()` finally block persists the partial result from the snapshot. We don't depend on the SDK sending a final result event after `interrupt()`. The snapshot has accumulated text and tool state, which is sufficient.

Unlike `clearSession()`, `abortProcessing()` does NOT call `close()` (which terminates the child process) or reset session identity. The session remains valid for the next message. `close()` is reserved for `clearSession()` when the user starts a new session and the old SDK process needs to die.

**`interrupt()` vs `close()` distinction:** `interrupt()` is the SDK's clean stop mechanism (asks the process to stop). `close()` is termination (kills the process). The current codebase only uses `close()`, which is incorrect for user-initiated abort. This refactor fixes that.

### Step 7: Split chat route into send + stream endpoints

**Files**: `app/api/chat/route.ts` (modify), `app/api/chat/stream/route.ts` (new)
**Addresses**: REQ-SDC-1, REQ-SDC-2, REQ-SDC-4, REQ-SDC-8, REQ-SDC-9, REQ-SDC-10, REQ-SDC-17

**POST `/api/chat`** becomes a REST endpoint (no SSE):
- Validates request, calls `controller.sendMessage()`
- Catches `AlreadyProcessingError`, returns 409 with `{ error: { code: "ALREADY_PROCESSING", message: "..." } }`
- On success, returns 200 with `{ sessionId: string }` from `controller.getState()`
- No ReadableStream, no event subscription

**GET `/api/chat/stream`** (new) is the SSE viewport:
- Creates ReadableStream
- First event: `snapshot` containing `controller.getSnapshot()` result (wrapped in try/catch; if getSnapshot throws, send error event and close)
- If `isProcessing` is false, send snapshot and close immediately (no subscription needed). Per REQ-SDC-9: "If processing is already complete when the client connects, the snapshot includes the final result and no further events follow."
- If `isProcessing` is true, send snapshot, then subscribe to controller events, forward to stream
- `cancel()` only unsubscribes (no abort, no clear)
- Terminal events (`response_end`, `error`, `session_cleared`) close the stream
- Multiple concurrent connections are fine (each subscribes independently)

### Step 8: Update abort endpoint

**Files**: `app/api/chat/[sessionId]/abort/route.ts`
**Addresses**: REQ-SDC-3

Change from calling `controller.clearSession()` to `controller.abortProcessing()`. Partial response is persisted, session remains valid.

### Step 9: Update useChat for two-phase flow

**Files**: `hooks/useChat.ts`
**Addresses**: REQ-SDC-2, REQ-SDC-8, REQ-SDC-9

Split `sendMessage()` into two phases:
1. POST to `/api/chat` (submit message, get session ID or 409)
2. GET `/api/chat/stream` (attach SSE viewport)

The POST response includes `{ sessionId }`. The `useChat` hook doesn't need to store it; SessionContext already tracks the session ID from the `session_ready` event that arrives via the SSE stream. The GET request doesn't need a session ID parameter since the controller is singleton.

Add `snapshot` event handling: when the first event from the stream is `snapshot`, forward it via `onEvent` so `useServerMessageHandler` can render the accumulated state.

Handle 409 by setting an error state ("Processing in progress, please wait").

The `abort()` method still POSTs to the abort endpoint. It no longer needs to abort the fetch; the SSE stream continues and will receive the terminal event from the server's abort handling.

### Step 10: Add reconnection on mount

**Files**: `hooks/useChat.ts`, `contexts/SessionContext.tsx`
**Addresses**: REQ-SDC-8, REQ-SDC-9

When the chat component mounts and a session ID exists, automatically connect to GET `/api/chat/stream`. If processing is active, the snapshot event provides accumulated state. If processing is complete, the snapshot has the final result and the stream closes immediately.

On unmount, close the SSE connection (useEffect cleanup). On remount, reconnect. React's useEffect cleanup handles this naturally.

Handle reconnection after network loss: when the SSE stream closes unexpectedly (not a terminal event), keep session state in place (don't clear messages) and attempt to reconnect. Backoff: 1s initial, 2x multiplier, 30s max, reset on successful connection.

### Step 11: Add snapshot rendering in SessionContext

**Files**: `contexts/SessionContext.tsx`, `lib/schemas/index.ts` (if needed)
**Addresses**: REQ-SDC-8, REQ-SDC-12, REQ-SDC-17

Add a `snapshot` event type to the frontend event handling. When received:
- Set accumulated `content` as the latest assistant message (no streaming animation). If a partial message already exists from before disconnect, replace it. Previous messages in history are preserved.
- Restore pending prompts to UI state (permission/question dialogs)
- Restore tool invocation state
- Update context usage display

This is the reconnect mechanism. No event replay, just a point-in-time snapshot rendered immediately.

### Step 12: Tests

**Files**: `lib/streaming/__tests__/session-streamer.test.ts`, `lib/streaming/__tests__/active-session-controller.test.ts`, `hooks/__tests__/useChat.test.ts`
**Addresses**: All requirements (validation)

Unit tests per spec's AI Validation section:
- Disconnect client mid-stream, verify processing completes and result is persisted
- Reconnect client mid-stream, verify snapshot delivered followed by live events
- New `runStreaming` starts while old one's finally block runs, verify no state clobbering (generation guard)
- Abort while processing, verify partial result persisted and SDK interrupted
- Send message while processing, verify 409 rejection
- Snapshot includes accumulated text, tool state, and pending prompts
- Trigger tool permission request, disconnect, reconnect, verify snapshot includes pending permission, resolve it, verify processing continues
- Multiple subscribers receive same events
- `getSnapshot()` returns complete result after processing finishes
- `sendMessage()` returns before streaming events emit (fire-and-forget validation)

Write tests incrementally alongside each step, not as a batch at the end. Step 12 is for integration tests that validate cross-step behavior.

### Step 13: Validate against spec

Run `pr-review-toolkit:code-reviewer` on the changed files. Then launch a fresh-context sub-agent (`lore-development:fresh-lore`) that reads the spec at `.lore/specs/server-driven-chat.md`, reviews the implementation, and flags any requirements not met. Address all Critical findings before marking complete.

## Delegation Guide

Steps requiring specialized expertise:
- Step 1 (streamer refactor): Async patterns, closure design. The tricky part is making the async loop run detached while exposing synchronous state reads.
- Step 3 (generation guard): Concurrency safety. Must handle the overlap between old finally block and new run start.
- Step 7 (route split): SSE protocol. The snapshot-first pattern is the key design decision.
- Step 10 (reconnection): React lifecycle. Must handle mount/unmount/remount without leaking connections.

Consult `.lore/lore-agents.md` for available agents:
- `pr-review-toolkit:silent-failure-hunter` for error handling review (critical given the retro lessons about silent failures)
- `pr-review-toolkit:type-design-analyzer` for the new `SessionSnapshot` type
- `pr-review-toolkit:pr-test-analyzer` for test coverage validation

## Resolved Questions

1. **Should `abortProcessing()` resolve pending prompts?** No. Abort means abort. `abortProcessing()` discards pending prompts (rejects them) just like `clearSession()` does. The partial response up to the abort point is persisted.

2. **How to stop SDK processing on abort?** Use `queryResult.interrupt()`, not `queryResult.close()`. `interrupt()` is the SDK's clean stop mechanism. `close()` kills the child process and is only appropriate when discarding the session entirely (new session clears old). Persist from the streamer snapshot rather than depending on the SDK yielding a final result event after interrupt.
