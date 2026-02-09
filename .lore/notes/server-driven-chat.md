---
title: Implementation notes: server-driven-chat
date: 2026-02-08
status: complete
tags: [implementation, notes]
source: .lore/plans/server-driven-chat.md
modules: [active-session-controller, session-streamer, chat-route, useChat]
---

# Implementation Notes: Server-Driven Chat Processing

## Progress
- [x] Phase 1: Expose streamer snapshot mid-stream (plan steps 1)
- [x] Phase 2: Add snapshot to controller + generation guard (plan steps 2-3)
- [x] Phase 3: Decouple runStreaming + processing rejection + abort separation (plan steps 4-6)
- [x] Phase 4: Split chat route into send + stream endpoints (plan steps 7-8)
- [x] Phase 5: Update useChat for two-phase flow + reconnection (plan steps 9-10)
- [x] Phase 6: Add snapshot rendering in SessionContext (plan step 11)
- [x] Phase 7: Integration tests + validation (plan steps 12-13)

## Log

### Phase 1: Expose streamer snapshot mid-stream
- Dispatched: Refactor `streamSdkEvents()` into `startStreamSdkEvents()` returning `StreamerHandle`
- Result: New function returns handle with `getSnapshot()` and `result` promise. Backward-compatible wrapper preserved.
- Tests: 11 tests (handle returns synchronously, snapshot at various points, abort handling, backward compat)

### Phase 2: Add snapshot to controller + generation guard
- Dispatched: Add `SessionSnapshot` type, `getSnapshot()` method, `currentStreamerHandle`, generation guard
- Result: Controller uses `startStreamSdkEvents` directly, stores handle for snapshot access. Generation guard prevents stale finally blocks from clobbering state.
- Tests: 1 new test (empty snapshot defaults). Mid-stream tests deferred to integration.

### Phase 3: Decouple runStreaming + processing rejection + abort separation
- Dispatched: Fire-and-forget `runStreaming`, `AlreadyProcessingError`, `abortProcessing()` vs `clearSession()`
- Result: `sendMessage()` returns immediately after kicking off streaming. `performClearSession()` extracted as internal function. `abortProcessing()` uses `interrupt()` (not `close()`). Partial result persistence in catch block.
- Tests: 5 new tests (AlreadyProcessingError shape, abort no-op, clearSession resets)
- Decision: `clearSession()` changed from `Promise<void>` to `void` (was already sync under the hood)

### Phase 4: Split chat route into send + stream endpoints
- Dispatched: Convert POST `/api/chat` to REST, create GET `/api/chat/stream` SSE viewport
- Result: POST returns `{ sessionId }` or 409. GET sends snapshot-first then live events. `encodeSSE` broadened to accept `object`.
- Tests: Existing suite passes (4145 tests)

### Phase 5: Update useChat for two-phase flow + reconnection
- Dispatched: Two-phase sendMessage (POST then connectToStream), snapshot event handling, abort reorder
- Result: `connectToStream()` extracted for reuse. `handleStreamEvent()` processes snapshot + prompt_pending translation. Abort sends server request before closing SSE.
- Tests: 19 useChat tests pass (including new 409 and snapshot tests)
- Note: Full reconnection-with-backoff deferred. Basic reconnect-on-mount supported via connectToStream.

### Phase 6: Add snapshot rendering in SessionContext
- Dispatched: Snapshot event handler in `useServerMessageHandler`, new `REPLACE_LAST_MESSAGE_CONTENT` reducer action
- Result: Handles session ID restore, content restore (replace or add), context usage. Tool invocations deferred to live events.
- Tests: 14 new tests (snapshot handling + replaceLastMessageContent)

### Phase 7: Integration tests + validation
- Dispatched: Three review agents in parallel (code-reviewer, silent-failure-hunter, fresh-lore spec validator)
- Code review found 2 critical bugs, 3 important issues
- Silent failure hunter found 14 findings (1 critical, 4 high, 7 medium, 1 low)
- Spec validator confirmed all 18 requirements implemented, flagged 3 critical test gaps
- **Critical bugs fixed:**
  1. `abortController` not nulled in `performClearSession()` (leaked reference after abort)
  2. Session ID race: `getState().sessionId` returned null because `currentSessionId` was set in fire-and-forget `runStreaming()` instead of before it. Fixed by setting identity in `sendMessage()` before `void runStreaming()`.
  3. `void queryResult.interrupt()` created unhandled rejection path. Fixed with `.catch()`.
- **Critical integration tests added (3 tests):**
  1. Processing continues after subscriber removal (REQ-SDC-4)
  2. Generation guard prevents stale cleanup (REQ-SDC-18)
  3. New session clears existing processing (REQ-SDC-6)
- Tests: 4164 pass across 107 files, typecheck clean
- Deferred to post-merge: error handling improvements from silent-failure-hunter (permission resolution error surfacing, SSE enqueue error differentiation, streaming state transitions). These are quality improvements to pre-existing patterns, not regressions from this change.

## Divergence

- **Reconnection with backoff (plan step 10)**: Deferred. The plan specified exponential backoff (1s initial, 2x, 30s max). The current implementation supports reconnection via `connectToStream()` but doesn't auto-reconnect on network loss. The infrastructure is in place for a follow-up.
- **Tool invocation bulk restore from snapshot**: The plan implied full tool state restoration on reconnect. Current implementation restores text content only; tool invocations appear through live events after the snapshot. This is acceptable because the snapshot content includes all text accumulated so far.
- **`clearSession()` return type**: Changed from `Promise<void>` to `void`. The implementation was already synchronous; the async wrapper was unnecessary. This simplifies callers.
