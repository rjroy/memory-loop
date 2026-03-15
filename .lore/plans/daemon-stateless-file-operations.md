---
title: "Stage 3: Daemon stateless file operations"
date: 2026-03-14
status: reviewed
tags: [daemon, migration, file-operations, search, meetings, tasks, api]
modules: [file-browser, file-upload, note-capture, meeting-capture, meeting-store, transcript-manager, task-manager, daily-prep-manager, reference-updater, search-cache, search-index, search-handlers]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/plans/daemon-skeleton-shared-package.md
  - .lore/plans/daemon-vault-foundation.md
---

# Plan: Stage 3 - Daemon Stateless File Operations

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 3 section)
**API conventions**: `.lore/research/daemon-rest-api.md`
**Stage 1 plan**: `.lore/plans/daemon-skeleton-shared-package.md`
**Stage 2 plan**: `.lore/plans/daemon-vault-foundation.md`

Requirements addressed:
- REQ-DAB-1: Daemon is the authority boundary → All steps (domain modules move to daemon)
- REQ-DAB-3: Vault data on filesystem, daemon owns reads/writes → Steps 2-8
- REQ-DAB-4: Next.js is a client, not a parallel runtime → Step 9 (proxy client)
- REQ-DAB-16: File operations, search, transcript, meeting, task modules are daemon-owned → Steps 2-8
- REQ-DAB-22: Migration reduces boundary bypasses → Steps 9, 10 (direct imports become API calls)
- REQ-DAB-23: Transitional direct imports allowed for unmigrated operations → Step 9

Staging goals addressed:
- Move ~12 stateless file operation modules into the daemon → Steps 2-8
- Dissolve search-handlers.ts into daemon routes → Step 6
- Create ~15 daemon API endpoints → Steps 2-8
- Handle meeting-store's in-memory state → Step 5
- Handle search-cache's in-memory LRU → Step 6

## Codebase Context

**Files in scope (12 source modules, 2 utility modules, 1 handler module):**

| File | Lines | Role | Dependencies |
|------|-------|------|-------------|
| `lib/file-browser.ts` | ~500 | Directory listing, file read/write/rename/delete, path security | schemas, logger |
| `lib/file-upload.ts` | 233 | File upload with WebP conversion | file-browser (`isPathWithinVault`), vault-manager (`directoryExists`), image-converter |
| `lib/note-capture.ts` | 408 | Daily note creation/append, recent notes | schemas, vault-manager (`getVaultInboxPath`, `directoryExists`, `fileExists`) |
| `lib/meeting-capture.ts` | 416 | Meeting file creation/append, stop meeting | schemas, vault-manager, note-capture (formatters) |
| `lib/meeting-store.ts` | 93 | In-memory active meeting per vault | meeting-capture (`ActiveMeeting`), logger |
| `lib/transcript-manager.ts` | 256 | Transcript file init/append | schemas, vault-manager, note-capture (formatters) |
| `lib/task-manager.ts` | 425 | Task discovery/parsing/toggle from vault dirs | schemas, file-browser (`validatePath`, `FileBrowserError`), vault-config, vault-manager |
| `lib/daily-prep-manager.ts` | 507 | Daily prep frontmatter parsing | schemas, vault-manager (`fileExists`), logger |
| `lib/reference-updater.ts` | 242 | Update wikilinks/markdown links on rename | logger |
| `lib/search-cache.ts` | 235 | LRU cache for SearchIndexManager instances | search/search-index, logger |
| `lib/search/search-index.ts` | ~400 | File and content search index | schemas |
| `lib/search/fuzzy-matcher.ts` | ~150 | Fuzzy string matching | (none) |
| `lib/utils/image-converter.ts` | ~200 | WebP conversion via cwebp binary | logger |
| `lib/utils/file-types.ts` | ~80 | File type detection by extension | (none) |
| `lib/handlers/search-handlers.ts` | 118 | Thin wrapper: search-cache to REST shapes | search-cache, logger, schemas |

**Test files in scope (10 test files):**

| Test File | Tests | Portability |
|-----------|-------|-------------|
| `__tests__/file-browser.test.ts` | Filesystem tests with temp dirs | Clean, no Next.js deps |
| `__tests__/file-upload.test.ts` | Upload flow with mocked conversion | Clean |
| `__tests__/note-capture.test.ts` | Capture parsing and writing | Clean |
| `__tests__/meeting-capture.test.ts` | Meeting file creation/append | Clean |
| `__tests__/meeting-store.test.ts` | In-memory store operations | Clean |
| `__tests__/transcript-manager.test.ts` | Transcript init/append | Clean |
| `__tests__/task-manager.test.ts` | Task scanning and toggling | Clean |
| `__tests__/daily-prep-manager.test.ts` | Frontmatter parsing | Clean |
| `__tests__/reference-updater.test.ts` | Reference update across files | Clean |
| `__tests__/search-cache.test.ts` | LRU eviction and TTL | Clean |
| `__tests__/search-index.test.ts` | File and content search | Clean |
| `__tests__/fuzzy-matcher.test.ts` | Fuzzy matching algorithm | Clean |
| `__tests__/search-index.perf.test.ts` | Performance benchmarks | Clean |
| `__tests__/search-integration.test.ts` | End-to-end search flow | Clean |

All test files use standard `node:fs/promises` for setup, no Next.js `Request`/`Response` objects. All port cleanly to the daemon.

**API routes that consume these modules (17 route files):**

