---
title: "Stage 5: Daemon session lifecycle and chat"
date: 2026-03-14
status: draft
tags: [daemon, migration, session, chat, sse, streaming, mcp, sdk, stage-5]
modules: [session-manager, active-session-controller, session-streamer, controller, vault-transfer, vault-setup, inspiration-manager, pair-writing-prompts, mock-sdk, sse]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/specs/server-driven-chat.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/research/claude-agent-sdk.md
  - .lore/research/claude-agent-sdk-ref-typescript.md
  - .lore/plans/daemon-skeleton-shared-package.md
  - .lore/plans/daemon-vault-foundation.md
  - .lore/plans/daemon-stateless-file-operations.md
  - .lore/plans/daemon-background-schedulers.md
  - .lore/retros/server-driven-chat.md
  - .lore/retros/discussion-multi-turn-resume.md
---

# Plan: Stage 5 - Daemon Session Lifecycle and Chat

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 5 section)
**Implemented spec to preserve**: `.lore/specs/server-driven-chat.md`
**API conventions**: `.lore/research/daemon-rest-api.md`
**SDK reference**: `.lore/research/claude-agent-sdk.md`, `.lore/research/claude-agent-sdk-ref-typescript.md`

Requirements addressed:
- REQ-DAB-1: Daemon is the authority boundary → All steps (session modules move to daemon)
- REQ-DAB-5: Two-phase chat transfers to daemon API → Steps 3, 4, 5
- REQ-DAB-18: Daemon manages MCP server registration → Step 2
- REQ-DAB-24: Two-phase chat requires least adaptation → Steps 4, 5
- REQ-DAB-25: Single active AI session across all clients → Step 3

