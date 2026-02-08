---
title: Server-driven chat processing
date: 2026-02-08
status: approved
tags: [architecture, session-management, sse, streaming, chat, processing-model]
modules: [active-session-controller, session-manager, session-streamer, chat-route, useChat]
related:
  - .lore/_archive/session-viewport-separation-spec.md
  - .lore/_archive/session-viewport-separation-brainstorm.md
  - .lore/_archive/active-session-controller.md
  - .lore/retros/discussion-multi-turn-resume.md
  - .lore/retros/next-js-migration.md
req-prefix: SDC
---

# Spec: Server-Driven Chat Processing

## Overview

Decouple chat processing from client connectivity. The server processes each user message to completion regardless of whether a client is observing. SSE connections become viewports into processing state, not drivers of it. Clients can disconnect and reconnect freely; the server holds a snapshot of current state for reconnecting clients. This supersedes the draft session-viewport separation spec, resolving its open stubs (event buffering, frontend reconnect) and updating for the SSE transport.

## Entry Points

- User sends a message via the Discussion input (from Discussion component)
- User resumes a previous session (from RecentActivity on Ground tab)
- User opens app with no session (creates new on first message)
- Client reconnects after connection loss (attaches to active processing)

## Requirements

### Processing Model

- REQ-SDC-1: The server processes each user message to completion. Processing does not depend on client connectivity.
- REQ-SDC-2: While processing a message, the server rejects any additional user messages for that session with HTTP 409 Conflict and a body indicating processing is active. The client must wait for processing to complete before sending another message.
- REQ-SDC-3: The user can abort processing. Abort is an explicit user action (stop button). Abort interrupts the SDK and stores the partial response. There is no other way to stop processing.
- REQ-SDC-4: Client disconnection does not abort or interrupt processing. The server continues until completion or explicit abort.

### Session Lifecycle

- REQ-SDC-5: Only one active session exists at a time per server (single-user assumption).
- REQ-SDC-6: Creating a new session clears any existing active session, discards pending prompts, and interrupts any in-progress processing.
- REQ-SDC-7: The `sendMessage` entry point handles both new sessions and resumed sessions through a unified interface. The caller provides a session ID (resume) or omits it (create); the controller resolves which SDK call to make. No behavioral divergence between the two cases from the caller's perspective.

### Client Connectivity

- REQ-SDC-8: When a client connects (or reconnects) to an active session, it receives a state snapshot as the first SSE event. The snapshot contains: (a) the session ID, (b) accumulated response text so far, (c) active tool invocations with their current status, and (d) any pending prompts (questions/permissions). This is a single event the client renders immediately, not a replay of individual stream events.
- REQ-SDC-9: After receiving the snapshot, the client receives live events going forward until processing completes or the client disconnects. If processing is already complete when the client connects, the snapshot includes the final result and no further events follow.
- REQ-SDC-10: Multiple SSE connections to the same session are allowed. All receive the same live events. (This supports the existing pattern where PairWritingMode shares the Discussion chat pipeline.)

### Pending Questions and Permissions

- REQ-SDC-11: When the SDK requests tool permission or asks a user question during processing, the request is stored as a pending prompt on the server. Processing pauses (the SDK callback blocks) until the prompt is resolved.
- REQ-SDC-12: Pending prompts are sent to any connected client immediately when they occur, and included in the state snapshot for reconnecting clients.
- REQ-SDC-13: The client resolves pending prompts via REST (existing permission/answer endpoints). The server forwards the response to the blocked SDK callback, and processing continues.
- REQ-SDC-14: Pending prompts have no timeout. They wait until resolved, or until the session is cleared (which discards them).

### State and Persistence

- REQ-SDC-15: The session streamer accumulates response text and tool state as SDK events arrive. This accumulated state serves two purposes: (a) constructing snapshots for reconnecting clients (REQ-SDC-8), and (b) building the final result for persistence. When processing completes, the final result is persisted to the session file and the accumulated state is discarded.
- REQ-SDC-16: If processing completes with no client connected, the result is still persisted. The next client to connect sees the completed response in session history.
- REQ-SDC-17: Individual SSE events are not buffered for later delivery. If no client is listening when an event fires, that event is lost. This is acceptable because the snapshot (constructed from accumulated streamer state) provides everything a reconnecting client needs. The snapshot is the reconnect mechanism, not event replay.

