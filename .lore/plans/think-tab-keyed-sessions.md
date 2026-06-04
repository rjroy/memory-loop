---
status: shipped
---
# Plan: Fix the Think Tab with Keyed Live Sessions (oracle-keep approach)

Status: draft for review. Date: 2026-05-31.
Companions: `.lore/notes/think-tab-intent.md`,
`.lore/notes/think-tab-intent-oracle-keep-reference.md`.

## Goal

Eliminate the Think tab's wrong-session bug family by removing the daemon's
single global "active session" slot and replacing it with per-session live
state keyed by session id, mirroring oracle-keep. The session id becomes a
required key on every live operation (stream, abort, permission, answer, state),
ideally carried in the URL path so it cannot be omitted.

Success criteria:
- Resuming conversation B from Ground while A was the last active session shows
  only B's messages, never A's last message or A's id. (The exact reproduction
  in `think-tab-intent.md`.)
- Two conversations can have live turns concurrently without interfering (e.g.
  two browser tabs).
- `GET .../stream` for session X returns X's state regardless of what any other
  session is doing. Never an empty-because-the-daemon-holds-something-else
  snapshot.
- The `?sessionId`-mismatch patch, the dead `pendingSessionId`, and the
  send-path-omits-id asymmetry are gone.
- All existing tests pass; new tests cover concurrent sessions and isolation.

## Non-goals

- Reworking durable persistence (`session-manager.ts` on-disk format is sound,
  keep it).
- Changing the GCTR UI, message rendering, or tool/permission UX.
- Slash-command or token-usage features still stubbed by the pi-agent migration
  (out of scope; leave the stubs).

## Core design

### 1. Per-session live state map (replaces the singleton)

Today `daemon/src/session-controller.ts` holds one `ActiveSessionController`,
and `active-session-controller.ts` keeps the live turn as module-level
variables (`currentSessionId`, `queryResult`, `currentResponseChunks`,
`subscribers`, pending-prompt maps, `streamerState`). Convert those exact
fields into the value type of a map:

```ts
// daemon/src/streaming/live-session-registry.ts (new)
interface LiveSession {
  sessionId: string;
  vaultId: string;
  vaultPath: string;
  piSession: AgentSession | null;     // warm across turns; null until first prompt
  isProcessing: boolean;
  eventBuffer: SessionEvent[];        // current turn's events, for replay (see §3)
  subscribers: Set<SessionEventCallback>;
  pendingPermissions: Map<string, PendingPermissionRequest>;
  pendingQuestions: Map<string, PendingQuestionRequest>;
  // per-turn accumulators (snapshot source if §3 deferred)
  responseChunks: string[];
  toolsMap: Map<string, StoredToolInvocation>;
  contextUsage: number | undefined;
  streamer: { cumulativeTokens: number; contextWindow: number | null; activeModel: string | null };
  generation: number;
}

// HMR note: daemon is a stable long-running process (see session-controller.ts
// comment), so a plain module-level Map is fine — no globalThis needed, unlike
// oracle-keep which runs inside Next.js.
const sessions = new Map<string, LiveSession>();
```

Every current method on the controller gains a `sessionId` argument and operates
on `sessions.get(sessionId)`:
`getSnapshot(id)`, `subscribe(id, cb)`, `abortProcessing(id)`,
`isProcessing(id)`, `respondToPrompt(id, ...)`, `clearSession(id)`,
`getState(id)`. `emit` becomes `emitToSession(id, event)` and only ever reaches
that id's subscribers (oracle-keep's `broadcastEventToSession` guarantee).

This is the essential fix. #2 and #3 below follow from it.

### 2. Session id in the route path (recommended: client-minted ids)

Mirror oracle-keep's `/api/s/[id]/...`. The cleanest version also removes the
"POST returns the id" asymmetry that my root-cause note flagged:

- For a **new** conversation, the **frontend mints the session id**
  (`crypto.randomUUID()`) up front, instead of the daemon minting it inside
  `createSession`. The id is then in the path on the very first message, exactly
  like every subsequent call. `validateSessionId` already guards path-safety;
  `createSession` takes the id as a parameter instead of generating it.
