---
specification: ./../specs/2026-01-15-external-data-sync.md
plan: ./../plans/2026-01-15-external-data-sync-plan.md
status: Draft
version: 1.0.0
created: 2026-01-15
last_updated: 2026-01-15
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# External Data Sync - Task Breakdown

## Task Summary
Total: 14 tasks | Complexity Distribution: 3×S, 8×M, 3×L

## Foundation

### TASK-001: Define Pipeline Configuration Schema
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create Zod schemas for sync pipeline configuration, secrets, and sync metadata. These schemas are the foundation for all other components.

**Acceptance Criteria**:
- [ ] `PipelineConfigSchema` validates YAML structure per plan (name, connector, match, defaults, fields, vocabulary)
- [ ] `SecretsConfigSchema` validates key-value secrets format
- [ ] `SyncMetaSchema` validates `_sync_meta` frontmatter structure
- [ ] `FieldMappingSchema` validates source, target, strategy, normalize fields
- [ ] Merge strategies are constrained to `overwrite | preserve | merge`
- [ ] Schemas export TypeScript types via `z.infer<>`

**Files**:
- Create: `backend/src/sync/schemas.ts`
- Modify: `shared/src/protocol.ts` (add sync message schemas)

**Testing**: Unit tests for valid/invalid config parsing, edge cases (missing optional fields, invalid merge strategies)

---

### TASK-002: Add WebSocket Protocol Messages
**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Add `trigger_sync` and `sync_status` message types to the WebSocket protocol, following existing discriminated union pattern.

**Acceptance Criteria**:
- [ ] `TriggerSyncMessageSchema` with `type: "trigger_sync"`, `mode: "full" | "incremental"`, optional `pipeline`
- [ ] `SyncStatusMessageSchema` with `type: "sync_status"`, status enum, optional progress/errors
- [ ] Schemas added to `ClientMessage` and `ServerMessage` unions
- [ ] TypeScript types export correctly

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Schema validation tests for message parsing

---

### TASK-003: Implement API Connector Interface
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Define the `ApiConnector` interface that all external API connectors must implement. This enables future extensibility (books, movies) without modifying core sync logic.

**Acceptance Criteria**:
- [ ] `ApiConnector` interface with `name`, `fetchById()`, `extractFields()` methods
- [ ] `ApiResponse` type for raw API response data
- [ ] Connector factory function that returns connector by name
- [ ] Exports types for use by BGG connector and sync pipeline

**Files**:
- Create: `backend/src/sync/connector-interface.ts`

**Testing**: Interface compilation (no runtime tests for interface-only file)

---

## Services

### TASK-004: Implement BGG XML API Connector
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-003

**Description**: Create the BGG connector that fetches game data from BGG's XML API v2 and extracts fields per the plan's field mapping table.

**Acceptance Criteria**:
- [ ] Fetches from `https://boardgamegeek.com/xmlapi2/thing?id={id}&stats=1`
- [ ] Parses XML with `fast-xml-parser`
- [ ] Extracts all fields: name, rating, weight, min/max players, min/max playtime, year, mechanics, categories
- [ ] Handles 429 responses with exponential backoff (1s, 2s, 4s, max 30s)
- [ ] Retries up to 3 times before throwing
- [ ] Returns structured data matching `ApiResponse` type

**Files**:
- Create: `backend/src/sync/connectors/bgg-connector.ts`
- Modify: `backend/package.json` (add `fast-xml-parser` dependency)

**Testing**: Unit tests with mocked HTTP responses (success, 429 rate limit, invalid XML, missing fields)

---

### TASK-005: Implement API Response Cache
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-003

**Description**: Create in-memory cache for API responses during a sync run. Cache is scoped per-run and cleared on full sync.

**Acceptance Criteria**:
- [ ] Map-based cache keyed by connector name + ID
- [ ] `get(connector, id)` and `set(connector, id, response)` methods
- [ ] `clear()` method for full sync invalidation
- [ ] Cache is not persistent (in-memory only)

**Files**:
- Create: `backend/src/sync/api-response-cache.ts`

**Testing**: Unit tests for get/set/clear operations

