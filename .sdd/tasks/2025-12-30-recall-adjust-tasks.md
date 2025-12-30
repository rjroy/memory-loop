---
specification: [.sdd/specs/2025-12-30-recall-adjust.md](./../specs/2025-12-30-recall-adjust.md)
plan: [.sdd/plans/2025-12-30-recall-adjust-plan.md](./../plans/2025-12-30-recall-adjust-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2025-12-30
last_updated: 2025-12-30
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Recall Tab Adjust Feature - Task Breakdown

## Task Summary

Total: 6 tasks | Complexity Distribution: 3×S, 3×M

## Foundation

### TASK-001: Add write_file/file_written Protocol Schemas

**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Extend the shared WebSocket protocol with schemas for file writing.

**Acceptance Criteria**:
- [ ] `WriteFileMessageSchema` added to ClientMessage discriminated union
- [ ] `FileWrittenMessageSchema` added to ServerMessage discriminated union
- [ ] TypeScript types exported (`WriteFileMessage`, `FileWrittenMessage`)
- [ ] Schema validation passes for valid messages, rejects invalid

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Unit tests for schema validation (valid/invalid message shapes)

**Requirements**: REQ-F-10, REQ-F-11

---

## Backend

### TASK-002: Add writeMarkdownFile() Function

**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Add file writing capability to file-browser.ts mirroring the existing `readMarkdownFile()` pattern.

**Acceptance Criteria**:
- [ ] `writeMarkdownFile(vaultPath, relativePath, content)` function exported
- [ ] Validates `.md` extension (throws `InvalidFileTypeError`)
- [ ] Validates path within vault via `validatePath()` (throws `PathTraversalError`)
- [ ] Verifies file exists before writing (no new file creation)
- [ ] Writes content using Node.js `writeFile()`
- [ ] Unit tests cover: success, wrong extension, path traversal, file not found

**Files**:
- Modify: `backend/src/file-browser.ts`
- Modify: `backend/src/__tests__/file-browser.test.ts`

**Testing**: Unit tests with temp directory filesystem operations

**Requirements**: REQ-F-12, REQ-F-13, REQ-NF-5

---

### TASK-003: Add handleWriteFile() WebSocket Handler

**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-001, TASK-002

**Description**: Add message routing for `write_file` messages in websocket-handler.ts.

**Acceptance Criteria**:
- [ ] `write_file` case added to `routeMessage()` switch
- [ ] Handler validates vault is selected (returns `VAULT_NOT_FOUND` if not)
- [ ] Calls `writeMarkdownFile()` with vault path and message params
- [ ] On success: sends `file_written` message
- [ ] On error: sends `error` message with appropriate code
- [ ] Server-side logging for write operations and errors (REQ-F-16)

**Files**:
- Modify: `backend/src/websocket-handler.ts`
- Modify: `backend/src/__tests__/websocket-handler.test.ts`

**Testing**: Integration tests mocking WebSocket, verifying message flow

**Requirements**: REQ-F-12, REQ-F-16

---

## Frontend State

### TASK-004: Extend BrowserState with Adjust Mode

**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Add state fields and reducer actions for adjust mode in SessionContext.

**Acceptance Criteria**:
- [ ] `BrowserState` extended with: `isAdjusting`, `adjustContent`, `adjustError`, `isSaving`
- [ ] New reducer actions: `START_ADJUST`, `UPDATE_ADJUST_CONTENT`, `CANCEL_ADJUST`, `START_SAVE`, `SAVE_SUCCESS`, `SAVE_ERROR`
- [ ] `START_ADJUST` copies `currentFileContent` to `adjustContent`
- [ ] `SET_CURRENT_PATH` clears adjust state (REQ-F-9)
- [ ] Action creators exported: `startAdjust()`, `updateAdjustContent()`, `cancelAdjust()`, `startSave()`, `saveSuccess()`, `saveError()`
- [ ] Unit tests for all new reducer cases

**Files**:
- Modify: `frontend/src/contexts/SessionContext.tsx`
- Modify: `frontend/src/contexts/__tests__/SessionContext.test.tsx`

**Testing**: Reducer unit tests for state transitions

**Requirements**: REQ-F-7, REQ-F-8, REQ-F-9, REQ-F-14, REQ-F-15

---

## Frontend UI

### TASK-005: Implement Adjust Mode UI in MarkdownViewer

**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Add conditional rendering for adjust mode with textarea, buttons, and styles.

**Acceptance Criteria**:
- [ ] "Adjust" button in header when file loaded and not adjusting (REQ-F-1)
- [ ] Clicking Adjust shows textarea with raw content (REQ-F-2)
- [ ] Save and Cancel buttons visible in adjust mode (REQ-F-3)
- [ ] Escape key triggers cancel (REQ-F-6, via `onKeyDown`)
- [ ] Textarea fills viewport with min-height 200px (REQ-NF-2)
- [ ] ARIA labels on all buttons (REQ-NF-3)
- [ ] Button styling matches existing BrowseMode buttons (REQ-NF-4)
- [ ] Error message displays above textarea when `adjustError` set
- [ ] Loading indicator during save (`isSaving` state)

**Files**:
- Modify: `frontend/src/components/MarkdownViewer.tsx`
- Modify: `frontend/src/components/MarkdownViewer.css`
- Modify: `frontend/src/components/__tests__/MarkdownViewer.test.tsx`

**Testing**: Component tests for mode switching, button interactions, keyboard handling

**Requirements**: REQ-F-1 to REQ-F-6, REQ-NF-2 to REQ-NF-4

---

## Integration

### TASK-006: Wire Frontend to Backend and Integration Tests

**Priority**: High | **Complexity**: M | **Dependencies**: TASK-003, TASK-005

**Description**: Connect MarkdownViewer save action to WebSocket, handle responses, and add integration tests.

**Acceptance Criteria**:
- [ ] Save button sends `write_file` message via WebSocket
- [ ] `file_written` response clears adjust state and refreshes content view
- [ ] `error` response sets `adjustError`, preserves textarea content (REQ-F-15)
- [ ] BrowseMode handles `file_written` message type in `useEffect`
- [ ] Integration test: basic edit round-trip (Acceptance Test #1)
- [ ] Integration test: cancel discards changes (Acceptance Test #2)
- [ ] Integration test: path security rejection (Acceptance Test #6)
- [ ] Integration test: file type rejection (Acceptance Test #7)

**Files**:
- Modify: `frontend/src/components/BrowseMode.tsx`
- Modify: `frontend/src/components/MarkdownViewer.tsx`
- Create: `frontend/src/components/__tests__/BrowseMode.adjust.test.tsx`

**Testing**: Integration tests with mocked WebSocket covering acceptance tests 1-2, 6-7

**Requirements**: REQ-F-4, REQ-F-5, REQ-F-14, REQ-F-15

---

## Dependency Graph

```
TASK-001 (Protocol) ──┬──> TASK-002 (writeMarkdownFile)
                      │
                      └──> TASK-003 (handleWriteFile) ──┐
                                                        │
TASK-004 (State) ──> TASK-005 (UI) ─────────────────────┴──> TASK-006 (Integration)
```

## Implementation Order

**Phase 1** (Foundation - can parallelize):
- TASK-001: Protocol schemas
- TASK-004: Frontend state

**Phase 2** (Backend):
- TASK-002: writeMarkdownFile function
- TASK-003: WebSocket handler

**Phase 3** (Frontend UI):
- TASK-005: MarkdownViewer adjust mode

**Phase 4** (Integration):
- TASK-006: Wire frontend to backend

## Notes

- **Parallelization**: TASK-001 and TASK-004 have no dependencies and can start immediately
- **Critical path**: TASK-001 → TASK-002 → TASK-003 → TASK-006
- **Testing coverage**: Each task includes its own tests; TASK-006 covers integration scenarios
- **Acceptance tests mapping**:
  - #1, #2: TASK-006 integration tests
  - #3: TASK-005 (Escape key)
  - #4: TASK-004 (navigation clears state)
  - #5: TASK-006 (error handling)
  - #6, #7: TASK-006 (security tests)
  - #8: Manual verification (mobile layout)

---

**Next Phase**: Once approved, use `/spiral-grove:implementation` to begin executing tasks with progress tracking.