| Route | Method | Module Imports |
|-------|--------|---------------|
| `/api/vaults/[vaultId]/files/route.ts` | GET, POST | file-browser |
| `/api/vaults/[vaultId]/files/[...path]/route.ts` | GET, PUT, PATCH, DELETE | file-browser, reference-updater |
| `/api/vaults/[vaultId]/directories/route.ts` | POST | file-browser |
| `/api/vaults/[vaultId]/directories/[...path]/route.ts` | GET, DELETE | file-browser |
| `/api/vaults/[vaultId]/upload/route.ts` | POST | file-upload |
| `/api/vaults/[vaultId]/capture/route.ts` | POST | note-capture, meeting-capture, meeting-store |
| `/api/vaults/[vaultId]/recent-notes/route.ts` | GET | note-capture |
| `/api/vaults/[vaultId]/recent-activity/route.ts` | GET | note-capture |
| `/api/vaults/[vaultId]/meetings/route.ts` | POST | meeting-capture, meeting-store |
| `/api/vaults/[vaultId]/meetings/current/route.ts` | GET, DELETE | meeting-capture, meeting-store |
| `/api/vaults/[vaultId]/tasks/route.ts` | GET, PATCH | task-manager |
| `/api/vaults/[vaultId]/daily-prep/today/route.ts` | GET | daily-prep-manager |
| `/api/vaults/[vaultId]/search/files/route.ts` | GET | search-handlers (via handlers) |
| `/api/vaults/[vaultId]/search/content/route.ts` | GET | search-handlers (via handlers) |
| `/api/vaults/[vaultId]/search/snippets/route.ts` | GET | search-handlers (via handlers) |
| `/api/vaults/[vaultId]/pinned-assets/route.ts` | GET, PUT | config-handlers |
| `/api/vaults/[vaultId]/goals/route.ts` | GET | vault-manager (getVaultGoals) |

**Stage 2 establishes patterns this plan builds on:**

- D1-D8 from Stage 2 define how modules split between shared package, daemon, and transitional client
- The vault-client facade (`nextjs/lib/vault-client.ts`) from Stage 2 provides the HTTP client pattern for calling the daemon
- Vault routes follow Hono handler conventions with structured error responses
- Help discovery endpoints at each hierarchy level

**Import rewiring after Stage 2:**

By the time Stage 3 begins, these modules will already have their imports updated:
- `fileExists`, `directoryExists` → `@memory-loop/shared`
- `getVaultInboxPath`, `getVaultMetadataPath` → `@memory-loop/shared`
- `resolveProjectPath`, `resolveAreaPath`, `VaultConfig` → `@memory-loop/shared`
- `DEFAULT_INBOX_PATH` → `@memory-loop/shared`

What remains are internal cross-references between Stage 3 modules (e.g., `task-manager` imports `validatePath` from `file-browser`, `meeting-capture` imports formatters from `note-capture`). These resolve naturally since all modules move together.

## Decisions

### D1: Sub-phase organization

This stage has ~12 source files, ~14 test files, and ~18 daemon endpoints to create. Doing it all as one atomic step is too large to review. Organized into four sub-phases by functional cluster:

1. **File operations** (file-browser, file-upload, reference-updater, utilities)
2. **Capture and meetings** (note-capture, meeting-capture, meeting-store, transcript-manager)
3. **Tasks and daily prep** (task-manager, daily-prep-manager)
4. **Search subsystem** (search-cache, search-index, fuzzy-matcher, search-handlers dissolution)

Each sub-phase is independently testable. Sub-phases 2-4 depend on Sub-phase 1 completing first (Step 2 moves date formatting utilities to shared package, which Sub-phases B and C consume). Sub-phases 2, 3, and 4 are independent of each other after Sub-phase 1 is done. The ordering reflects increasing complexity and builds confidence with daemon route patterns.

### D2: meeting-store becomes daemon in-memory state

`meeting-store.ts` uses a module-level `Map<string, ActiveMeeting>` to track one active meeting per vault. In the daemon, this is cleaner than in Next.js:

- No HMR clearing the map unexpectedly
- The daemon is the single source of truth for "is a meeting active?"
- Process restart clears the map, which is the correct behavior (meetings are ephemeral)

The web app accesses meeting state through daemon API calls (`GET /vaults/:id/meetings/current`), not by importing the store directly. No architectural change needed, just move the module.

### D3: search-cache LRU stays in-process

The LRU cache wrapping `SearchIndexManager` instances stays as in-process module state in the daemon. Same rationale as D2: no HMR clearing, stable process lifecycle, and the cache rebuilds from disk transparently on miss. No external cache (Redis, etc.) is justified.

### D4: search-handlers.ts dissolves into daemon routes

Per the brainstorm's resolved question #6: `search-handlers.ts` is a thin wrapper that exists because Next.js API routes wanted a layer between route and domain logic. In the daemon, route handlers ARE that layer. The three functions (`searchFilesRest`, `searchContentRest`, `getSnippetsRest`) become inline logic in the daemon's search route handlers. The `SearchResultWithTiming` type moves to the daemon's search route module.

### D5: config-handlers.ts stays for Stage 4

The brainstorm assigns `config-handlers.ts` dissolution to Stage 4 (it wraps vault-setup and extraction config, which are Stage 4/5 concerns). The pinned-assets and vault-config endpoints it exposes are already covered by Stage 2's vault config routes. The only parts of `config-handlers.ts` that concern Stage 3 are the search-related operations, and those come through `search-handlers.ts`, not `config-handlers.ts`.

