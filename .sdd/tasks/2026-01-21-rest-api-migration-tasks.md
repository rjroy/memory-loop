---
specification: [.sdd/specs/2026-01-21-rest-api-migration.md](./../specs/2026-01-21-rest-api-migration.md)
plan: [.sdd/plans/2026-01-21-rest-api-migration-plan.md](./../plans/2026-01-21-rest-api-migration-plan.md)
status: Draft
version: 1.0.0
created: 2026-01-21
last_updated: 2026-01-21
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# REST API Migration - Task Breakdown

## Task Summary
Total: 18 tasks | Complexity Distribution: 5×S, 10×M, 3×L

## Foundation

### TASK-001: Vault Resolution Middleware
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create Hono middleware that resolves `:vaultId` path parameter to `VaultInfo`, handling 404 for unknown vaults.

**Acceptance Criteria**:
- [ ] Middleware extracts `:vaultId` from path and looks up via `discoverVaults()`
- [ ] Sets `c.set("vault", vaultInfo)` for downstream handlers
- [ ] Returns 404 JSON error when vault not found
- [ ] Validates vault ID format before filesystem access

**Files**:
- Create: `backend/src/middleware/vault-resolution.ts`
- Modify: `backend/src/server.ts` (register middleware on `/api/vaults/:vaultId/*`)

**Testing**: Unit tests for valid vault, missing vault, invalid ID format

---

### TASK-002: REST Error Handling Middleware
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create error handling middleware that maps exceptions to HTTP status codes with JSON bodies matching WebSocket error schema.

**Acceptance Criteria**:
- [ ] Catches `FileBrowserError` and maps to 4xx codes
- [ ] Returns `{ error: { code: ErrorCode, message: string } }` format
- [ ] Maps: 404 → FILE_NOT_FOUND, 403 → PATH_TRAVERSAL, 400 → bad request
- [ ] Unknown errors → 500 with safe message (no stack traces)
- [ ] Logs errors server-side with context

**Files**:
- Create: `backend/src/middleware/error-handler.ts`
- Modify: `backend/src/server.ts` (register as global error handler)

**Testing**: Unit tests for each error code mapping

---

### TASK-003: REST Route Registration Infrastructure
**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-001, TASK-002

**Description**: Create route index that registers all REST routes under `/api/vaults/:vaultId/*` with vault middleware.

**Acceptance Criteria**:
- [ ] Route index file that imports and registers domain routes
- [ ] Vault middleware applied to all `/api/vaults/:vaultId/*` routes
- [ ] Error handler middleware applied globally
- [ ] CORS extended to new routes (matches existing `/api/*` config)

**Files**:
- Create: `backend/src/routes/index.ts`
- Modify: `backend/src/server.ts` (import and register routes)

**Testing**: Integration test verifying route registration

---

## Backend Routes - File Browser (REQ-F-5 to REQ-F-15)

### TASK-004: File Browser REST Routes
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-003

**Description**: Create REST endpoints for file browser operations, wrapping existing `browser-handlers.ts` functions.

**Acceptance Criteria**:
- [ ] `GET /api/vaults/:vaultId/files?path=` → directory listing (REQ-F-5)
- [ ] `GET /api/vaults/:vaultId/files/*` → file content (REQ-F-6)
- [ ] `PUT /api/vaults/:vaultId/files/*` → write file (REQ-F-7)
- [ ] `DELETE /api/vaults/:vaultId/files/*` → delete file (REQ-F-8)
- [ ] `POST /api/vaults/:vaultId/files` → create file (REQ-F-9)
- [ ] `POST /api/vaults/:vaultId/directories` → create directory (REQ-F-10)
- [ ] `DELETE /api/vaults/:vaultId/directories/*` → delete directory (REQ-F-11)
- [ ] `PATCH /api/vaults/:vaultId/files/*` → rename/move file (REQ-F-12, REQ-F-13)
- [ ] `POST /api/vaults/:vaultId/files/*/archive` → archive file (REQ-F-14)
- [ ] `GET /api/vaults/:vaultId/directories/*/contents` → directory contents (REQ-F-15)
- [ ] URL-encoded paths handled correctly (REQ-F-60)

**Files**:
- Create: `backend/src/routes/files.ts`

**Testing**: Integration tests covering:
- Happy path for all operations
- 404 for missing file (REQ-F-56)
- 403 for path traversal attempt (REQ-F-58)
- 400 for invalid request format (REQ-F-57)
- URL-encoded path edge cases (spaces, special chars)
- Performance <200ms (REQ-NF-1)

---

