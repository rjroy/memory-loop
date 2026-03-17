---
title: Consolidate to Single Next.js Application
date: 2026-02-05
status: executed
tags: [migration, next-js, consolidation, maintainability]
modules: [nextjs, backend]
related:
  - .lore/brainstorm/next-js-migration.md
---

# Plan: Consolidate to Single Next.js Application

## Goal

One codebase, one build, one server.

- All React UI in `nextjs/app/`
- All API routes in `nextjs/app/api/`
- Business logic in `backend/` as importable modules (no HTTP server)
- Delete `frontend/` workspace entirely
- Single `bun run build`, single `bun run start`

## Why

- **Maintainability**: One place to look, one set of conventions
- **Simpler deployment**: One build artifact, one process
- **Next.js conventions**: File-based routing, standard patterns, ecosystem compatibility
- **No custom WebSocket handling**: SSE is simpler and native to HTTP

---

## Current Structure

```
memory-loop/
├── backend/          # Hono server + business logic
├── frontend/         # Vite SPA (React)
├── nextjs/           # Partial Next.js (SSE only)
└── shared/           # Zod schemas
```

## Target Structure

```
memory-loop/
├── nextjs/           # THE app (UI + API)
│   ├── app/          # Pages and API routes
│   ├── components/   # React components (from frontend)
│   ├── hooks/        # React hooks (from frontend)
│   ├── contexts/     # React contexts (from frontend)
│   └── lib/          # Utilities
├── backend/          # Business logic library (no server)
│   └── src/          # vault-manager, file-browser, etc.
└── shared/           # Zod schemas (unchanged)
```

---

## Phase 1: Move React Components to Next.js

### 1A: Set up Next.js app structure

Create directories:
- `nextjs/components/` - UI components
- `nextjs/hooks/` - React hooks
- `nextjs/contexts/` - State management
- `nextjs/styles/` - CSS files

### 1B: Move shared components

From `frontend/src/components/shared/`:
- ConversationPane, ConfirmDialog, ErrorBoundary, LoadingSpinner, etc.

### 1C: Move contexts

From `frontend/src/contexts/`:
- SessionContext → `nextjs/contexts/SessionContext.tsx`

### 1D: Move hooks

From `frontend/src/hooks/`:
- useChat (keep, this is SSE)
- useConfig, useApi, etc.
- Delete useWebSocket (not needed)

### 1E: Create pages

Convert modes to Next.js pages:

| Current | Next.js Page |
|---------|--------------|
| HomeView | `app/page.tsx` or `app/(modes)/ground/page.tsx` |
| NoteCapture | `app/(modes)/capture/page.tsx` |
| Discussion | `app/(modes)/think/page.tsx` |
| BrowseMode | `app/(modes)/recall/page.tsx` |

### 1F: Create layout

`app/layout.tsx`:
- Vault selection gate
- Mode navigation
- Session provider

**Checkpoint:** UI renders in Next.js, API still proxied to Hono

---

## Phase 2: Move REST Endpoints to Next.js

### 2A: Vaults (required first)

| Endpoint | Next.js Route |
|----------|---------------|
| GET /api/vaults | `app/api/vaults/route.ts` |
| POST /api/vaults | `app/api/vaults/route.ts` |
| GET /api/health | `app/api/health/route.ts` |

### 2B: Vault-scoped routes

Create `app/api/vaults/[vaultId]/` with:
- `files/route.ts` and `files/[...path]/route.ts`
- `capture/route.ts`
- `search/*/route.ts`
- `config/route.ts`
- `cards/*/route.ts`
- etc.

Each route imports business logic from `@memory-loop/backend`:
```typescript
import { discoverVaults } from "@memory-loop/backend/vault-manager";
```

### 2C: SSE routes (already done)

- `app/api/chat/route.ts` - exists
- `app/api/chat/[sessionId]/*/route.ts` - exists

**Checkpoint:** All API routes work in Next.js, Hono server not needed

---

## Phase 3: Cleanup

### 3A: Delete frontend workspace

- Remove `frontend/` directory
- Remove from `package.json` workspaces
- Remove frontend scripts from root

### 3B: Remove Hono server from backend

