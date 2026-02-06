---
title: Session and viewport separation
date: 2026-02-03
status: parked
tags: [architecture, websocket, session-management, separation-of-concerns]
modules: [websocket-handler, session-manager]
---

# Brainstorm: Session and Viewport Separation

## Context

Feature request: switch machines mid-conversation (close browser, open elsewhere, resume).

Current behavior: changing tabs or closing browser kills the WebSocket, which kills the session. The `queryResult` from `createSession`/`resumeSession` is held by the WebSocket handler, and callbacks (`requestToolPermission`, `askUserQuestion`) are bound to that specific connection.

The feature request revealed a deeper design problem.

## The Design Smell

Why is part of the session managed by WebSocket handler and part by session manager?

**WebSocket Handler currently holds:**
- `activeQuery` (the live SDK connection)
- `pendingPermissions` / `pendingAskUserQuestions` maps
- `cumulativeTokens`, `contextWindow`, `activeModel`
- The streaming loop that consumes SDK events

**Session Manager currently holds:**
- Session metadata persistence (JSON files)
- Creating/resuming SDK queries (but returns them, doesn't own them)
- Message history

The problem: `createSession` returns a query to the caller, then washes its hands of it. The WebSocket handler becomes the owner of a live process it didn't create.

## The Insight

**Current model:** WebSocket connection *is* the session. Connection dies, session dies.

**Better model:** Session exists independently. WebSocket is a viewport, attach, detach, reattach from anywhere.

"The session is the thing, the WebSocket is just a viewport into it."

## Proposed Ownership

Session Manager should own:
```
Session Manager
├── Persisted sessions (JSON files)
└── Active session (singular - one at a time)
    ├── queryResult (the SDK connection)
    ├── eventEmitter (pub/sub for streaming)
    ├── pendingPrompts (tool permissions, questions)
    └── state (tokens, model, etc.)
```

WebSocket Handler becomes a thin subscriber:
- `subscribeToSession(sessionId)` - start receiving events
- `unsubscribeFromSession(sessionId)` - stop receiving (session continues)
- `respondToPrompt(promptId, answer)` - answer pending prompts

The WebSocket handler shouldn't be "managing" anything about the AI conversation. It should be:
- A message router (client -> session, session -> client)
- A subscription manager (which client is watching which session)
- Nothing else

## Design Constraints

**Lifecycle:** One active session at a time. Unless messages are flowing, it's idle and no cost.

**Multiple viewports:** Out of scope unless it falls out naturally from the design.

**Resource management:** Non-issue. Single-user server, single active session.

**The prompt problem:** Pending prompts (tool permissions, questions) wait for a viewport. When no viewport is connected, prompts queue. When viewport reconnects, it picks up pending prompts and can respond. Need to discuss reconnect mechanics in detail later.

## Open Questions

- How does the viewport discover pending prompts on reconnect?
- What's the timeout before a prompt auto-denies (if ever)?
- Does the SDK support pausing mid-stream, or does it expect continuous consumption of events?
- Where does the event buffer live if the viewport disconnects mid-stream?

## Next Steps

This brainstorm identifies the architectural direction. Next step would be a design document that works through the mechanics of:
1. Session manager owning active sessions
2. Event pub/sub pattern for streaming
3. Prompt queue and reconnect protocol
