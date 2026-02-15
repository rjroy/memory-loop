---
title: Stale ref race condition in streaming message handler
date: 2026-02-15
status: complete
tags: [bug, react, race-condition, streaming, reducer, useRef]
modules: [session-context, session-reducer]
related: [.lore/plans/message-fragmentation-streaming.md]
---

# Retro: Message Fragmentation During Streaming

## Summary

Streaming LLM responses appeared as multiple separate message bubbles instead of accumulating into a single assistant turn. The fix moved create-or-append decisions from `useServerMessageHandler` (which relied on a stale `useRef`) into the reducer, where state is always current.

## What Went Well

- Root cause was identified quickly from the screenshot: the pattern of "partial text in one bubble, tool indicator, rest of text in another bubble" pointed directly at a race between SSE events and React renders.
- The fix was clean and self-contained. Four new reducer actions replaced all `messagesRef` usage, eliminating the entire class of stale-ref bugs.
- The plan correctly predicted that `session_ready` and `snapshot` handlers had the same vulnerability, and moving all three into the reducer removed the ref entirely rather than leaving a partial fix.
- Tests directly reproduced the race condition (dispatching ENSURE then APPEND without a render in between) and proved the fix works.

## What Could Improve

- The plan said `types.ts` wouldn't need changes, but it did. The new reducer actions needed action wrappers exposed through `SessionActions` because `useServerMessageHandler` accesses state through the context interface, not through raw dispatch. This was a minor oversight in planning.
- No existing tests covered the streaming message handler's create-or-append logic, which is how this bug shipped in the first place. The handler was written with `useRef` as the synchronization mechanism, and no test verified that rapid dispatches wouldn't fragment.

## Lessons Learned

- `useRef` updated via `useEffect` is always one render behind `useReducer` state. When SSE events (or any external event source) arrive faster than React renders, a ref-based "read current state, then dispatch" pattern will read stale data. The fix is to push the decision into the reducer, which always operates on the latest state.
- When multiple event handlers need to check "what's the last message?" before deciding what to do, that's a signal the logic belongs in the reducer, not in the handler. The reducer is the single source of truth for state transitions.

## Artifacts

- Plan: `.lore/plans/effervescent-wibbling-valiant.md`
- PR: #480
