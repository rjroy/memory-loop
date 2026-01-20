---
specification: [.sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md](../specs/memory-loop/2026-01-20-pair-writing-mode.md)
plan: [.sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md](../plans/memory-loop/2026-01-20-pair-writing-mode-plan.md)
status: Draft
version: 1.0.0
created: 2026-01-20
last_updated: 2026-01-20
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Pair Writing Mode - Task Breakdown

## Task Summary
Total: 14 tasks | Complexity Distribution: 3xS, 8xM, 3xL

## Foundation Layer

### TASK-001: WebSocket Protocol Extensions
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add new message types to shared protocol for Quick Actions, Advisory Actions, and Pair Chat.

**Acceptance Criteria**:
- [ ] `QuickActionRequest` schema with action type, selection, context, filePath, line numbers
- [ ] `AdvisoryActionRequest` schema with action type, selection, context, snapshotSelection
- [ ] `PairChatRequest` schema with text, optional selection context
- [ ] Schemas integrated into `ClientMessageSchema` discriminated union
- [ ] Type exports for frontend/backend consumption

**Files**: Modify: `shared/src/protocol.ts`

**Testing**: Unit tests for schema validation (valid/invalid payloads)

---

### TASK-002: Long-Press Hook
**Priority**: High | **Complexity**: S | **Dependencies**: None

**Description**: Extract long-press timer logic from FileTree into reusable `useLongPress` hook.

**Acceptance Criteria**:
- [ ] Hook accepts callback and optional duration (default 500ms)
- [ ] Returns touch event handlers (onTouchStart, onTouchMove, onTouchEnd)
- [ ] Cancels timer on move or end events
- [ ] Calls `e.preventDefault()` in onTouchStart to suppress system context menu

**Files**: Create: `frontend/src/hooks/useLongPress.ts`

**Testing**: Unit tests for timer behavior, cancellation, 500ms threshold

---

### TASK-003: Text Selection Hook
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Create `useTextSelection` hook to track current selection in editor with line number metadata.

**Acceptance Criteria**:
- [ ] Tracks selection changes via Selection API
- [ ] Returns `SelectionContext`: text, startLine, endLine, totalLines, contextBefore, contextAfter
- [ ] `contextBefore`/`contextAfter` are full paragraphs (delimited by `\n\n`)
- [ ] Returns null for empty selection

**Files**: Create: `frontend/src/hooks/useTextSelection.ts`

**Testing**: Unit tests for line counting, paragraph extraction at document boundaries

---

## Context Menu

### TASK-004: Editor Context Menu Component
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-002, TASK-003

**Description**: Create `EditorContextMenu` with right-click (desktop) and long-press (mobile) triggers.

**Acceptance Criteria**:
- [ ] Renders via portal at selection position
- [ ] Shows Quick Actions (Tighten, Embellish, Correct, Polish) on all platforms
- [ ] Uses `useLongPress` for mobile trigger
- [ ] Dismisses on click outside or Escape
- [ ] Keyboard navigable (arrow keys, Enter, Escape) per REQ-NF-5
- [ ] Appears within 100ms of trigger per REQ-NF-3

**Files**:
- Create: `frontend/src/components/EditorContextMenu.tsx`
- Create: `frontend/src/components/EditorContextMenu.module.css`

**Testing**: Unit tests for rendering, keyboard navigation; manual test: verify long-press triggers menu on iOS/Android, system menu suppressed

---

### TASK-005: Integrate Context Menu into MemoryEditor
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Wire `EditorContextMenu` into `MemoryEditor` component with selection tracking.

**Acceptance Criteria**:
- [ ] Right-click with selection opens context menu
- [ ] Long-press with selection opens context menu (mobile)
- [ ] Menu position follows selection bounding rect
- [ ] Selection state passed to menu for action dispatch
- [ ] Prevents browser default context menu when our menu opens

**Files**: Modify: `frontend/src/components/MemoryEditor.tsx`

**Testing**: Integration test: select text -> right-click -> menu appears

---

## Quick Actions

### TASK-006: Quick Action Prompts Configuration
**Priority**: High | **Complexity**: S | **Dependencies**: None

