---
specification: [.sdd/specs/2025-12-31-task-list.md](./../specs/2025-12-31-task-list.md)
plan: [.sdd/plans/2025-12-31-task-list-plan.md](./../plans/2025-12-31-task-list-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2025-12-31
last_updated: 2025-12-31
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Task List - Task Breakdown

## Task Summary
Total: 12 tasks | Complexity Distribution: 3×S, 6×M, 3×L

## Foundation

### TASK-001: Extend VaultConfig with Task Paths
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add projectPath and areaPath to VaultConfig interface and implementation.

**Acceptance Criteria**:
- [ ] VaultConfig interface has `projectPath?: string` and `areaPath?: string`
- [ ] Defaults to `01_Projects` and `02_Areas` when not specified
- [ ] `resolveProjectPath()` and `resolveAreaPath()` functions work like `resolveMetadataPath()`
- [ ] Existing vault loading continues to work

**Files**: Modify: `backend/src/vault-config.ts`

**Testing**: Unit tests verify defaults and custom paths resolve correctly

---

### TASK-002: Add WebSocket Protocol Schemas
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add Zod schemas for TaskEntry and four new message types.

**Acceptance Criteria**:
- [ ] `TaskEntrySchema` validates text, state, filePath, lineNumber
- [ ] `GetTasksMessageSchema` for client request (no params)
- [ ] `TasksMessageSchema` for server response with tasks[], incomplete, total
- [ ] `ToggleTaskMessageSchema` for client request with filePath, lineNumber
- [ ] `TaskToggledMessageSchema` for server response with filePath, lineNumber, newState
- [ ] All schemas added to ClientMessageSchema/ServerMessageSchema discriminated unions

**Files**: Modify: `shared/src/protocol.ts`

**Testing**: Unit tests validate schema acceptance and rejection

---

## Backend Core

### TASK-003: Create Task Manager - Directory Scanning
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Create task-manager.ts with recursive directory scanning using Promise.all for parallel I/O.

**Acceptance Criteria**:
- [ ] `scanTasksFromDirectory(vaultPath, relativePath)` recursively scans a directory
- [ ] Uses `validatePath()` from file-browser.ts for security
- [ ] Scans inbox, projects, areas directories in parallel with Promise.all
- [ ] Returns empty array for missing directories (no error)
- [ ] Performance: handles 500+ tasks across 100 files in under 2 seconds

**Files**: Create: `backend/src/task-manager.ts`

**Testing**: Unit tests with temp directories, verify parallel execution

---

### TASK-004: Create Task Manager - Task Parsing
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-003

**Description**: Add task parsing to task-manager.ts using regex `/^\s*- \[(.)\] (.+)$/`.

**Acceptance Criteria**:
- [ ] `parseTasksFromFile(filePath)` extracts all tasks from a file
- [ ] Captures state character, task text, line number (1-indexed)
- [ ] Handles all six states: ` `, `x`, `/`, `?`, `b`, `f`
- [ ] Preserves leading whitespace in detection (indented tasks)
- [ ] `getAllTasks(vaultPath, config)` combines scanning + parsing

**Files**: Modify: `backend/src/task-manager.ts`

**Testing**: Unit tests for various task formats, edge cases (emoji, quotes, special chars)

---

### TASK-005: Create Task Manager - Task Toggle
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-004

**Description**: Implement task toggle with line-level file modification and comprehensive safety checks.

**Acceptance Criteria**:
- [ ] `toggleTask(vaultPath, filePath, lineNumber)` cycles state: ` `→`x`→`/`→`?`→`b`→`f`→` `
- [ ] Read file → split lines → modify target line → write file (atomic)
- [ ] Validates line number is within bounds
- [ ] Validates target line is actually a task
- [ ] Only modifies checkbox character, preserves all other content
- [ ] Returns new state character on success
- [ ] Returns error for invalid line, non-task line, or write failure

**Files**: Modify: `backend/src/task-manager.ts`

**Testing**: Critical - all tests per plan "Critical: File Modification Tests" section:
- Line isolation tests (all other lines byte-identical)
- Edge cases (indented, trailing content, special chars, EOF handling)
- State cycle tests (full cycle, each transition)
- Failure mode tests (invalid line, non-task line, read-only file)

---

### TASK-006: Add WebSocket Message Handlers
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002, TASK-005

**Description**: Route get_tasks and toggle_task messages to task-manager functions.

**Acceptance Criteria**:
- [ ] `handleGetTasks(ws, vault)` calls getAllTasks and sends tasks response
- [ ] `handleToggleTask(ws, vault, filePath, lineNumber)` calls toggleTask
- [ ] On success, sends task_toggled response with newState
- [ ] On failure, sends error response with appropriate code
- [ ] Case handlers added to routeMessage() switch

**Files**: Modify: `backend/src/websocket-handler.ts`

**Testing**: Integration tests with mock WebSocket, verify message flow

---

## Frontend Core

### TASK-007: Add Task State to SessionContext
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Extend BrowserState with task-related state and reducer actions.

**Acceptance Criteria**:
- [ ] TaskState interface: `tasks: TaskEntry[]`, `isTasksLoading: boolean`, `tasksError: string | null`
- [ ] BrowserState extended with TaskState fields
- [ ] Reducer actions: SET_TASKS, SET_TASKS_LOADING, SET_TASKS_ERROR, UPDATE_TASK
- [ ] Action creators: setTasks, setTasksLoading, setTasksError, updateTask
- [ ] UPDATE_TASK enables optimistic updates (find by filePath+lineNumber, update state)
- [ ] viewMode: "files" | "tasks" added to state with localStorage persistence

**Files**: Modify: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Unit tests for reducer actions and state transitions

---

### TASK-008: Create TaskList Component
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-007

**Description**: Create TaskList.tsx component displaying grouped tasks with state indicators.

**Acceptance Criteria**:
- [ ] Groups tasks by filePath using Map<string, TaskEntry[]>
- [ ] Displays rollup count "{incomplete} / {total}" where incomplete = state ' '
- [ ] Shows visual indicator per state: checkbox (` `/`x`), half-fill (`/`), `?`, 📍 (`b`), 🔥 (`f`)
- [ ] Clicking indicator sends toggle_task message via WebSocket
- [ ] Optimistic UI update with rollback on error
- [ ] Shows "No tasks found" when empty (REQ-F-23)
- [ ] Shows error toast on toggle failure (REQ-F-24)
- [ ] 44px minimum touch target height per REQ-NF-2

**Files**: Create: `frontend/src/components/TaskList.tsx`

**Testing**: Unit tests for grouping logic, indicator rendering, click handlers

---

### TASK-009: Create TaskList Styling
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-008

**Description**: Create TaskList.css with BEM naming parallel to FileTree.css.

**Acceptance Criteria**:
- [ ] BEM naming: `.task-list__*` parallel to `.file-tree__*`
- [ ] Uses existing CSS variables: `--glass-bg`, `--glass-border`, `--color-text-secondary`
- [ ] 44px touch targets, consistent icon sizes, indentation patterns
- [ ] Mobile responsive (same patterns as FileTree)
- [ ] Visual consistency with existing Browse mode styling

**Files**: Create: `frontend/src/components/TaskList.css`

**Testing**: Visual inspection, mobile viewport testing

---

### TASK-010: Integrate TaskList into BrowseMode
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-008, TASK-009

**Description**: Add view toggle to BrowseMode header and conditionally render TaskList.

**Acceptance Criteria**:
- [ ] viewMode state from SessionContext controls which view is shown
- [ ] Clicking "Files" header cycles viewMode: "files" → "tasks" → "files"
- [ ] Header text updates to reflect current mode (e.g., "Files" vs "Tasks")
- [ ] Conditionally render FileTree or TaskList based on viewMode
- [ ] Send get_tasks on mount when viewMode is "tasks"
- [ ] Works identically on desktop and mobile (mobile via hamburger menu)

**Files**: Modify: `frontend/src/components/BrowseMode.tsx`

**Testing**: Integration test for view toggle, message dispatch

---

## Testing & Validation

### TASK-011: Backend Integration Tests
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-006

**Description**: End-to-end WebSocket tests for task operations.

**Acceptance Criteria**:
- [ ] Test get_tasks → tasks response with mock filesystem
- [ ] Test toggle_task → task_toggled with temp file verification
- [ ] Test error scenarios: missing directories, read-only files
- [ ] Verify file contents before/after toggle operations

**Files**: Create: `backend/src/task-manager.test.ts` (if not covered in TASK-005)

**Testing**: All tests pass, coverage meets project standards

---

### TASK-012: Frontend Integration Tests
**Priority**: Medium | **Complexity**: L | **Dependencies**: TASK-010

**Description**: Component and integration tests for TaskList and BrowseMode toggle.

**Acceptance Criteria**:
- [ ] TaskList renders correctly with mock task data
- [ ] Click handling triggers correct WebSocket messages
- [ ] Optimistic updates and rollback work correctly
- [ ] View toggle persists to localStorage
- [ ] Empty state and error state render correctly

**Files**: Create: `frontend/src/components/TaskList.test.tsx`

**Testing**: All tests pass with React Testing Library

---

## Dependency Graph
```
TASK-001 ────────────┐
                     ├──> TASK-003 ──> TASK-004 ──> TASK-005 ──┬──> TASK-006 ──> TASK-011
TASK-002 ────────────┴─────────────────────────────────────────┤
                                                               │
TASK-002 ──> TASK-007 ──> TASK-008 ──> TASK-009 ──> TASK-010 ──┴──> TASK-012
```

## Implementation Order
**Phase 1** (Foundation - 4pts): TASK-001, TASK-002 (parallel)
**Phase 2** (Backend Core - 15pts): TASK-003 → TASK-004 → TASK-005 → TASK-006
**Phase 3** (Frontend Core - 14pts): TASK-007 → TASK-008 → TASK-009 → TASK-010 (TASK-007 can start with Phase 2)
**Phase 4** (Testing - 6pts): TASK-011, TASK-012 (parallel)

## Notes
- **Parallelization**: TASK-001 and TASK-002 can run in parallel; TASK-007 can start as soon as TASK-002 is done; TASK-011 and TASK-012 can run in parallel
- **Critical path**: TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 → TASK-010
- **Risk focus**: TASK-005 is the highest risk task due to file modification - allocate extra review time
