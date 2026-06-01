# Implementation Notes: Think Tab Keyed Sessions

Source plan: `.lore/plans/think-tab-keyed-sessions.md`
Branch: `fix/think-tab-keyed-sessions` (cut from `fix/think-tab-stale-session-snapshot`)
Orchestration: lore-development `implement` strategy — per-phase implement → test → review → resolve, via sub-agents. Orchestrator does not write code/tests/reviews directly.
Started: 2026-05-31

## Resolved design decisions (from plan)
1. Client-minted session ids (UUID up front; id in path on first message).
2. Event-buffer replay on reconnect (delete `handleSnapshot`).
3. Warm session reuse across turns (re-resume = cold-start fallback).
4. Fold send+stream into one keyed `/chat` route (POST starts, GET reconnects).

## Behaviors to preserve while re-keying (from archived spec + current code)
- REQ-SDC-2: reject a message for a session already processing (409).
- REQ-SDC-4: client disconnect does NOT abort the turn; events keep buffering.
- REQ-SDC-6: "new session" no longer clears a global slot — it is just a new map entry.
- REQ-ESS-10: pending prompts present during a crash → emit a clear error.
- REQ-ESS-19: abort with pending prompts emits `aborted` (terminal, non-error).
- Subscriber callback throws are caught and logged, never propagated.
- Partial assistant message persisted on error/abort.

## Progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Registry skeleton: `live-session-registry.ts` types + pure helpers + tests, no wiring | done |
| 1 | Port turn state machine onto registry; client-minted ids; warm reuse | done |
| 2 | Rewrite daemon session routes keyed by `:sessionId` in path; buffer-replay stream; delete singleton | done |
| 3 | Next.js proxy + daemon client keyed by sessionId | done (uncommitted; ships with Phase 4) |
| 4 | Frontend useChat/reducer simplification; delete handleSnapshot + pendingSessionId | done (uncommitted; ships with Phase 3) |
| 5 | Cleanup, docs/ADR, manual smoke test | pending |
| V | Holistic validation against the plan | pending |

Status legend: pending / in-progress / done / failed

## Log

### Setup (2026-05-31)
- Created branch `fix/think-tab-keyed-sessions`.
- Read archived `session-viewport-separation-spec.md` + `active-session-controller.md`:
  confirmed REQ-4 (single active session) is the assumption being overturned and
  that event buffering was always a stub. Behavior contracts captured above.
- Agent availability: `pr-review-toolkit:*` agents named in `.lore/lore-agents.md`
  are NOT installed; using `general-purpose` for implement/test/review per the
  skill's documented fallback.

### Phase 0 (2026-05-31) — done
- Created `daemon/src/streaming/live-session-registry.ts` + `__tests__/live-session-registry.test.ts`.
- 28 tests pass, typecheck 0, lint 0. Independent review re-ran all checks: no blockers.
- Decisions: idempotent `createLiveSession` (returns existing, never clobbers in-flight turn);
  **subscribers is `Map<string, SessionEventCallback>` keyed by subscriberId, NOT a Set** —
  Phase 1 must expect the keyed map. Per-turn accumulators (responseChunks/toolsMap/contextUsage)
  retained alongside the new eventBuffer (both needed: accumulators for persistence, buffer for replay).
- Phase 1 carry-over notes from impl agent:
  - `generation` guard is now per-session, so clearing A no longer suppresses B's cleanup (improvement).
  - Old controller had two near-identical flags (isProcessing + isStreamingActive); collapsed to isProcessing.
    Derive `isStreaming` from it in getState/getSnapshot unless a real divergence appears.
  - emitToSession always buffers (incl. terminal events); clearEventBuffer at turn start prevents bleed.
  - Logger prefix changed: "LiveSessionRegistry" (old controller used "Session").

