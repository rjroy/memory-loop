---
title: "Stage 6: Web app conversion"
date: 2026-03-14
status: executed
tags: [daemon, migration, proxy, nextjs, cleanup, stage-6]
modules: [api-routes, lib, daemon]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/plans/daemon-skeleton-shared-package.md
  - .lore/plans/daemon-vault-foundation.md
  - .lore/plans/daemon-stateless-file-operations.md
  - .lore/plans/daemon-background-schedulers.md
  - .lore/plans/daemon-session-lifecycle-chat.md
---

# Plan: Daemon Migration Stage 6 -- Web App Conversion

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Brainstorm**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 6 section)

Requirements addressed:
- REQ-DAB-22: Migration must reduce boundary bypasses, not deepen them --> Steps 1-6
- REQ-DAB-23: Transitional direct imports allowed during migration (this stage removes them) --> Steps 3, 4
- REQ-DAB-16: Daemon-owned vs web-owned module classification --> Steps 3, 4, 5

## Codebase Context

### What Happened in Stages 1-5

The brainstorm describes Stage 6 as "Convert all ~40 Next.js API routes from direct lib/ imports to daemon API proxies." In practice, Stages 3-5 already converted routes as they moved each domain module to the daemon. Stage 6 is therefore not a bulk conversion stage. It is a cleanup, verification, and deletion stage.

**Stage 3** (Stateless File Operations, Step 16) converted ~17 routes to proxies: files, directories, capture, meetings, tasks, search, daily-prep, goals, recent-notes, recent-activity, upload, and the vaults list/create routes.

**Stage 4** (Background Schedulers, Step 8) converted ~13 routes: vault config, pinned-assets, all card endpoints, card-generator config/status/trigger/requirements, extraction-prompt config/trigger, and memory config.

**Stage 5** (Session Lifecycle) converted ~10 routes: chat send, chat stream (SSE), abort, permission, answer, sessions list/create/resume, session detail/delete, setup, inspiration, and session lookup.

That accounts for 40 of 41 route files. The remaining route (`/api/health`) stays web-local by design.

### What Stage 6 Actually Does

The brainstorm says it well: "Nothing moves. This stage rewrites." The rewrite work is:

1. **Verify** every proxied route works end-to-end through the daemon
2. **Delete** all domain modules from `nextjs/lib/` that are now daemon-owned
3. **Promote** the transitional client facades (`vault-client.ts`, `file-client.ts`, `session-client.ts`) to a permanent `lib/daemon/` layer
4. **Clean up** `nextjs/lib/` to contain only web-owned modules
5. **Update** `lib/api/types.ts` to import from `@memory-loop/shared` instead of `@/lib/schemas`
6. **Remove** scheduler bootstrap from `instrumentation.ts` (schedulers run in daemon now)
7. **Convert** route-level tests to test proxying behavior, not domain logic
8. **Validate** the browser-to-daemon request chain works without regressions

### The Double-Hop Question

After Stage 6, a browser request travels: **Browser --> Next.js API route --> daemon (Unix socket)**. The `lib/api/client.ts` in the browser calls Next.js routes using relative URLs (`/api/vaults/...`), and those routes forward to the daemon. This is the expected architecture from the spec (REQ-DAB-5: "web application connects to daemon via Unix domain socket").

The double-hop adds latency for every API call. For REST calls, this is negligible (one local socket round-trip). For SSE streaming, Stage 5 already established byte-transparent proxying: the Next.js route fetches the daemon SSE stream and pipes `response.body` directly to the browser without parsing. The `X-Accel-Buffering: no` header and keep-alive comments (every 15 seconds) prevent proxy buffering.

`lib/api/client.ts` itself does not change. It is browser-only code consumed exclusively by React hooks and components. It calls Next.js routes, which happen to be proxies now. The client doesn't know or care.

### What Stays in nextjs/lib/

After Stage 6, `nextjs/lib/` contains only web-presentation modules:

| Module | Purpose | Why it stays |
|--------|---------|--------------|
| `lib/api/client.ts` | Browser-side fetch wrapper | Frontend HTTP client, no domain logic |
| `lib/api/types.ts` | API error types, request options | Frontend type definitions |
| `lib/sse.ts` | SSE encoding/headers utilities | Used by proxy routes for SSE forwarding |
| `lib/schemas/` | Shared Zod schemas | Becomes re-export from `@memory-loop/shared` |
| `lib/daemon-fetch.ts` | Shared Unix socket/TCP connection, `DaemonUnavailableError` | Used by all client facades to reach daemon |
| `lib/utils/file-types.ts` | File extension detection | Used by 6 React components for asset display |

Everything else in `lib/` gets deleted. The deletion list in Step 4 is exhaustive; only modules explicitly listed there are removed. If a module isn't on either the "delete" or "keep" list, investigate before deleting.

## Complete Route Inventory

All 41 Next.js API route files and their disposition after Stage 6.

### Routes Proxied in Stage 3 (File Operations)

| Route File | Methods | Daemon Endpoint | Stage |
|------------|---------|-----------------|-------|
| `vaults/route.ts` | GET, POST | `GET /vaults`, `POST /vaults` | 3 |
| `vaults/[vaultId]/files/route.ts` | GET, POST | `GET /vaults/:id/files`, `POST /vaults/:id/files` | 3 |
| `vaults/[vaultId]/files/[...path]/route.ts` | GET, PUT, DELETE | `GET/PUT/DELETE /vaults/:id/files/:path` | 3 |
| `vaults/[vaultId]/directories/route.ts` | GET | `GET /vaults/:id/directories` | 3 |
| `vaults/[vaultId]/directories/[...path]/route.ts` | GET | `GET /vaults/:id/directories/:path` | 3 |
| `vaults/[vaultId]/capture/route.ts` | POST | `POST /vaults/:id/capture` | 3 |
| `vaults/[vaultId]/meetings/route.ts` | GET, POST | `GET/POST /vaults/:id/meetings` | 3 |
| `vaults/[vaultId]/meetings/current/route.ts` | GET | `GET /vaults/:id/meetings/current` | 3 |
| `vaults/[vaultId]/tasks/route.ts` | GET | `GET /vaults/:id/tasks` | 3 |
| `vaults/[vaultId]/search/files/route.ts` | GET | `GET /vaults/:id/search/files` | 3 |
| `vaults/[vaultId]/search/content/route.ts` | GET | `GET /vaults/:id/search/content` | 3 |
| `vaults/[vaultId]/search/snippets/route.ts` | GET | `GET /vaults/:id/search/snippets` | 3 |
| `vaults/[vaultId]/daily-prep/today/route.ts` | GET | `GET /vaults/:id/daily-prep/today` | 3 |
| `vaults/[vaultId]/goals/route.ts` | GET | `GET /vaults/:id/goals` | 3 |
| `vaults/[vaultId]/recent-notes/route.ts` | GET | `GET /vaults/:id/recent-notes` | 3 |
| `vaults/[vaultId]/recent-activity/route.ts` | GET | `GET /vaults/:id/recent-activity` | 3 |
| `vaults/[vaultId]/upload/route.ts` | POST | `POST /vaults/:id/upload` | 3 |

### Routes Proxied in Stage 4 (Schedulers/Config)