- All live routes become path-keyed:

  | Old (global)                         | New (keyed)                                  |
  |--------------------------------------|----------------------------------------------|
  | `POST /session/chat/send`            | `POST /session/:sessionId/chat`              |
  | `GET  /session/chat/stream`          | `GET  /session/:sessionId/chat` (reconnect)  |
  | `POST /session/chat/abort`           | `POST /session/:sessionId/abort`             |
  | `POST /session/chat/permission`      | `POST /session/:sessionId/permission`        |
  | `POST /session/chat/answer`          | `POST /session/:sessionId/answer`            |
  | `POST /session/clear`                | `POST /session/:sessionId/clear`             |
  | `GET  /session/state`                | `GET  /session/:sessionId/state`             |

  (oracle-keep folds POST-start and GET-reconnect onto one `chat` route. We can
  do the same or keep `/chat` POST + `/stream` GET keyed — either works. Folding
  is closer to the reference and means one less path.)

  The `state.sessionId !== sessionId` "session mismatch" 409 guards in
  `abort.ts`, `permission.ts`, `answer.ts` all disappear: a keyed lookup either
  finds the session or returns 404. Those guards exist only to defend the global
  slot.

There is no unkeyed entry point: because the id is client-minted, even the
first message POSTs to `/session/:sessionId/chat`. `send` and `stream` fold onto
that one `chat` route (POST starts a turn, GET reconnects), matching oracle-keep.

### 3. Event-buffer replay (recommended; can be a deferred phase)

oracle-keep's reconnect replays the turn's actual event buffer rather than
reconstructing a content blob. memory-loop's current snapshot flattens
text+tool ordering into a single `content` string and forces the frontend
reducer (`handleSnapshot`) to guess whether to replace or append. Replacing the
snapshot with an event buffer:

- Buffer every emitted turn event in `LiveSession.eventBuffer`; clear it at turn
  start (oracle-keep's `clearEventBufferForSession`).
- On stream connect: register the subscriber first, then replay the buffer, then
  go live (oracle-keep's exact order — airtight in single-threaded JS). If
  `!isProcessing`, the terminal event is already in the buffer, so close after
  replay.
- Frontend deletes `handleSnapshot` and processes replayed events through the
  same path as live events. The defensive replace/append/merge logic is gone.

Correctness note on history vs. buffer (no double-counting): persisted history
(prior completed turns) is delivered separately via the resume/init REST path,
which already exists and is used by `RecentActivity`. The in-progress assistant
message is not appended to `metadata.messages` until turn end, so the event
buffer (current turn) and the history (prior turns) never overlap — same
invariant oracle-keep relies on.

Note on separability: #1 + #2 alone would fix the bug even with the old
reconstructed snapshot kept per-session, so if §3 ever needs to be time-boxed
out it can be, without reintroducing the wrong-session bug. The plan commits to
doing §3 (resolved decision 2), but the phase ordering keeps it the last,
most-droppable piece.

### 4. Warm session reuse (falls out of the map, confirm desired)

Today every message re-opens the session from its `.jsonl`
(`sdkResumeSession` → `SessionManager.open` each turn) and nulls `queryResult`
after. With a live map, `LiveSession.piSession` stays warm across turns
(oracle-keep's `getSession` caches it); message 2+ reuses it. On daemon restart
the map is empty, so the first message for a session lazily reopens from
`piSessionPath`/`sessionFile` (the existing resume path becomes the cold-start
fallback). Adopted (resolved decision 3): the live map holds the warm session;
re-resume-per-turn becomes the cold-start path only.

## Phases

Each phase ends green (`bun run typecheck && bun run lint && bun run test`).
Work on a branch; the daemon↔frontend protocol change in Phases 2–4 lands as one
reviewable unit but is checkpointed internally. Per the phased-migration rule,
no phase leaves the build broken.

### Phase 0 — Types and registry skeleton (daemon, no wiring)
- Add `LiveSession` type and `live-session-registry.ts` with the map and pure
  helpers (`getOrCreate`, `get`, `emitToSession`, `addSubscriber`,
  `removeSubscriber`, `bufferEvent`, `clearBuffer`, `isProcessing`).
- No routes call it yet; old controller still live.
- Tests: unit tests for the registry helpers (isolation: events to A never reach
  B's subscribers; buffer is per-id; missing-id is safe).
- Rollback: delete the new file. Zero blast radius.

### Phase 1 — Port the turn state machine onto the registry (daemon)
- Move `runStreaming`, prompt callbacks, `performClearSession`, snapshot/state
  readers from `active-session-controller.ts` into registry-keyed functions
  operating on a `LiveSession`. Keep behavior identical; just per-id.
- `createSession`/`resumeSession` in `session-manager.ts`: accept the
  client-minted session id as a parameter (stop generating it internally), with
  a collision check for new ids. Implement warm-session reuse (§4): the registry
  holds the pi session; `resumeSession` becomes the cold-start path.
- Tests: port `active-session-controller.test.ts` → `live-session-registry.test.ts`,
  add a two-session concurrency test (A and B both processing, events don't
  cross). Port relevant `session-manager.test.ts` cases.
- Rollback: old controller still present and wired; new module unused until
  Phase 2.

### Phase 2 — Rewrite daemon session routes to be keyed (daemon)
- Rewrite `send.ts`, `stream.ts`, `abort.ts`, `permission.ts`, `answer.ts`,
  `clear.ts`, `state.ts` to read `:sessionId` from the path and call the
  registry. Delete the "session mismatch" 409 guards.
- Update `router.ts` paths (table in §2). Fold `send`+`stream` onto one `chat`
  route if adopting oracle-keep's shape.
- Delete `session-controller.ts` (the singleton holder) and
  `active-session-controller.ts` once nothing imports them.
- Implement the buffer-replay stream (§3): register subscriber, replay buffer,
  go live; close after replay if the turn already ended.
- Tests: rewrite `chat-routes.test.ts` for keyed paths; add isolation test at
  the route layer (stream X while Y is the most recently active → returns X).
- Rollback: revert the branch. (This is the irreversible-within-protocol step;
  it must land with Phase 3.)

### Phase 3 — Next.js proxy + daemon client (nextjs)
- `lib/daemon/sessions.ts`: every function takes `sessionId` and builds the
  keyed path. `getChatStream(sessionId)` drops the `?sessionId` query in favor
  of the path. `clearSession(sessionId)`, `getSessionState(sessionId)`.
- `app/api/chat/*`: route files become `app/api/chat/[sessionId]/...` uniformly
  (abort/permission/answer already are; add stream and, under client-minted ids,
  the message POST). Keep them thin proxies.
- Tests: update daemon-client tests using `configureDaemonFetchForTesting`.
- Rollback: with Phase 2, revert together.

### Phase 4 — Frontend hook + reducer simplification (nextjs)
- `useChat.ts`: session id is always known (client-minted for new sessions), so
  `connectToStream` always passes it and the send-path-vs-reconnect asymmetry
  collapses into one keyed path. Remove the snapshot-mismatch handling.
- `reducer.ts` + `SessionContext.tsx`: if adopting §3, delete `handleSnapshot`
  and `HANDLE_SNAPSHOT`; replayed events flow through `ensureStreamingMessage` /
  `appendStreamingChunk` / tool handlers exactly like live events. Remove the
  dead `pendingSessionId` (action, reducer cases, RecentActivity writes, the
  session_ready clear).
- `RecentActivity.tsx`: resume sets the (client or server) session id and
  navigates to Think; no `pendingSessionId`.
- Tests: update `useChat.test.ts`, `useChat.session-scope.test.ts`,
  `useChat.session-isolation.test.ts`, reducer tests; drop snapshot-specific
  tests if §3 lands.
- Rollback: revert with Phases 2–3.

### Phase 5 — Cleanup, docs, manual smoke test
- Remove `currentVaultPath` eslint-disabled dead field and any other migration
  vestiges surfaced along the way.
- Update `.lore/reference/` (session/stream architecture) and `docs/usage/`
  Think tab notes; add/update an ADR for the keyed-session model.
- **Manual smoke test (mandatory, per CLAUDE.md):** start daemon + Next.js,
  open the browser, and:
  1. New conversation A, send a message, watch it stream.
  2. Go to Ground, resume older conversation B. Return to Think. Confirm B's
     history only — no A message, correct id.
  3. Two tabs, two sessions, both mid-turn: confirm independent streaming.
  4. Disconnect mid-turn (reload) and confirm reconnect resumes the same turn.
  5. Tool permission + AskUserQuestion prompts still resolve.

## Risks and mitigations

- **Protocol atomicity (Phases 2–4).** Daemon and frontend share the wire
  format; the keyed-path + buffer change can't be half-shipped. Mitigation:
  land 2–4 as one PR, checkpoint with green tests at each phase, keep the branch
  small and the diff reviewable; this is exactly the integration gap the lessons
  file warns about, so the manual smoke test is non-optional.
- **New-session id ownership.** Client-minted ids change who generates the id.
  Mitigation: `validateSessionId` already exists; add a daemon-side check that a
  client-supplied id for a *new* session doesn't collide with an existing
  session file (reject/regenerate on collision).
- **Live-map growth.** Warm sessions accumulate in the map. Mitigation: evict on
  `clear`; optionally evict completed sessions with zero subscribers after a TTL.
  Scale is a personal vault tool (like oracle-keep, which never evicts), so this
  is low urgency but should be a conscious decision.
- **Daemon restart loses warm sessions.** Acceptable: cold-start reopens from
  `piSessionPath` on next message (existing resume path as fallback).
- **Reducer changes touch the streaming hot path.** The race-safe-in-reducer
  pattern must be preserved; replayed events must go through the same reducer
  actions as live events (no separate snapshot path). Covered by reducer tests +
  smoke test step 4.

## Resolved decisions (2026-05-31)

1. **Client-minted session ids.** The frontend generates the UUID up front; the
   session id is in the path on the first message too. `createSession` takes the
   id as a parameter. Option B (daemon-minted, unkeyed create POST) is dropped —
   §2 commits to fully keyed paths with no unkeyed entry point.
2. **Adopt event-buffer replay (§3) now.** `handleSnapshot` / `HANDLE_SNAPSHOT`
   are deleted in Phase 4; replayed events flow through the live reducer path.
   The per-session reconstructed snapshot is not retained.
3. **Warm session reuse (§4) now.** `LiveSession.piSession` stays warm across
   turns; cold-start after daemon restart reopens from `piSessionPath`.
4. **Fold `send`+`stream` into one keyed `/chat` route** (oracle-keep shape):
   `POST /session/:sessionId/chat` starts a turn, `GET /session/:sessionId/chat`
   reconnects. One less path; matches the reference exactly.

Because all four resolve toward the full oracle-keep model, there are no
remaining forks — Phase 0 can begin.

## Files touched (map)

Daemon:
- new `daemon/src/streaming/live-session-registry.ts`
- delete `daemon/src/session-controller.ts`,
  `daemon/src/streaming/active-session-controller.ts`
- `daemon/src/session-manager.ts` (id param, warm reuse)
- `daemon/src/routes/session/{send,stream,abort,permission,answer,clear,state}.ts`
- `daemon/src/router.ts`
- tests: `daemon/src/__tests__/chat-routes.test.ts`,
  `daemon/src/streaming/__tests__/*`, `daemon/src/__tests__/session-manager.test.ts`

Next.js:
- `nextjs/lib/daemon/sessions.ts`
- `nextjs/app/api/chat/**` (move message POST + stream under `[sessionId]`)
- `nextjs/hooks/useChat.ts`
- `nextjs/contexts/SessionContext.tsx`, `nextjs/contexts/session/reducer.ts`,
  `nextjs/contexts/session/types.ts`
- `nextjs/components/home/RecentActivity.tsx`
- `nextjs/components/discussion/Discussion.tsx` (minor, sessionId plumbing)
- tests: `useChat.*.test.ts`, reducer tests, `SessionContext.test.tsx`

Docs:
- `.lore/reference/` session architecture, `docs/usage/`, `docs/adr/` new ADR.

## One-line summary

Turn the daemon's single `ActiveSessionController` into a
`Map<sessionId, LiveSession>`, put the session id in every route path, and
(recommended) replay a per-session event buffer instead of a reconstructed
snapshot — the mechanical changes that make "a stream is about a specific
session" structurally true, as it already is in oracle-keep.