- Delete `backend/src/server.ts`
- Delete `backend/src/routes/`
- Delete `backend/src/websocket-handler.ts`
- Delete `backend/src/index.ts` (entry point)
- Keep all business logic modules

### 3C: Update backend package.json

Backend becomes a pure library:
```json
{
  "name": "@memory-loop/backend",
  "exports": {
    "./vault-manager": "./src/vault-manager.ts",
    "./file-browser": "./src/file-browser.ts",
    "./streaming": "./src/streaming/index.ts",
    // ... etc
  }
}
```

### 3D: Update scripts

Root `package.json`:
```json
{
  "scripts": {
    "dev": "bun run --cwd nextjs dev",
    "build": "bun run --cwd nextjs build",
    "start": "bun run --cwd nextjs start",
    "test": "bun run --cwd backend test && bun run --cwd nextjs test"
  }
}
```

### 3E: Update deployment

- `scripts/launch.sh` → starts Next.js
- systemd service → runs Next.js

**Checkpoint:** Single app, single server, old code deleted

---

## Files to Move

### From frontend/src/components/

| Source | Destination |
|--------|-------------|
| `shared/*` | `nextjs/components/shared/` |
| `discussion/*` | `nextjs/components/discussion/` |
| `home/*` | `nextjs/components/home/` |
| `browse/*` | `nextjs/components/browse/` |
| `note/*` | `nextjs/components/note/` |
| `App.tsx` | Split into `app/layout.tsx` + pages |

### From frontend/src/hooks/

| Source | Destination |
|--------|-------------|
| `useChat.ts` | `nextjs/hooks/useChat.ts` |
| `useConfig.ts` | `nextjs/hooks/useConfig.ts` |
| `useApi.ts` | `nextjs/hooks/useApi.ts` |
| `useWebSocket.ts` | DELETE |

### From frontend/src/contexts/

| Source | Destination |
|--------|-------------|
| `SessionContext.tsx` | `nextjs/contexts/SessionContext.tsx` |

---

## API Routes to Create

54 endpoints grouped:

| Group | Count | Priority |
|-------|-------|----------|
| Vaults | 3 | HIGH - app won't boot without |
| Files | 10 | HIGH - core functionality |
| Capture | 3 | MEDIUM |
| Dashboard | 4 | MEDIUM |
| Search | 3 | MEDIUM |
| Config | 5 | MEDIUM |
| Sessions | 4 | MEDIUM |
| Cards | 5 | LOW |
| Assets | 2 | LOW |
| Memory | 2 | LOW |

(Detailed endpoint list in previous version of plan)

---

## Verification

After Phase 1:
- [ ] Next.js renders all pages
- [ ] Navigation works between modes
- [ ] Session state persists across pages

After Phase 2:
- [ ] All REST endpoints work
- [ ] Chat streaming works (SSE)
- [ ] File operations work
- [ ] No calls to port 3000 (old Hono)

After Phase 3:
- [ ] `bun run dev` starts single server
- [ ] `bun run build && bun run start` works
- [ ] `bun run test` passes
- [ ] `frontend/` directory gone
- [ ] No WebSocket code anywhere

---

## Execution Order

```
Phase 1A-1D (setup, move components)
    ↓
Phase 1E-1F (create pages, layout)
    ↓
Phase 2A (vaults API) ─── verify app boots
    ↓
Phase 2B (remaining APIs)
    ↓
Phase 3 (delete old code)
```

---

## What Stays vs Goes

| Keep | Delete |
|------|--------|
| `backend/src/vault-manager.ts` | `backend/src/server.ts` |
| `backend/src/file-browser.ts` | `backend/src/routes/*` |
| `backend/src/session-manager.ts` | `backend/src/websocket-handler.ts` |
| `backend/src/streaming/*` | `frontend/*` (move first) |
| `shared/*` | `frontend/src/hooks/useWebSocket.ts` |

---

## Estimate

| Phase | Hours |
|-------|-------|
| 1: Move React to Next.js | 8-12 |
| 2: Move REST to Next.js | 10-15 |
| 3: Cleanup | 2-4 |
| **Total** | **20-31 hours** |