| Route File | Methods | Daemon Endpoint | Stage |
|------------|---------|-----------------|-------|
| `vaults/[vaultId]/config/route.ts` | GET, PATCH | `GET/PATCH /vaults/:id/config` | 4 |
| `vaults/[vaultId]/pinned-assets/route.ts` | GET, PUT | `GET/PUT /vaults/:id/pinned-assets` | 4 |
| `vaults/[vaultId]/cards/due/route.ts` | GET | `GET /vaults/:id/cards/due` | 4 |
| `vaults/[vaultId]/cards/[cardId]/route.ts` | GET | `GET /vaults/:id/cards/:cardId` | 4 |
| `vaults/[vaultId]/cards/[cardId]/review/route.ts` | POST | `POST /vaults/:id/cards/:cardId/review` | 4 |
| `vaults/[vaultId]/cards/[cardId]/archive/route.ts` | POST | `POST /vaults/:id/cards/:cardId/archive` | 4 |
| `config/card-generator/route.ts` | GET, PUT | `GET/PUT /config/card-generator` | 4 |
| `config/card-generator/status/route.ts` | GET | `GET /config/card-generator/status` | 4 |
| `config/card-generator/trigger/route.ts` | POST | `POST /config/card-generator/trigger` | 4 |
| `config/card-generator/requirements/route.ts` | GET | `GET /config/card-generator/requirements` | 4 |
| `config/extraction-prompt/route.ts` | GET, PUT | `GET/PUT /config/extraction-prompt` | 4 |
| `config/extraction-prompt/trigger/route.ts` | POST | `POST /config/extraction-prompt/trigger` | 4 |
| `config/memory/route.ts` | GET | `GET /config/memory` | 4 |

### Routes Proxied in Stage 5 (Session/Chat)

| Route File | Methods | Daemon Endpoint | Stage |
|------------|---------|-----------------|-------|
| `chat/route.ts` | POST | `POST /session/chat/send` | 5 |
| `chat/stream/route.ts` | GET (SSE) | `GET /session/chat/stream` | 5 |
| `chat/[sessionId]/abort/route.ts` | POST | `POST /session/chat/abort` | 5 |
| `chat/[sessionId]/permission/[toolUseId]/route.ts` | POST | `POST /session/chat/permission` | 5 |
| `chat/[sessionId]/answer/[toolUseId]/route.ts` | POST | `POST /session/chat/answer` | 5 |
| `vaults/[vaultId]/sessions/route.ts` | GET, POST | `GET /session/lookup`, `POST /session/chat/send` | 5 |
| `vaults/[vaultId]/sessions/[sessionId]/route.ts` | GET, DELETE | `GET/DELETE /session/state` | 5 |
| `vaults/[vaultId]/setup/route.ts` | POST | `POST /config/setup` | 5 |
| `vaults/[vaultId]/inspiration/route.ts` | GET | `GET /inspiration` | 5 |
| `sessions/[vaultId]/route.ts` | GET | `GET /session/lookup` | 5 |

### Routes That Stay Web-Local

| Route File | Methods | Reason |
|------------|---------|--------|
| `health/route.ts` | GET | Web app's own health check, separate from daemon health |

## Implementation Steps

### Step 1: Audit All Proxy Routes for Completeness

**Files**: All 40 proxied route files under `nextjs/app/api/`
**Addresses**: REQ-DAB-22
**Expertise**: none needed

Read every proxied route file and verify it follows the established proxy pattern:

1. No imports from domain modules in `nextjs/lib/` (no `session-manager`, `note-capture`, etc.; `vault-client` is a transitional facade, not a domain module)
2. Imports only from: `next/server`, `@/lib/daemon-fetch` (or stage-specific client facade: vault-client, file-client, session-client), `@/lib/sse` (for SSE routes), `@memory-loop/shared` (for types/schemas)
3. Route handler extracts params and query string, forwards to daemon endpoint, returns daemon response
4. Error responses from daemon are forwarded as-is (status code and body)

Produce a checklist of all 40 routes with pass/fail. Any route that still imports domain modules gets fixed in Step 2.

### Step 2: Fix Any Remaining Direct Imports

**Files**: Any routes identified in Step 1 as still importing domain modules
**Addresses**: REQ-DAB-22, REQ-DAB-23

If any routes were not fully converted in their respective stages (possible if a stage plan described conversion but implementation was incomplete), convert them now using the established proxy pattern from the relevant client facade.

This step may be empty if all previous stages executed cleanly. That's the expected outcome, but Step 1 verifies it rather than assuming.

### Step 3: Promote Transitional Client Facades to Permanent Daemon Layer

**Files**: `nextjs/lib/vault-client.ts`, `nextjs/lib/file-client.ts`, `nextjs/lib/session-client.ts`, `nextjs/lib/daemon-fetch.ts`
**Addresses**: REQ-DAB-23