### D6: file-types.ts goes to shared package, image-converter.ts to daemon

`file-types.ts` is pure utility (zero I/O, zero dependencies). The web app uses it for viewer detection (e.g., "should we show an image preview?"). It belongs in `@memory-loop/shared`.

`image-converter.ts` does filesystem I/O (writes temp files, calls `cwebp` binary). It's only used by `file-upload.ts` for server-side conversion. It belongs in the daemon.

### D7: Transitional file-client in nextjs

Following Stage 2's vault-client pattern, create `nextjs/lib/file-client.ts` as a transitional facade. Downstream modules that still live in nextjs (session-manager, controller, vault-transfer) import from file-browser for `isPathWithinVault` and `validatePath`. These modules don't migrate until Stage 5.

However, reviewing the actual imports: `vault-transfer.ts` imports `isPathWithinVault` from file-browser. `session-manager.ts` imports `formatDateForFilename` from note-capture, and `initializeTranscript`/`appendToTranscript` from transcript-manager.

For the pure formatting functions (`formatDateForFilename`, `formatTimeForTimestamp`), move them to `@memory-loop/shared` since they're stateless string utilities used by both sides. The `isPathWithinVault` function does filesystem I/O (realpath resolution), so session-manager and vault-transfer need to call the daemon for path validation, or accept that these modules will move in Stage 5 anyway and use a transitional import.

Decision: move the formatting functions to `@memory-loop/shared`. For `isPathWithinVault`, create a minimal re-export in the transitional client. For `initializeTranscript` and `appendToTranscript`, the transitional client calls the daemon API (these are write operations that belong on the daemon side).

### D8: Goals endpoint moves here

`GET /api/vaults/[vaultId]/goals` currently calls `getVaultGoals()` which reads a file from the vault. Stage 2's vault-client noted this as a `// TODO: Stage 3` item. The file-browser daemon endpoint handles reading files, so this becomes a specific route that reads the goals file. Simple.

### D9: Daemon directory structure

All Stage 3 modules go under `daemon/src/files/` as a functional group, not scattered across topic directories. The search subsystem gets its own subdirectory: `daemon/src/files/search/`.

```
daemon/src/
  files/
    file-browser.ts
    file-upload.ts
    note-capture.ts
    meeting-capture.ts
    meeting-store.ts
    transcript-manager.ts
    task-manager.ts
    daily-prep-manager.ts
    reference-updater.ts
    search/
      search-cache.ts
      search-index.ts
      fuzzy-matcher.ts
    utils/
      image-converter.ts
    __tests__/
      file-browser.test.ts
      file-upload.test.ts
      note-capture.test.ts
      meeting-capture.test.ts
      meeting-store.test.ts
      transcript-manager.test.ts
      task-manager.test.ts
      daily-prep-manager.test.ts
      reference-updater.test.ts
      search-cache.test.ts
      search-index.test.ts
      fuzzy-matcher.test.ts
      search-index.perf.test.ts
      search-integration.test.ts
  routes/
    files.ts       (file CRUD + directory endpoints)
    capture.ts     (note capture + meeting capture)
    meetings.ts    (meeting start/stop/status)
    tasks.ts       (task listing + toggle)
    search.ts      (file search, content search, snippets)
    daily-prep.ts  (daily prep status)
```

## Precondition

Stage 2 must be complete before beginning any step below. That means: vault-manager and vault-config live in `daemon/src/vault/`, the vault API routes are serving, vault-client exists as the transitional facade in nextjs, and all Stage 2 acceptance criteria are met.

## Implementation Steps

### Sub-Phase A: File Operations

#### Step 1: Move file-types.ts to shared package

**Files**: `nextjs/lib/utils/file-types.ts` → `packages/shared/src/file-types.ts`, `packages/shared/src/index.ts` (update)
**Addresses**: D6

1. Move `nextjs/lib/utils/file-types.ts` to `packages/shared/src/file-types.ts`. It has zero dependencies.

2. Export from `packages/shared/src/index.ts`.

3. Update all importers in nextjs to import from `@memory-loop/shared` instead of `./utils/file-types` or `../utils/file-types`. Grep for `file-types` to find all consumers. This includes frontend components that check file types for viewer rendering, so the shared package is the right home.

**Verification**: `bun run typecheck && bun run lint && bun run test` from root.

#### Step 2: Move note-capture formatting utilities to shared package

**Files**: `packages/shared/src/date-utils.ts` (new), `packages/shared/src/index.ts` (update)
**Addresses**: D7

Extract the pure formatting functions that both daemon and nextjs need:
- `formatDateForFilename(date: Date): string`
- `formatTimeForTimestamp(date: Date): string`
- `getDailyNoteFilename(date: Date): string`

These are currently in `note-capture.ts`. Move them to `packages/shared/src/date-utils.ts`.

Update `note-capture.ts` to import these from `@memory-loop/shared`. Update `session-manager.ts` (which imports `formatDateForFilename` from `note-capture`) to import from `@memory-loop/shared` instead.

**Verification**: `bun run typecheck && bun run test` from root.

#### Step 3: Move file-browser, file-upload, reference-updater, and image-converter to daemon