### Phase 1 (2026-05-31) — done
- Created `daemon/src/streaming/live-session-controller.ts`: plain exported keyed
  functions (sendMessage, runTurn, abortProcessing, clearSession, subscribe,
  unsubscribe, respondToPrompt, getPendingPrompts, isProcessing, getState,
  getSnapshot, getReplayBuffer). Ports active-session-controller.ts faithfully,
  re-keyed per id; logger prefix "LiveSessionController".
- `session-manager.ts` createSession new signature (backward compatible):
  `createSession(vault, requestToolPermission?, askUserQuestion?, sessionId?)`.
  When `sessionId` omitted → `crypto.randomUUID()` as before (old controller path
  unchanged). When supplied → `validateSessionId` + collision check (rejects with
  SessionError SESSION_INVALID if a session file already exists). resumeSession
  unchanged. On-disk format unchanged.
- Warm reuse + create-vs-resume branch in sendMessage:
  - `live.piSession` set → reuse (message 2+, no re-open), isNewSession=false.
  - else `loadSession(vaultPath, id)`: metadata exists → `resumeSession` (cold
    start / Ground resume), isNewSession=false; no metadata → `createSession(...,
    id)` (brand-new conversation), isNewSession=true. Store result.piSession on
    live, fire-and-forget runTurn.
- Generation guard is per-session: runTurn captures `gen = ++live.generation`,
  finally only clears isProcessing when `gen === live.generation`. clearSession
  bumps generation so a running turn's finally skips cleanup.
- Tests: `live-session-controller.test.ts` (12 pass) — happy path + buffer,
  two-session isolation (A/B concurrent, events don't cross), warm reuse (open
  count stays 1), REQ-SDC-2, REQ-ESS-19 (abort w/ + w/o pending prompt), partial
  persistence on crash, clearSession isolation, client-minted create + cold-start
  resume, state readers. Regressions: session-manager (14), active-session-
  controller old (15) all pass. Full daemon suite 1995 pass / 0 fail. typecheck 0,
  lint 0.
- Test seam: same `configurePiSessionForTesting` injection as the old controller.
  Registry is module-level → `resetForTesting()` in before/afterEach. Subscriber
  timing note for Phase 2 tests: runTurn subscribes to the pi session AFTER its
  initial awaits (appendMessage), and sets `live.piSession` then too; tests that
  drive the fake listener or abort must wait a tick after `sendMessage`. To capture
  the early synchronous emits (session_ready/response_start), pre-create the live
  session (createLiveSession is idempotent) and subscribe before sendMessage.
- No divergence from plan. clearSession on an unknown id is a no-op (emitToSession
  is a no-op for unknown ids) rather than emitting to nobody — matches registry
  semantics.

### Phase 1 review + resolution (2026-05-31)
- Independent review: re-ran all checks (12+14+15 tests, typecheck, lint, full suite 1995). No blockers.
- Two should-fix items found and RESOLVED:
  1. Warm-reuse TOCTOU: `isProcessing` was set inside runTurn after awaits, so two rapid
     same-id sends could both pass the guard and double-open, second clobbering the first.
     Fix: claim `live.isProcessing = true` synchronously in sendMessage after the guard,
     before the first await; catch resets it on setup failure. Regression test added
     (gated factory parks first send, second rejects, openCount stays 1).
  2. createSession 4th-param (client-minted id) had no direct test. Added session-manager
     tests: supplied-id writes under that id; collision rejects SESSION_INVALID without clobber.
- Post-resolution: live-session-controller 14 pass, session-manager 17 pass, old controller 15 pass,
  typecheck 0, lint 0. No protected files changed.

