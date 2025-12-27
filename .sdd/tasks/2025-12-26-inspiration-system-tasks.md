---
specification: [.sdd/specs/inspiration-system.md](./../specs/inspiration-system.md)
plan: [.sdd/plans/2025-12-26-inspiration-system-plan.md](./../plans/2025-12-26-inspiration-system-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Inspiration System - Task Breakdown

## Task Summary
Total: 12 tasks | Complexity Distribution: 4xS, 6xM, 2xL

## Foundation (Protocol & Shared Types)

### TASK-001: Add Inspiration Protocol Types
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add Zod schemas and TypeScript types for inspiration WebSocket messages to the shared protocol.

**Acceptance Criteria**:
- [ ] `InspirationItemSchema` with `text: string` and optional `attribution: string`
- [ ] `GetInspirationMessageSchema` with `type: "get_inspiration"`
- [ ] `InspirationMessageSchema` with `contextual: InspirationItem | null` and `quote: InspirationItem`
- [ ] Add schemas to `ClientMessageSchema` and `ServerMessageSchema` discriminated unions
- [ ] Export inferred TypeScript types
- [ ] Unit tests for schema validation (valid/invalid payloads)

**Files**: Modify: `shared/src/protocol.ts`, `shared/src/__tests__/protocol.test.ts`

**Testing**: `bun test shared/src/__tests__/protocol.test.ts`

---

## Backend (Inspiration Manager)

### TASK-002: Create Inspiration File Parser
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Implement markdown list parsing for inspiration files with `-- Source` attribution format.

**Acceptance Criteria**:
- [ ] Parse lines matching `- "Quote text" -- Source` with attribution
- [ ] Parse lines matching `- "Quote text"` without attribution
- [ ] Skip malformed lines gracefully (no errors)
- [ ] Parse generation marker `<!-- last-generated: YYYY-MM-DD -->` from first line
- [ ] Return empty array for missing/empty files
- [ ] Handle UTF-8 content correctly

**Files**: Create: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Unit tests covering valid entries, invalid lines, empty file, missing file, mixed content

---

### TASK-003: Implement Generation Freshness Checks
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Implement logic to determine if contextual/quote generation is needed based on date markers.

**Acceptance Criteria**:
- [ ] `isContextualGenerationNeeded(vaultPath)`: returns true if weekday AND not generated today
- [ ] `isQuoteGenerationNeeded(vaultPath)`: returns true if not generated this ISO week
- [ ] Parse `<!-- last-generated: YYYY-MM-DD -->` marker for contextual
- [ ] Parse `<!-- last-generated: YYYY-MM-DD (week NN) -->` marker for quotes
- [ ] Return true if marker missing or file doesn't exist
- [ ] Use server's local date/timezone consistently

**Files**: Modify: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Unit tests with mocked dates for weekday/weekend, same-day, same-week, different-week

---

### TASK-004: Implement Day-Specific Context Gathering
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-002

**Description**: Gather vault content for contextual prompt generation based on day of week.

**Acceptance Criteria**:
- [ ] `DAY_CONTEXT_CONFIG` constant defining day-to-source mapping
- [ ] Tuesday-Thursday: Read previous day's daily note from `00_Inbox/YYYY-MM-DD.md`
- [ ] Monday: Read previous week's daily notes (7 days) + `01_Projects/*/README.md` or `index.md`
- [ ] Friday: Read current week's daily notes (5 days) + `02_Areas/*/README.md` or `index.md`
- [ ] Cap total context at ~800 tokens (~3200 chars)
- [ ] Truncate oldest content first when exceeding token budget
- [ ] Return empty string gracefully if no files found
- [ ] Assume claudesidian PARA structure with numbered folders

**Files**: Modify: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Unit tests with temp directories containing mock vault structure

---

### TASK-005: Implement Haiku Generation for Prompts and Quotes
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-003, TASK-004

**Description**: Generate contextual prompts and inspirational quotes using Claude Haiku via Agent SDK.

**Acceptance Criteria**:
- [ ] `generateContextualPrompts(vaultPath, context)`: generates 5 prompts referencing vault content
- [ ] `generateInspirationQuote()`: generates 1 quote with attribution from historical wisdom
- [ ] Use `claude-3-haiku` model for cost efficiency
- [ ] Use single-turn `query()` with only model parameter (no streaming, extended thinking, or conversation context)
- [ ] Return structured output parseable as markdown list
- [ ] Cap input tokens at ~1000 per generation
- [ ] Handle SDK errors gracefully (log, return empty)

**Files**: Modify: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Unit tests with mocked SDK responses; integration test with `MOCK_SDK=true`

---

### TASK-006: Implement Pool Management and File Writing
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002, TASK-005

**Description**: Append generated content to files and prune pools to 50 entries max.

**Acceptance Criteria**:
- [ ] `appendToInspirationFile(path, entries)`: appends new entries, updates generation marker
- [ ] `prunePool(path, maxSize)`: removes oldest entries if pool exceeds limit
- [ ] Create `06_Metadata/memory-loop/` directory if missing
- [ ] Preserve existing entries when appending
- [ ] Apply pruning after append (cap at 50)
- [ ] Update `<!-- last-generated: ... -->` marker with current date

**Files**: Modify: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Unit tests for append, prune at boundary, prune over limit, directory creation

---

### TASK-007: Implement Main Inspiration Handler
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002 through TASK-006

**Description**: Orchestrate the full inspiration flow: check freshness, generate if needed, parse, select random, return.

**Acceptance Criteria**:
- [ ] `getInspiration(vaultPath)`: returns `{ contextual, quote }`
- [ ] Check and trigger contextual generation if needed (weekday only)
- [ ] Check and trigger quote generation if needed (once per week)
- [ ] Parse files after generation completes
- [ ] Select random item from each pool
- [ ] Define hardcoded fallback quote constant in module
- [ ] Return fallback quote if inspiration file missing/empty
- [ ] Return `null` for contextual if file missing/empty (hide section)
- [ ] Generation failures don't block response (log, use existing content)

**Files**: Modify: `backend/src/inspiration-manager.ts`, `backend/src/__tests__/inspiration-manager.test.ts`

**Testing**: Integration tests covering full flow with mocked SDK

---

### TASK-008: Integrate Inspiration Handler with WebSocket
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001, TASK-007

**Description**: Add `get_inspiration` message handler to WebSocket router.

**Acceptance Criteria**:
- [ ] Handle `get_inspiration` message type in `routeMessage`
- [ ] Call `getInspiration(vault.path)` from inspiration-manager
- [ ] Send `inspiration` response with contextual and quote
- [ ] Require vault selection (return VAULT_NOT_FOUND if no vault)
- [ ] Log errors but never send error response (inspiration is optional)

**Files**: Modify: `backend/src/websocket-handler.ts`, `backend/src/__tests__/websocket-handler.test.ts`

**Testing**: WebSocket handler tests with mock inspiration-manager

---

## Frontend (SessionContext & Components)

### TASK-009: Add Discussion Prefill to SessionContext
**Priority**: High | **Complexity**: S | **Dependencies**: None

**Description**: Extend SessionContext with `discussionPrefill` state for click-to-discuss flow.

**Acceptance Criteria**:
- [ ] Add `discussionPrefill: string | null` to `SessionState`
- [ ] Add `setDiscussionPrefill: (text: string | null) => void` to `SessionActions`
- [ ] Add `SET_DISCUSSION_PREFILL` action to reducer
- [ ] Clear prefill on vault change (same as other state)
- [ ] No localStorage persistence (transient state)

**Files**: Modify: `frontend/src/contexts/SessionContext.tsx`, `frontend/src/contexts/__tests__/SessionContext.test.tsx`

**Testing**: Unit tests for set/clear prefill, prefill cleared on vault change

---

### TASK-010: Create InspirationCard Component
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001, TASK-009

**Description**: Display contextual prompt and inspirational quote with click-to-discuss behavior.

**Acceptance Criteria**:
- [ ] Show contextual prompt (top) and quote (bottom) when both present
- [ ] Show only quote if contextual is null
- [ ] Display attribution with `-- Source` format when present
- [ ] Click handler: set prefill text, switch to discussion mode
- [ ] Match glassmorphism card style from RecentActivity
- [ ] BEM CSS naming: `inspiration-card__prompt`, `inspiration-card__quote`, etc.
- [ ] Loading state while fetching (subtle, not blocking)

**Files**: Create: `frontend/src/components/InspirationCard.tsx`, `frontend/src/components/InspirationCard.css`, `frontend/src/components/__tests__/InspirationCard.test.tsx`

**Testing**: Unit tests for both items, only quote, click handlers, loading state

---

### TASK-011: Integrate InspirationCard with HomeView
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-008, TASK-010

**Description**: Add InspirationCard to HomeView and wire up WebSocket fetch.

**Acceptance Criteria**:
- [ ] Send `get_inspiration` after `session_ready` (parallel with other requests)
- [ ] Handle `inspiration` response and pass data to InspirationCard
- [ ] Place InspirationCard between context card and quick actions
- [ ] Re-fetch on reconnect (same pattern as recent_activity)

**Files**: Modify: `frontend/src/components/HomeView.tsx`, `frontend/src/components/__tests__/HomeView.test.tsx`

**Testing**: Integration tests for WebSocket flow and component rendering

---

### TASK-012: Handle Prefill in Discussion Component
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-009

**Description**: Discussion component consumes prefill text on mount and clears it.

**Acceptance Criteria**:
- [ ] Read `discussionPrefill` from SessionContext on mount
- [ ] If prefill present, populate input field with text
- [ ] Clear prefill immediately after populating (call `setDiscussionPrefill(null)`)
- [ ] Prefill takes precedence over localStorage draft
- [ ] User must still click send (not auto-submit)

**Files**: Modify: `frontend/src/components/Discussion.tsx`, `frontend/src/components/__tests__/Discussion.test.tsx`

**Testing**: Unit tests for prefill population, prefill clearing, precedence over draft

---

## Dependency Graph
```
TASK-001 ─────────────────────────────────> TASK-008
                                               │
                                               ▼
TASK-002 ──┬─> TASK-003 ──┐                TASK-011
           │              ▼
           ├─> TASK-004 ─> TASK-005 ──┐
           │                          ▼
           └─> TASK-006 ────────────> TASK-007 ──> TASK-008
                                                      │
                                                      ▼
TASK-009 ──┬─> TASK-010 ─────────────────────────> TASK-011
           │
           └─> TASK-012
```

## Implementation Order
**Phase 1** (Foundation): TASK-001, TASK-009 (parallel)
**Phase 2** (Backend Core): TASK-002, then TASK-003, TASK-004, TASK-006 (can parallel after TASK-002)
**Phase 3** (Backend Generation): TASK-005, TASK-007
**Phase 4** (Backend Integration): TASK-008
**Phase 5** (Frontend Components): TASK-010, TASK-012 (parallel)
**Phase 6** (Frontend Integration): TASK-011

## Notes
- **Parallelization**: TASK-001 + TASK-009 can run in parallel. After TASK-002, TASK-003/004/006 can be parallelized. TASK-010 + TASK-012 can run in parallel.
- **Critical path**: TASK-002 → TASK-004 → TASK-005 → TASK-007 → TASK-008 → TASK-011
- **Risk mitigation**: TASK-005 (SDK generation) is the highest-risk task; mock SDK support already exists for testing.
