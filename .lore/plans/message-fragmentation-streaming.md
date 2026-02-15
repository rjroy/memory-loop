# Fix Message Fragmentation During Streaming

## Context

When the LLM streams a response, partial text appears as separate message bubbles instead of accumulating into a single assistant turn. The screenshot shows "Good" in one bubble, a "Task" tool indicator, then "call. Let me use the skill-reviewer agent..." in another bubble. These fragments are also persisted, so they survive page reloads.

## Root Cause

`useServerMessageHandler` in `SessionContext.tsx` reads `messagesRef.current` to decide whether to create a new message or append to an existing one. This ref is updated via `useEffect` (post-render), but SSE events arrive between renders. The sequence:

1. `response_start` dispatches `ADD_MESSAGE` (creates streaming assistant message)
2. React hasn't re-rendered yet, so `messagesRef.current` is stale
3. `response_chunk` reads stale ref, doesn't see the streaming message, dispatches another `ADD_MESSAGE`
4. Result: two (or more) assistant message bubbles for one turn

## Fix

**Move the "create or append?" decision into the reducer.** The reducer always operates on the latest state, so there's no stale-ref race.

### New reducer actions

Add two new action types that replace the branching logic currently in `useServerMessageHandler`:

- `ENSURE_STREAMING_MESSAGE` (replaces `response_start` handler logic): If the last message is already a streaming assistant message, no-op. Otherwise, add a new empty streaming assistant message.
- `APPEND_STREAMING_CHUNK` (replaces `response_chunk` handler logic): If the last message is a streaming assistant message, append content. If not, create a new streaming assistant message with the chunk content.

### Files to modify

1. **`nextjs/contexts/session/reducer.ts`**
   - Add `ENSURE_STREAMING_MESSAGE` and `APPEND_STREAMING_CHUNK` to `SessionAction` union
   - Add handler functions and reducer cases

2. **`nextjs/contexts/SessionContext.tsx`**
   - Simplify `useServerMessageHandler`: `response_start` dispatches `ENSURE_STREAMING_MESSAGE`, `response_chunk` dispatches `APPEND_STREAMING_CHUNK`
   - Remove `messagesRef` entirely (no handler reads it for streaming decisions anymore)
   - Check remaining uses of `messagesRef` (session_ready history restore, snapshot handler) and either keep ref for those or pass them through the reducer too

3. **`nextjs/contexts/session/types.ts`**
   - No changes needed (ConversationMessage type is fine, SessionActions interface doesn't need new public actions since these are internal dispatch details)

### What about `messagesRef`?

The ref is also used in:
- `session_ready` handler (line 541): checks `messagesRef.current.length === 0` before restoring server history
- `snapshot` handler (line 611-614): checks last message to decide replace vs add

These can also move into the reducer for consistency:
- `session_ready` with messages: dispatch `SET_MESSAGES_IF_EMPTY` (reducer checks `state.messages.length === 0`)
- `snapshot`: dispatch a `RESTORE_SNAPSHOT` action (reducer checks last message state)

This eliminates `messagesRef` entirely, which removes the class of bugs where ref staleness causes incorrect branching.

## Verification

1. `bun run typecheck` passes
2. `bun run test` passes (run sequentially per CLAUDE.md)
3. `bun run lint` passes
4. Manual test: start a conversation, observe streaming response stays in one bubble
5. Manual test: disconnect and reconnect mid-stream, verify snapshot restores correctly
6. Manual test: response with tool use mid-turn, verify text before and after tool stays in one bubble