**Description**: Create action-specific prompt templates for Tighten, Embellish, Correct, Polish on backend.

**Acceptance Criteria**:
- [ ] Prompt config object with all 4 action types
- [ ] Each prompt includes action rules, context placeholders, efficiency guidance
- [ ] Position hint logic (beginning/middle/end based on line numbers)
- [ ] Prompts instruct Claude to use Read then Edit tool

**Files**: Create: `backend/src/pair-writing-prompts.ts`

**Testing**: Unit test for prompt template generation

---

### TASK-007: Quick Action Handler
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-001, TASK-006

**Description**: Implement `handleQuickAction` in backend to create task-scoped Claude session with Read/Edit tools.

**Acceptance Criteria**:
- [ ] Validates file path within vault
- [ ] Builds prompt from action template + request context
- [ ] Creates Claude session with Read and Edit tools scoped to vault
- [ ] Streams all events (tool_start, tool_end, response_chunk, response_end)
- [ ] Session terminates after Claude confirms completion

**Files**:
- Create: `backend/src/handlers/pair-writing-handlers.ts`
- Modify: `backend/src/websocket-handler.ts` (route new message type)

**Testing**: Unit tests with mocked SDK (MOCK_SDK=true); manual integration test with real Claude verifies file is modified

---

### TASK-008: Quick Action Frontend Flow
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-005, TASK-007

**Description**: Wire context menu actions to WebSocket requests, handle streaming response, reload file on completion.

**Acceptance Criteria**:
- [ ] Menu action triggers `quick_action_request` with selection context
- [ ] Loading indicator shown on selection during processing
- [ ] Tool events displayed (optional: show "editing..." indicator)
- [ ] On `response_end`, reload file content from disk
- [ ] Toast displays Claude's brief confirmation message

**Files**:
- Modify: `frontend/src/components/EditorContextMenu.tsx`
- Modify: `frontend/src/components/MemoryEditor.tsx`

**Testing**: Unit tests with mocked WebSocket; manual E2E: select text -> Tighten -> verify file content changed on disk, toast displayed

---

## Pair Writing Mode

### TASK-009: Pair Writing State Management
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Create `usePairWritingState` hook to manage session state (content, snapshot, conversation).

**Acceptance Criteria**:
- [ ] State includes: isActive, content, snapshot, conversation[], selection, hasUnsavedChanges
- [ ] Actions: setContent, takeSnapshot, addMessage, setSelection, clearAll
- [ ] Conversation cleared on exit (session-scoped per REQ-F-27)

**Files**: Create: `frontend/src/hooks/usePairWritingState.ts`

**Testing**: Unit tests for state transitions

---

### TASK-010: Conversation Pane Extraction
**Priority**: High | **Complexity**: M | **Dependencies**: None

**Description**: Extract shared conversation display from Discussion.tsx into reusable `ConversationPane`.

**Acceptance Criteria**:
- [ ] Renders message list, streaming indicator
- [ ] Accepts messages prop and onSendMessage callback
- [ ] Matches existing Discussion styling per REQ-NF-4
- [ ] Discussion.tsx refactored to use extracted component

**Files**:
- Create: `frontend/src/components/ConversationPane.tsx`
- Modify: `frontend/src/components/Discussion.tsx`

**Testing**: Unit tests for message rendering; manual visual check that Discussion mode appearance unchanged

---

### TASK-011: Pair Writing Mode Layout
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-009, TASK-010

**Description**: Create `PairWritingMode` container with split-screen layout, toolbar, and desktop-only visibility.

**Acceptance Criteria**:
- [ ] Split-screen: editor (left), conversation (right) per REQ-F-11
- [ ] CSS Grid layout, 50/50 split
- [ ] PairWritingToolbar with Snapshot, Save, Exit buttons
- [ ] Exit warns if hasUnsavedChanges (manual edits only; Quick Actions persist immediately)
- [ ] Hidden via CSS media query on touch devices per REQ-F-10

**Files**:
- Create: `frontend/src/components/PairWritingMode.tsx`
- Create: `frontend/src/components/PairWritingToolbar.tsx`
- Create: `frontend/src/components/PairWritingMode.module.css`