## Backend Routes - Capture (REQ-F-16 to REQ-F-18)

### TASK-005: Capture REST Routes
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-003

**Description**: Create REST endpoints for note capture, wrapping existing `note-capture.ts` functions.

**Acceptance Criteria**:
- [ ] `POST /api/vaults/:vaultId/capture` with body `{ text }` → capture result (REQ-F-16)
- [ ] `GET /api/vaults/:vaultId/recent-notes` → recent notes list (REQ-F-17)
- [ ] `GET /api/vaults/:vaultId/recent-activity` → recent activity (REQ-F-18)

**Files**:
- Create: `backend/src/routes/capture.ts`

**Testing**: Integration tests for capture success and recent notes retrieval

---

## Backend Routes - Home Dashboard (REQ-F-19 to REQ-F-22)

### TASK-006: Home Dashboard REST Routes
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-003

**Description**: Create REST endpoints for home dashboard data, wrapping existing handlers.

**Acceptance Criteria**:
- [ ] `GET /api/vaults/:vaultId/goals` → goals list (REQ-F-19)
- [ ] `GET /api/vaults/:vaultId/inspiration` → inspiration data (REQ-F-20)
- [ ] `GET /api/vaults/:vaultId/tasks` → tasks list (REQ-F-21)
- [ ] `PATCH /api/vaults/:vaultId/tasks` → toggle task (REQ-F-22)

**Files**:
- Create: `backend/src/routes/home.ts`

**Testing**: Integration tests for each endpoint

---

## Backend Routes - Meeting (REQ-F-23 to REQ-F-25)

### TASK-007: Meeting State Store
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Extract meeting state from ConnectionState to module-level Map keyed by vaultId.

**Acceptance Criteria**:
- [ ] Create `meeting-store.ts` with `Map<string, ActiveMeeting>`
- [ ] Export `getMeeting(vaultId)`, `setMeeting(vaultId, meeting)`, `clearMeeting(vaultId)`
- [ ] Single meeting per vault enforced
- [ ] Update `meeting-capture.ts` to use store instead of ConnectionState
- [ ] WebSocket handlers updated to use new store

**Files**:
- Create: `backend/src/meeting-store.ts`
- Modify: `backend/src/meeting-capture.ts`
- Modify: `backend/src/handlers/meeting-handlers.ts`

**Testing**: Unit tests for store operations, integration tests for meeting lifecycle

---

### TASK-008: Meeting REST Routes
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-003, TASK-007

**Description**: Create REST endpoints for meeting management.

**Acceptance Criteria**:
- [ ] `POST /api/vaults/:vaultId/meetings` → start meeting (REQ-F-23)
- [ ] `DELETE /api/vaults/:vaultId/meetings/current` → stop meeting (REQ-F-24)
- [ ] `GET /api/vaults/:vaultId/meetings/current` → get meeting state (REQ-F-25)

**Files**:
- Create: `backend/src/routes/meetings.ts`

**Testing**: Integration tests for meeting lifecycle via REST

---

## Backend Routes - Search (REQ-F-26 to REQ-F-28)

### TASK-009: Search Index Cache
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Cache search index per vault in module-level Map to avoid recreation on each REST call.

**Acceptance Criteria**:
- [ ] Create `search-cache.ts` with `Map<vaultId, SearchIndex>`
- [ ] Export `getOrCreateIndex(vaultId, vaultPath)` that lazily creates/returns index
- [ ] LRU eviction when >10 vaults cached (configurable threshold)
- [ ] Update search handlers to use cache
- [ ] Cache invalidation: index refreshed when vault content changes (or TTL-based)

**Files**:
- Create: `backend/src/search-cache.ts`
- Modify: `backend/src/search/search-index.ts` (export creation function)
- Modify: `backend/src/handlers/search-handlers.ts`

**Testing**: Unit tests for cache hit/miss, eviction

---

### TASK-010: Search REST Routes
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-003, TASK-009

**Description**: Create REST endpoints for search operations.

**Acceptance Criteria**:
- [ ] `GET /api/vaults/:vaultId/search/files?q=` → file name search (REQ-F-26)
- [ ] `GET /api/vaults/:vaultId/search/content?q=` → content search (REQ-F-27)
- [ ] `GET /api/vaults/:vaultId/search/snippets?path=&q=` → snippets (REQ-F-28)
- [ ] Performance <500ms (REQ-NF-2)

**Files**:
- Create: `backend/src/routes/search.ts`

**Testing**: Integration tests with performance validation

---

## Backend Routes - Config (REQ-F-29 to REQ-F-34)

### TASK-011: Config REST Routes
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-003