### Phase 2 carry-over notes
- Routes call these keyed functions (all in `live-session-controller.ts`):
  - `POST /session/:sessionId/chat` → `sendMessage({ vaultId, vaultPath, sessionId, prompt })`.
    sessionId is REQUIRED (client-minted). Throws AlreadyProcessingError (map to 409)
    and re-throws factory/resume errors (map to HTTP error; error event already emitted).
  - `GET /session/:sessionId/chat` (reconnect) → register subscriber via
    `subscribe(id, subscriberId, cb)`, then replay `getReplayBuffer(id)`, then go
    live; if `!isProcessing(id)` the terminal event is already in the buffer so
    close after replay. `unsubscribe(id, subscriberId)` on disconnect.
  - `POST /session/:sessionId/abort` → `abortProcessing(id)`.
  - `POST /session/:sessionId/permission` and `/answer` → `respondToPrompt(id, promptId, response)`.
  - `POST /session/:sessionId/clear` → `clearSession(id)`.
  - `GET /session/:sessionId/state` → `getState(id)` (or `getSnapshot(id)`).
- The "session mismatch" 409 guards in abort/permission/answer disappear: a keyed
  lookup either finds the session or the function is a safe no-op. Delete the old
  singleton holder (`session-controller.ts`) and `active-session-controller.ts`
  once nothing imports them.

### Phase 2 (2026-05-31) — done
- Rewrote daemon routes keyed by `:sessionId` in path; deleted the singleton.
- Router path table (final):
  ```
  GET    /session/lookup/:vaultId        (unchanged, metadata)
  POST   /session/init/:vaultId          (unchanged, metadata)
  DELETE /session/:vaultId/:sessionId    (unchanged, metadata)
  POST   /session/:sessionId/chat        -> chatSendHandler   (start turn)
  GET    /session/:sessionId/chat        -> chatStreamHandler (SSE replay+live)
  POST   /session/:sessionId/abort
  POST   /session/:sessionId/permission
  POST   /session/:sessionId/answer
  POST   /session/:sessionId/clear
  GET    /session/:sessionId/state
  ```
  Hono static-over-param precedence keeps `lookup`/`init` from colliding with `:sessionId`.
- Rewrote `send/stream/abort/permission/answer/clear/state.ts`, `router.ts`, `streaming/index.ts` barrel.
- DELETED: `session-controller.ts`, `streaming/active-session-controller.ts` + its test.
- Migrated 2 more tests off the singleton: `__tests__/sse-proxy.test.ts`, `__tests__/mock-mode.test.ts`.
- SSE stream contract CHANGED: no more `{type:"snapshot"}` wrapper. Raw turn events are replayed
  (session_ready, response_start, response_chunk..., tool events, response_end/error/aborted).
  Phase 4 must update the frontend to consume replayed events directly (delete handleSnapshot).