---

### TASK-006: Implement Vocabulary Normalizer
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Create LLM-based vocabulary normalizer using Claude SDK. Maps incoming values to canonical terms from configured vocabulary.

**Acceptance Criteria**:
- [ ] Takes vocabulary mapping (canonical -> variations) and input value
- [ ] Uses Claude SDK to find best matching canonical term
- [ ] Returns canonical term if matched, original value if no match
- [ ] On LLM error (timeout, API failure), returns original value and logs warning
- [ ] Batch normalization support for arrays of values

**Files**:
- Create: `backend/src/sync/vocabulary-normalizer.ts`

**Testing**: Unit tests with mocked Claude SDK (successful match, no match, API failure)

---

### TASK-007: Implement Frontmatter Updater
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Create frontmatter update service that reads files, merges synced data per strategy, and writes atomically.

**Acceptance Criteria**:
- [ ] Reads existing frontmatter using `gray-matter`
- [ ] Applies merge strategies: `overwrite` replaces, `preserve` skips existing, `merge` appends arrays
- [ ] Writes to namespace (e.g., `bgg.rating`) or direct fields based on config
- [ ] Atomic writes via temp file + rename (following `note-capture.ts` pattern)
- [ ] Updates `_sync_meta` with timestamp, source, and source_id

**Files**:
- Create: `backend/src/sync/frontmatter-updater.ts`

**Testing**: Unit tests for each merge strategy, namespace writing, atomic write verification

---

### TASK-008: Implement Pipeline Configuration Loader
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Load and validate pipeline configs from `.memory-loop/sync/*.yaml` and secrets from `.memory-loop/secrets/*.yaml`.

**Acceptance Criteria**:
- [ ] Discovers all `.yaml` files in sync directory
- [ ] Validates each config against `PipelineConfigSchema`
- [ ] Invalid configs logged and skipped (other pipelines continue)
- [ ] Loads secrets separately, wraps in non-enumerable proxy to prevent logging
- [ ] Path traversal validation (stays within vault root)

**Files**:
- Create: `backend/src/sync/config-loader.ts`

**Testing**: Unit tests for valid config loading, invalid config handling, secrets filtering

---

## Orchestration

### TASK-009: Implement Sync Pipeline Manager
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-004, TASK-005, TASK-006, TASK-007, TASK-008

**Description**: Create the main orchestrator that coordinates sync execution across all pipelines.

**Acceptance Criteria**:
- [ ] Loads all valid pipeline configs
- [ ] For each pipeline: glob matches files, filters by frontmatter field presence
- [ ] Fetches data from connector (with caching)
- [ ] Applies normalization to configured fields
- [ ] Updates frontmatter with merge strategies
- [ ] Supports full sync (all files, clear cache) and incremental (skip recent syncs)
- [ ] Reports progress via callback (for WebSocket status updates)
- [ ] Collects per-file errors without stopping overall sync

**Files**:
- Create: `backend/src/sync/sync-pipeline.ts`

**Testing**: Integration tests with mocked connector and filesystem

---

### TASK-010: Implement Sync WebSocket Handlers
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002, TASK-009

**Description**: Add WebSocket message handlers for sync trigger and status reporting.

**Acceptance Criteria**:
- [ ] `handleTriggerSync` validates message, starts sync pipeline
- [ ] Sends `sync_status` updates: `idle`, `syncing` (with progress), `success`, `error`
- [ ] Progress includes current/total files and current file name
- [ ] Error status includes per-file error list
- [ ] Follows existing handler pattern (`HandlerContext`, `requireVault`)

**Files**:
- Create: `backend/src/handlers/sync-handlers.ts`
- Modify: `backend/src/websocket-handler.ts` (add routing)

**Testing**: Unit tests for message handling, status update flow

---

## Integration

### TASK-011: Integrate Sync Pipeline with Backend
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-010

**Description**: Wire up the sync system to the backend server, register handlers, and ensure proper initialization.

