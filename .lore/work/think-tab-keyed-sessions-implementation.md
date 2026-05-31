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
| 3 | Next.js proxy + daemon client keyed by sessionId | pending |
| 4 | Frontend useChat/reducer simplification; delete handleSnapshot + pendingSessionId | pending |
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

---

## >>> RESUME HERE (state as of end of Phase 2) <<<

**Branch:** `fix/think-tab-keyed-sessions`. **Committed through Phase 2** (run `git log --oneline` to confirm).
Daemon side is DONE and green. The running app is currently BROKEN at runtime (expected): the daemon
routes are keyed, but the Next.js proxy/client still call the OLD daemon paths. Phase 3 fixes that.
Unit tests + build are green because Next.js tests mock the daemon fetch layer.

**NEXT: Phase 3 — Next.js proxy + daemon client (nextjs/ only).**
Target the new daemon paths (sessionId in PATH, not body/query, no `snapshot` event):
- `nextjs/lib/daemon/sessions.ts`: every fn takes `sessionId`, builds keyed path.
  - `sendMessage({vaultId,vaultPath,sessionId,prompt})` → `POST /session/{sessionId}/chat`, body `{vaultId,vaultPath,prompt}`, returns `{sessionId}`; 409 carries `{error:{code:"ALREADY_PROCESSING",message}}`.
  - `getChatStream(sessionId)` → `GET /session/{sessionId}/chat` (drop the `?sessionId=` query — path now).
  - `abortProcessing(sessionId)` → `POST /session/{sessionId}/abort` (no body).
  - `respondToPermission(sessionId,toolUseId,allowed)` → `POST /session/{sessionId}/permission`, body `{toolUseId,allowed}`.
  - `respondToAnswer(sessionId,toolUseId,answers)` → `POST /session/{sessionId}/answer`, body `{toolUseId,answers}`.
  - `clearSession(sessionId)` → `POST /session/{sessionId}/clear`.
  - `getSessionState(sessionId)` → `GET /session/{sessionId}/state`.
  - Metadata fns unchanged: initSession, lookupSession, deleteSessionById.
- `nextjs/app/api/chat/**`: move the message POST and the stream GET under `[sessionId]` so the proxy
  paths are keyed too (abort/permission/answer already are). Keep them thin proxies.
- Update daemon-client tests (`configureDaemonFetchForTesting`).
- Keep build/tests green.

**THEN Phase 4 — frontend (nextjs/): client-minted ids + delete handleSnapshot + delete pendingSessionId.**
- `useChat.ts`: mint `crypto.randomUUID()` for a NEW session up front so the id is in the path on the
  first message; `connectToStream` always passes the id (the send-path-omits-id asymmetry collapses);
  remove the snapshot-mismatch handling and the `?sessionId` scoping (now gone server-side).
- `reducer.ts` + `SessionContext.tsx`: DELETE `handleSnapshot`/`HANDLE_SNAPSHOT`; replayed events flow
  through `ensureStreamingMessage`/`appendStreamingChunk`/tool handlers exactly like live events.
  DELETE dead `pendingSessionId` (action, reducer cases, RecentActivity writes, the session_ready clear).
- `RecentActivity.tsx`: resume sets the session id + navigates; no pendingSessionId.
- Update useChat/reducer/SessionContext tests.

**THEN Phase 5 — cleanup + docs/ADR + MANDATORY manual smoke test** (the A/B resume reproduction; see
plan "Phase 5"). **THEN V — holistic validation agent** against `.lore/plans/think-tab-keyed-sessions.md`.

**Orchestration reminder:** per-phase implement → review → resolve via `general-purpose` sub-agents
(pr-review-toolkit agents are NOT installed). Commit each green phase. Pre-commit hook runs the full
typecheck/lint/test/build across all 4 packages — it must pass.