- Tests: chat-routes 24 pass (incl. route-level isolation regression: GET B while A active → B's own
  empty stream, never A's events). Full daemon suite 1994 pass. typecheck 0, lint 0.

### Phase 2 review + resolution (2026-05-31)
- Independent review: re-ran all 7 checks. Singleton confirmed deleted (not emptied), no dangling refs,
  route disambiguation collision-free, isolation test genuine. No blockers.
- One should-fix RESOLVED: SSE replay ordering bug. The replay loop `await`ed each write, yielding to
  the event loop so a live event could interleave between replayed events (scrambled response_chunk
  order on mid-turn reconnect). Fix (Option B, queue-and-drain): subscriber callback enqueues live
  events into `liveQueue` while a `replaying` flag is set; after replay, drain in order then clear the
  flag (drain+clear in one synchronous block, no yield). Proven regression test added (fails against
  old await-per-replay with order ["live","buffered-1",...], passes after fix). Also fixed a vacuous
  init-disambiguation assertion. Post-fix: chat-routes 24 pass, full daemon 1994, typecheck 0, lint 0.

### Phase 3 (2026-05-31) — done (verified directly, NOT committed yet)
> CORRECTION (2026-05-31): An earlier draft of this section claimed Phase 3 "did not persist" and that
> `daemon/src/contract.ts`/`generated-types.ts` were stale. **That was wrong** — it was written off a
> laggy/out-of-order tool-output channel that replayed a stale clean `git status`. Re-verified directly,
> one command at a time: the sub-agent changes ARE on disk, the named contract/generated-types files do
> not exist in this repo (the Next.js client imports types from `@memory-loop/shared` + `./fetch`, no
> codegen step), and the touched tests pass. Sub-agent persistence was never the problem. The accurate
> record follows.
- Rewrote `nextjs/lib/daemon/sessions.ts`: every live fn takes `sessionId` and builds the keyed daemon
  path with `encodeURIComponent` (POST/GET `/session/{id}/chat`, `/abort`, `/permission`, `/answer`,
  `/clear`, `/state`). `sendMessage` strips `sessionId` from the body (it's in the path) and is now
  REQUIRED. Dropped the old `?sessionId=` stream query. Metadata fns
  (initSession/lookupSession/deleteSessionById) unchanged; 409 `ALREADY_PROCESSING` code+status
  preserved via `DaemonError`.
- Proxy route tree (verified on disk via `find`):
  ```
  app/api/chat/[sessionId]/route.ts                      POST (send)          [new]
  app/api/chat/[sessionId]/stream/route.ts               GET  (SSE stream)    [new]
  app/api/chat/[sessionId]/abort/route.ts                POST                 [pre-existing]
  app/api/chat/[sessionId]/answer/[toolUseId]/route.ts   POST                 [pre-existing]
  app/api/chat/[sessionId]/permission/[toolUseId]/route.ts POST               [pre-existing]
  ```
  DELETED old unkeyed routes: `app/api/chat/route.ts`, `app/api/chat/stream/route.ts`. (Send and stream
  are SEPARATE route files, not folded — earlier draft said folded; that was wrong.) Routes stay thin
  proxies; SSE passthrough preserved; 409 status preserved.
- `nextjs/lib/api/client.ts` was NOT modified (earlier draft claimed it was — false; it's absent from
  the git diff). It's the generic REST wrapper. Phase 4 will update the browser fetch URLs in `useChat`.
- Tests updated via `configureDaemonFetchForTesting`: `sessions.test.ts` (17 pass) and
  `chat-proxy.test.ts` (4 pass) — assert keyed paths/bodies; old `?sessionId`/`snapshot` assertions
  removed. typecheck clean (all 4 packages).

### Phase 3 review + resolution (2026-05-31)
- Independent review (opus): scope respected (daemon/shared/useChat/contexts/components untouched),
  paths correctly keyed, snapshot wrapper gone, routes thin. The review flagged a `client.ts`
  id-minting stopgap as a blocker — but on direct inspection that stopgap **does not exist**
  (`client.ts` is unmodified; no `crypto.randomUUID()` anywhere in the keyed surface). The review was
  reasoning off the same bad output channel. Real residual findings, all benign:
  - should-fix: stale doc comments in `[sessionId]/abort|answer|permission/route.ts` still cite the old
    `/session/chat/*` daemon paths. Cosmetic; fix in Phase 5 cleanup.
  - should-fix: `daemon/src/routes/help.ts` discovery endpoint still advertises the old unkeyed API
    surface ("snapshot-first", `/session/chat/send`, etc.). Pre-existing from Phase 2; fix in Phase 5.
  - 409 `code` is not surfaced to the UI today (and never was) — no regression. Optional Phase 4 polish.
- The expected, correct state: keying the proxy/client without keying `useChat` makes the running app
  non-functional until Phase 4. This is the plan's deliberate "Phases 2–4 land together" design, not a
  defect. Phases 2+3 must commit/ship as a unit with Phase 4.

---

### Phase 4 (2026-05-31) — done (uncommitted; ships with Phase 3)

Frontend re-keyed onto client-minted ids and event-buffer replay. All source edits were made directly
(not via sub-agents) per the flaky-channel lesson from earlier this session.

Source changes (already on disk before this entry, confirmed green):
- `useChat.ts`: `sendMessage` mints `crypto.randomUUID()` for a new session up front and seeds
  `sessionIdRef` synchronously, so stream/abort within the turn use it immediately; POST → `/api/chat/{id}`
  with the id in the PATH (dropped from body); `connectToStream(sessionId)` now requires the id and builds
  `/api/chat/{id}/stream`; all `receivedSnapshot`/snapshot branches removed; `scheduleReconnect` bails to
  error if no id.
- `reducer.ts` / `types.ts` / `initial-state.ts` / `SessionContext.tsx`: deleted `HANDLE_SNAPSHOT` +
  `handleSnapshot` + `SET_PENDING_SESSION_ID` + `pendingSessionId`. `REPLACE_LAST_MESSAGE_CONTENT` /
  `replaceLastMessageContent` is now dead (snapshot-only) — flagged for Phase 5, NOT yet removed.
- `RecentActivity.tsx`: resume calls `setSessionId(data.sessionId)` directly + navigates; no pendingSessionId.

Test changes (this session): updated the 5 test files that asserted the old API.
- `useChat.test.ts`: full rewrite onto keyed paths + raw replay (no snapshot wrapper). 23 pass.
- `Discussion.test.tsx`: POST asserts keyed path; **fixed a real regression** in the abort test — with
  client-minted ids `abort()` now always calls `/chat/{id}/abort`, and the test's coarse mock (5000ms delay
  on *every* fetch) hung it; the mock now fast-paths `/abort` like the real daemon. (Controlled stash
  experiment confirmed it passed at HEAD and only my changes triggered it — a genuine behavior change, not
  flakiness.)
- `RecentActivity.test.tsx`: captures `sessionId` instead of `pendingSessionId`.
- `reducer-streaming.test.ts`: deleted the whole `HANDLE_SNAPSHOT` describe block.
- `SessionContext.test.tsx`: deleted the `snapshot event handling` block + the `setPendingSessionId` test.

**Verification (all green, 2026-05-31):** typecheck clean (4 pkgs); nextjs `1970 pass / 0 fail`; daemon
`1994 pass / 0 fail`; lint clean. (nextjs dropped from 1986 → 1970 because obsolete snapshot/pendingSessionId
tests were removed.) No stale `/api/chat` / `pendingSessionId` / `HANDLE_SNAPSHOT` refs remain in any test.

## >>> RESUME HERE (state as of end of Phase 4 — uncommitted, verified green) <<<

**Branch:** `fix/think-tab-keyed-sessions`. **HEAD = `23324d5` (Phase 2).** Phases **3 AND 4** are in the
working tree, **uncommitted** and fully green (typecheck + nextjs 1970 + daemon 1994 + lint all pass). The
app is now whole end-to-end (browser uses keyed `/api/chat/{id}` + `/api/chat/{id}/stream`). Per the plan's
atomicity decision, Phases 2–4 land together, so commit Phases 3+4 as one unit.

**NEXT: commit Phases 3+4** (only on user go-ahead). The pre-commit hook runs the full
typecheck/lint/test/build across all 4 packages — it must pass. Suggested message theme: "Re-key Think-tab
frontend onto client-minted session ids + event-buffer replay (phases 3+4)".

**ORCHESTRATION NOTE:** earlier this session a flaky tool-output channel replayed stale `git status`/test
output and led to false "sub-agents didn't persist" + hallucinated-file conclusions. Sub-agent persistence
works fine. Verify any agent report against a direct `git status` / direct test run, OR use direct tools.

**THEN Phase 5 — cleanup + docs/ADR + MANDATORY manual smoke test** (the A/B resume reproduction; see
plan "Phase 5"). **THEN V — holistic validation agent** against `.lore/plans/think-tab-keyed-sessions.md`.

**Orchestration reminder:** per-phase implement → review → resolve via `general-purpose` sub-agents
(pr-review-toolkit agents are NOT installed). Commit each green phase. Pre-commit hook runs the full
typecheck/lint/test/build across all 4 packages — it must pass.
