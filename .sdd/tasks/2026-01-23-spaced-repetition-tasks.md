---
specification: [.sdd/specs/2026-01-23-spaced-repetition.md](./../specs/2026-01-23-spaced-repetition.md)
plan: [.sdd/plans/2026-01-23-spaced-repetition-plan.md](./../plans/2026-01-23-spaced-repetition-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2026-01-23
last_updated: 2026-01-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Spaced Repetition - Task Breakdown

## Task Summary
Total: 12 tasks | Complexity Distribution: 4×S, 5×M, 3×L

## Foundation Layer

### TASK-001: Card Schema and Storage Utilities
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create Zod schemas for card metadata and utility functions for reading/writing card files with atomic operations.

**Acceptance Criteria**:
- [ ] `CardMetadataSchema` validates all fields per plan (id, type, dates, SM-2 fields, source_file)
- [ ] `parseCardFile()` extracts frontmatter and body (question/answer sections)
- [ ] `writeCardFile()` uses temp+rename atomic write pattern
- [ ] `getCardsDir()` and `getArchiveDir()` resolve paths from vault info
- [ ] Directory creation on first write (cards/ and cards/archive/)
- [ ] Unit tests for schema validation, parse/write roundtrip

**Files**:
- Create: `backend/src/spaced-repetition/card-schema.ts`
- Create: `backend/src/spaced-repetition/card-storage.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-schema.test.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-storage.test.ts`

**Testing**: Unit tests for schema validation edge cases, file operations in temp directory

---

### TASK-002: SM-2 Algorithm Implementation
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Implement SM-2 spaced repetition algorithm as pure functions for calculating next review parameters.

**Acceptance Criteria**:
- [ ] `calculateSM2()` accepts current card state and response (again/hard/good/easy)
- [ ] Returns updated `{ interval, ease_factor, repetitions, next_review }`
- [ ] "again" resets interval to 1, decreases ease (min 1.3)
- [ ] "hard" increases interval slightly, decreases ease slightly
- [ ] "good" multiplies interval by ease_factor
- [ ] "easy" increases interval significantly, increases ease
- [ ] Default ease_factor is 2.5, minimum is 1.3
- [ ] Unit tests validate against SM-2 reference implementation values

**Files**:
- Create: `backend/src/spaced-repetition/sm2-algorithm.ts`
- Create: `backend/src/spaced-repetition/__tests__/sm2-algorithm.test.ts`

**Testing**: Test all four response types across multiple review cycles, verify against known SM-2 reference values

---

### TASK-003: Card Manager Core Operations
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-001, TASK-002

**Description**: Implement CardManager with CRUD operations for cards and SM-2 review processing.

**Acceptance Criteria**:
- [ ] `getDueCards(vault)` returns cards where next_review <= today, sorted ascending
- [ ] `getCard(vault, cardId)` returns full card including question/answer
- [ ] `submitReview(vault, cardId, response)` applies SM-2 and updates card file
- [ ] `archiveCard(vault, cardId)` moves file to archive directory
- [ ] `createCard(vault, cardData)` generates UUID, writes new card file
- [ ] Handles invalid card files gracefully (skip with warning log)
- [ ] Unit tests for each operation

**Files**:
- Create: `backend/src/spaced-repetition/card-manager.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-manager.test.ts`

**Testing**: Integration tests with real filesystem in temp directory

---

## API Layer

### TASK-004: Card REST API Routes
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-003

**Description**: Create REST endpoints for card operations under `/api/vaults/:vaultId/cards/`.

**Acceptance Criteria**:
- [ ] `GET /cards/due` returns due cards with question preview
- [ ] `GET /cards/:cardId` returns full card detail with answer
- [ ] `POST /cards/:cardId/review` accepts response body, returns updated schedule
- [ ] `POST /cards/:cardId/archive` moves card to archive, returns confirmation
- [ ] Routes use existing vault middleware for path resolution
- [ ] Error responses use existing ErrorCodeSchema pattern
- [ ] Routes mounted in server.ts

**Files**:
- Create: `backend/src/routes/cards.ts`
- Create: `backend/src/__tests__/routes-cards.test.ts`
- Modify: `backend/src/server.ts` (mount routes)

**Testing**: Integration tests for all endpoints with mock vault

---

### TASK-005: useCards React Hook
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-004

**Description**: Create React hook for card API operations following existing useHome pattern.

**Acceptance Criteria**:
- [ ] `getDueCards()` fetches and returns due cards
- [ ] `getCard(cardId)` fetches full card detail
- [ ] `submitReview(cardId, response)` posts review, returns updated card
- [ ] `archiveCard(cardId)` archives card
- [ ] `isLoading`, `error`, `clearError` state management
- [ ] Accepts optional fetch function for testing (dependency injection)

**Files**:
- Create: `frontend/src/hooks/useCards.ts`
- Create: `frontend/src/hooks/__tests__/useCards.test.ts`

**Testing**: Unit tests with mock fetch, verify API calls and state transitions

---

## Widget Layer

### TASK-006: SpacedRepetitionWidget Component
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-005

**Description**: Create the review widget UI with question display, answer input, and self-assessment buttons.

**Acceptance Criteria**:
- [ ] Displays header "Spaced Repetition: N cards" when cards due
- [ ] Shows current question as markdown with source link
- [ ] Answer input field with placeholder "Type your answer..."
- [ ] Action buttons: Skip, Forget (with confirm), Show Answer
- [ ] After reveal: self-assessment buttons Again/Hard/Good/Easy
- [ ] Skip moves card to end of queue (in-memory)
- [ ] Completion state shows "Great job today!" when queue empty
- [ ] Touch-friendly buttons (44x44px minimum)
- [ ] Keyboard shortcuts 1/2/3/4 for assessment

**Files**:
- Create: `frontend/src/components/SpacedRepetitionWidget.tsx`
- Create: `frontend/src/components/SpacedRepetitionWidget.css`
- Create: `frontend/src/components/__tests__/SpacedRepetitionWidget.test.tsx`

**Testing**: Component tests for all states (loading, reviewing, revealed, complete)

---

### TASK-007: Widget Integration in HomeView
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-006

**Description**: Integrate SpacedRepetitionWidget into HomeView, loading due cards on mount.

**Acceptance Criteria**:
- [ ] Widget loads due cards when HomeView mounts (via useCards)
- [ ] Widget renders between InspirationCard and GoalsCard
- [ ] Widget hidden when no cards due (count = 0)
- [ ] Widget always visible on Ground page when cards exist

**Files**:
- Modify: `frontend/src/components/HomeView.tsx`
- Modify: `frontend/src/components/__tests__/HomeView.test.tsx`

**Testing**: Verify widget renders conditionally based on due card count

---

## Discovery Layer

### TASK-008: Card Discovery State Management
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Implement state persistence for card discovery tracking (which files processed, when).

**Acceptance Criteria**:
- [ ] `CardDiscoveryStateSchema` with lastDailyRun, lastWeeklyRun, processedFiles, weeklyProgress
- [ ] `readDiscoveryState()` loads from `~/.config/memory-loop/card-discovery-state.json`
- [ ] `writeDiscoveryState()` uses atomic write pattern
- [ ] `isFileProcessed(path, checksum)` checks against state
- [ ] `markFileProcessed(path, checksum)` updates state
- [ ] Returns empty state on first run (file doesn't exist)

**Files**:
- Create: `backend/src/spaced-repetition/card-discovery-state.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-discovery-state.test.ts`

**Testing**: Unit tests for state read/write, checksum comparison

---

### TASK-009: LLM Card Generator
**Priority**: Medium | **Complexity**: L | **Dependencies**: TASK-001

**Description**: Implement LLM-based Q&A card extraction from vault content using Haiku.

**Acceptance Criteria**:
- [ ] `CardTypeGenerator` interface with `type` and `generate()` method
- [ ] `QACardGenerator` implements interface for Q&A extraction
- [ ] Uses existing `getSdkQuery()` pattern from inspiration-manager
- [ ] Prompt extracts Q&A pairs from content (question + expected answer)
- [ ] Returns array of card content (may generate 0-N cards per file)
- [ ] Handles generation failures gracefully (log, return empty)

**Files**:
- Create: `backend/src/spaced-repetition/card-generator.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-generator.test.ts`

**Testing**: Unit tests with mock SDK, verify prompt structure and response parsing

---

### TASK-010: Card Discovery Scheduler
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-003, TASK-008, TASK-009

**Description**: Implement scheduled card discovery with daily and weekly passes.

**Acceptance Criteria**:
- [ ] Daily pass: processes files modified in last 24 hours
- [ ] Weekly catch-up: processes oldest unprocessed files (500KB per run)
- [ ] Cron scheduling (default: daily at 3am, configurable via env)
- [ ] Catch-up on startup if last run > 24 hours ago
- [ ] Tracks processed files via checksum (idempotent)
- [ ] Logs discovery progress and errors
- [ ] Creates cards via CardManager for each extracted Q&A

**Files**:
- Create: `backend/src/spaced-repetition/card-discovery-scheduler.ts`
- Create: `backend/src/spaced-repetition/__tests__/card-discovery-scheduler.test.ts`
- Modify: `backend/src/server.ts` (start scheduler)

**Testing**: Integration tests with mock filesystem and SDK

---

## Protocol Layer

### TASK-011: Shared Card Schemas
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-004

**Description**: Add card-related schemas to shared protocol for type-safe API communication.

**Acceptance Criteria**:
- [ ] `DueCardSchema` for GET /due response items
- [ ] `CardDetailSchema` for GET /:cardId response
- [ ] `ReviewRequestSchema` for POST /review body
- [ ] `ReviewResponseSchema` for POST /review response
- [ ] Export TypeScript types inferred from schemas

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Schema validation via existing protocol test patterns

---

## Integration Layer

### TASK-012: End-to-End Integration and Manual Testing
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-007, TASK-010

**Description**: Verify complete flow from card discovery through review, document manual test procedures.

**Acceptance Criteria**:
- [ ] Manual test: Create vault note → discovery generates cards → cards appear in widget
- [ ] Manual test: Review flow (answer, assess, next card)
- [ ] Manual test: Skip moves to end of queue
- [ ] Manual test: Forget archives card (check cards/archive/)
- [ ] Manual test: Completion state when all cards reviewed
- [ ] Verify 500ms widget load time target
- [ ] Update docs/usage/ground.md with widget documentation

**Files**:
- Modify: `docs/usage/ground.md`

**Testing**: Manual validation checklist execution

---

## Dependency Graph

```
TASK-001 (Schema) ──┬──> TASK-003 (Manager) ──> TASK-004 (API) ──> TASK-005 (Hook) ──> TASK-006 (Widget) ──> TASK-007 (Integration)
                    │                                    │
TASK-002 (SM-2) ────┘                                    └──> TASK-011 (Shared)
                    │
                    └──> TASK-008 (State) ──┬
                                            ├──> TASK-010 (Scheduler)
TASK-009 (Generator) ───────────────────────┘
                                                              │
                                                              v
                                                         TASK-012 (E2E)
```

## Implementation Order

**Phase 1 - Foundation** (Can parallelize):
- TASK-001: Card Schema and Storage
- TASK-002: SM-2 Algorithm
- TASK-008: Discovery State Management
- TASK-009: LLM Card Generator

**Phase 2 - Core Backend**:
- TASK-003: Card Manager (requires TASK-001, TASK-002)
- TASK-004: REST API Routes (requires TASK-003)
- TASK-011: Shared Schemas (requires TASK-004)

**Phase 3 - Frontend**:
- TASK-005: useCards Hook (requires TASK-004)
- TASK-006: Widget Component (requires TASK-005)
- TASK-007: HomeView Integration (requires TASK-006)

**Phase 4 - Discovery**:
- TASK-010: Discovery Scheduler (requires TASK-003, TASK-008, TASK-009)

**Phase 5 - Validation**:
- TASK-012: E2E Integration (requires TASK-007, TASK-010)

## Notes

- **Parallelization**: Phase 1 tasks (001, 002, 008, 009) can all run in parallel
- **Critical path**: TASK-001 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-012
- **Risk mitigation**: TASK-009 (LLM generation) can be deferred; manual card creation (REQ-F-14) provides fallback
