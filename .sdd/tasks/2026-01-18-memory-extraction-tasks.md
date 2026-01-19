---
specification: [.sdd/specs/2026-01-18-memory-extraction.md](./../specs/2026-01-18-memory-extraction.md)
plan: [.sdd/plans/2026-01-18-memory-extraction-plan.md](./../plans/2026-01-18-memory-extraction-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2026-01-18
last_updated: 2026-01-18
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Memory Extraction System - Task Breakdown

## Task Summary
Total: 14 tasks | Complexity Distribution: 4×S, 7×M, 3×L

## Foundation

### TASK-001: Create Extraction State Data Model
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Define TypeScript interfaces and Zod schemas for extraction state tracking.

**Acceptance Criteria**:
- [ ] `ExtractionState` and `ProcessedTranscript` interfaces defined
- [ ] Zod schemas for validation
- [ ] State file read/write utilities with JSON persistence
- [ ] SHA-256 checksum calculation for transcript content

**Files**:
- Create: `backend/src/extraction/extraction-state.ts`

**Testing**: Unit tests for state serialization, checksum calculation, and file I/O

---

### TASK-002: Create Default Extraction Prompt
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Write the default extraction prompt that defines fact categories and output format.

**Acceptance Criteria**:
- [ ] Prompt defines all categories: Identity, Goals, Preferences, Project Context, Recurring Insights
- [ ] Instructs Claude to never extract credentials or sensitive data
- [ ] Specifies hybrid narrative/list output format per TD-3
- [ ] Instructs merging with existing facts, not replacement

**Files**:
- Create: `backend/src/prompts/extraction-prompt.md`

**Testing**: Manual review; integration tests validate output format

---

## Extraction Pipeline

### TASK-003: Implement Transcript Reader
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Create module to discover and read transcript markdown files from vault inbox directories.

**Acceptance Criteria**:
- [ ] Enumerate `{inbox}/chats/*.md` files across all vaults
- [ ] Parse YAML frontmatter and markdown content
- [ ] Filter to unprocessed transcripts using state from TASK-001
- [ ] Handle malformed files gracefully (log warning, skip)

**Files**:
- Create: `backend/src/extraction/transcript-reader.ts`

**Testing**: Unit tests with temp directory fixtures, various transcript formats

---

### TASK-004: Implement Fact Extractor
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-001, TASK-002, TASK-003

**Description**: Create module that calls Claude Agent SDK to analyze transcripts and extract facts.

**Acceptance Criteria**:
- [ ] Use Haiku model via Agent SDK `query()` call
- [ ] Enable tools: Glob, Grep, Read, Edit, Write, Task (per TD-2)
- [ ] Load extraction prompt from default or user override location (per TD-6)
- [ ] Pass unprocessed transcripts to Claude for analysis
- [ ] Handle SDK errors with single retry and backoff

**Files**:
- Create: `backend/src/extraction/fact-extractor.ts`

**Testing**: Unit tests with mocked SDK responses; integration test with real SDK (optional)

---

### TASK-005: Implement Memory Writer with Sandbox Pattern
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-004

**Description**: Create module that writes extracted facts to memory.md and vault CLAUDE.md files, using the sandbox copy pattern from TD-12.

**Acceptance Criteria**:
- [ ] Copy `~/.claude/rules/memory.md` to `VAULTS_DIR/.memory-extraction/memory.md` before extraction
- [ ] After extraction, copy result back to `~/.claude/rules/memory.md`
- [ ] Implement recovery logic on startup (handle crashed extraction)
- [ ] Write vault-specific insights to `## Memory Loop Insights` section only
- [ ] Atomic writes (temp file + rename)
- [ ] Enforce 50KB limit: prune entries from top of each category section (oldest by file position) until under limit

**Files**:
- Create: `backend/src/extraction/memory-writer.ts`

**Testing**: Unit tests for sandbox copy, recovery, section isolation, size enforcement

---

### TASK-006: Implement Duplicate Detection
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-005

**Description**: Add normalized text comparison and fuzzy matching to prevent duplicate facts.

**Acceptance Criteria**:
- [ ] Normalize text: lowercase, trim whitespace, remove punctuation
- [ ] Similarity threshold: ratio ≥ 0.9 considers facts duplicate (skip new fact)
- [ ] Integrate with memory-writer merge logic
- [ ] Log when duplicates are skipped

**Files**:
- Modify: `backend/src/extraction/memory-writer.ts`

**Testing**: Unit tests with exact duplicates, near-duplicates, distinct facts

---

### TASK-007: Implement Extraction Manager and Scheduler
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-003, TASK-004, TASK-005, TASK-006

**Description**: Orchestrate the extraction pipeline and schedule daily runs using node-cron.

**Acceptance Criteria**:
- [ ] `runExtraction()` coordinates reader → extractor → writer flow
- [ ] Schedule configurable via environment variable (default: 3am)
- [ ] Catch-up run on startup if `lastRunAt` is >24h ago (configurable threshold)
- [ ] Update extraction state after successful processing
- [ ] Log progress and errors to health collector

**Files**:
- Create: `backend/src/extraction/extraction-manager.ts`
- Modify: `backend/src/server.ts` (initialize scheduler on startup)

**Testing**: Unit tests for orchestration; integration test for full flow with mocks

---

## WebSocket Protocol

### TASK-008: Add Memory and Extraction Protocol Messages
**Priority**: Medium | **Complexity**: M | **Dependencies**: None

**Description**: Extend shared protocol with message types for Settings dialog operations.

**Acceptance Criteria**:
- [ ] Client messages: `get_memory`, `save_memory`, `get_extraction_prompt`, `save_extraction_prompt`, `trigger_extraction`
- [ ] Server messages: `memory_content`, `extraction_prompt_content`, `memory_saved`, `extraction_prompt_saved`, `extraction_status`
- [ ] Zod schemas for all new message types
- [ ] Update discriminated unions

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Schema validation tests for all new message types

---

### TASK-009: Implement Memory WebSocket Handlers
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-005, TASK-008

**Description**: Add server-side handlers for memory read/write operations.

**Acceptance Criteria**:
- [ ] `get_memory` handler reads `~/.claude/rules/memory.md`
- [ ] `save_memory` handler writes to memory file with atomic write
- [ ] `get_extraction_prompt` returns prompt content and override status
- [ ] `save_extraction_prompt` creates user override at `~/.config/memory-loop/extraction-prompt.md`
- [ ] `trigger_extraction` calls extraction manager for manual runs

**Files**:
- Create: `backend/src/handlers/memory-handlers.ts`
- Modify: `backend/src/websocket-handler.ts` (route new messages)

**Testing**: Unit tests for each handler with mocked file system

---

## Settings UI

### TASK-010: Create Settings Dialog Component
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-008

**Description**: Create tabbed Settings dialog accessible from VaultSelect header.

**Acceptance Criteria**:
- [ ] Modal dialog with two tabs: Memory, Extraction Prompt
- [ ] Settings button in VaultSelect header (gear icon)
- [ ] Tab switching preserves unsaved content
- [ ] Close via X button or clicking outside
- [ ] Match existing dialog styling (ConfigEditorDialog pattern)

**Files**:
- Create: `frontend/src/components/SettingsDialog.tsx`
- Modify: `frontend/src/components/VaultSelect.tsx` (add settings button)

**Testing**: Component tests for tab switching, open/close behavior

---

### TASK-011: Implement Memory Editor Tab
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-009, TASK-010

**Description**: Add textarea for viewing and editing memory.md content.

**Acceptance Criteria**:
- [ ] Load memory content on tab open via WebSocket
- [ ] Textarea for editing markdown
- [ ] Save button writes via WebSocket
- [ ] Show current file size; display warning badge when >45KB
- [ ] Delete entries by editing textarea (standard markdown editing)
- [ ] Success/error feedback on save

**Files**:
- Create: `frontend/src/components/MemoryEditor.tsx`
- Modify: `frontend/src/components/SettingsDialog.tsx` (integrate editor)

**Testing**: Component tests for load, edit, save flow with mocked WebSocket

---

### TASK-012: Implement Extraction Prompt Editor Tab
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-009, TASK-010

**Description**: Add textarea for viewing and editing the extraction prompt with override detection.

**Acceptance Criteria**:
- [ ] Load prompt content on tab open via WebSocket
- [ ] Display indicator when user override is active
- [ ] Textarea for editing prompt
- [ ] Save creates override at user config location
- [ ] "Reset to default" action removes user override

**Files**:
- Create: `frontend/src/components/ExtractionPromptEditor.tsx`
- Modify: `frontend/src/components/SettingsDialog.tsx` (integrate editor)

**Testing**: Component tests for override indicator, save, reset flow

---

## Integration

### TASK-013: Wire Up Extraction Pipeline Startup
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-007, TASK-009

**Description**: Initialize extraction scheduler and recovery logic on server startup.

**Acceptance Criteria**:
- [ ] Recovery check: if sandbox copy exists and newer than target, complete copy-back; if older, delete stale file
- [ ] Initialize node-cron scheduler with configured time
- [ ] Check `lastRunAt` in state file; if >24h ago, trigger catch-up extraction
- [ ] Add `node-cron` dependency to package.json

**Files**:
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

**Testing**: Integration test for startup sequence

---

### TASK-014: End-to-End Acceptance Testing
**Priority**: High | **Complexity**: L | **Dependencies**: All previous tasks

**Description**: Implement acceptance tests covering all spec scenarios.

**Acceptance Criteria**:
- [ ] First extraction: 5 transcripts → memory.md created
- [ ] Incremental extraction: only new transcripts processed
- [ ] Duplicate handling: facts merged not duplicated
- [ ] Manual edit: Settings UI edits persist
- [ ] Size limit: pruning triggers at 50KB
- [ ] Prompt customization: custom categories extracted
- [ ] CLAUDE.md isolation: only `## Memory Loop Insights` modified

**Files**:
- Create: `backend/src/__tests__/extraction-e2e.test.ts`

**Testing**: Integration tests with controlled fixtures

---

## Dependency Graph
```
TASK-001 ──┬─> TASK-003 ──┐
           │              ├─> TASK-004 ──> TASK-005 ──> TASK-006 ──┐
TASK-002 ──┘                                                       ├─> TASK-007 ──> TASK-013
                                                                   │
TASK-008 ──────────────────────────────────────────────────────────┴─> TASK-009 ──┬─> TASK-011
                                                                                   ├─> TASK-012
TASK-010 ──────────────────────────────────────────────────────────────────────────┘

TASK-014 depends on all tasks
```

## Implementation Order

**Phase 1** (Foundation): TASK-001, TASK-002, TASK-008 (parallelizable)
**Phase 2** (Core Pipeline): TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 (sequential)
**Phase 3** (UI): TASK-010, TASK-009 (parallelizable), then TASK-011, TASK-012
**Phase 4** (Integration): TASK-013, TASK-014

## Notes
- **Parallelization**: Phase 1 tasks have no dependencies and can run concurrently
- **Critical path**: TASK-001 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-013 → TASK-014
- **Risk area**: TASK-005 (memory writer) has most complexity; allocate extra review time