Server-driven chat guarantees preserved (from `.lore/specs/server-driven-chat.md`):
- REQ-SDC-1: Server processes to completion regardless of connectivity → Step 3
- REQ-SDC-2: Reject concurrent messages with 409 → Step 4 (daemon endpoint returns 409)
- REQ-SDC-3: User can abort processing → Step 4 (abort endpoint)
- REQ-SDC-4: Client disconnect does not abort processing → Steps 4, 5
- REQ-SDC-5: Single active session → Step 3 (daemon enforces across all clients)
- REQ-SDC-6: New session clears existing, discards prompts, interrupts processing → Step 3 (sendMessage handles this in active-session-controller, preserved by port)
- REQ-SDC-7: Unified sendMessage for create/resume → Step 3
- REQ-SDC-8: Snapshot on reconnect → Step 4
- REQ-SDC-9: After snapshot, live events until completion → Step 4
- REQ-SDC-10: Multiple SSE connections allowed → Step 4 (controller's Set-based subscriber map transfers unchanged)
- REQ-SDC-11: Pending prompts pause processing → Step 3 (pending promise maps in controller transfer unchanged)
- REQ-SDC-12: Pending prompts in snapshot for reconnecting clients → Step 4 (getSnapshot() includes pendingPrompts, preserved by port)
- REQ-SDC-13: Prompts resolved via REST → Step 4 (permission/answer endpoints)
- REQ-SDC-14: No timeout on pending prompts → Step 3 (no timeout logic in controller, preserved by port)
- REQ-SDC-15: Streamer accumulates state for persistence → Step 3 (session-streamer transfers unchanged)
- REQ-SDC-16: Results persist with zero connected clients → Step 3 (controller persists in finally block, preserved by port)
- REQ-SDC-17: No event replay, snapshot is the reconnect mechanism → Step 4
- REQ-SDC-18: Generation guard for concurrent cleanup → Step 3

## Decisions

**D1: Sub-phase decomposition.** This stage has the largest blast radius of any stage. Split into four sub-phases that each produce a testable intermediate state: (A) supporting modules, (B) session core, (C) daemon chat API + SSE, (D) Next.js proxy swap. Each sub-phase is independently verifiable.

**D2: Session types stay in `@memory-loop/shared`.** The `SessionEvent`, `SessionState`, `SessionSnapshot`, `PendingPrompt`, `PromptResponse`, and `AlreadyProcessingError` types from `streaming/types.ts` move to the shared package. Both daemon and Next.js need these types: the daemon produces them, Next.js consumes them (and the browser renders based on them). The `ActiveSessionController` interface does NOT move to shared because it is internal to the daemon.

**D3: globalThis singleton dissolves.** `controller.ts` uses `globalThis.__memoryLoopController` to survive Next.js HMR module re-evaluation. The daemon is a stable process with no HMR, so the globalThis pattern is unnecessary. The controller becomes a module-level singleton in the daemon. In Next.js, `controller.ts` becomes a thin HTTP client that proxies to daemon endpoints.

**D4: SSE proxy is byte-transparent.** Resolved in the daemon brainstorm. The daemon produces standard SSE (`data: {json}\n\n`). Next.js `GET /api/chat/stream` fetches the daemon's SSE endpoint and pipes `response.body` (a `ReadableStream`) directly to the browser. No parsing, no transformation, no re-encoding. The daemon owns the SSE wire format. Next.js adds no headers beyond the standard SSE set. This means the `sse.ts` helper (`encodeSSE`, `SSE_HEADERS`) moves to daemon; Next.js no longer needs it.

**D5: mock-sdk.ts strategy.** After Stage 4, `sdk-provider.ts` is already in the daemon. `mock-sdk.ts` provides a mock query function for E2E testing without real API calls. Two things move: (1) `mock-sdk.ts` moves to daemon alongside sdk-provider, (2) the daemon checks `MOCK_SDK=true` to substitute mock responses. The mock generates `ServerMessage` events (from shared schemas), so it integrates naturally with the daemon's session pipeline. Next.js doesn't need mock-sdk after this stage because it no longer hosts the SDK.

**D6: MCP server registration is daemon-owned.** `vault-transfer.ts` creates an MCP server via `createSdkMcpServer()` and passes it to `session-manager.ts` as part of SDK query options. Since both vault-transfer and session-manager move to daemon, MCP registration requires zero architectural changes. The vault-transfer MCP server's dependencies (`vault-manager`, `file-browser`) are already in the daemon after Stages 2-3. The `createVaultTransferServer()` call stays exactly where it is, just in daemon context.

**D7: Inspiration and vault-setup use SDK independently.** Both `inspiration-manager.ts` and `vault-setup.ts` call `getSdkQuery()` directly (not through session-manager). They're not part of the chat pipeline; they're on-demand SDK consumers for content generation and vault initialization. They move to daemon as independent modules with their own daemon API endpoints. Their SDK usage pattern (fire query, collect response, return) doesn't interact with the active session.

**D8: pair-writing-prompts.ts is pure data.** It has zero imports (no SDK, no vault, no filesystem). It's template strings and validation functions. No production code imports it today (session-manager does NOT use it; the only consumer is its own test file). Move to `@memory-loop/shared` because the daemon will need it for pair-writing chat sessions (prompt construction happens server-side), and the types (`QuickActionType`, `AdvisoryActionType`) are useful for both sides.

**D9: Session ID management.** The daemon is the sole authority on session IDs. When Next.js POSTs to daemon's chat endpoint, the daemon returns `{ sessionId }`. Next.js stores this for subsequent operations (abort, permission, answer) and passes it to the browser. The browser never talks to the daemon. Session IDs are opaque strings to Next.js.

**D10: Keep-alive and buffering.** The daemon SSE stream should emit keep-alive comments (`: keep-alive\n\n`) every 15 seconds during processing to prevent proxy/load-balancer timeouts. The Next.js proxy must not buffer (set `X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`). Test this explicitly because buffering is the most common SSE failure mode.

## Codebase Context

### Files Moving to Daemon (Sub-phase A: Supporting Modules)

| File | Lines | Role | Daemon Dependencies After Migration |
|------|-------|------|--------------------------------------|
| `lib/vault-transfer.ts` | 396 | MCP server for cross-vault file ops | vault-manager, file-browser (already in daemon) |
| `lib/inspiration-manager.ts` | 1250 | Contextual prompts and quote generation | sdk-provider, vault-config (in daemon) |
| `lib/mock-sdk.ts` | 116 | Test/dev mock SDK responses | schemas (in shared) |

Note: `lib/vault-setup.ts` (1024 lines) moves in Sub-phase B alongside session-manager because it imports `mapSdkError` from session-manager.

### Files Moving to Daemon (Sub-phase B: Session Core)

| File | Lines | Role | Daemon Dependencies After Migration |
|------|-------|------|--------------------------------------|
| `lib/session-manager.ts` | 1037 | SDK session create/resume/save | sdk-provider, vault-manager, vault-config, transcript-manager, note-capture, vault-transfer (all in daemon) |
| `lib/vault-setup.ts` | 1024 | Vault initialization (PARA dirs, CLAUDE.md update) | vault-manager, vault-config, file-browser, sdk-provider, session-manager (mapSdkError) |
| `lib/streaming/session-streamer.ts` | 636 | SDK event → SessionEvent transformation | schemas (in shared) |
| `lib/streaming/active-session-controller.ts` | 627 | Stateful session orchestration | session-manager, session-streamer, logger |
| `lib/streaming/types.ts` | 192 | Type definitions for session events | schemas (in shared); types move to shared package |
| `lib/controller.ts` | 65 | globalThis singleton → dissolves | active-session-controller |
| `lib/sse.ts` | 48 | SSE encoding helpers | (none) |

### Files Moving to Shared Package

| Source | Target | Reason |
|--------|--------|--------|
| `lib/streaming/types.ts` (most types) | `packages/shared` | Daemon produces, Next.js consumes, browser renders |
| `lib/pair-writing-prompts.ts` | `packages/shared` | Pure data, no dependencies, used by both sides |

### Next.js Files That Become Proxies

| Current Route | Current Behavior | After Stage 5 |
|---------------|-----------------|---------------|
| `app/api/chat/route.ts` (POST) | Calls `getController().sendMessage()` | POSTs to daemon `/session/chat/send` |
| `app/api/chat/stream/route.ts` (GET) | Calls `getController().getSnapshot()`, subscribes | GETs daemon `/session/chat/stream`, pipes body |
| `app/api/chat/[sessionId]/abort/route.ts` | Calls `getController().abortProcessing()` | POSTs to daemon `/session/chat/abort` |
| `app/api/chat/[sessionId]/permission/[toolUseId]/route.ts` | Calls `respondToPrompt()` | POSTs to daemon `/session/chat/permission` |
| `app/api/chat/[sessionId]/answer/[toolUseId]/route.ts` | Calls `respondToPrompt()` | POSTs to daemon `/session/chat/answer` |
| `app/api/sessions/[vaultId]/route.ts` (GET) | Calls `getSessionForVault()` from session-manager | GETs daemon `/session/lookup/:vaultId` |

### Existing API Routes That Get New Daemon Endpoints

| Module | Current Access | Daemon Endpoint |
|--------|---------------|-----------------|
| `vault-setup` | `POST /api/config/[vaultId]/setup` | `POST /config/setup` |
| `inspiration-manager` | `GET /api/vaults/[vaultId]/inspiration` | `GET /inspiration` |

### Prerequisites

This plan assumes Stages 1-4 are complete. Specifically:
- Daemon process exists with Hono HTTP framework on Unix socket (Stage 1)
- vault-manager, vault-config are in daemon (Stage 2)
- file-browser, note-capture, transcript-manager are in daemon (Stage 3)
- sdk-provider is in daemon (Stage 4)
- Daemon directory structure (`daemon/src/`, `daemon/src/routes/`) exists

Stage 4 plan is currently `status: active`. This plan can be reviewed and approved now, but execution must wait for Stage 4 completion.

### Key Patterns From Prior Stages

- **Transitional client facade** (Stage 2 D4, Stage 3 D7): Next.js keeps a thin client module that calls daemon endpoints. This pattern replaces direct module imports.
- **Copy-then-delete** (Stage 4 D1): sdk-provider was copied to daemon, nextjs copy kept temporarily. By Stage 5, the nextjs copy of sdk-provider is deleted because no nextjs code calls it anymore.
- **Daemon route registration** (Stage 1 D1): Hono routes at `daemon/src/routes/`. Follow existing patterns from Stages 2-4.

## Implementation Steps

### Sub-Phase A: Supporting Modules

#### Step 1: Move session types to shared package

**Files**: `nextjs/lib/streaming/types.ts` → `packages/shared/src/session-types.ts`
**Addresses**: D2
**Expertise**: none

Move these types from `nextjs/lib/streaming/types.ts` to `@memory-loop/shared`:
- `SessionEvent` (the discriminated union)
- `PendingPrompt`, `PromptResponse`
- `SessionState`, `SessionSnapshot`
- `AlreadyProcessingError`
- `SessionEventCallback`

Do NOT move:
- `ActiveSessionController` interface (internal to daemon)
- `PendingPermissionRequest`, `PendingQuestionRequest` (internal to daemon controller)

Update `nextjs/lib/streaming/types.ts` to re-export from shared for backward compatibility during migration. Update the shared package's barrel export (`packages/shared/src/index.ts`).

Move `pair-writing-prompts.ts` to `packages/shared/src/pair-writing-prompts.ts`. Update the one known consumer (`session-manager.ts`, which builds prompts). Also update any Next.js imports of pair-writing action types.

#### Step 2: Move vault-transfer, vault-setup, inspiration-manager, mock-sdk to daemon

**Files**: `nextjs/lib/vault-transfer.ts` → `daemon/src/vault-transfer.ts`, similarly for the others
**Addresses**: D5, D6, D7
**Expertise**: none

**vault-transfer.ts**: All its dependencies (`vault-manager`, `file-browser`) are already in daemon. Move file, update imports. The `createVaultTransferServer()` function stays as-is; it will be called by session-manager in Step 3.

**vault-setup.ts**: Dependencies include `vault-manager`, `vault-config`, `file-browser`, `session-manager` (for `mapSdkError`), and `sdk-provider`. All are in or will be in daemon. The `mapSdkError` import creates a forward dependency on session-manager (Step 3). Extract `mapSdkError` as a standalone utility first (it's a simple error-message mapper), or move vault-setup alongside session-manager in Step 3 instead. **Decision: Move vault-setup in Step 3 alongside session-manager to avoid the forward dependency.**

**inspiration-manager.ts**: Dependencies are `sdk-provider`, `vault-config`, and `VaultInfo` from schemas (shared). Move file, update imports. Create daemon endpoint `GET /inspiration` that accepts `vaultId` query param, looks up vault, calls `getInspiration(vault)`.

**mock-sdk.ts**: Depends only on `ServerMessage` from schemas (shared). Move to `daemon/src/mock-sdk.ts`. The daemon's sdk-provider initialization checks `isMockMode()` and substitutes mock responses when `MOCK_SDK=true`.

Daemon route creation and Next.js proxy updates for vault-setup and inspiration are handled in Step 6 (after the session core is in place).

#### Step 3: Move session core to daemon

**Files**: `nextjs/lib/session-manager.ts`, `nextjs/lib/streaming/session-streamer.ts`, `nextjs/lib/streaming/active-session-controller.ts`, `nextjs/lib/controller.ts`, `nextjs/lib/sse.ts` → daemon
**Addresses**: REQ-DAB-1, REQ-DAB-5, REQ-DAB-25, D3, D6
**Expertise**: security review (session lifecycle is auth-adjacent)

This is the core step. Move the five files into daemon:

**session-manager.ts** (`daemon/src/session-manager.ts`):
- All imports are now satisfied within daemon: `sdk-provider`, `vault-manager`, `vault-config`, `transcript-manager`, `note-capture`, `vault-transfer`, `logger`.
- `pair-writing-prompts` imports from `@memory-loop/shared`.
- `mapSdkError` stays in session-manager (vault-setup imports from here, or extract to shared utility).
- `VaultConfig` and schema types import from `@memory-loop/shared`.
- The `createSession()` function's MCP server registration (`createVaultTransferServer()`) works unchanged because vault-transfer is in daemon.

**session-streamer.ts** (`daemon/src/streaming/session-streamer.ts`):
- Pure event transformation. Imports only schema types (from shared) and session types (from shared after Step 1).
- No dependency changes needed.

**active-session-controller.ts** (`daemon/src/streaming/active-session-controller.ts`):
- Imports session-manager and session-streamer (both now in daemon).
- Imports session types: `ActiveSessionController` interface stays local, event types from shared.
- The generation guard pattern, subscriber management, and pending prompt maps transfer unchanged.
- Remove the module-level singleton export (`getActiveSessionController`, `resetActiveSessionController`). The daemon instantiates exactly one controller at startup.

**controller.ts** dissolves:
- The `globalThis.__memoryLoopController` pattern is unnecessary in daemon (D3).
- Replace with daemon startup code that: (1) calls `initializeSdkProvider()`, (2) creates one `ActiveSessionController` instance, (3) stores it as a module-level variable accessible to route handlers.
- Create `daemon/src/session-controller.ts` with:
  ```
  let controller: ActiveSessionController | null = null;
  export function getSessionController(): ActiveSessionController { ... }
  export function initializeSessionController(): void { ... }
  ```
- Call `initializeSessionController()` during daemon startup (in `daemon/src/index.ts`).

**sse.ts** (`daemon/src/sse.ts`):
- `encodeSSE()` and `encodeSSEComment()` are used by the daemon's SSE streaming endpoint.
- `SSE_HEADERS` and `createSSEResponse()` are used by both daemon (for origin response) and Next.js (for proxy response headers). Move the helper to daemon. Next.js proxy sets headers manually (they're just three constant strings).

**vault-setup.ts** moves now (deferred from Step 2):
- With session-manager in daemon, the `mapSdkError` import resolves.

#### Step 4: Create daemon chat API endpoints

**Files**: New files in `daemon/src/routes/session/`
**Addresses**: REQ-DAB-5, REQ-DAB-24, D4, D9, D10
**Expertise**: none

Create daemon endpoints following the capability-oriented URL grammar from `.lore/research/daemon-rest-api.md`:

**`POST /session/chat/send`**
- Body: `{ vaultId, vaultPath, sessionId?, prompt }`
- Validates with Zod (same schema as current `ChatRequestSchema`)
- Calls `controller.sendMessage({ vaultId, vaultPath, sessionId, prompt })`
- Returns `{ sessionId }` from `controller.getState().sessionId`
- On `AlreadyProcessingError`: returns `{ error: "Already processing", code: "ALREADY_PROCESSING" }` with 409
- On other errors: returns structured error with 500

**`GET /session/chat/stream`**
- Returns SSE stream
- First event: snapshot (`{ type: "snapshot", ...controller.getSnapshot() }`)
- If not processing: close stream after snapshot
- If processing: subscribe to controller events, forward each as SSE
- Close on terminal events (`response_end`, `error`, `session_cleared`)
- Emit keep-alive comment every 15 seconds (D10). Cancel the keep-alive interval on stream close and on client disconnect.
- Client disconnect cleans up subscription but does NOT abort processing (REQ-SDC-4)

**`POST /session/chat/abort`**
- Body: `{ sessionId }`
- Validates session matches current: `controller.getState().sessionId === sessionId`
- Calls `controller.abortProcessing()`
- Returns `{ success: true }`

**`POST /session/chat/permission`**
- Body: `{ sessionId, toolUseId, allowed }`
- Validates session matches
- Calls `controller.respondToPrompt(toolUseId, { type: "tool_permission", allowed })`
- Returns `{ success: true }`

**`POST /session/chat/answer`**
- Body: `{ sessionId, toolUseId, answers }`
- Validates session matches
- Calls `controller.respondToPrompt(toolUseId, { type: "ask_user_question", answers })`
- Returns `{ success: true }`

**`GET /session/chat/help`**
- Returns capability description for the chat subsystem

**`POST /session/clear`**
- Calls `controller.clearSession()`
- Returns `{ success: true }`

**`GET /session/state`**
- Returns `controller.getState()` (convenience for Next.js to check session status without opening SSE)

**`GET /session/lookup/:vaultId`**
- Calls `getSessionForVault(vaultId)` (from session-manager)
- Returns `{ sessionId }` (string or null)
- This replaces the current `GET /api/sessions/[vaultId]` route which imports session-manager directly

Note on REQ-SDC-6: The `POST /session/chat/send` endpoint calls `controller.sendMessage()`, which already handles the clear-on-new-session case internally (clears existing session when vault changes). This behavior is preserved by porting the controller unchanged. The `POST /session/clear` endpoint exists for explicit clear requests (e.g., user clicking "new session").

### Sub-Phase C: Next.js Proxy Swap (kept as sub-phase label for clarity, but follows sequentially)

#### Step 5: Create session-client facade in Next.js

**Files**: New `nextjs/lib/session-client.ts`, updates to all chat API routes
**Addresses**: REQ-DAB-5, D3, D4
**Expertise**: none

Create `nextjs/lib/session-client.ts` following the transitional client pattern from Stages 2-3:

```typescript
// Pattern from Stage 2's vault-client.ts and Stage 3's file-client.ts
const DAEMON_URL = process.env.DAEMON_URL ?? "http://localhost:3001";

export async function sendMessage(params: { ... }): Promise<{ sessionId: string }> {
  const res = await fetch(`${DAEMON_URL}/session/chat/send`, { method: "POST", ... });
  // error handling
  return res.json();
}

export async function getChatStream(): Promise<Response> {
  return fetch(`${DAEMON_URL}/session/chat/stream`);
}

export async function abortProcessing(sessionId: string): Promise<void> { ... }
export async function respondToPermission(sessionId: string, toolUseId: string, allowed: boolean): Promise<void> { ... }
export async function respondToAnswer(sessionId: string, toolUseId: string, answers: Record<string, string>): Promise<void> { ... }
export async function getSessionState(): Promise<SessionState> { ... }
export async function clearSession(): Promise<void> { ... }
export async function lookupSession(vaultId: string): Promise<string | null> { ... }
```

Rewrite each Next.js chat API route to use session-client:

**`app/api/chat/route.ts` (POST)**:
- Replace `getController().sendMessage()` with `sessionClient.sendMessage()`
- Same request/response shape, same error codes

**`app/api/chat/stream/route.ts` (GET)** - the SSE proxy:
- Call `sessionClient.getChatStream()` to get the daemon's Response
- Pipe `response.body` directly to the browser as a new Response
- Set SSE headers on the proxy response
- This is byte-transparent (D4): the daemon's SSE bytes flow through unchanged
- Handle daemon connection failure: return an SSE error event, then close

```typescript
export async function GET() {
  try {
    const daemonResponse = await sessionClient.getChatStream();
    if (!daemonResponse.ok || !daemonResponse.body) {
      // Return error as SSE event so client handles it uniformly
      return errorSSEResponse("DAEMON_UNAVAILABLE", "Could not connect to daemon");
    }
    return new Response(daemonResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return errorSSEResponse("DAEMON_ERROR", err.message);
  }
}
```

**`app/api/chat/[sessionId]/abort/route.ts`**:
- Replace `getController()` calls with `sessionClient.abortProcessing(sessionId)`

**`app/api/chat/[sessionId]/permission/[toolUseId]/route.ts`**:
- Replace with `sessionClient.respondToPermission(sessionId, toolUseId, allowed)`

**`app/api/chat/[sessionId]/answer/[toolUseId]/route.ts`**:
- Replace with `sessionClient.respondToAnswer(sessionId, toolUseId, answers)`

**`app/api/sessions/[vaultId]/route.ts`**:
- Replace `getSessionForVault()` import with `sessionClient.lookupSession(vaultId)`

#### Step 6: Create daemon endpoints for vault-setup and inspiration

**Files**: `daemon/src/routes/config/setup.ts`, `daemon/src/routes/inspiration.ts`
**Addresses**: D7
**Expertise**: none

**`POST /config/setup`** (body: `{ vaultId }`):
- Calls `runVaultSetup(vaultId)`
- Returns `SetupResult`

**`GET /inspiration`** (query: `vaultId`):
- Looks up vault from vault cache
- Calls `getInspiration(vault)`
- Returns `InspirationResult`

Update Next.js config handlers to proxy to daemon for setup. Update Next.js inspiration route to proxy to daemon.

#### Step 7: Delete migrated Next.js files and clean up

**Files**: Delete source files, update imports
**Addresses**: REQ-DAB-22
**Expertise**: none

Delete from `nextjs/lib/`:
- `session-manager.ts`
- `streaming/active-session-controller.ts`
- `streaming/session-streamer.ts`
- `streaming/types.ts` (after confirming all consumers import from shared)
- `controller.ts`
- `sse.ts`
- `vault-transfer.ts`
- `vault-setup.ts`
- `inspiration-manager.ts`
- `mock-sdk.ts`
- `sdk-provider.ts` (the nextjs copy, last consumer was session-manager)

Update `nextjs/lib/streaming/index.ts` barrel exports to re-export from `@memory-loop/shared` where needed. The barrel currently exports `createActiveSessionController`, `getActiveSessionController`, `resetActiveSessionController` from active-session-controller. After the session core moves to daemon, these exports become dead code in Next.js. Remove them and update any Next.js consumers to use session-client instead.

Grep for any remaining direct imports of deleted modules. Fix any broken references. Key search targets:
- `from "@/lib/session-manager"` (must be zero after migration)
- `from "@/lib/controller"` (must be zero)
- `from "@/lib/streaming"` (must import only types from shared, not controller functions)

#### Step 8: Tests

**Files**: New test files in `daemon/src/__tests__/`
**Addresses**: All requirements
**Expertise**: none

**Daemon unit tests** (test each module in isolation):

1. **session-manager.test.ts**: Test `createSession`, `resumeSession`, `appendMessage`, `querySession` with mocked SDK (inject via `configureSdkForTesting`). Verify MCP server registration is passed in options. Verify session ID handling (create returns new ID, resume with unknown ID is handled).

2. **active-session-controller.test.ts**: Test `sendMessage` fire-and-forget pattern, `AlreadyProcessingError` on concurrent sends, `clearSession` interrupts processing, `abortProcessing` interrupts and persists partial, generation guard prevents stale cleanup, subscriber notification, pending prompt lifecycle.

3. **session-streamer.test.ts**: Test SDK event → SessionEvent transformation. Feed mock SDK events, verify output event sequence. Test snapshot construction accuracy.

4. **vault-transfer.test.ts**: Existing tests transfer with the module. Verify they pass in daemon context.

5. **mock-sdk.test.ts**: Test mock response generation, mock session creation.

**Daemon integration tests** (test the HTTP layer):

6. **chat-routes.test.ts**: Test the full daemon API surface:
   - POST `/session/chat/send` with valid params → 200 + sessionId
   - POST `/session/chat/send` while processing → 409
   - GET `/session/chat/stream` → SSE with snapshot event
   - POST `/session/chat/abort` with matching sessionId → 200
   - POST `/session/chat/abort` with wrong sessionId → 409
   - POST `/session/chat/permission` and `/session/chat/answer` → 200

7. **sse-proxy.test.ts**: Test the byte-transparent proxy:
   - Daemon produces SSE events, proxy forwards them unchanged
   - Daemon stream closes, proxy closes
   - Client disconnects from proxy, daemon stream continues (verify via controller state)
   - Keep-alive comments pass through proxy
   - **Buffering test**: Verify events arrive at proxy output within 100ms of daemon emission (catches accidental buffering). Note: this test requires real timers, not fake timers (the streaming path uses async generators which are incompatible with fake timers per CLAUDE.md).

8. **mock-mode.test.ts**: Start daemon with `MOCK_SDK=true`, send a chat message, verify mock response streams through the full pipeline (daemon SSE → proxy → client).

**Next.js proxy tests**:

9. **session-client.test.ts**: Test the facade with mocked fetch. Verify correct URLs, methods, body serialization, error handling for daemon unavailability.

10. **chat-route-proxy.test.ts**: Test that the SSE proxy route handles daemon connection failure gracefully (returns error SSE event, not a 500 HTML page).

#### Step 9: Validate against spec

**Addresses**: All requirements
**Expertise**: spec-reviewer, plan-reviewer

Launch a sub-agent that reads:
- `.lore/specs/daemon-application-boundary.md` (REQ-DAB-1, 5, 18, 24, 25)
- `.lore/specs/server-driven-chat.md` (all REQ-SDC requirements)
- The daemon source code after migration

Verify:
1. Every REQ-SDC guarantee is preserved in daemon context
2. SSE proxy is genuinely byte-transparent (no re-encoding)
3. Single-session constraint is enforced at daemon level
4. MCP server registration works from daemon process
5. No Next.js code directly imports session/SDK modules (all go through session-client or shared)

## Risks and Mitigations

### Risk 1: SSE buffering breaks streaming UX

**Likelihood**: Medium. SSE works in direct connections but proxying introduces buffering opportunities at every layer: Node.js HTTP client, Hono response, Next.js API route, nginx/reverse proxy.

**Impact**: High. Users see response text appear in chunks after long delays instead of streaming character by character.

**Mitigation**:
- Explicit buffering test in Step 8 (test 7) that measures event latency through the proxy
- Set `X-Accel-Buffering: no` in both daemon and proxy responses
- Daemon emits keep-alive comments every 15 seconds (D10)
- Test with the production reverse proxy configuration, not just localhost

### Risk 2: Generation guard race condition in daemon context

**Likelihood**: Low. The generation guard pattern is proven in the current codebase (`.lore/retros/server-driven-chat.md`), and the daemon's single-threaded event loop provides the same concurrency model as Next.js.

**Impact**: High. State corruption between overlapping session runs.

**Mitigation**:
- Port the generation guard exactly as-is. Do not refactor it during migration.
- Dedicated test case (test 2 in Step 8): start processing, immediately send clearSession + new sendMessage, verify no state corruption.

### Risk 3: Session file I/O races under daemon

**Likelihood**: Low. Same filesystem, same serialization. The daemon runs on the same machine.

**Impact**: Medium. Session persistence failures.

**Mitigation**:
- Session files are written to vault's `.memory-loop/sessions/` directory. The daemon has filesystem access to vault paths (established in Stage 2).
- Verify `session-manager.ts`'s file operations work from daemon's CWD (session paths are absolute, so CWD shouldn't matter, but verify).

### Risk 4: SDK subprocess CWD matters for MCP registration

**Likelihood**: Medium. The Claude Agent SDK spawns a subprocess. The `cwd` option in `query()` determines where the subprocess runs. Session-manager currently passes vault path as CWD. The daemon process itself runs from a different directory.

**Impact**: High. MCP servers might fail to register, or session-manager might not find vault files.

**Mitigation**:
- The `cwd` option is explicitly set per-query in `session-manager.ts:createSession()` and `resumeSession()`. This is already vault-specific, not process-CWD-dependent. Verify this by inspecting the SDK call sites.
- Test MCP tool invocation end-to-end in mock mode: daemon receives chat message, mock SDK simulates tool use that invokes vault-transfer MCP tool, verify the tool executes correctly.

### Risk 5: Inspiration and vault-setup SDK calls conflict with active chat session

**Likelihood**: Low. The SDK provider is a factory that creates independent query instances. Concurrent queries are confirmed safe (`.lore/research/claude-agent-sdk.md`).

**Impact**: Medium. If SDK calls serialized, vault-setup (which takes 30-60s for CLAUDE.md update) would block chat.

**Mitigation**:
- SDK provider confirmed safe for concurrent use (resolved in brainstorm)
- vault-setup already runs CLAUDE.md update as fire-and-forget (`updateClaudeMd` promise not awaited in `runVaultSetup`)
- No architectural change needed

### Risk 6: Next.js SSE proxy doesn't properly propagate daemon stream close

**Likelihood**: Medium. When the daemon closes its SSE stream (terminal event), the proxy must also close its response to the browser. If the proxy holds the connection open, the browser's EventSource won't fire its `close` event.

**Impact**: Medium. Browser thinks stream is still active, may miss the terminal state.

**Mitigation**:
- The byte-transparent pipe naturally propagates stream close: when the daemon's ReadableStream ends, the proxy's Response body ends, and the browser sees the connection close.
- Test this explicitly: daemon emits `response_end` then closes stream, verify browser-side EventSource receives the event and the connection closes.

## Delegation Guide

Steps requiring specialized expertise:
- **Step 3** (session core migration): Security review of session lifecycle. Session management is auth-adjacent (controls what the AI can access via vault paths and MCP tools). Use `pr-review-toolkit:code-reviewer` after completing the move.
- **Step 4** (daemon chat API): Use `pr-review-toolkit:silent-failure-hunter` to audit error handling in the SSE streaming endpoint. The retro from server-driven-chat (`.lore/retros/server-driven-chat.md`) documented 3 critical bugs caught by parallel review agents.
- **Step 8** (tests): Use `pr-review-toolkit:pr-test-analyzer` to verify test coverage on the new daemon modules. Coverage target: 90%+ on new code.
- **Step 9** (validation): Use `lore-development:spec-reviewer` or `lore-development:fresh-lore` agent with fresh context to validate against both specs.

Consult `.lore/lore-agents.md` for the full agent registry.

## Open Questions

1. **Session route URL structure**: The current Next.js routes use `[sessionId]` path segments (`/api/chat/[sessionId]/abort`). The daemon API proposed here uses body params (`POST /session/chat/abort` with `{ sessionId }`). This is simpler for the daemon (no dynamic route segments) and consistent with the REST API conventions doc. But it means Next.js routes still accept `[sessionId]` in the URL (for browser compatibility) and translate it to body params for the daemon. This works but is worth noting: the translation happens in the proxy routes and is one more place where a mismatch could cause bugs.

2. **Streaming events for inspiration/setup**: Vault-setup's CLAUDE.md update runs an SDK query that could take 30-60 seconds. Currently it's fire-and-forget. Should the daemon expose a progress endpoint for this? Current answer: no, keep fire-and-forget. The setup result returns the synchronous steps' results. CLAUDE.md update is logged but not surfaced to the user in real-time. Revisit if users report confusion about setup timing.

3. **Test file migration**: Existing test files for session-manager, active-session-controller, and session-streamer need to move to daemon. The tests use `configureSdkForTesting()` which will be in daemon's sdk-provider. Assess whether tests can be ported directly or need adaptation for the daemon's test harness.

## Acceptance Criteria

- [ ] All session/streaming modules are in `daemon/src/`, not `nextjs/lib/`
- [ ] `nextjs/lib/` contains no direct imports of SDK, session-manager, or active-session-controller
- [ ] Next.js chat API routes proxy to daemon (no local session logic)
- [ ] SSE proxy is byte-transparent: daemon bytes arrive at browser unchanged
- [ ] SSE proxy latency: events arrive within 100ms of daemon emission (no buffering)
- [ ] Single-session constraint enforced at daemon level (POST while processing → 409)
- [ ] Session create, resume, abort, permission, answer all work through daemon API
- [ ] MCP server registration (vault-transfer) works from daemon context
- [ ] Mock mode (`MOCK_SDK=true`) works end-to-end through daemon
- [ ] Keep-alive comments emitted every 15s during processing
- [ ] Daemon connection failure produces SSE error event (not HTML error page)
- [ ] All existing unit tests pass (ported to daemon test harness)
- [ ] New integration tests cover chat API + SSE proxy
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, `bun run --cwd nextjs build` all pass
- [ ] Manual smoke test: send a message, see streaming response, abort mid-stream, reconnect