**Description**: Create REST endpoints for configuration management.

**Acceptance Criteria**:
- [ ] `GET /api/vaults/:vaultId/config/pinned-assets` → pinned assets (REQ-F-29)
- [ ] `PUT /api/vaults/:vaultId/config/pinned-assets` → set pinned assets (REQ-F-30)
- [ ] `PATCH /api/vaults/:vaultId/config` → update vault config (REQ-F-31)
- [ ] `POST /api/vaults/:vaultId/setup` → setup vault (REQ-F-32)
- [ ] `POST /api/vaults` → create vault (REQ-F-33)
- [ ] `DELETE /api/vaults/:vaultId/health-issues/:issueId` → dismiss health issue (REQ-F-34)

**Files**:
- Create: `backend/src/routes/config.ts`

**Testing**: Integration tests for each configuration operation

---

## Backend Routes - Memory & Sessions (REQ-F-35 to REQ-F-40)

### TASK-012: Memory and Sessions REST Routes
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-003

**Description**: Create REST endpoints for memory and session management.

**Acceptance Criteria**:
- [ ] `GET /api/vaults/:vaultId/memory` → get memory (REQ-F-35)
- [ ] `PUT /api/vaults/:vaultId/memory` → save memory (REQ-F-36)
- [ ] `GET /api/config/extraction-prompt` → get extraction prompt (REQ-F-37)
- [ ] `PUT /api/config/extraction-prompt` → save extraction prompt (REQ-F-38)
- [ ] `DELETE /api/config/extraction-prompt` → reset extraction prompt (REQ-F-39)
- [ ] `DELETE /api/vaults/:vaultId/sessions/:sessionId` → delete session (REQ-F-40)

**Files**:
- Create: `backend/src/routes/memory.ts`
- Create: `backend/src/routes/sessions.ts`

**Testing**: Integration tests for memory and session operations

---

## Frontend - API Client Infrastructure

### TASK-013: REST API Client Foundation
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-003

**Description**: Create base API client utilities and shared types for frontend REST calls.

**Acceptance Criteria**:
- [ ] Base fetch wrapper with error handling
- [ ] Typed response helpers that match WebSocket response schemas (REQ-NF-3)
- [ ] VaultContext hook that provides vaultId to API functions
- [ ] Error type that matches `{ error: { code, message } }` format

