# Companion Note: How oracle-keep Got This Right

Research note, 2026-05-31. Companion to `think-tab-intent.md`.

`~/Projects/oracle-keep` is a sibling project built on the **same pi-agent SDK**
(`@earendil-works/pi-coding-agent`) that solves the exact problem memory-loop's
Think tab keeps tripping over: many resumable conversations, each with a
server-owned live viewport. It is worth studying because it is not a different
architecture in spirit, it is the architecture memory-loop *intended*, with one
decision made differently at the root. That one decision is what fixes
everything downstream.

## The root decision: everything is keyed by session id

In memory-loop the daemon holds a single global "active session" slot. In
oracle-keep there is no global slot at all. State lives in a **map keyed by
session id**, and the session id is part of the URL on every request.

```
app/api/s/[id]/chat      POST = start a turn, GET = reconnect to the live stream
app/api/s/[id]/status    GET  = is *this* session processing?
app/api/s/[id]/history   GET  = persisted messages for *this* session
app/api/s/[id]/meta      GET  = slash commands / metadata for *this* session
app/api/s/[id]/widgets   GET  = widget snapshot for *this* session
```

There is never a "which session is active?" question because the question is
malformed. There is only "session X," and X is in the path. The whole class of
"the snapshot belongs to the wrong conversation" bugs cannot be expressed.

## The shape of the per-session state (`lib/session.ts`)

```ts
type SessionState = {
  sessionPromise: Promise<AgentSession>;  // the live pi-agent session
  isProcessing: boolean;                  // per session, not global
  eventBuffer: BufferedEvent[];           // this turn's events, for replay
  subscribers: Map<string, UIEnqueue>;    // SSE viewers of THIS session
  uiContext: WebUIContext;
  meta: SessionMeta;
};

// HMR-safe map on globalThis. N concurrent sessions, each fully isolated.
var __oracleKeepSessions: Map<string, SessionState>;
```

Compare directly to memory-loop's `active-session-controller.ts`, which has the
*same fields* — `isProcessing`, response accumulators, `subscribers`, pending
prompts — but as **single module-level variables instead of map values**.
oracle-keep took the controller memory-loop already wrote and made it
per-id. That is nearly the entire difference.

`getSession(id, cwd)` lazily creates the state on first touch and returns the
same `AgentSession` forever after. `broadcastEventToSession(id, ...)` pushes to
that id's buffer *and* its subscribers, with the explicit guarantee in the
comment: "Events from one session never reach another session's subscribers."
memory-loop's `emit()` has no such guarantee because it has nothing to key on.

## How the viewport contract is honored (the part memory-loop degraded)

This is the piece worth copying most carefully. memory-loop's current
`?sessionId` patch concedes that if you resume B while the daemon is busy on A,
you cannot view B's live turn. oracle-keep has no such concession because every
session keeps its own buffer + subscriber set:

**Reconnect / mount flow (`components/chat/index.tsx`):**
1. `GET /api/s/[id]/history` — load persisted messages.
2. `GET /api/s/[id]/status` — is *this* session mid-turn? If not, stop.
3. If yes, `GET /api/s/[id]/chat` — open the SSE viewport.

**The SSE stream (`buildEventStream` in `chat/route.ts`):**
1. Register the subscriber on this id **before** replaying the buffer (so no
   event slips through the gap; single-threaded JS makes this airtight).
2. Replay `getEventBufferForSession(id)` — every event of the current turn so
   far. This *is* the "snapshot," but as a faithful event replay rather than a
   reconstructed content blob.
3. If the turn already finished, close immediately (the `done` is in the buffer).
4. Otherwise stay subscribed for live events; close on `done`/`error`.

