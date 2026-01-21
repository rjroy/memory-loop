---
specification: [.sdd/specs/2026-01-21-rest-api-migration.md](./../specs/2026-01-21-rest-api-migration.md)
status: Approved
version: 1.0.0
created: 2026-01-21
last_updated: 2026-01-21
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# REST API Migration - Technical Plan

## Overview

This plan converts 36 stateless WebSocket message types to REST endpoints while preserving WebSocket for 17 streaming/interactive operations. The architecture separates "actions" (HTTP) from "streams" (WebSocket).

**Key strategy**: Extract business logic from WebSocket handlers into shared functions, then wrap those functions in both REST routes and (temporarily) WebSocket handlers. Frontend migrates incrementally by domain. WebSocket handlers are removed once frontend migration is complete.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React 19)                    │
├────────────────────────┬────────────────────────────────────┤
│   REST Client (fetch)  │     WebSocket Client (streams)     │
│   - File browser       │     - Discussion messages          │
│   - Capture            │     - AI response streaming        │
│   - Tasks, Goals       │     - Tool use events              │
│   - Search             │     - Session management           │
│   - Config             │     - Pair writing                 │
└───────────┬────────────┴─────────────────┬──────────────────┘
            │                              │
            ▼                              ▼
┌───────────────────────┐    ┌────────────────────────────────┐
│  Hono REST Routes     │    │    Hono WebSocket Handler      │
│  /api/vaults/:id/*    │    │    /ws                         │
└───────────┬───────────┘    └─────────────┬──────────────────┘
            │                              │
            └──────────────┬───────────────┘
                           ▼
            ┌──────────────────────────────┐
            │   Shared Business Logic      │
            │   backend/src/handlers/*.ts  │
            │   backend/src/*.ts           │
            └──────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `backend/src/routes/` | NEW: REST route handlers (thin wrappers) |
| `backend/src/handlers/` | Business logic (already extracted, shared) |
| `backend/src/middleware/` | NEW: Vault resolution, error handling |
| `backend/src/websocket-handler.ts` | Reduced scope (streaming only) |
| `frontend/src/api/` | NEW: REST client functions |
| `frontend/src/hooks/useApi.ts` | NEW: React hooks for REST calls |

### WebSocket Preservation (REQ-F-41 through REQ-F-54)

These operations remain WebSocket-only (no REST equivalent):

| Category | Messages | Rationale |
|----------|----------|-----------|
| AI Streaming | `discussion_message`, `response_*`, `tool_*` | Chunked responses require persistent connection |
| Interactive | `tool_permission_*`, `ask_user_question_*` | Bidirectional request-response during stream |
| Session | `select_vault`, `resume_session`, `new_session`, `abort` | Establishes streaming context |
| Progress | `index_progress`, `trigger_extraction` | Long-running with incremental updates |
| Pair Writing | `quick_action_request`, `advisory_action_request` | Claude streams responses with tool use |
| Utility | `ping/pong` | Keepalive for idle connections |

These remain in `websocket-handler.ts` unchanged. The handler will shrink but not be removed.

## Technical Decisions

### TD-1: Route Structure
**Choice**: `/api/vaults/:vaultId/[resource]` pattern
**Requirements**: REQ-F-3, REQ-F-5 through REQ-F-40
**Rationale**:
- Vault ID in path (not query) makes routes RESTful and cacheable
- Matches existing `/vault/:vaultId/upload` and `/vault/:vaultId/assets/*` patterns
- Path-based vault ID eliminates connection state dependency (core goal)

### TD-2: Shared Business Logic
**Choice**: Reuse existing `handlers/*.ts` functions, adapt signatures for REST
**Requirements**: REQ-F-64, REQ-NF-3
**Rationale**:
- Handler functions already accept `vaultPath`/`VaultInfo` as parameters
- Functions like `listDirectory`, `readMarkdownFile` are pure business logic
- REST routes call same functions as WebSocket handlers (no duplication)
- Only change: REST routes construct `VaultInfo` from path param instead of `ConnectionState`

### TD-3: Vault Resolution Middleware
**Choice**: Create Hono middleware that resolves `:vaultId` to `VaultInfo`
**Requirements**: REQ-F-3, REQ-F-55, REQ-NF-6
**Rationale**:
- Every REST endpoint needs vault lookup; middleware avoids repetition
- Middleware returns 404 if vault not found (REQ-F-55)
- Middleware validates vault ID format before filesystem access
- Pattern: `c.set("vault", vaultInfo)` for downstream handlers

### TD-4: Error Response Format
**Choice**: JSON error responses matching WebSocket `error` message schema
**Requirements**: REQ-F-4, REQ-F-55-59, REQ-NF-3
**Rationale**:
- Existing frontend already handles `{ type: "error", code, message }` format
- REST errors use same `ErrorCode` enum (FILE_NOT_FOUND, PATH_TRAVERSAL, etc.)
- HTTP status codes map to error codes: 404 → FILE_NOT_FOUND, 403 → PATH_TRAVERSAL
- Response body: `{ error: { code: ErrorCode, message: string } }`

### TD-5: Meeting State Persistence
**Choice**: In-memory Map keyed by vaultId (not ConnectionState)
**Requirements**: REQ-F-23, REQ-F-24, REQ-F-25
**Rationale**:
- Currently: `ConnectionState.activeMeeting` (lost on disconnect)
- New: `Map<vaultId, ActiveMeeting>` in meeting-capture.ts
- Single meeting per vault (business rule already exists)
- No database needed; meeting state is ephemeral (survives reconnect, not restart)

### TD-6: Frontend API Client Pattern
**Choice**: Domain-specific hooks matching existing `useFileUpload` pattern
**Requirements**: REQ-F-63
**Rationale**:
- Existing `useFileUpload` shows the pattern: hook returns async function + loading/error state
- Create hooks per domain: `useFileBrowser`, `useCapture`, `useTasks`, `useSearch`
- Hooks internally call `fetch()` with vault ID from context
- Components become simpler: just call hook functions, check loading/error

### TD-7: Incremental Migration Strategy
**Choice**: Migrate by domain with temporary parallel support
**Requirements**: REQ-NF-5 (backward compatibility during transition)
**Rationale**:
- Migration order: File Browser → Capture → Home → Search → Config → Meeting
- Each domain is self-contained; frontend can use REST while others still use WebSocket
- WebSocket handlers remain until that domain's frontend is migrated
- Allows testing each domain in isolation before moving to next

### TD-8: URL-Encoded Path Handling
**Choice**: Use wildcard routes (`/files/*`) and decode paths in middleware
**Requirements**: REQ-F-60
**Rationale**:
- File paths can contain spaces, special characters
- Hono wildcard captures entire path including encoded characters
- Middleware decodes once; handlers receive clean paths
- Example: `GET /api/vaults/abc/files/My%20Folder/notes.md` → `path = "My Folder/notes.md"`

### TD-9: Protocol Cleanup
**Choice**: Remove migrated message types from WebSocket protocol after frontend migration completes
**Requirements**: REQ-F-61, REQ-F-62
**Rationale**:
- During migration: both REST and WebSocket handlers exist (REQ-NF-5)
- After migration: remove WebSocket schemas for migrated operations from `shared/protocol.ts`
- Remove corresponding handler cases from `websocket-handler.ts`
- Cleanup happens per-domain after that domain's frontend migration is verified
- Order: Code cleanup follows frontend migration by one release cycle

## Data Model

### Meeting State Store
```typescript
// New: backend/src/meeting-store.ts
const activeMeetings = new Map<string, ActiveMeeting>();

export function getMeeting(vaultId: string): ActiveMeeting | null;
export function setMeeting(vaultId: string, meeting: ActiveMeeting): void;
export function clearMeeting(vaultId: string): void;
```

### REST Response Types
No new types needed. REST responses use existing protocol schemas:
- `DirectoryListing` → `{ path, entries }` (same as WebSocket)
- `FileContent` → `{ path, content, truncated }`
- Error → `{ error: { code, message } }`

## API Design

### Route Organization
```
backend/src/routes/
├── index.ts              # Route registration
├── files.ts              # REQ-F-5 to REQ-F-15 (file browser)
├── capture.ts            # REQ-F-16 to REQ-F-18
├── home.ts               # REQ-F-19 to REQ-F-22 (goals, tasks, inspiration)
├── meetings.ts           # REQ-F-23 to REQ-F-25
├── search.ts             # REQ-F-26 to REQ-F-28
├── config.ts             # REQ-F-29 to REQ-F-34
├── memory.ts             # REQ-F-35 to REQ-F-39
└── sessions.ts           # REQ-F-40
```

### Key Endpoints (representative examples)

**File Browser** (REQ-F-5, REQ-F-6, REQ-F-7):
```
GET  /api/vaults/:vaultId/files?path=dir     → directory_listing response
GET  /api/vaults/:vaultId/files/*            → file_content response
PUT  /api/vaults/:vaultId/files/*            → file_written response
```

**Capture** (REQ-F-16):
```
POST /api/vaults/:vaultId/capture
Body: { text: string }
Response: { success, timestamp, notePath } or { error }
```

**Meetings** (REQ-F-23, REQ-F-24, REQ-F-25):
```
POST   /api/vaults/:vaultId/meetings         → meeting_started response
DELETE /api/vaults/:vaultId/meetings/current → meeting_stopped response
GET    /api/vaults/:vaultId/meetings/current → meeting_state response
```

### Frontend Hooks

```typescript
// Example: frontend/src/hooks/useFileBrowser.ts
function useFileBrowser(vaultId: string) {
  return {
    listDirectory: (path: string) => Promise<DirectoryListing>,
    readFile: (path: string) => Promise<FileContent>,
    writeFile: (path: string, content: string) => Promise<void>,
    // ... other operations
    isLoading: boolean,
    error: string | null,
  };
}
```

## Integration Points

| System | Integration | Notes |
|--------|-------------|-------|
| `vault-manager.ts` | Used by vault resolution middleware | `discoverVaults()` already exists |
| `file-browser.ts` | Called by REST file routes | Functions already vault-path-based |
| `note-capture.ts` | Called by capture routes | `captureToDaily()` takes VaultInfo |
| `meeting-capture.ts` | Refactor state to module-level Map | Currently in ConnectionState |
| `search/search-index.ts` | Create index per vault on demand | Currently in ConnectionState |
| `shared/protocol.ts` | Add REST-specific schemas | Request body validation |

## Error Handling, Performance, Security

### Error Strategy
- Middleware catches errors, maps to HTTP status + JSON body
- `FileBrowserError` → appropriate 4xx with code
- Unknown errors → 500 with generic message (no stack traces)
- Logging: errors logged server-side with context

### Performance Targets
- File operations: <200ms (REQ-NF-1) - local filesystem, already fast
- Search operations: <500ms (REQ-NF-2) - index is in-memory
- No additional caching needed; operations are stateless reads/writes

### Security Measures
- Path traversal: reuse existing `isPathWithinVault()` from file-browser.ts (REQ-NF-6)
- Vault ID validation: middleware checks vault exists before any operation
- No sensitive data in error messages
- CORS: extend existing `/api/*` CORS config to new routes

## Testing Strategy

### Unit Tests
- Route handlers: mock `VaultInfo` and handler functions
- Middleware: test vault resolution, error mapping
- Meeting store: test Map operations

### Integration Tests (REQ-NF-4)
Per acceptance test in spec:
1. File Browser Without WebSocket: navigate, read, write via REST
2. Capture Without WebSocket: POST note, verify response
3. Search Without WebSocket: search files/content, get snippets
4. Error Handling: 404 for missing vault/file, 400 for bad request, 403 for traversal

### Migration Validation
- Run both WebSocket and REST for same operation, compare responses
- Ensure response schemas match (REQ-NF-3)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Meeting state lost on server restart | M | L | Document as known limitation; meetings are short-lived |
| Search index recreation on each REST call | M | M | Cache index per vault in module-level Map (like meetings) |
| Frontend/backend response schema drift | L | M | Share Zod schemas; type-check responses |
| Migration breaks existing functionality | M | H | Incremental rollout; keep WebSocket handlers during transition |
| Vault lookup overhead per REST request | L | L | `discoverVaults()` already cached; single Map lookup per request |
| Index cache memory growth (many vaults) | L | M | Implement LRU eviction if >10 vaults cached; monitor in production |
| Frontend race conditions during migration | L | L | Components already independent; no implicit ordering assumed |

## Dependencies

### Technical
- None new. Uses existing: Hono, Zod, TypeScript

### Infrastructure
- None. REST uses same HTTP server as WebSocket upgrade

### Team
- None. Self-contained refactor.

## Open Questions

All resolved in spec. No new technical questions.

---

**Next Phase**: Once approved, use `/spiral-grove:task-breakdown` to decompose into implementable tasks.
