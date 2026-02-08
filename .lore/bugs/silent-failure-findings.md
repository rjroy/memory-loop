---
title: Silent failure findings from SDC review
date: 2026-02-08
status: open
source: silent-failure-hunter review of PR #474
tags: [error-handling, silent-failures, sse, useChat, controller]
---

# Silent Failure Findings

Surfaced by the silent-failure-hunter during the server-driven chat review. Finding 9 (unhandled rejection from `void interrupt()`) was fixed in PR #474. The remaining 13 are documented here.

---

## Conversations hang forever

### Finding 6: Permission/question resolution fails silently

**Location**: `hooks/useChat.ts:395-422` (resolvePermission), `hooks/useChat.ts:427-454` (resolveQuestion)

**What happens**: User clicks Allow/Deny on a tool permission prompt. The fetch to the server fails (network error, auth expiry, server restart). The error is logged but not surfaced. The SDK callback stays blocked. The conversation is permanently stuck. No error shown, no retry option. Only escape is page refresh.

**Fix**: Set `lastError` and call `onError` when resolution fetch fails. Both the `!response.ok` path and the catch block need to surface the error.

```typescript
// Both resolvePermission and resolveQuestion need this pattern:
if (!response.ok) {
  const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
  const error = errorBody.error ?? `Resolution failed (HTTP ${response.status})`;
  setLastError(error);
  onErrorRef.current?.(error);
}
// ... and in the catch:
} catch (err) {
  const error = `Failed to send response: ${err instanceof Error ? err.message : "Network error"}`;
  setLastError(error);
  onErrorRef.current?.(error);
}
```

---

## Silent data loss

### Finding 4: SSE enqueue catch swallows serialization errors

**Location**: `app/api/chat/stream/route.ts:89-92`

**What happens**: The catch block around `streamController.enqueue(encodeSSE(event))` catches everything. If `encodeSSE` throws a serialization error (circular reference, invalid event structure), it's treated the same as "client disconnected." The stream dies silently. The client's UI stays in "streaming" state forever with no error.

**Fix**: Distinguish client-disconnect TypeError from serialization failures.

```typescript
} catch (err) {
  if (err instanceof TypeError && /enqueue|closed/.test(err.message)) {
    cleanup(); // Client disconnected, expected
  } else {
    log.error("Failed to send SSE event", { eventType: event.type, error: err });
    cleanup();
  }
}
```

---

### Finding 1: Partial result persistence failure swallowed

**Location**: `lib/streaming/active-session-controller.ts:364-366`

**What happens**: After an error or abort, the catch block tries to persist partial results via `sdkAppendMessage`. If that persistence fails (disk full, permissions), the error is logged but the user gets no indication their partial response was lost. The error event from line 339 already fired, so the user sees an error but doesn't know their data is gone.

**Fix**: Emit a user-visible warning event when persistence fails.

```typescript
} catch (persistErr) {
  log.error("Failed to persist partial result", {
    sessionId: result.sessionId,
    vaultPath,
    error: persistErr,
  });
  emit({
    type: "error",
    code: "PERSIST_ERROR",
    message: "Partial response was not saved. Your conversation may be incomplete.",
  });
}
```

---

### Finding 12: Tool input JSON parse failure drops event entirely

**Location**: `lib/streaming/session-streamer.ts:399-404`

**What happens**: When tool input JSON fails to parse, the `tool_input` event is never emitted. The tool shows as "running" in the UI with no input displayed. The user can't see what the tool was asked to do, can't make informed permission decisions, and can't debug unexpected tool results.

**Fix**: Emit a tool_input event with error placeholder so the UI renders something.

```typescript
} catch (err) {
  log.error(`Failed to parse tool input JSON for ${block.toolUseId}`, { jsonStr, err });
  emitter.emit({
    type: "tool_input",
    toolUseId: block.toolUseId,
    input: { _parseError: "Tool input could not be parsed" },
  });
}
```

---

## User sees wrong state

### Finding 11: Streaming state set before fetch succeeds

**Location**: `hooks/useChat.ts:232`

**What happens**: `connectToStream()` sets state to "streaming" synchronously, but the SSE fetch hasn't connected yet. If the server is slow or the fetch fails, the user sees a flash of streaming UI followed by an error. The state should stay "starting" (set by `sendMessage`) until the fetch succeeds.

**Fix**: Move `setStreamingState("streaming")` inside the async block, after the fetch succeeds.