The transitional client facades (`vault-client.ts` from Stage 2, `file-client.ts` from Stage 3, `session-client.ts` from Stage 5) wrap `daemon-client.ts` with domain-specific methods. They were created as stepping stones so proxy routes didn't need to know raw daemon URLs.

Now that all routes are proxied and stable, these facades add an unnecessary layer. Two options:

**Option A: Keep the facades.** They provide named methods (`vaultClient.getFiles(vaultId)`) rather than raw URL construction. This is cleaner for the route handlers.

**Option B: Collapse into daemon-client.ts.** The proxy routes call `daemonClient.get('/vaults/${id}/files')` directly. Fewer files, but raw URL strings in every route.

**Decision: Keep the facades.** They're thin, they prevent URL typos, and deleting them just to say "fewer files" isn't a good trade. But rename them: they're no longer "transitional," they're the permanent daemon API layer for the web app. Move them to `nextjs/lib/daemon/` alongside `daemon-client.ts`:

- `nextjs/lib/daemon/fetch.ts` (was `daemon-fetch.ts`, the shared Unix socket connection logic + `DaemonUnavailableError`)
- `nextjs/lib/daemon/vaults.ts` (was `vault-client.ts`)
- `nextjs/lib/daemon/files.ts` (was `file-client.ts`)
- `nextjs/lib/daemon/sessions.ts` (was `session-client.ts`)
- `nextjs/lib/daemon/index.ts` (barrel export)

Update all proxy route imports to use the new paths.

### Step 4: Delete Domain Modules from nextjs/lib/

**Files**: Everything in `nextjs/lib/` that is daemon-owned per REQ-DAB-16
**Addresses**: REQ-DAB-16, REQ-DAB-22

**Prerequisite: Step 3 must complete first.** The client facades are being relocated, not deleted. If this step runs before Step 3, proxy routes will break.

Delete all domain modules that now live in the daemon. This is the largest single step and the one that enforces REQ-DAB-22 irreversibly. After this step, the Next.js app cannot call domain logic directly even if someone wanted to.

**Modules to delete** (daemon-owned, per REQ-DAB-16 and previous stage plans):

| Module | Moved to daemon in |
|--------|--------------------|
| `lib/vault-client.ts` | Stage 2 (transitional facade; promoted to `lib/daemon/vaults.ts` in Step 3) |
| `lib/vault-config.ts` | Stage 2 (already deleted in Stage 2) |
| `lib/vault-setup.ts` | Stage 5 |
| `lib/file-browser.ts` | Stage 3 |
| `lib/file-upload.ts` | Stage 3 |
| `lib/note-capture.ts` | Stage 3 |
| `lib/meeting-capture.ts` | Stage 3 |
| `lib/meeting-store.ts` | Stage 3 |
| `lib/transcript-manager.ts` | Stage 3 |
| `lib/task-manager.ts` | Stage 3 |
| `lib/search/` (entire directory) | Stage 3 |
| `lib/search-cache.ts` | Stage 3 |
| `lib/handlers/search-handlers.ts` | Stage 3 |
| `lib/daily-prep-manager.ts` | Stage 3 |
| `lib/extraction/` (entire directory) | Stage 4 |
| `lib/spaced-repetition/` (entire directory) | Stage 4 |
| `lib/handlers/config-handlers.ts` | Stage 4 |
| `lib/handlers/index.ts` | Stage 4 |
| `lib/session-manager.ts` | Stage 5 |
| `lib/streaming/` (entire directory) | Stage 5 |
| `lib/controller.ts` | Stage 5 |
| `lib/inspiration-manager.ts` | Stage 5 |
| `lib/sdk-provider.ts` | Stage 5 |
| `lib/mock-sdk.ts` | Stage 5 |
| `lib/vault-helpers.ts` | No longer needed (was route helper for domain calls) |
| `lib/logger.ts` | Daemon-owned; web app uses console or a minimal replacement |
| `lib/scheduler-bootstrap.ts` | Stage 4 (schedulers run in daemon) |
| `lib/pair-writing-prompts.ts` | Stage 5 (session context) |
| `lib/reference-updater.ts` | Stage 3 or 5 (file operations) |
| `lib/vault-transfer.ts` | Stage 5 (MCP server for cross-vault file ops) |
| `lib/utils/image-converter.ts` | Stage 3 (file operations, no remaining Next.js consumers after `file-upload.ts` deleted) |