**Files**: `nextjs/lib/file-browser.ts` → `daemon/src/files/file-browser.ts`, `nextjs/lib/file-upload.ts` → `daemon/src/files/file-upload.ts`, `nextjs/lib/reference-updater.ts` → `daemon/src/files/reference-updater.ts`, `nextjs/lib/utils/image-converter.ts` → `daemon/src/files/utils/image-converter.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

1. Create `daemon/src/files/` and `daemon/src/files/utils/` directories.

2. Move `file-browser.ts` to `daemon/src/files/file-browser.ts`:
   - Update imports: schemas from `@memory-loop/shared`, logger from `@memory-loop/shared`.
   - The `ErrorCode` type import from schemas stays the same (already in shared package from Stage 1).

3. Move `file-upload.ts` to `daemon/src/files/file-upload.ts`:
   - Update imports: `isPathWithinVault` from `./file-browser`, `directoryExists` from `@memory-loop/shared`, `convertToWebp` from `./utils/image-converter`, logger from `@memory-loop/shared`.

4. Move `reference-updater.ts` to `daemon/src/files/reference-updater.ts`:
   - Update imports: logger from `@memory-loop/shared`.

5. Move `image-converter.ts` to `daemon/src/files/utils/image-converter.ts`:
   - Update imports: logger from `@memory-loop/shared`.

6. Delete the original files from nextjs.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 4: Move file operation tests to daemon

**Files**: `nextjs/lib/__tests__/file-browser.test.ts` → `daemon/src/files/__tests__/file-browser.test.ts`, same pattern for `file-upload.test.ts`, `reference-updater.test.ts`

1. Move all three test files using `git mv`.

2. Update imports in test files to point to `../file-browser`, `../file-upload`, `../reference-updater`, and `@memory-loop/shared` for schemas and utilities.

3. Audit for Next.js-specific dependencies: all three test files use `node:fs/promises` for setup. No `Request`/`Response` objects. Clean port.

4. Run `bun run --cwd daemon test`.

**Verification**: All three test suites pass in the daemon context.

#### Step 5: Create daemon file operation routes

**Files**: `daemon/src/routes/files.ts` (new), `daemon/src/routes/__tests__/files.test.ts` (new)
**Addresses**: REQ-DAB-1, REQ-DAB-3

Create Hono route handlers for file operations. These endpoints mirror the current Next.js API routes but run in the daemon.

**`GET /vaults/:id/files`** - List directory contents.
Request: query params `path` (relative to content root, default: root).
Returns: `{ entries: FileEntry[] }`.

**`POST /vaults/:id/files`** - Create a new markdown file.
Request body: `{ path: string, content?: string }`.
Returns: 201 with `{ path: string }`.

**`GET /vaults/:id/files/*`** - Read a file.
Catch-all path parameter for the file path.
Returns: `{ content: string, truncated: boolean }`.

**`PUT /vaults/:id/files/*`** - Write to a file.
Request body: `{ content: string }`.
Returns: `{ success: true }`.

**`PATCH /vaults/:id/files/*`** - Rename or move a file.
Request body: `{ newPath: string }`.
Calls `reference-updater` to update wikilinks/markdown links.
Returns: `{ oldPath: string, newPath: string, referencesUpdated: number }`.

**`DELETE /vaults/:id/files/*`** - Delete a file.
Returns: `{ success: true }`.

**`POST /vaults/:id/directories`** - Create a directory.
Request body: `{ path: string }`.
Returns: 201 with `{ path: string }`.

**`GET /vaults/:id/directories/*`** - Get directory contents for deletion preview.
Returns: `{ entries: FileEntry[] }`.

**`DELETE /vaults/:id/directories/*`** - Delete a directory.
Returns: `{ success: true }`.

**`POST /vaults/:id/upload`** - Upload a file.
Accepts multipart form data (file + metadata).
Returns: `{ path: string, converted?: boolean, originalFormat?: string }`.

**`GET /vaults/:id/goals`** - Read vault goals file.
Returns: `{ content: string | null }`.
This resolves the Stage 2 TODO in vault-client's `getVaultGoals`.

All error responses follow the Stage 1 convention: `{ "error": string, "code": string, "detail"?: string }`. Error codes map from `FileBrowserError.code` values.

Register routes in `daemon/src/server.ts`. Update `daemon/src/routes/help.ts` to include file endpoints.

Write tests in `daemon/src/routes/__tests__/files.test.ts`:
- Test each endpoint with Hono's `app.request()`.
- Create temp vault directory with fixture files.
- Test path traversal rejection (security-critical).
- Test file CRUD round-trip.
- Test rename with reference updates.
- Test upload with extension validation.
- Test goals endpoint.

**Verification**: Route tests pass. Manual test over Unix socket confirms expected shapes.

### Sub-Phase B: Capture and Meetings

#### Step 6: Move note-capture, meeting-capture, meeting-store, and transcript-manager to daemon

**Files**: `nextjs/lib/note-capture.ts` → `daemon/src/files/note-capture.ts`, same pattern for `meeting-capture.ts`, `meeting-store.ts`, `transcript-manager.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

1. Move `note-capture.ts` to `daemon/src/files/note-capture.ts`:
   - Update imports: schemas from `@memory-loop/shared`, `getVaultInboxPath`/`directoryExists`/`fileExists` from `@memory-loop/shared`, date formatting from `@memory-loop/shared` (moved in Step 2).
   - Remove the now-shared formatting functions if they haven't been removed during Step 2 (they should have been).

2. Move `meeting-capture.ts` to `daemon/src/files/meeting-capture.ts`:
   - Update imports: schemas from `@memory-loop/shared`, vault helpers from `@memory-loop/shared`, note-capture functions from `./note-capture`.

3. Move `meeting-store.ts` to `daemon/src/files/meeting-store.ts`:
   - Update imports: `ActiveMeeting` from `./meeting-capture`, logger from `@memory-loop/shared`.
   - Replace `wsLog` import (the old pre-created logger) with `createLogger("MeetingStore")`.

4. Move `transcript-manager.ts` to `daemon/src/files/transcript-manager.ts`:
   - Update imports: schemas from `@memory-loop/shared`, vault helpers from `@memory-loop/shared`, date formatting from `@memory-loop/shared`, `directoryExists` from `@memory-loop/shared`.

5. Handle `getTranscriptsDirectory` for extraction subsystem:
   - `nextjs/lib/extraction/transcript-reader.ts` imports `getTranscriptsDirectory` from `../transcript-manager`. The extraction subsystem does not move until Stage 4/5, so this import will break when `transcript-manager.ts` is deleted.
   - `getTranscriptsDirectory` is a pure path derivation: `join(getVaultInboxPath(vault), "chats")`. Move it to `@memory-loop/shared` alongside the other vault path helpers (`getVaultInboxPath`, `getVaultMetadataPath`). Add it to `packages/shared/src/vault-paths.ts` (or wherever those helpers landed in Stage 2).
   - Update `transcript-reader.ts` and its test file to import `getTranscriptsDirectory` from `@memory-loop/shared`.
   - Update `transcript-manager.ts` (now in daemon) to also import from `@memory-loop/shared`.

6. Delete originals from nextjs.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 7: Move capture and meeting tests to daemon

**Files**: `nextjs/lib/__tests__/note-capture.test.ts` → `daemon/src/files/__tests__/note-capture.test.ts`, same for `meeting-capture.test.ts`, `meeting-store.test.ts`, `transcript-manager.test.ts`

1. Move all four test files using `git mv`.
2. Update imports to daemon-relative paths and `@memory-loop/shared`.
3. Run `bun run --cwd daemon test`.

**Verification**: All four test suites pass in daemon context.

#### Step 8: Create daemon capture and meeting routes

**Files**: `daemon/src/routes/capture.ts` (new), `daemon/src/routes/meetings.ts` (new), `daemon/src/routes/__tests__/capture.test.ts` (new), `daemon/src/routes/__tests__/meetings.test.ts` (new)
**Addresses**: REQ-DAB-1, REQ-DAB-3, D2

**Capture routes (`capture.ts`):**

**`POST /vaults/:id/capture`** - Capture text to daily note or active meeting.
Request body: `{ text: string }`.
Behavior: If a meeting is active for this vault (via meeting-store), routes capture to meeting file. Otherwise routes to daily note.
Returns: `{ success: true, timestamp: string, notePath: string, meeting?: boolean }`.

**`GET /vaults/:id/recent-notes`** - Get recent captured notes.
Query params: `limit` (default 5).
Returns: `{ notes: RecentNoteEntry[] }`.

**`GET /vaults/:id/recent-activity`** - Get combined recent activity.
This combines recent notes and recent discussions. The discussion history part depends on session-manager (Stage 5). For now, return only recent notes. Add a `// TODO: Stage 5 - include recent discussions` comment.
Returns: `{ captures: RecentNoteEntry[], discussions: [] }`.

**Meeting routes (`meetings.ts`):**

**`POST /vaults/:id/meetings`** - Start a meeting.
Request body: `{ title: string }`.
Returns: 201 with `{ meeting: MeetingState }`.
Error: 409 if a meeting is already active for this vault.

**`GET /vaults/:id/meetings/current`** - Get current meeting state.
Returns: `{ meeting: MeetingState }` (isActive: false if no meeting).

**`DELETE /vaults/:id/meetings/current`** - Stop the active meeting.
Returns: `{ content: string, entryCount: number, filePath: string }`.
Error: 404 if no active meeting.

Register routes in `daemon/src/server.ts`. Update help discovery.

Write tests for both route modules.

**Verification**: Route tests pass.

### Sub-Phase C: Tasks and Daily Prep

#### Step 9: Move task-manager and daily-prep-manager to daemon

**Files**: `nextjs/lib/task-manager.ts` → `daemon/src/files/task-manager.ts`, `nextjs/lib/daily-prep-manager.ts` → `daemon/src/files/daily-prep-manager.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

1. Move `task-manager.ts` to `daemon/src/files/task-manager.ts`:
   - Update imports: schemas from `@memory-loop/shared`, `validatePath`/`FileBrowserError` from `./file-browser`, `resolveProjectPath`/`resolveAreaPath`/`VaultConfig` from `@memory-loop/shared`, `DEFAULT_INBOX_PATH`/`directoryExists` from `@memory-loop/shared`, logger from `@memory-loop/shared`.

2. Move `daily-prep-manager.ts` to `daemon/src/files/daily-prep-manager.ts`:
   - Update imports: schemas from `@memory-loop/shared`, `fileExists` from `@memory-loop/shared`, logger from `@memory-loop/shared`.

3. Delete originals from nextjs.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 10: Move task and daily-prep tests to daemon

**Files**: `nextjs/lib/__tests__/task-manager.test.ts` → `daemon/src/files/__tests__/task-manager.test.ts`, `nextjs/lib/__tests__/daily-prep-manager.test.ts` → `daemon/src/files/__tests__/daily-prep-manager.test.ts`

1. Move both test files using `git mv`.
2. Update imports.
3. Run `bun run --cwd daemon test`.

**Verification**: Both test suites pass.

#### Step 11: Create daemon task and daily-prep routes

**Files**: `daemon/src/routes/tasks.ts` (new), `daemon/src/routes/daily-prep.ts` (new), tests for both
**Addresses**: REQ-DAB-1

**Task routes (`tasks.ts`):**

**`GET /vaults/:id/tasks`** - Get all tasks from vault.
Loads vault config, then calls `getAllTasks(contentRoot, config)`.
Returns: `{ tasks: TaskEntry[], incomplete: number, total: number }`.

**`PATCH /vaults/:id/tasks`** - Toggle or set a task state.
Request body: `{ filePath: string, lineNumber: number, newState?: string }`.
Returns: `{ success: true, newState: string }`.

**Daily prep routes (`daily-prep.ts`):**

**`GET /vaults/:id/daily-prep/today`** - Get today's daily prep status.
Returns: `DailyPrepStatus` object.

Register routes. Update help discovery. Write tests.

**Verification**: Route tests pass.

### Sub-Phase D: Search Subsystem

#### Step 12: Move search modules to daemon

**Files**: `nextjs/lib/search-cache.ts` → `daemon/src/files/search/search-cache.ts`, `nextjs/lib/search/search-index.ts` → `daemon/src/files/search/search-index.ts`, `nextjs/lib/search/fuzzy-matcher.ts` → `daemon/src/files/search/fuzzy-matcher.ts`
**Addresses**: REQ-DAB-16, D3

1. Move `search-cache.ts` to `daemon/src/files/search/search-cache.ts`:
   - Update imports: `SearchIndexManager` from `./search-index`, logger from `@memory-loop/shared`.

2. Move `search/search-index.ts` to `daemon/src/files/search/search-index.ts`:
   - Update imports: schemas from `@memory-loop/shared`.

3. Move `search/fuzzy-matcher.ts` to `daemon/src/files/search/fuzzy-matcher.ts`:
   - No external imports to update.

4. Delete `nextjs/lib/handlers/search-handlers.ts`. Its logic dissolves into daemon routes (D4).

5. Update `nextjs/lib/handlers/index.ts`: remove the re-exports from `search-handlers`. The three re-exported functions (`searchFilesRest`, `searchContentRest`, `getSnippetsRest`) and the `SearchResultWithTiming` type are no longer available. If `index.ts` becomes empty of search exports, verify no consumers import search functions through `@/lib/handlers`. The search API routes import through this barrel file, but those routes will be converted to daemon proxies in Step 16.

6. Delete `nextjs/lib/search/` directory.

7. Delete originals from nextjs.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 13: Move search tests to daemon

**Files**: Move `search-cache.test.ts`, `search-index.test.ts`, `fuzzy-matcher.test.ts`, `search-index.perf.test.ts`, `search-integration.test.ts` to `daemon/src/files/__tests__/`

1. Move all five test files using `git mv`.
2. Update imports.
3. Run `bun run --cwd daemon test`.

**Verification**: All five test suites pass.

#### Step 14: Create daemon search routes

**Files**: `daemon/src/routes/search.ts` (new), `daemon/src/routes/__tests__/search.test.ts` (new)
**Addresses**: REQ-DAB-1, D4

The three functions from `search-handlers.ts` dissolve into these route handlers:

**`GET /vaults/:id/search/files`** - Fuzzy file name search.
Query params: `q` (required), `limit` (optional).
Inline: `getOrCreateIndex(vaultId, contentRoot)`, then `index.searchFiles(q, { limit })`.
Returns: `{ results: FileSearchResult[], totalMatches: number, searchTimeMs: number }`.

**`GET /vaults/:id/search/content`** - Full-text content search.
Query params: `q` (required), `limit` (optional).
Inline: `getOrCreateIndex(vaultId, contentRoot)`, then `index.searchContent(q, { limit })`.
Returns: `{ results: ContentSearchResult[], totalMatches: number, searchTimeMs: number }`.

**`GET /vaults/:id/search/snippets`** - Context snippets for a file.
Query params: `path` (required), `q` (required).
Inline: `getOrCreateIndex(vaultId, contentRoot)`, then `index.getSnippets(path, q)`.
Returns: `{ snippets: ContextSnippet[] }`.

Register routes. Update help discovery. Write tests.

**Verification**: Route tests pass.

### Finalization

#### Step 15: Create transitional file-client in nextjs

**Files**: `nextjs/lib/file-client.ts` (new)
**Addresses**: REQ-DAB-22, REQ-DAB-23, D7

Create `nextjs/lib/file-client.ts` following the vault-client pattern from Stage 2. This provides the same async interface for downstream nextjs modules that still import from deleted modules.

Functions to expose (calling daemon API over Unix socket):

```
// From file-browser (used by vault-transfer.ts in Stage 5)
isPathWithinVault(vaultPath: string, targetPath: string): Promise<boolean>
validatePath(vaultPath: string, relativePath: string): Promise<string>

// From transcript-manager (used by session-manager.ts in Stage 5)
initializeTranscript(vault: VaultInfo, sessionId: string, firstMessage: string, date?: Date): Promise<string>
appendToTranscript(transcriptPath: string, content: string): Promise<void>

// From note-capture (used by session-manager.ts)
// formatDateForFilename already moved to @memory-loop/shared in Step 2

// From meeting-store (used by capture API route)
getActiveMeeting(vaultId: string): Promise<ActiveMeeting | null>
```

Note: `isPathWithinVault` and `validatePath` are tricky because they resolve filesystem paths. In the transitional period, `vault-transfer.ts` (Stage 5) and `vault-setup.ts` (Stage 4/5) still run in nextjs and need path validation. Two options:

1. Call the daemon's file read endpoint and let it do the validation.
2. Keep a minimal local copy of `isPathWithinVault` and `validatePath` in the transitional client that does the realpath check locally.

Option 2 is pragmatic: these functions use only `node:fs/promises` and `node:path`, and vault-transfer/vault-setup need them for security checks before passing paths to the daemon. Mark them `// TODO: Stage 5 - remove when vault-transfer and vault-setup move to daemon`.

For `initializeTranscript` and `appendToTranscript`: these are used by `session-manager.ts` which moves in Stage 5. The transitional client can call daemon endpoints for transcript operations. Create two daemon endpoints:

**`POST /vaults/:id/transcripts`** - Initialize a transcript.
Request body: `{ sessionId: string, firstMessage: string }`.
Returns: `{ path: string }`.

**`POST /vaults/:id/transcripts/append`** - Append to a transcript.
Request body: `{ path: string, content: string }`.
Returns: `{ success: true }`.

These endpoints are thin wrappers around `initializeTranscript` and `appendToTranscript`.

**Verification**: `bun run --cwd nextjs typecheck` passes.

#### Step 16: Rewrite downstream imports across nextjs

**Files**: ~15 files in `nextjs/lib/` and `nextjs/app/api/`

Switch all remaining nextjs imports from deleted modules to their new sources.

1. **API route files (17 routes)**: These routes currently import from `lib/file-browser`, `lib/note-capture`, `lib/meeting-capture`, `lib/meeting-store`, `lib/task-manager`, `lib/daily-prep-manager`, `lib/handlers/search-handlers`, etc. During Stage 3, these routes continue to work by importing from the transitional `file-client`. But since these routes will become daemon API proxies in Stage 6, and the daemon now serves these endpoints directly, an alternative is to convert these specific routes to daemon proxies now (calling the daemon API instead of importing domain modules).

   Decision: Convert the API routes to daemon proxies now for the modules that moved in this stage. This eliminates the need for a large file-client and reduces the remaining work in Stage 6. Each route becomes a thin HTTP proxy:

   ```typescript
   // Before (direct import)
   import { listDirectory } from "@/lib/file-browser";
   const entries = await listDirectory(vault.contentRoot, path);

   // After (daemon proxy)
   const res = await fetch(`http://localhost/vaults/${vaultId}/files?path=${path}`, { unix: socketPath });
   const data = await res.json();
   ```

   This follows the same pattern as Stage 2's vault-client, but applied at the route level. The vault-helpers `getVaultOrError` function was already rewritten in Stage 2 to use vault-client.

2. **lib/ modules still in nextjs** that imported from moved modules:

   | Module | Old Import | New Source |
   |--------|-----------|-----------|
   | `session-manager.ts` | `formatDateForFilename` from note-capture | `@memory-loop/shared` (moved in Step 2) |
   | `session-manager.ts` | `initializeTranscript`, `appendToTranscript` from transcript-manager | `@/lib/file-client` |
   | `vault-transfer.ts` | `isPathWithinVault` from file-browser | `@/lib/file-client` (local copy per D7) |
   | `vault-setup.ts` | `validatePath` from file-browser | `@/lib/file-client` (local copy per D7) |

3. Run grep to verify completeness:
   ```
   grep -r "from.*file-browser\|from.*note-capture\|from.*meeting-capture\|from.*meeting-store\|from.*transcript-manager\|from.*task-manager\|from.*daily-prep-manager\|from.*reference-updater\|from.*search-cache\|from.*search-handlers\|from.*search/search-index\|from.*search/fuzzy-matcher\|from.*utils/image-converter" nextjs/
   ```

   Expected remaining matches: only `file-client.ts` (transitional), and `vault-transfer.ts`/`session-manager.ts` importing from file-client. No direct imports from deleted modules.

**Verification**: `bun run typecheck && bun run lint && bun run test && bun run build` from root. `bun run --cwd nextjs dev` works. Grep confirms zero imports from deleted modules (except through file-client).

#### Step 17: Integration test

**Files**: `daemon/src/__tests__/file-operations-integration.test.ts` (new)

End-to-end test validating the file operations API works through the HTTP layer.

1. Start the daemon in-process using Hono's test helper.
2. Create a temp vaults directory with a fixture vault containing test files.
3. Test the full sequence:
   - `GET /vaults/:id/files` lists directory contents
   - `POST /vaults/:id/files` creates a file
   - `GET /vaults/:id/files/path/to/file.md` reads it back
   - `PUT /vaults/:id/files/path/to/file.md` updates it
   - `PATCH /vaults/:id/files/path/to/file.md` renames it
   - `DELETE /vaults/:id/files/path/to/renamed.md` removes it
   - `POST /vaults/:id/capture` captures to daily note
   - `POST /vaults/:id/meetings` starts a meeting
   - `POST /vaults/:id/capture` routes to meeting (meeting active)
   - `DELETE /vaults/:id/meetings/current` stops meeting, returns content
   - `GET /vaults/:id/tasks` returns tasks from fixture files
   - `GET /vaults/:id/search/files?q=test` returns file search results
   - `GET /vaults/:id/search/content?q=hello` returns content search results
   - `GET /vaults/:id/daily-prep/today` returns daily prep status
4. Cleanup temp directory.

**Verification**: Integration test passes end-to-end.

#### Step 18: Validate against spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md`, the staging goals from `.lore/brainstorm/daemon-migration-stages.md` (Stage 3 section), and reviews the implementation. Flag any requirements not met.

Checklist for validation:
- [ ] All 12 source modules live in `daemon/src/files/`, not in `nextjs/lib/`
- [ ] All 14 test files pass from their new locations in the daemon
- [ ] `search-handlers.ts` is deleted, its logic lives in daemon route handlers
- [ ] `file-types.ts` is in `@memory-loop/shared`
- [ ] `formatDateForFilename`/`formatTimeForTimestamp` are in `@memory-loop/shared`
- [ ] Daemon endpoints exist for: files CRUD, directories CRUD, upload, capture, recent-notes, recent-activity, meetings start/stop/current, tasks list/toggle, daily-prep/today, search files/content/snippets, goals, transcripts init/append
- [ ] Help discovery includes all new endpoints
- [ ] meeting-store's in-memory Map runs in the daemon process
- [ ] search-cache's LRU runs in the daemon process
- [ ] No nextjs files import directly from deleted modules
- [ ] Transitional file-client exists for session-manager and vault-transfer (Stage 5 consumers)
- [ ] All existing nextjs tests pass (route tests updated for proxy pattern where routes were converted)
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
- [ ] `bun run --cwd nextjs dev` works (turbopack resolution check)
- [ ] No new direct-import paths from Next.js into daemon domain modules (REQ-DAB-22 invariant)

## Delegation Guide

This is the largest stage by file count. Most steps are mechanical (move files, rewrite imports, create route handlers following established patterns). The following steps warrant focused attention:

- **Step 5** (file CRUD routes): The file-browser has security-critical path traversal protection. The daemon routes must preserve this. A code-reviewer should verify that all path inputs go through `validatePath` before any filesystem access. The upload endpoint handles multipart form data, which may need Hono-specific handling (Hono's `c.req.parseBody()` or `c.req.formData()`).

- **Step 8** (capture/meeting routes): The meeting-store interaction (check if meeting active, route capture accordingly) is the most stateful logic in this stage. Review the meeting lifecycle: start → capture → capture → stop. Verify that the daemon correctly manages the `Map<string, ActiveMeeting>` state across these operations.

- **Step 14** (search routes): The search-handlers dissolution is straightforward but the timing metadata (`searchTimeMs`) should be preserved. Review that the `getOrCreateIndex` call correctly resolves the vault's content root (not the vault root).

- **Step 16** (import rewriting): High-volume mechanical change. Run grep-first, then bulk replace, then all quality gates. A code-reviewer agent should check the diff for missed imports.

Consult `.lore/lore-agents.md` for available review agents. The `plan-reviewer`, `code-reviewer`, and `silent-failure-hunter` agents are relevant.

## Risks

**R1: Multipart form data handling in Hono.** The upload route (`POST /vaults/:id/upload`) accepts file uploads. Hono handles multipart via `c.req.parseBody()` which returns a `File` or `string` for each field. Verify Hono's multipart API works with Bun's `File` implementation. If not, the fallback is Bun's native `Request.formData()` which Hono exposes through `c.req.raw`.

**R2: Import rewrite completeness.** Steps 3, 6, 9, 12, and 16 collectively touch ~30+ files. Missing one import means a runtime crash. Defense: delete old files before typechecking. The type checker catches unresolved imports. The build step (`bun run build`) catches anything the typecheck misses.

**R3: Path security in daemon routes.** `file-browser.ts` has careful path traversal protection (realpath resolution, vault boundary checks). The daemon routes must use these functions for every path parameter. A route that constructs a path without calling `validatePath` is a security bug. The code reviewer should specifically check for this.

**R4: Meeting state across daemon restart.** Meeting-store's in-memory Map clears on process restart. This is intentional (meetings are ephemeral capture sessions, not persistent data). But it means a daemon restart during an active meeting loses the meeting association (though the meeting file itself is on disk). Document this in the health endpoint's response or in daemon lifecycle documentation.

**R5: API route conversion scope creep.** Step 16 converts API routes to daemon proxies for modules that moved in this stage. This overlaps with Stage 6's scope (convert ALL routes to proxies). Keep the conversion limited to routes that import from modules deleted in this stage. Don't convert routes that still work via direct imports of modules that haven't moved yet.

## Acceptance Criteria

Stage 3 is complete when:

1. All 12 source modules and 2 utility modules live in `daemon/src/files/`, with their tests
2. `@memory-loop/shared` contains: `file-types.ts` exports, `formatDateForFilename`, `formatTimeForTimestamp`, `getDailyNoteFilename`
3. The daemon serves **24 domain endpoints** plus **2 transitional transcript endpoints**: file CRUD (5), directory operations (3), upload (1), capture (1), recent-notes (1), recent-activity (1), meetings (3), tasks (2), daily-prep (1), search (3), goals (1), transcripts init/append (2) = **26 total endpoints**
4. `search-handlers.ts` is deleted; its logic is inline in daemon search routes
5. `meeting-store.ts` runs in the daemon process (in-memory Map)
6. `search-cache.ts` runs in the daemon process (LRU cache)
7. `nextjs/lib/file-client.ts` provides transitional interface for Stage 5 consumers
8. No file in `nextjs/` imports from any of the deleted modules (except through file-client)
9. All existing tests pass from their new locations
10. New tests cover each daemon endpoint
11. Integration test validates end-to-end file operations flow
12. `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
13. `bun run --cwd nextjs dev` works (turbopack resolution verified)
