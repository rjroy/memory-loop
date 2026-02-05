---
title: WebSocket Handler Integration with ActiveSessionController
date: 2026-02-05
status: complete
tags: [migration, websocket, streaming, refactor]
modules: [websocket-handler, streaming]
related:
  - .lore/specs/session-viewport-separation.md
  - .lore/brainstorm/next-js-migration.md
---

# Plan: WebSocket Handler Integration

## Context

Phase 1.1 of the Next.js migration is complete:
- `backend/src/streaming/` module created with `ActiveSessionController`, `SessionStreamer`, types
- Next.js SSE endpoints working (`nextjs/app/api/chat/`)
- Frontend `useChat` hook implemented with `transport="sse"` option

This plan completes Phase 1.2: Update WebSocket handler to use the new streaming module.

## Goal

Make `websocket-handler.ts` consume `ActiveSessionController` instead of owning streaming logic directly. The handler becomes a thin transport layer while the controller owns AI state (REQ-6 from session-viewport spec).

## Current State

**WebSocket handler owns:**
- `this.state.activeQuery` (SDK connection)
- `this.state.pendingPermissions` / `this.state.pendingAskUserQuestions` (pending prompts)
- `this.state.cumulativeTokens`, `contextWindow`, `activeModel` (streaming state)
- Streaming loop (`streamEvents()`, `handleStreamEvent()`, etc.)
- Message persistence (calls `appendMessage()`)

**ActiveSessionController already has:**
- `startSession()` / `resumeSession()` - creates SDK connection
- `subscribe()` - emits `SessionEvent` to subscribers
- `respondToPrompt()` - resolves pending permissions/questions
- `clearSession()` - aborts and cleans up
- `getState()` - returns current session state
- All streaming logic via `streamSdkEvents()`

## Event Type Mapping

The controller emits `SessionEvent` types; WebSocket sends `ServerMessage` types:

| SessionEvent | ServerMessage | Notes |
|--------------|---------------|-------|
| `session_ready` | `session_ready` | Same |
| `response_start` | `response_start` | Same |
| `response_chunk` | `response_chunk` | Same |
| `response_end` | `response_end` | Same |
| `tool_start` | `tool_start` | Same |
| `tool_input` | `tool_input` | Same |
| `tool_end` | `tool_end` | Same |
| `error` | `error` | Same |
| `prompt_pending` (tool_permission) | `tool_permission_request` | Map prompt fields |
| `prompt_pending` (ask_user_question) | `ask_user_question_request` | Map prompt fields |
| `prompt_resolved` | N/A | Internal bookkeeping |
| `session_cleared` | N/A | Internal bookkeeping |

## Implementation Steps

### Step 1: Add Controller Subscription

In `handleDiscussionMessage()` (lines 664-798):

**Before:**
```typescript
const queryResult = await (sessionId ? resumeSession(...) : createSession(...));
this.state.activeQuery = queryResult;
await this.streamEvents(queryResult, messageId, ws);
```

**After:**
```typescript
const controller = getActiveSessionController();
const unsubscribe = controller.subscribe((event) => {
  this.handleControllerEvent(event, ws);
});

try {
  if (sessionId) {
    await controller.resumeSession(vault.path, sessionId, prompt);
  } else {
    await controller.startSession(vault, prompt);
  }
} finally {
  unsubscribe();
}
```

### Step 2: Create Event Mapper

New method `handleControllerEvent()`:

```typescript
private handleControllerEvent(event: SessionEvent, ws: ServerWebSocket<unknown>): void {
  switch (event.type) {
    case "session_ready":
    case "response_start":
    case "response_chunk":
    case "response_end":
    case "tool_start":
    case "tool_input":
    case "tool_end":
    case "error":
      // Direct passthrough - types match
      this.send(ws, event as unknown as ServerMessage);
      break;

    case "prompt_pending":
      if (event.prompt.type === "tool_permission") {
        this.send(ws, {
          type: "tool_permission_request",
          toolUseId: event.prompt.id,
          toolName: event.prompt.toolName!,
          input: event.prompt.input,
        });
      } else if (event.prompt.type === "ask_user_question") {
        this.send(ws, {
          type: "ask_user_question_request",
          toolUseId: event.prompt.id,
          questions: event.prompt.questions!,
        });
      }
      break;

    // prompt_resolved, session_cleared - no WebSocket message needed
  }
}
```

### Step 3: Update Permission/Question Response Handlers

**Current:** Resolve from `this.state.pendingPermissions`

**New:** Call `controller.respondToPrompt()`

```typescript
private async handleToolPermissionResponse(payload: ToolPermissionResponsePayload): Promise<void> {
  const controller = getActiveSessionController();
  controller.respondToPrompt(payload.toolUseId, {
    type: "tool_permission",
    allowed: payload.allowed,
  });
}

private async handleAskUserQuestionResponse(payload: AskUserQuestionResponsePayload): Promise<void> {
  const controller = getActiveSessionController();
  controller.respondToPrompt(payload.toolUseId, {
    type: "ask_user_question",
    answers: payload.answers,
  });
}
```

### Step 4: Update Abort Handler

**Current:** Calls `this.state.activeQuery?.interrupt()`

**New:** Calls `controller.clearSession()`

```typescript
private async handleAbort(): Promise<void> {
  const controller = getActiveSessionController();
  await controller.clearSession();
}
```

### Step 5: Remove Redundant Code

After integration, remove from `websocket-handler.ts`:
- `streamEvents()` method (~80 lines)
- `handleStreamEvent()` method (~125 lines)
- `handleResultEvent()` method (~130 lines)
- `handleUserEvent()` method (~30 lines)
- `summarizeEvent()` method (~35 lines)
- `createToolPermissionCallback()` method (~20 lines)
- `createAskUserQuestionCallback()` method (~20 lines)
- State fields: `activeQuery`, `pendingPermissions`, `pendingAskUserQuestions`, `cumulativeTokens`, `contextWindow`, `activeModel`

**Total reduction:** ~440 lines

### Step 6: Update Connection State

Simplify `ConnectionState` interface:
```typescript
interface ConnectionState {
  currentVault: VaultInfo | null;
  currentSessionId: string | null;
  // Remove: activeQuery, pendingPermissions, pendingAskUserQuestions,
  //         cumulativeTokens, contextWindow, activeModel
  healthCollector: HealthEventCollector | null;
  activeMeeting: string | null;
}
```

## Files Modified

| File | Changes |
|------|---------|
| `backend/src/websocket-handler.ts` | Subscribe to controller, map events, remove streaming |
| `backend/src/streaming/types.ts` | Ensure `PendingPrompt` has all needed fields |

## What Stays in WebSocket Handler

- Connection lifecycle (`onOpen`, `onClose`)
- Message routing (`routeMessage`)
- Vault selection (`handleSelectVault`)
- Mock mode handler (already separate)
- Session resume flow coordination
- Slash commands caching (vault-scoped)
- Health collection (non-AI feature)

## Verification

1. **Unit tests:** Existing `websocket-handler.test.ts` should pass unchanged
2. **Manual test:** Discussion mode works with streaming, permissions, questions
3. **Context usage:** Verify token tracking still accurate
4. **Abort:** Verify stop button cancels streaming

## Risks

| Risk | Mitigation |
|------|-----------|
| Singleton controller vs multiple WS connections | Only one active session anyway (spec REQ-4) |
| Event timing race conditions | Controller emits synchronously in subscriber loop |
| Missing event types | Comprehensive mapping in handleControllerEvent |

## Rollback

If issues arise, revert the single commit. The controller module exists independently and doesn't break existing code.