**Modules to keep** (web-owned):

| Module | Purpose |
|--------|---------|
| `lib/api/client.ts` | Browser-side fetch wrapper |
| `lib/api/types.ts` | Frontend API types |
| `lib/sse.ts` | SSE encoding utilities (used by proxy routes) |
| `lib/schemas/` | Re-exports from `@memory-loop/shared` |
| `lib/utils/file-types.ts` | File extension detection, asset URL encoding (used by 6 components) |
| `lib/daemon/` | Daemon client layer (from Step 3) |

After deletion, verify the Next.js build succeeds. Any import errors reveal modules that were missed or dependencies between web-owned and daemon-owned code that need resolution.

### Step 5: Update Schema Imports

**Files**: `nextjs/lib/api/types.ts`, `nextjs/lib/sse.ts`, any remaining files importing from `@/lib/schemas`
**Addresses**: REQ-DAB-16

`lib/api/types.ts` currently imports `ErrorCode` from `@/lib/schemas`. After Stage 1, schemas live in `@memory-loop/shared`. Update this import:

```typescript
// Before
import type { ErrorCode } from "@/lib/schemas";

// After
import type { ErrorCode } from "@memory-loop/shared";
```

Check all files across `nextjs/` (not just `lib/`, but also `components/`, `hooks/`, `contexts/`, and `app/`) for `@/lib/schemas` imports. There are approximately 60+ such imports throughout the frontend codebase.

**Decision: Keep `lib/schemas/` as a re-export barrel.** Rewriting 60+ import paths across components, hooks, and contexts is high churn for zero functional benefit. The `lib/schemas/` directory becomes a thin re-export from `@memory-loop/shared`:

```typescript
// lib/schemas/index.ts (after Stage 6)
export * from "@memory-loop/shared";
```

This means existing `@/lib/schemas` imports throughout the frontend continue to work unchanged. Only files in `lib/` itself (like `lib/api/types.ts`) should import directly from `@memory-loop/shared` to avoid circular re-export paths.

### Step 6: Clean Up instrumentation.ts

**Files**: `nextjs/instrumentation.ts`
**Addresses**: REQ-DAB-22

Stage 4 moved schedulers to the daemon, but `instrumentation.ts` may still contain the bootstrap code (guarded by `NEXT_RUNTIME === "nodejs"`). Remove the scheduler bootstrap entirely. If `instrumentation.ts` has no remaining purpose, delete the file.

If it still serves other purposes (telemetry, error tracking), keep it but remove all scheduler-related imports and code.

### Step 7: Convert Route Tests

**Files**: `nextjs/lib/__tests__/` and any route-level test files
**Addresses**: REQ-DAB-22
**Expertise**: none needed

Most existing tests in `nextjs/lib/__tests__/` test domain logic directly (`session-manager.test.ts`, `vault-manager.test.ts`, `note-capture.test.ts`, etc.). These tests belong in the daemon now and should be deleted from Next.js. Route-level proxy tests are largely new, not conversions of existing tests. Tests need to verify:

1. **Proxy behavior**: Route extracts params correctly and forwards to the right daemon endpoint
2. **Error forwarding**: Daemon error responses (4xx, 5xx) pass through with correct status and body
3. **SSE proxying**: The chat stream route pipes daemon SSE bytes to the browser without transformation
4. **Auth forwarding**: If auth headers exist, they're forwarded to the daemon (future concern, but test the passthrough now)

Test approach:
- Mock `daemon-client.ts` (or the facade layer) to return canned responses
- Verify the route handler calls the correct daemon endpoint with the correct params
- Verify the response status and body match what the daemon returned

Delete tests that test domain logic directly (those tests live in the daemon now). Keep only proxy-behavior tests.