```typescript
function connectToStream(): void {
  // ... setup ...
  // Don't set streaming state here; stays "starting" from sendMessage

  void (async () => {
    try {
      const response = await fetch(`${apiBase}/chat/stream`, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Stream failed: HTTP ${response.status}`);
      }
      setStreamingState("streaming"); // Now actually connected
```

---

### Finding 14: Session mismatch warning emits before session_ready

**Location**: `lib/streaming/active-session-controller.ts:442-455`

**What happens**: When resume returns a different session ID, `sendMessage` emits an error event ("Could not resume previous session"), then fires `void runStreaming()` which emits `session_ready`. The error arrives before `session_ready`, but the ordering is racy because `runStreaming` is fire-and-forget. The warning may flash and disappear, or display over the new conversation confusingly.

**Fix**: Include the warning in the `session_ready` event itself rather than emitting a separate error event before it. Or emit the warning after `session_ready`.

---

## Errors hidden from user

### Finding 5: Abort swallows all errors

**Location**: `hooks/useChat.ts:373-379`

**What happens**: The abort function catches and ignores all errors from the server abort request. If the server responds 409 (session mismatch), the abort was rejected and the user doesn't know. Processing continues, consuming API tokens, while the user thinks they stopped it.

**Fix**: Log non-trivial failures. Don't need to set error state (abort is best-effort), but warn when the server rejected the request.

```typescript
try {
  const response = await fetch(`${apiBase}/chat/${currentSessionId}/abort`, { method: "POST" });
  if (!response.ok && response.status !== 400) {
    // 400 = "no active streaming" which is fine (already ended)
    log.warn(`Abort request failed: HTTP ${response.status}`);
  }
} catch (err) {
  log.warn("Abort request failed (network)", err);
}
```

---

### Finding 7: Malformed SSE events silently dropped

**Location**: `hooks/useChat.ts:94-104`

**What happens**: `parseSSE` catches JSON parse errors and logs a warning, but drops the event. If a terminal event (`response_end`) is malformed (truncated by network buffer), it's dropped. The stream reader keeps waiting, but the server already closed. The UI hangs in "streaming" state with no error.

**Fix**: Promote log to error. Consider tracking whether a terminal event was received; if the stream ends without one, set error state.

---

### Finding 2: Slash command fetch failure falls back to empty array

**Location**: `lib/streaming/active-session-controller.ts:246-256`

**What happens**: When `result.supportedCommands()` fails, the code logs a warning and falls back to `slashCommands = []`. The `session_ready` event carries an empty array, indistinguishable from "no commands available." User sees no slash commands and thinks the feature doesn't exist.

**Fix**: Promote log level from warn to error. Consider adding a flag to `session_ready` indicating commands failed to load, so the UI could show "Commands unavailable" instead of an empty menu.

---

## Operational / fragility

### Finding 3: Detached .catch() creates fragile dual error path

**Location**: `lib/streaming/session-streamer.ts:198-206`

**What happens**: The `result` promise has a `.catch()` to prevent unhandled rejection. The error still propagates to the controller because `result` holds the original promise (the `.catch()` returns a new, unused promise). This works, but if anyone refactors `result = result.catch(...)`, errors would be swallowed and the controller's catch block would never fire. The code is one refactoring step from silent failure. Also double-logs errors.

**Fix**: Replace the log in the `.catch()` with an empty body and a comment explaining why the pattern is safe and what would break it.

---

### Finding 8: queryResult.close() failure logged at warn

**Location**: `lib/streaming/active-session-controller.ts:188-193`

**What happens**: `queryResult.close()` failures are caught and logged at warn level. If `close()` fails, the SDK child process may leak (zombie process). Accumulated leaks degrade server performance. Warn level likely filtered out of production alerting.

**Fix**: Promote to `log.error`. Include session ID for debugging.

---

### Finding 10: `as unknown as ServerMessage` casts bypass type safety

**Location**: `hooks/useChat.ts:166, 193-198, 210`

**What happens**: SSE events are cast to `ServerMessage` with `as unknown as ServerMessage`, bypassing TypeScript entirely. If the server sends an event with an unexpected shape, downstream handlers get `undefined` where they expect values. The UI renders blank text or missing tools with no error.

**Fix**: Add runtime validation (type guard or Zod schema) before casting. At minimum, verify the event has a `type` field.

---

### Finding 13: Abort response codes silently ignored

**Location**: `app/api/chat/[sessionId]/abort/route.ts` + `hooks/useChat.ts:373-379`

**What happens**: The abort endpoint returns 400 (nothing to abort) or 409 (session mismatch). The client ignores both. Low practical impact since abort is best-effort and the server processes independently.

**Fix**: Covered by Finding 5's fix. No additional work needed.
