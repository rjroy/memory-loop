---
specification: [.sdd/specs/2026-01-10-vault-widgets.md](./../specs/2026-01-10-vault-widgets.md)
plan: [.sdd/plans/2026-01-10-vault-widgets-plan.md](./../plans/2026-01-10-vault-widgets-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2026-01-10
last_updated: 2026-01-10
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Widgets - Task Breakdown

## Task Summary
Total: 18 tasks | Complexity Distribution: 5×S, 9×M, 4×L

## Foundation Layer

### TASK-001: Widget Configuration Schema and Loader
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create Zod schemas for widget configuration and implement YAML loader that discovers and validates `.memory-loop/widgets/*.yaml` files.

**Acceptance Criteria**:
- [ ] Zod schemas for `WidgetConfig`, `FieldConfig`, `DimensionConfig`, `DisplayConfig`, `EditableField`
- [ ] `widget-loader.ts` discovers YAML files in `.memory-loop/widgets/`
- [ ] Invalid configs produce actionable error messages with file path and validation details
- [ ] Zero file matches logged as info, not error

**Files**:
- Create: `backend/src/widgets/schemas.ts`
- Create: `backend/src/widgets/widget-loader.ts`

**Testing**: Unit tests for valid/invalid config parsing, missing directory handling

---

### TASK-002: Frontmatter Field Extraction
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Implement frontmatter parsing with dot-notation field access using `gray-matter` and `lodash-es`.

**Acceptance Criteria**:
- [ ] `extractField(content, fieldPath)` returns nested field value (e.g., `bgg.play_count`)
- [ ] Missing fields return `null`
- [ ] Invalid YAML returns parse error

**Files**:
- Create: `backend/src/widgets/frontmatter.ts`

**Testing**: Unit tests for nested paths, missing fields, malformed frontmatter

---

### TASK-003: Aggregation Functions
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Implement collection-level aggregation functions with proper null handling per REQ-F-28.

**Acceptance Criteria**:
- [ ] Aggregator registry with `sum`, `avg`, `count`, `min`, `max`, `stddev`
- [ ] Null/undefined values skipped in sum/avg/min/max/stddev
- [ ] Count includes all items (nulls counted per REQ-F-28)
- [ ] Empty arrays return `null` for avg/min/max/stddev, `0` for sum/count

**Files**:
- Create: `backend/src/widgets/aggregators.ts`

**Testing**: Unit tests for each aggregator with null values, empty arrays, edge cases

---

### TASK-004: Safe Expression Evaluator
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-003

**Description**: Implement expression evaluation using `expr-eval` with custom functions and 1-second timeout.

**Acceptance Criteria**:
- [ ] Expressions can reference `this.*` (current item) and `stats.*` (collection stats)
- [ ] Built-in functions: `abs()`, `round()`, `clamp()`, `zscore()`
- [ ] 1-second timeout per expression (REQ-F-30)
- [ ] Blocked: `require`, `import`, `process`, `global`, `window`, file/network access
- [ ] Security test: expressions with blocked keywords throw clear errors

**Files**:
- Create: `backend/src/widgets/expression-eval.ts`

**Testing**: Unit tests for expressions, custom functions, timeout, security rejection

---

### TASK-005: Similarity Comparators
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Implement similarity computation methods with comparator registry.

**Acceptance Criteria**:
- [ ] Comparator registry with `jaccard`, `proximity`, `cosine`
- [ ] Jaccard: set overlap ratio for array/tag fields
- [ ] Proximity: normalized distance for numeric fields
- [ ] Cosine: vector similarity for multi-dimensional comparison
- [ ] Weights applied per dimension config

**Files**:
- Create: `backend/src/widgets/comparators.ts`

**Testing**: Unit tests for each method with known similarity scores

---

## Caching Layer

### TASK-006: SQLite Cache with WAL Mode
**Priority**: Critical | **Complexity**: L | **Dependencies**: None

**Description**: Implement cache persistence using `bun:sqlite` with WAL mode and in-memory fallback.

**Acceptance Criteria**:
- [ ] Cache stored at `.memory-loop/cache.db` in vault
- [ ] WAL mode enabled with `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL`
- [ ] Schema includes `widget_cache` and `similarity_cache` tables
- [ ] Integrity check on startup (`PRAGMA integrity_check`); corrupted DB deleted and rebuilt
- [ ] In-memory Map fallback when SQLite init fails (logged warning)

**Files**:
- Create: `backend/src/widgets/widget-cache.ts`

**Testing**: Unit tests for get/set/invalidate, corruption recovery, fallback mode

---

### TASK-007: File Watcher with Debounce
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-006

**Description**: Implement file change detection using `chokidar` with configurable debounce.

**Acceptance Criteria**:
- [ ] Watch vault directory for changes to files matching widget glob patterns
- [ ] 500ms debounce (configurable) before triggering recomputation
- [ ] Content hash comparison to skip unchanged files
- [ ] Watcher starts on vault select, stops on deselect

**Files**:
- Create: `backend/src/widgets/file-watcher.ts`

**Testing**: Integration test with temp files, debounce timing, hash comparison

---

## Widget Engine

### TASK-008: Widget Engine Orchestrator
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-001, TASK-003, TASK-004, TASK-005, TASK-006

**Description**: Implement the core widget engine that orchestrates computation, caching, and result formatting.

**Acceptance Criteria**:
- [ ] Two-phase computation: collection stats first, then per-item expressions
- [ ] Stale-while-revalidate: serve cached results while recomputing
- [ ] Route widgets by `location` field (ground vs recall)
- [ ] Recall widgets filtered by source pattern matching current file
- [ ] `isEmpty` flag set when glob matches zero files

**Files**:
- Create: `backend/src/widgets/widget-engine.ts`
- Create: `backend/src/widgets/index.ts` (barrel export)

**Testing**: Integration tests for full computation flow, caching behavior, routing

---

### TASK-009: Similarity Computation with Caching
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-005, TASK-006, TASK-008

**Description**: Implement on-demand similarity computation with cache invalidation on file changes.

**Acceptance Criteria**:
- [ ] `computeSimilarity(widget, sourceItem)` returns top-N similar items
- [ ] Results cached with content version hash
- [ ] Cache invalidated when any source file changes
- [ ] Cached results returned in <100ms (measured via `performance.now()` timing)

**Files**:
- Modify: `backend/src/widgets/widget-engine.ts`

**Testing**: Performance tests for 1000-item collection, cache hit timing

---

## WebSocket Protocol

### TASK-010: Widget Protocol Schemas
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add Zod schemas for widget-related WebSocket messages to shared protocol.

**Acceptance Criteria**:
- [ ] Client messages: `get_ground_widgets`, `get_recall_widgets`, `widget_edit`
- [ ] Server messages: `ground_widgets`, `recall_widgets`, `widget_update`, `widget_error`
- [ ] `WidgetResultSchema` includes `isEmpty`, `emptyReason` fields

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Schema validation tests for each message type

---

### TASK-011: WebSocket Handler Integration
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-008, TASK-010

**Description**: Add widget message handlers to websocket-handler.ts and integrate with vault manager.

**Acceptance Criteria**:
- [ ] Handler for `get_ground_widgets` sends computed ground widgets
- [ ] Handler for `get_recall_widgets` sends widgets for specific file
- [ ] Handler for `widget_edit` updates frontmatter and triggers recomputation
- [ ] File watcher connected on vault select, triggers `widget_update` on changes
- [ ] Widget errors sent via `widget_error` message

**Files**:
- Modify: `backend/src/websocket-handler.ts`
- Modify: `backend/src/vault-manager.ts` (add `widgetsPath` detection)

**Testing**: Integration tests for message flow, edit persistence

---

## Frontend Display

### TASK-012: Widget State in SessionContext
**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-010

**Description**: Extend SessionContext with widget state management following existing patterns.

**Acceptance Criteria**:
- [ ] `WidgetState` with `groundWidgets`, `recallWidgets`, loading flags
- [ ] Reducer actions for widget messages
- [ ] `pendingEdits` map for in-flight edits

**Files**:
- Modify: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Reducer unit tests for widget actions

---

### TASK-013: Widget Display Components
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-012

**Description**: Create widget display components with registry-based dispatch.

**Acceptance Criteria**:
- [ ] `WidgetRenderer` dispatches to type-specific components
- [ ] `SummaryCardWidget`: key-value pairs
- [ ] `TableWidget`: rows/columns with sorting
- [ ] `ListWidget`: ordered items with limit
- [ ] `MeterWidget`: single value with min/max scale
- [ ] Empty state: displays widget name + `emptyReason` text in muted style

**Files**:
- Create: `frontend/src/components/widgets/WidgetRenderer.tsx`
- Create: `frontend/src/components/widgets/SummaryCardWidget.tsx`
- Create: `frontend/src/components/widgets/TableWidget.tsx`
- Create: `frontend/src/components/widgets/ListWidget.tsx`
- Create: `frontend/src/components/widgets/MeterWidget.tsx`
- Create: `frontend/src/components/widgets/index.ts`

**Testing**: Component tests with various widget data shapes

---

### TASK-014: Widget Editing Controls
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-013

**Description**: Implement editable widget controls that persist changes via WebSocket.

**Acceptance Criteria**:
- [ ] Input types: `slider`, `number`, `text`, `date`, `select`
- [ ] Edits send `widget_edit` message with path, field, value
- [ ] Optimistic UI update with rollback on error
- [ ] Debounced input for continuous controls (slider, number)

**Files**:
- Create: `frontend/src/components/widgets/EditableField.tsx`
- Modify: `frontend/src/components/widgets/WidgetRenderer.tsx`

**Testing**: Component tests for each input type, edit flow

---

### TASK-015: Ground Widgets in HomeView
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-013

**Description**: Integrate ground widgets into the Home/Ground view.

**Acceptance Criteria**:
- [ ] Request `get_ground_widgets` on Home view mount
- [ ] Display widgets below existing content (goals, inspiration)
- [ ] Loading skeleton during fetch
- [ ] Widgets update automatically when `widget_update` received

**Files**:
- Modify: `frontend/src/components/modes/HomeView.tsx`

**Testing**: Integration test for widget display in Home view

---

### TASK-016: Recall Widgets in BrowseMode
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-013

**Description**: Integrate recall widgets into Browse/Recall view when viewing matching files.

**Acceptance Criteria**:
- [ ] Request `get_recall_widgets` when file is opened
- [ ] Display widgets in sidebar or below file content
- [ ] Only shown for files matching widget source patterns
- [ ] Widgets update on file save or `widget_update` message

**Files**:
- Modify: `frontend/src/components/modes/BrowseMode.tsx`

**Testing**: Integration test for widget display when browsing files

---

## Integration & Testing

### TASK-017: Test Fixtures and Performance Benchmarks
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-008

**Description**: Create test fixtures and performance benchmarks for widget system.

**Acceptance Criteria**:
- [ ] `backend/__fixtures__/test-vault-widgets/` with sample configs and files
- [ ] `backend/__fixtures__/test-vault-1000/` with 1000 files for performance tests
- [ ] Benchmark: aggregation <1s for 1000 files (REQ-NF-1)
- [ ] Benchmark: similarity <500ms for 1000 items (REQ-NF-2)
- [ ] Benchmark: cached similarity <100ms (REQ-SC-3)

**Files**:
- Create: `backend/__fixtures__/test-vault-widgets/` (directory with sample vault)
- Create: `backend/__fixtures__/test-vault-1000/` (directory with 1000 files)
- Create: `backend/src/__tests__/widget-performance.test.ts`

**Testing**: Performance regression tests run in CI

---

### TASK-018: End-to-End Integration Tests
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-011, TASK-015, TASK-016

**Description**: Create end-to-end tests covering all acceptance tests from spec.

**Acceptance Criteria**:
- [ ] Config discovery on vault connection
- [ ] Simple aggregation returns correct count
- [ ] Z-score computation matches manual calculation
- [ ] Similarity cache hit returns <50ms
- [ ] Cache invalidation on file change
- [ ] Ground widget appears on Home view
- [ ] Recall widget appears for matching file
- [ ] Single-value edit persists and updates widget
- [ ] Invalid config produces actionable error
- [ ] Expression with blocked keywords rejected

**Files**:
- Create: `backend/src/__tests__/widget-integration.test.ts`

**Testing**: All spec acceptance tests covered

---

## Dependency Graph
```
TASK-001 ──┬───────────────────────────────────────────────────> TASK-008
TASK-002 ──┼─> TASK-003 ─> TASK-004 ───────────────────────────> TASK-008
           └─> TASK-005 ───────────────────────────────────────> TASK-008
TASK-006 ──────────────────────────────────────────────────────> TASK-008
                                                                     │
TASK-007 ─────────────────────────────────────────────────────────> TASK-011
TASK-010 ─────────────────────────────────────────────────────────> TASK-011
                                                                     │
TASK-008 ─> TASK-009 ─────────────────────────────────────────────> TASK-011
                                                                     │
TASK-012 ───────────────────────────────────────────────────────────> TASK-013
TASK-013 ─> TASK-014                                                     │
TASK-013 ───────────────────────────────────────────────────────────────> TASK-015
TASK-013 ───────────────────────────────────────────────────────────────> TASK-016
                                                                          │
TASK-008 ─────────────────────────────────────────────────────────────> TASK-017
TASK-011, TASK-015, TASK-016 ─────────────────────────────────────────> TASK-018
```

## Implementation Order

**Phase 1 - Foundation** (can parallelize): TASK-001, TASK-002, TASK-006, TASK-010
**Phase 2 - Computation**: TASK-003, TASK-004, TASK-005, TASK-007
**Phase 3 - Engine**: TASK-008, TASK-009
**Phase 4 - Integration**: TASK-011, TASK-012
**Phase 5 - Frontend**: TASK-013, TASK-014, TASK-015, TASK-016
**Phase 6 - Testing**: TASK-017, TASK-018

## Notes

- **Parallelization**: Phase 1 tasks have no dependencies and can run concurrently
- **Critical path**: TASK-002 → TASK-003 → TASK-004 → TASK-008 → TASK-011 → TASK-018
- **New dependencies**: `gray-matter`, `lodash-es`, `expr-eval`, `chokidar` (bun:sqlite is built-in)