### Step 8: Integration Smoke Test

**Files**: none (runtime verification)
**Addresses**: REQ-DAB-22

Run the full application with the daemon process and verify the browser-to-daemon chain works:

1. Start the daemon (`bun run daemon`)
2. Start Next.js (`bun run --cwd nextjs dev`)
3. Open the browser and exercise each mode:
   - **Ground (home)**: vault list loads, vault selection works
   - **Capture (note)**: daily note capture creates a file
   - **Think (discussion)**: chat message sends, SSE stream displays tokens, stop/permission work
   - **Recall (browse)**: file browser lists directories, opens files, search works
4. Verify config operations: pinned assets, vault config, card generator settings
5. Verify scheduled task status endpoints respond

This step is manual verification. It confirms the proxy chain works under real conditions, not just in unit tests.

### Step 9: Build and Typecheck Verification

**Files**: none (build verification)

Run the full quality suite:
- `bun run typecheck` (no import errors from deleted modules)
- `bun run lint` (no unused imports, no references to deleted files)
- `bun run test` (all proxy tests pass)
- `bun run --cwd nextjs build` (production build succeeds)

Any failure here means a dependency was missed in Steps 3-6. Fix and re-run.

### Step 10: Validate Against Spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md`, reviews the implementation, and flags any requirements not met. Specifically verify:

- REQ-DAB-22: No domain logic imports remain in `nextjs/` (grep for imports from deleted modules)
- REQ-DAB-23: No transitional direct imports remain (the migration is complete)
- REQ-DAB-16: Module ownership matches the classification table
- REQ-DAB-5: Web app connects to daemon via Unix socket (all routes use daemon-client)

## Delegation Guide

Steps requiring specialized expertise:
- **Step 8** (Integration Smoke Test): Manual testing across all four modes. If the team has QA resources, delegate the verification checklist.
- **Step 10** (Spec Validation): Use a fresh-context sub-agent to avoid confirmation bias from the implementer.

No steps require external domain expertise (security, performance, etc.) beyond what's already been established in previous stages.

## Acceptance Criteria

1. **Zero domain imports in nextjs/**: `grep -r "from.*@/lib/" nextjs/` returns only imports from approved paths: `@/lib/api/`, `@/lib/sse`, `@/lib/daemon/`, `@/lib/schemas/`, and `@/lib/utils/file-types`. No imports from deleted domain modules anywhere in the codebase.
2. **nextjs/lib/ contains only web-owned modules**: `lib/api/`, `lib/daemon/`, `lib/sse.ts`, `lib/schemas/` (re-export barrel), `lib/utils/file-types.ts`. Nothing else.
3. **All 40 proxy routes forward to daemon**: Each route handler's only job is param extraction, daemon call, response forwarding
4. **SSE streaming works without buffering**: Chat stream displays tokens incrementally, no visible delay from the proxy hop
5. **Build passes cleanly**: `typecheck`, `lint`, `test`, and `build` all succeed with zero errors
6. **No scheduler code in Next.js**: `instrumentation.ts` contains no scheduler bootstrap; extraction and card discovery run exclusively in the daemon
7. **Tests verify proxy behavior**: Route tests mock the daemon client and verify forwarding, not domain logic

## Open Questions

1. **Logger replacement**: Domain modules used `lib/logger.ts` (daemon-owned). Proxy routes may want minimal logging for request tracing. Should they use `console.log`, a lightweight logger, or skip logging entirely? The proxy is thin enough that daemon-side logging may suffice.

2. **lib/schemas/ disposition**: If all consumers can import from `@memory-loop/shared` directly, the `lib/schemas/` directory can be deleted entirely rather than kept as a re-export barrel. This depends on whether any build tooling or path aliases make direct shared-package imports awkward in Next.js.

3. **Health route enhancement**: The web `/api/health` route currently returns `{ status: "ok" }`. Should it also check daemon connectivity (fetch daemon's `/health` endpoint) and report composite health? This would catch "web is up but daemon is down" scenarios. Not required by spec, but useful operationally.