**Files**:
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/types.ts`

**Testing**: Unit tests for error handling, type validation

---

### TASK-014: File Browser Hooks
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-004, TASK-013

**Description**: Create React hooks for file browser operations, replacing WebSocket calls.

**Acceptance Criteria**:
- [ ] `useFileBrowser(vaultId)` hook with:
  - `listDirectory(path)` → `Promise<DirectoryListing>`
  - `readFile(path)` → `Promise<FileContent>`
  - `writeFile(path, content)` → `Promise<void>`
  - `deleteFile(path)` → `Promise<void>`
  - `createFile(path, content)` → `Promise<void>`
  - `createDirectory(path)` → `Promise<void>`
  - `renameFile(path, newPath)` → `Promise<void>`
  - `isLoading`, `error` state
- [ ] Pattern matches existing `useFileUpload` hook
- [ ] Response schemas match WebSocket schemas (REQ-NF-3)
- [ ] Error states handle 404, 400, 403, 500 responses (REQ-F-55-59)
- [ ] REST route calls shared business logic (REQ-F-64, no duplication)

**Files**:
- Create: `frontend/src/hooks/useFileBrowser.ts`
- Modify: `frontend/src/components/Browse.tsx` (use new hook)

**Testing**: Unit tests with mocked fetch, component tests

---

### TASK-015: Domain Hooks (Capture, Home, Search)
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-005, TASK-006, TASK-010, TASK-013

**Description**: Create React hooks for capture, home, and search operations.

**Acceptance Criteria**:
- [ ] `useCapture(vaultId)` hook with `captureNote(text)`, `getRecentNotes()`, `getRecentActivity()`
- [ ] `useHome(vaultId)` hook with `getGoals()`, `getInspiration()`, `getTasks()`, `toggleTask(taskId)`
- [ ] `useSearch(vaultId)` hook with `searchFiles(query)`, `searchContent(query)`, `getSnippets(path, query)`
- [ ] Each hook exposes `isLoading`, `error` state
- [ ] Update components to use REST hooks instead of WebSocket
- [ ] Error states handle 404, 400, 403, 500 responses (REQ-F-55-59)
- [ ] REST route calls shared business logic (REQ-F-64, no duplication)

**Files**:
- Create: `frontend/src/hooks/useCapture.ts`
- Create: `frontend/src/hooks/useHome.ts`
- Create: `frontend/src/hooks/useSearch.ts`
- Modify: `frontend/src/components/Note.tsx`
- Modify: `frontend/src/components/Home.tsx`
- Modify: `frontend/src/components/Search.tsx` (if exists)

**Testing**: Unit tests for each hook, component integration tests

---

## Protocol Cleanup (REQ-F-61, REQ-F-62)

### TASK-016: Remove Migrated WebSocket Handlers
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-014, TASK-015

**Description**: Remove WebSocket handlers for operations now served by REST.

**Acceptance Criteria**:
- [ ] Remove migrated message type handlers from `websocket-handler.ts`
- [ ] `websocket-handler.ts` only handles streaming operations (REQ-F-41-54)
- [ ] Verify Discussion mode still works:
  - AI response streaming (response_start, response_chunk, response_end)
  - Tool invocations display (tool_start, tool_input, tool_end)
  - Interactive prompts (tool_permission_request/response, ask_user_question_request/response)
  - Abort functionality
- [ ] Verify ping/pong keepalive still works

**Files**:
- Modify: `backend/src/websocket-handler.ts`

**Testing**: Full regression test of Discussion mode, streaming, tool invocations

---

### TASK-017: Protocol Schema Cleanup
**Priority**: Low | **Complexity**: S | **Dependencies**: TASK-016

**Description**: Remove migrated message types from shared protocol schemas.

**Acceptance Criteria**:
- [ ] Remove migrated ClientMessage types from `shared/protocol.ts`
- [ ] Remove migrated ServerMessage types from `shared/protocol.ts`
- [ ] Keep streaming message types (response_*, tool_*, etc.)
- [ ] Frontend compiles without errors
- [ ] Backend compiles without errors

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: TypeScript compilation, full test suite passes

---

## Integration Testing

### TASK-018: End-to-End Integration Tests
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-014, TASK-015

**Description**: Create integration tests validating REST-only operation per spec acceptance tests.

**Acceptance Criteria**:
- [ ] File Browser Without WebSocket: navigate, read, write via REST
- [ ] Capture Without WebSocket: POST note, verify response
- [ ] Search Without WebSocket: search files/content, get snippets
- [ ] Error Handling: 404 for missing vault/file, 400 for bad request, 403 for traversal
- [ ] Performance: File operations <200ms (REQ-NF-1), search <500ms (REQ-NF-2)
- [ ] Discussion Still Streams: AI chat works via WebSocket
- [ ] No select_vault Bug: components fetch data without prior vault selection
- [ ] REQ-F-64: Verify REST and WebSocket use same business logic (spot-check responses match)

**Files**:
- Create: `backend/src/__tests__/rest-integration.test.ts`

**Testing**: All acceptance tests from spec pass

---

## Dependency Graph
```
TASK-001 ──┬─> TASK-003 ──┬─> TASK-004 ──> TASK-014 ──┐
           │              ├─> TASK-005 ──┐            │
TASK-002 ──┘              ├─> TASK-006 ──┼─> TASK-015 ├─> TASK-016 ──> TASK-017
                          ├─> TASK-008 ──┘            │
TASK-007 ─────────────────┘                           │
                          ├─> TASK-010 ──────────────>┤
TASK-009 ─────────────────┘                           │
                          ├─> TASK-011               │
                          └─> TASK-012               │
                                                      │
TASK-013 ────────────────────────────────────────────>┴─> TASK-018
```

## Implementation Order

**Phase 1 - Foundation (7 pts)**: TASK-001, TASK-002, TASK-003, TASK-013
- Parallelizable: TASK-001 + TASK-002, TASK-007 + TASK-009

**Phase 2 - Backend Routes (26 pts)**: TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012
- Parallelizable: All domain routes after TASK-003

**Phase 3 - Frontend Migration (13 pts)**: TASK-014, TASK-015
- TASK-014 (file browser hooks) can start once TASK-004 complete
- TASK-015 hooks parallelizable: useCapture after TASK-005, useHome after TASK-006, useSearch after TASK-010

**Phase 4 - Cleanup (6 pts)**: TASK-016, TASK-017, TASK-018
- Sequential: handlers → schema → integration tests

## Notes

- **Parallelization**: TASK-007 (meeting store), TASK-009 (search cache) can start immediately alongside foundation work
- **Critical path**: Foundation → File Browser Routes → File Browser Hooks → Handler Cleanup → Schema Cleanup
- **Risk mitigation**: Run full test suite after each phase before proceeding