Because the buffer and subscribers are per id, reconnecting to B replays B's
turn regardless of what A is doing. Two live turns can stream concurrently to
two browser tabs. The contract memory-loop *wanted* ("a stream is about a
specific session") is structurally true here, not defended after the fact.

## Server-owned processing, the same as memory-loop intended

The POST handler fires the turn and does **not** await it:

```ts
session.prompt(message)
  .then(()  => broadcastEventToSession(id, "done"))
  .catch(e  => broadcastEventToSession(id, "error", { message: ... }))
  .finally(() => { unsubscribe(); setProcessingSession(id, false); });
return new Response(buildEventStream(id), ...);   // returns immediately
```

Client disconnect (`cancel()` on the stream) unsubscribes but explicitly does
**not** abort the turn — same principle as memory-loop's REQ-SDC-4, just
per-session. The 409-on-busy guard is also here, but checks
`isProcessingSession(id)`, i.e. "is *this* session busy," not "is *the* daemon
busy." Two sessions are never falsely mutually exclusive.

## Durable identity: the registry (`lib/registry.ts`)

Conversations are recorded in `~/.oracle-keep/registry.json` (`SessionRecord`:
id, cwd, label, `sessionFile`). The pi `.jsonl` path is pinned per id via
`setSessionFile`, so restarts reopen the *specific* file with
`SessionManager.open(path)` rather than `continueRecent(cwd)` grabbing whatever
is newest. memory-loop's `session-manager.ts` already does the equivalent
(`piSessionPath` + `SessionManager.open`), so its **durable** layer is fine —
the divergence is entirely in the **live/runtime** layer.

`/new` is handled as a UI-level slash command in the chat POST: it mints a new
registry record, pre-warms a `fresh: true` session, and emits a single
`navigate` event to `/s/<newId>`. Session identity is a route, so "new
conversation" is just "navigate to a new id."

## The one-to-one mapping (use this when planning the fix)

| Concern | memory-loop (flawed) | oracle-keep (correct) |
|---|---|---|
| Live session state | single module-level vars in `active-session-controller.ts` | `Map<id, SessionState>` in `lib/session.ts` |
| "Is it processing?" | one global `isProcessing` | `isProcessingSession(id)` |
| Event fan-out | `emit()` to one global subscriber set | `broadcastEventToSession(id, ...)`, per-id subscribers |
| Reconnect snapshot | reconstructed content blob from the one active session | per-id `eventBuffer` replay |
| Stream addressing | global GET, later patched with optional `?sessionId` | id is in the path: `/api/s/[id]/chat` |
| Two live turns at once | impossible (one slot) | native (two map entries) |
| Wrong-session leak | the entire bug family | unrepresentable |
| Durable persistence | `piSessionPath` + `SessionManager.open` (fine) | `sessionFile` + `SessionManager.open` (fine) |

## What to take from this

The fix for memory-loop's Think tab is not a new mechanism. It is:

1. Turn the single `ActiveSessionController` into a `Map<sessionId,
   SessionState>` (the controller's own fields become the map value's fields).
2. Make session id a required argument on `getSnapshot`, `subscribe`,
   `abortProcessing`, `isProcessing`, `respondToPrompt`, and on the
   stream/send/abort/permission routes — ideally in the path, as oracle-keep
   does, so it cannot be omitted.
3. Replace the reconstructed-content snapshot with a per-session **event
   buffer replay**, which removes the frontend's defensive `handleSnapshot`
   merge guessing entirely.
4. Delete the `?sessionId`-mismatch patch, the dead `pendingSessionId`, and the
   send-path-omits-id asymmetry — all of them are scaffolding around the
   missing key.

memory-loop already wrote every hard part (durable sessions, two-phase send,
server-owned processing, race-safe reducer). It just built the runtime around
"one conversation" and never re-keyed it. oracle-keep is the proof that the same
SDK and the same intent, keyed by id from the start, has none of these bugs.

## Files to read in oracle-keep (in order)

- `lib/session.ts` — the per-id `SessionState` map. The heart of it.
- `app/api/s/[id]/chat/route.ts` — POST fire-and-forget + GET buffer-replay SSE.
- `app/api/s/[id]/status/route.ts` — per-id processing check (mount probe).
- `components/chat/index.tsx` (lines ~91–147) — history → status → reconnect.
- `components/chat/stream.ts` — event-to-reducer translation (the viewer side).
- `lib/registry.ts` — durable per-id records + pinned `sessionFile`.
