---
status: shipped
---
# Think Tab — Intent vs. Implementation

Research note, 2026-05-31. Branch: `fix/think-tab-stale-session-snapshot`.

Goal of this note: capture **what the Think tab is *supposed* to do**, separate
from how it currently does it. The implementation is descended from our first
agentic-system wiring and is structurally flawed. Do not treat the code below as
the spec. When we fix one symptom we tend to break another (see the revert pair
`d727b40` -> `a049052`), which is the signature of a design problem, not a bug.

---

## What the Think tab is for

Think (internally `discussion`, component `Discussion`) is the conversational
mode of the GCTR loop. A user has a vault-contextualized chat with Claude:
streaming responses, inline tool calls (read/grep/bash), tool-permission
prompts, and `AskUserQuestion` prompts. Conversations are durable: they persist
to `.memory-loop/sessions/<id>.json` plus a markdown transcript, and can be
resumed later from the Ground tab's "Recent Discussions" list.

So the intended mental model is **multiple long-lived conversations**, each
identified by a session id, any of which can be reopened and continued.

## The intended contracts (what the design *wants* to be true)

These are the invariants the various comments, REQ tags, and naming clearly
reach for, stated plainly:

1. **A session is a conversation.** Identified by `sessionId`. Has an ordered
   message history. Resumable by id. This part is real and consistent
   (`session-manager.ts` persistence is sound).

2. **Processing is server-owned, not client-owned.** The daemon runs a turn to
   completion regardless of client connectivity. The SSE stream is a *viewport*
   into processing state, never the driver of it. The first SSE event is always
   a snapshot of current state; clients may disconnect/reconnect freely. This
   is a good design and the stream route honors it.

3. **Two-phase send.** POST `/api/chat` submits a prompt and returns
   `{ sessionId }`; GET `/api/chat/stream` attaches the viewport. Errors during
   POST must throw (HTTP error), because emitting to zero subscribers is silent
   failure. Also sound in principle.

4. **A snapshot/stream is *about a specific session*.** When I am looking at
   conversation X, the events and snapshot I receive must be X's. This is the
   contract the whole UI implicitly assumes and it is the one the implementation
   **cannot currently guarantee** (see below).

## The structural flaw: one global "active session," but the UI has many

`session-controller.ts` is a module-level **singleton** holding exactly one
`ActiveSessionController`. That controller (`active-session-controller.ts`)
holds exactly one live conversation at a time: `currentSessionId`,
`queryResult`, one `currentResponseChunks`, one `currentToolsMap`, one set of
`subscribers`, one set of pending prompts. The header comment is explicit:
"only one active session at a time (REQ-4)."

Meanwhile the frontend genuinely tracks *which* conversation it is showing
(`sessionId` in `SessionContext`, resumable to any of N stored sessions). So we
have a fan-in mismatch:

- Frontend: "I am conversation X." (one of many)
- Daemon stream/snapshot: "Here is whatever conversation was last active." (one global)

`GET /api/chat/stream` originally carried **no session id**, so it always
returned the snapshot of whichever session the singleton last touched. The
intent was clearly "give me *my* session's state." The mechanism delivers
"give me *the* session's state." Those coincide only when there is exactly one
conversation in play, which was true in the first agentic implementation and is
the flawed assumption baked into everything downstream.

### How this manifests (the bug the branch name points at)

1. Open conversation A in Think, chat. A becomes the singleton's active session.
2. Go to Ground, resume older conversation B. Frontend `sessionId` is now B; it
   loads B's messages over REST.
3. Return to Think. `useChat`'s mount-reconnect probe opens the stream. The
   singleton still holds A, so the snapshot is **A's** last assistant message
   and **A's** session id.
4. The reducer's `handleSnapshot` merges that content and adopts A's id on top
   of B's conversation. B is now corrupted with a stray message from A.

### Why the fixes keep breaking each other

- `d727b40` added a guard in `useChat`: reject any snapshot whose `sessionId`
  differs from the frontend's current id, abort the stream. That assumes the
  daemon snapshot always reports the same id the frontend tracks. It does not
  (e.g. a brand-new session: frontend id is null, or the singleton reports a
  different id), so the guard tore down **legitimate** streams. Reverted in
  `a049052`.
