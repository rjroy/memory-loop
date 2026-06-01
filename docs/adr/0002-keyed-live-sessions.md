---
title: "ADR 0002: Keyed Live Sessions for the Think Tab"
date: 2026-06-01
status: accepted
tags: [adr, architecture, session, streaming, think]
modules: [sessions, streaming]
---

# ADR 0002: Keyed Live Sessions for the Think Tab

**Status:** Accepted
**Date:** 2026-06-01
**Authors:** RJ Roy

## Context

The daemon tracked the in-flight chat turn in a single global "active session"
slot. Only one live session could exist at a time, and the SSE stream and the
abort/permission/answer routes all implicitly operated on whatever that slot
held. This produced the Think-tab wrong-session bug:

1. Start conversation A and let it stream. A becomes the active session.
2. Go to Ground, resume an older conversation B, return to Think.
3. The stream reconnect (or a follow-up turn) attached to the global slot, which
   could still reflect A. B's tab showed A's events, or the wrong session id was
   persisted.

Two code paths "did the same thing differently": the send path omitted the
session id (the slot was implied) while the reconnect path tried to scope by a
`?sessionId=` query the server did not fully honor. The frontend layered a
`snapshot` event on top: on reconnect the daemon reconstructed a single
accumulated-state blob, and the reducer had a dedicated `HANDLE_SNAPSHOT` path
separate from how live events were applied. That split was a second source of
divergence and a dead `pendingSessionId` flag accreted around the resume flow.

A sibling project, oracle-keep, runs on the same SDK and does not have this bug:
it keys live sessions by id in a map, puts the id in the URL path on every route,
and replays the turn's raw events on reconnect instead of a snapshot wrapper.

## Decision

Replace the singleton active-session slot with per-session live state keyed by
session id, mirroring the oracle-keep model.

### Changes Made

**Daemon:**
- A `Map<sessionId, LiveSession>` registry replaces the global slot. Each
  `LiveSession` owns its turn controller, subscriber list, and event buffer.
- All live routes are keyed by `:sessionId` in the path:
  `POST/GET /session/:sessionId/chat`, `/abort`, `/permission`, `/answer`,
  `/clear`, `/state`. Send and stream are folded onto one `/chat` route (POST
  starts a turn, GET attaches a viewport), matching the reference shape.
- On connect the daemon replays the turn's buffered raw events (`session_ready`,
  `response_start`, `response_chunk...`, tool events, terminal), then streams
  live ones. There is no snapshot wrapper; replay and live use the same events.
- `LiveSession.piSession` stays warm across turns; a daemon restart cold-starts
  from `piSessionPath` on the next message (the existing resume path).

**Frontend:**
- New chats mint the session id (`crypto.randomUUID()`) up front so it is in the
  path on the very first message. `useChat` seeds `sessionIdRef` synchronously so
  the stream/abort within the turn use it immediately, before the server echoes
  it back in `session_ready`.
- Proxy routes are keyed: `/api/chat/[sessionId]` and
  `/api/chat/[sessionId]/stream`. The old `/api/chat` and `/api/chat/stream`
  routes are deleted; the id is never in the body or a query string.
- `HANDLE_SNAPSHOT` / `handleSnapshot`, `SET_PENDING_SESSION_ID` /
  `pendingSessionId`, and the now-dead `REPLACE_LAST_MESSAGE_CONTENT` are
  removed. Replayed events flow through the same race-safe reducer actions as
  live events.

## Consequences

### Positive

- **Correct resume** - Each tab streams exactly its own session; resuming B can
  never surface A's events, because the path keys the stream.
- **Independent concurrent sessions** - Two tabs on two sessions stream at once.
- **One reconnect path** - Replaying raw events means reconnect and first-connect
  share a code path; the snapshot special-case is gone.
- **Less state** - `pendingSessionId` and the snapshot reducer branch are deleted.

### Negative

- **Client owns the id** - The frontend mints ids, so the daemon must guard a
  client-supplied id for a *new* session against colliding with an existing
  session file. `validateSessionId` exists; collision handling is the daemon's
  responsibility.
- **Live-map growth** - Warm sessions accumulate in the registry.

### Mitigations

- Evict on `clear`; optionally evict completed, zero-subscriber sessions after a
  TTL. Scale is a personal vault tool (oracle-keep never evicts), so this is a
  conscious low-urgency decision rather than a required feature.
- The server processes each turn to completion regardless of client connectivity,
  so a disconnect/reload mid-turn is recovered by reconnecting and replaying.

## References

- Plan: `.lore/plans/think-tab-keyed-sessions.md`
- Implementation notes: `.lore/work/think-tab-keyed-sessions-implementation.md`
- Reference doc: `.lore/reference/think.md` (SSE streaming protocol)
- Prior art: oracle-keep keyed-session model
- Supersedes the singleton model from ADR 0001 (server-side session messages)