**Acceptance Criteria**:
- [ ] Sync handlers registered in `websocket-handler.ts`
- [ ] Sync pipeline manager instantiated on server start
- [ ] Logger configured for sync operations (INFO for progress, WARN for issues, ERROR for failures)
- [ ] Health collector integration for sync errors

**Files**:
- Modify: `backend/src/websocket-handler.ts`
- Modify: `backend/src/server.ts` (if initialization needed)

**Testing**: Integration test for end-to-end WebSocket message flow

---

### TASK-012: Add Frontend Sync UI
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Add sync button and status display to Ground tab settings section.

**Acceptance Criteria**:
- [ ] Sync button in Ground tab settings (follows existing UI patterns)
- [ ] Button states: idle, syncing (with spinner), success, error
- [ ] Error state shows brief message (e.g., "3 files failed")
- [ ] Sends `trigger_sync` message on click
- [ ] Receives and displays `sync_status` updates

**Files**:
- Modify: `frontend/src/components/Ground.tsx` (or relevant Ground settings component)
- Modify: `frontend/src/contexts/SessionContext.tsx` (add sync state if needed)

**Testing**: Component tests for button states, message sending

---

### TASK-013: Create Example Pipeline Configuration
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-008

**Description**: Create documented example pipeline config for BGG sync to serve as reference for users.

**Acceptance Criteria**:
- [ ] Example YAML in `docs/` or as `.example` file
- [ ] Documents all configuration options with comments
- [ ] Includes vocabulary normalization example
- [ ] Covers common use cases (basic sync, preserve fields, namespaced output)

**Files**:
- Create: `docs/sync/bgg-pipeline.example.yaml`

**Testing**: Example parses without errors against schema

---

## Testing

### TASK-014: End-to-End Sync Tests
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-011, TASK-012

**Description**: Create integration tests covering the complete sync workflow including the acceptance tests from the spec.

**Acceptance Criteria**:
- [ ] Test: Basic BGG sync populates frontmatter
- [ ] Test: Vocabulary normalization maps variations to canonical terms
- [ ] Test: Preserve strategy keeps existing values
- [ ] Test: Incremental sync skips recently synced files
- [ ] Test: Rate limit handling with backoff
- [ ] Test: Error reporting shows failed file count
- [ ] Test: Secrets never appear in logs
- [ ] Tests use mocked BGG API (no real network calls)

**Files**:
- Create: `backend/src/__tests__/sync-integration.test.ts`

**Testing**: All spec acceptance tests (1-10) covered

---

## Dependency Graph
```
TASK-001 ──┬──> TASK-002 ──> TASK-010 ──> TASK-011
           │                              ↑
           ├──> TASK-003 ──> TASK-004 ────┤
           │              └──> TASK-005 ──┤
           │                              │
           ├──> TASK-007 ─────────────────┤
           │                              │
           └──> TASK-008 ──> TASK-009 ────┘
                              ↑
TASK-006 ─────────────────────┘

TASK-002 ──> TASK-012

TASK-008 ──> TASK-013

TASK-011, TASK-012 ──> TASK-014
```

## Implementation Order

**Phase 1** (Foundation): TASK-001, TASK-002, TASK-003, TASK-006
- All parallelizable, no dependencies
- Establishes types and interfaces

**Phase 2** (Services): TASK-004, TASK-005, TASK-007, TASK-008
- TASK-004 depends on TASK-003
- Others can start after TASK-001
- Build core service components

**Phase 3** (Orchestration): TASK-009, TASK-010
- Requires all services complete
- Creates main sync flow

**Phase 4** (Integration): TASK-011, TASK-012, TASK-013
- TASK-011 and TASK-012 can parallelize
- TASK-013 is independent documentation

**Phase 5** (Validation): TASK-014
- Requires full integration
- Validates all spec acceptance criteria

## Notes

- **Parallelization**: Phase 1 tasks are fully parallel. Phase 2 has partial parallelism (TASK-005, TASK-007, TASK-008 can run concurrently after TASK-001).
- **Critical path**: TASK-001 → TASK-003 → TASK-004 → TASK-009 → TASK-010 → TASK-011 → TASK-014
- **External dependency**: `fast-xml-parser` package needed for TASK-004