- The current tip (`aeb7727`) instead scopes on the **server** side: the stream
  route takes `?sessionId=X` and, if X is not the singleton's current session,
  returns an *idle empty snapshot* for X and closes. `useChat` passes the id on
  the mount-probe and reconnect paths, but deliberately **omits** it on the
  send path (where it wants to attach to the session it just started).

That last fix is a patch over the same fault line. It works by having the
server admit "I don't have X, here's an empty viewport" instead of leaking the
wrong session. But notice what it concedes: **if you resume B and B's turn were
still processing on the daemon, you could not actually view it**, because the
singleton can only be "holding" one session and it might be holding A. The
viewport-into-processing contract (#2/#4) silently degrades to "viewport into
processing, but only for whichever single session the daemon last ran." The
architecture cannot host two live conversations, so "scope to my session"
collapses into "scope to my session, or get nothing."

## The conceptual confusion to untangle

The code conflates three distinct things under "session":

- **The conversation** (durable, many, id'd, stored on disk) — sound.
- **The live turn** (the in-flight pi-agent `prompt()` call, its streaming
  accumulators, its pending prompts) — inherently transient.
- **"The active session"** (the singleton's single slot) — an artifact of the
  first implementation that assumed one conversation total.

The singleton fuses "the live turn" with "the active session" and then assumes
there is only ever one conversation, so it never needed keying. Everything
painful in this tab traces to that fusion. The frontend already moved past it
(it keys by `sessionId`); the daemon has not.

### Vestigial pieces (signs of the migration)

- `pendingSessionId` in `SessionContext` is still *written* (RecentActivity sets
  it on resume, session_ready clears it) but **nothing reads it** anymore. It is
  a leftover from an earlier resume handshake. Dead concept occupying state.
- `getState()` exposes `currentVaultPath` only via an eslint-disabled unused
  var "retained for future getState() exposure" — more half-migrated surface.
- `slashCommands` is permanently `[]` with a "Phase 7 may revisit" note; token
  usage / context bar is hardwired to zero for the same reason. The pi-agent
  swap left several intended features stubbed.

## What a correct design would assert (for when we plan the fix)

Not implementing here — just recording the target so we stop patching symptoms:

- The daemon should be able to hold **N concurrent live turns keyed by
  session id**, or at minimum treat "session id" as a required key on every
  stream/snapshot/abort/permission call rather than an optional hint over a
  global slot. `clearSession()` (singular), `getSnapshot()` (no id arg), and
  `currentSessionId` as a single field are the tells that this is missing.
- "Resume B" and "is B processing?" must be answerable independently of whatever
  A was doing. Today they are not.
- The send path omitting the session id while the reconnect path requires it is
  two code paths doing the same thing differently — exactly the kind of split
  the lessons file warns produces bugs. One keyed entry point.
- Frontend `handleSnapshot` should never have to defensively decide whether a
  snapshot "belongs" to it; a correctly-keyed stream can only ever deliver the
  requested session's state.

## Files that matter (map for the next pass)

- `daemon/src/session-controller.ts` — the singleton holder. Root of the fault.
- `daemon/src/streaming/active-session-controller.ts` — single-session state
  machine; `performClearSession`, `runStreaming`, `getSnapshot`.
- `daemon/src/routes/session/stream.ts` — the `?sessionId` scoping patch.
- `daemon/src/routes/session/send.ts` — POST, returns `getState().sessionId`.
- `daemon/src/session-manager.ts` — durable persistence (the *sound* layer).
- `nextjs/hooks/useChat.ts` — two-phase client, mount-reconnect probe, the
  send-path-omits-id asymmetry.
- `nextjs/contexts/session/reducer.ts` — `handleSnapshot`, `setMessagesIfEmpty`,
  streaming message handling (race-safe-in-reducer pattern).
- `nextjs/components/home/RecentActivity.tsx` — resume-from-Ground entry point.
- `nextjs/components/discussion/Discussion.tsx` — the tab UI; wires context +
  useChat.

## One-line summary

The Think tab is meant to be many resumable conversations each with a
server-owned live viewport; the daemon implements a single global "active
session" slot, and every recurring bug is the seam where "my conversation"
meets "the one conversation the daemon can hold."