### Concurrency Safety

- REQ-SDC-18: The controller must handle the case where a previous processing run is still winding down (async generator teardown) when a new run starts. Shared mutable state (queryResult, abortController, isStreaming) must not be clobbered by the previous run's cleanup.

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Processing complete | SDK query finishes (success or error) | Result persisted, clients notified |
| Processing aborted | User clicks stop button | Partial result persisted, clients notified |
| Session cleared | User starts new session | Active processing interrupted, state reset |
| Client disconnects | Network loss, tab close, navigation | Processing continues, client removed from listeners |
| Client reconnects | New SSE connection to active session | Snapshot delivered, live events resume |

## Success Criteria

- [ ] Client disconnects mid-stream; on reconnect, the session file contains the complete response
- [ ] Client reconnects mid-stream; first SSE event is a snapshot containing accumulated text, tool state, and pending prompts
- [ ] Client reconnects mid-stream; after the snapshot event, subsequent events arrive in real-time
- [ ] Client sends POST to abort endpoint; SDK processing stops and session file contains partial response up to that point
- [ ] Client SSE connection drops (no abort); server-side processing run completes without interruption
- [ ] Client sends a second message while processing; server responds with HTTP 409
- [ ] New session starts while old processing is in its finally block; new session's state is not corrupted by old cleanup
- [ ] Processing completes with zero connected clients; session file is written correctly
- [ ] All existing Discussion, PairWriting, and slash command functionality preserved (manual smoke test)

## AI Validation

**Defaults** (apply unless overridden):
- Unit tests with mocked time/network/filesystem/LLM calls (including Agent SDK `query()`)
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**
- Test: disconnect client mid-stream, verify processing completes and result is persisted
- Test: reconnect client mid-stream, verify snapshot delivered followed by live events
- Test: new `runStreaming` starts while old one's finally block runs, verify no state clobbering (the generation guard)
- Test: abort while processing, verify partial result persisted and SDK interrupted
- Test: send message while processing, verify rejection

## Constraints

- Single-user server assumption (one active session is sufficient)
- Pending prompts are in-memory only; server restart clears them (acceptable)
- The state snapshot is constructed from in-memory accumulation during processing, not from replaying persisted data
- SDK must support continued event consumption without connected client (already confirmed: the async generator runs server-side regardless of HTTP connections)

## Context

This spec completes the session-viewport separation work that was designed but never fully implemented. The original spec (now archived) identified the core principle ("the session is the thing, the WebSocket is just a viewport") and defined the Active Session Controller interface. Two stubs were left open:

- **Event buffering strategy**: Resolved as "snapshot, not replay." The server accumulates response text and tool state during processing. Reconnecting clients receive this snapshot, then live events. No individual event replay.
- **Frontend reconnect behavior**: Resolved as "deliver snapshot + pending prompts, then live stream." The client renders the snapshot immediately (no animation of past events) and continues from there.

The immediate trigger for this spec is a production bug observed over cellular/VPN: a race condition in `runStreaming`'s finally block can clobber a newer session's state (REQ-SDC-18), and forceful SDK query termination can prevent session persistence (REQ-SDC-15, REQ-SDC-16). Both bugs stem from the current architecture where processing lifetime is coupled to connection lifetime.

### Prior Work

- [Archived spec: Session viewport separation](.lore/_archive/session-viewport-separation-spec.md): The predecessor. Requirements REQ-1 through REQ-6 are carried forward here.
- [Archived design: Active Session Controller](.lore/_archive/active-session-controller.md): The implemented interface. Hybrid push/pull pattern (events + state queries) is preserved.
- [ADR 0001: Server-side session storage](.lore/_archive/adr-0001-server-side-session-messages.md): Established server as source of truth for messages. Prerequisite for this work.
- [Retro: Discussion multi-turn resume](.lore/retros/discussion-multi-turn-resume.md): Confirmed `sendMessage` unification as the right model (REQ-SDC-7).
- [Retro: Next.js migration](.lore/retros/next-js-migration.md): SSE + REST POST for mid-stream interactions is confirmed simpler than WebSocket. Backend modules as pure libraries survive framework changes.
- [Retro: contentRoot + instrumentation fix](.lore/retros/content-root-and-instrumentation-fix.md): Silent failures in try/catch blocks masked broken schedulers. Relevant to REQ-SDC-16 (results must persist even without connected clients).