**Testing**: Unit tests for layout, exit warning; manual desktop/mobile visibility test

---

### TASK-012: Pair Writing Entry Point in BrowseMode
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-011

**Description**: Add "Pair Writing" button to BrowseMode that toggles into PairWritingMode.

**Acceptance Criteria**:
- [ ] Button visible when viewing markdown file on desktop
- [ ] Button hidden on mobile/touch devices
- [ ] Click enters Pair Writing Mode with current file
- [ ] Exiting Pair Writing returns to standard Browse view

**Files**: Modify: `frontend/src/components/BrowseMode.tsx`

**Testing**: Integration test: open file -> click button -> split view appears

---

## Advisory Actions & Chat

### TASK-013: Advisory Action Handlers
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-001, TASK-007

**Description**: Implement `handleAdvisoryAction` and `handlePairChat` for Validate, Critique, Compare, and freeform chat.

**Acceptance Criteria**:
- [ ] Advisory actions use streaming (no tool use, just response)
- [ ] Compare action includes snapshot selection if provided
- [ ] Pair chat includes optional selection context
- [ ] All use existing response_chunk streaming

**Files**:
- Modify: `backend/src/handlers/pair-writing-handlers.ts`
- Modify: `backend/src/websocket-handler.ts`

**Testing**: Unit tests for each action type

---

### TASK-014: Full Context Menu in Pair Writing Mode
**Priority**: Medium | **Complexity**: L | **Dependencies**: TASK-004, TASK-011, TASK-013

**Description**: Extend EditorContextMenu to show all 6 actions in Pair Writing Mode, plus Compare when snapshot exists.

**Acceptance Criteria**:
- [ ] Menu receives mode flag (browse vs pair-writing)
- [ ] In Pair Writing: shows Quick Actions + Validate + Critique
- [ ] If snapshot exists: shows "Compare to snapshot"
- [ ] Advisory actions dispatch to conversation pane (not inline)
- [ ] SelectionQuote component shows selection above chat input
- [ ] Tab hotkey jumps to chat input per REQ-F-19

**Files**:
- Modify: `frontend/src/components/EditorContextMenu.tsx`
- Create: `frontend/src/components/SelectionQuote.tsx`
- Modify: `frontend/src/components/PairWritingMode.tsx`

**Testing**: Unit tests with mocked WebSocket; manual E2E for each: Validate selection shows response in conversation, Critique shows feedback, Compare shows diff analysis

---

## Dependency Graph
```
TASK-001 (Protocol) ─────────────────────────────┐
                                                  │
TASK-002 (LongPress) ───┐                        │
                        ├──> TASK-004 (Menu) ────┼──> TASK-005 (Integrate) ──> TASK-008 (Quick Frontend)
TASK-003 (Selection) ───┘                        │
                                                  │
TASK-006 (Prompts) ──────────────────────────────┼──> TASK-007 (Quick Handler) ──> TASK-008
                                                  │
TASK-009 (State) ────────────────────────────────┼──> TASK-011 (Layout) ──> TASK-012 (Entry)
                                                  │                    │
TASK-010 (ConvoPane) ────────────────────────────┘                    │
                                                                       │
TASK-013 (Advisory Handlers) ──────────────────────────────────────────┼──> TASK-014 (Full Menu)
```

## Implementation Order

**Phase 1** (Foundation, parallel):
- TASK-001: Protocol extensions
- TASK-002: Long-press hook
- TASK-003: Selection hook
- TASK-006: Prompt config
- TASK-009: State management
- TASK-010: Conversation pane extraction

**Phase 2** (Context Menu):
- TASK-004: Context menu component
- TASK-005: Menu integration into editor

**Phase 3** (Quick Actions):
- TASK-007: Quick action backend handler
- TASK-008: Quick action frontend flow

**Phase 4** (Pair Writing Mode):
- TASK-011: Layout + toolbar
- TASK-012: Entry point in BrowseMode
- TASK-013: Advisory handlers
- TASK-014: Full context menu

## Notes

- **Parallelization**: Phase 1 tasks have no interdependencies and can all be worked in parallel
- **Critical path**: TASK-001 -> TASK-007 -> TASK-008 (Quick Actions must work before Pair Writing)
