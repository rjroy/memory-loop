# Plan: Remove Hono and WebSocket

## Context

The migration from Hono to Next.js is functionally complete. The frontend uses REST+SSE exclusively (pair writing uses `sendChatMessage` over SSE, not WebSocket). The entire Hono/WebSocket layer is dead code: nothing imports it, nothing connects to it.

## What gets deleted

### WebSocket layer
- `backend/src/websocket-handler.ts` (~839 lines, message router)
- `backend/src/__tests__/websocket-handler.test.ts`

### Hono server entry point
- `backend/src/index.ts` (Bun.serve, scheduler startup - schedulers already run via Next.js instrumentation)
- `backend/src/server.ts` (Hono app, TLS config, WebSocket upgrade, server config)
- `backend/src/__tests__/server.test.ts`

### Hono routes (entire directory, all replaced by Next.js API routes)
- `backend/src/routes/` (11 files: index, capture, cards, config, daily-prep, files, home, meetings, memory, search, sessions)

### Hono middleware (entire directory, unused by Next.js)
- `backend/src/middleware/vault-resolution.ts`
- `backend/src/middleware/error-handler.ts`
- `backend/src/__tests__/error-handler.test.ts`

### WebSocket-only handlers
- `backend/src/handlers/pair-writing-handlers.ts` (frontend sends pair writing via SSE chat, not WebSocket)
- `backend/src/handlers/memory-handlers.ts` (duplicated by `nextjs/app/api/config/extraction-prompt/route.ts`)
- `backend/src/handlers/card-generator-handlers.ts` (duplicated by `nextjs/app/api/config/card-generator/route.ts`)
- `backend/src/handlers/types.ts` (WebSocket types: `WebSocketLike`, `ConnectionState`, `HandlerContext`, etc.)
- `backend/src/handlers/__tests__/card-generator-handlers.test.ts`
- `backend/src/handlers/__tests__/pair-writing-handlers.test.ts`

**Total: ~25 files deleted**

## What gets modified

### `backend/src/handlers/index.ts`
Strip to only export what Next.js uses:
- Keep: search-handlers exports (`searchFilesRest`, `searchContentRest`, `getSnippetsRest`)
- Keep: config-handlers exports (`handleUpdateVaultConfig`, `handleSetupVault`, `handleCreateVault`, pinned assets, error types)
- Remove: all WebSocket type exports, pair-writing handler exports, memory handler exports

### `backend/package.json`
- Remove `"hono": "^4.6.0"` from dependencies
- Remove `"."` export entry (pointed to deleted `index.ts`)
- Remove `"./middleware"` export entry
- Remove `"./health-collector"` export entry (unused)
- Remove/update `dev` and `start` scripts (they launched the Hono server)

### `CLAUDE.md`
- Remove "the Hono server in server.ts is legacy, retained only for its WebSocket handler" note
- Remove WebSocket references from architecture description

## What is NOT touched

All domain logic modules stay exactly as they are. Next.js imports these directly:
- vault-manager, session-manager, file-browser, note-capture
- streaming/ (ActiveSessionController, SessionStreamer, types)
- sdk-provider, vault-config, search modules
- spaced-repetition/, extraction/
- meeting-capture, meeting-store, task-manager, etc.
- handlers/search-handlers.ts, handlers/config-handlers.ts

## Execution order

1. Delete all files listed above
2. Update `handlers/index.ts` (remove dead exports)
3. Update `backend/package.json` (remove hono dep, dead exports, dead scripts)
4. Run `bun install` to update lockfile
5. Update `CLAUDE.md`
6. Run full test suite to verify nothing breaks
7. Commit

## Verification

- `bun run --cwd backend typecheck` passes (no dangling imports)
- `bun run --cwd backend test` passes (deleted tests won't run, remaining tests unaffected)
- `bun run --cwd nextjs build` passes (no imports from deleted modules)
- `bun run test` from root passes
- `grep -r "hono" backend/src/` returns nothing
- `grep -r "websocket\|WebSocket" backend/src/` returns nothing (except possibly comments)
