---
specification: [.sdd/specs/2025-12-23-vault-browser.md](./../specs/2025-12-23-vault-browser.md)
plan: [.sdd/plans/2025-12-23-vault-browser-plan.md](./../plans/2025-12-23-vault-browser-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2025-12-23
last_updated: 2025-12-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Browser - Task Breakdown

## Task Summary

Total: 12 tasks | Complexity Distribution: 4×S, 6×M, 2×L

## Foundation

### TASK-001: Protocol Extension - File Browser Messages

**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add Zod schemas and TypeScript types for file browser WebSocket messages.

**Acceptance Criteria**:
- [ ] `FileEntrySchema` defines name, type (file/directory), path
- [ ] `ListDirectoryMessageSchema` (client→server) with path field
- [ ] `DirectoryListingMessageSchema` (server→client) with entries array
- [ ] `ReadFileMessageSchema` (client→server) with path field
- [ ] `FileContentMessageSchema` (server→client) with content, truncated flag
- [ ] New error codes added: `FILE_NOT_FOUND`, `DIRECTORY_NOT_FOUND`, `PATH_TRAVERSAL`, `INVALID_FILE_TYPE`
- [ ] All schemas added to discriminated unions

**Files**:
- Modify: `shared/src/protocol.ts`
- Modify: `shared/src/types.ts`

**Testing**: TypeScript compilation passes; schema validation tests for valid/invalid messages

---

### TASK-002: Backend File Browser Module

**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Create `file-browser.ts` with directory listing and file reading functions including security validation.

**Acceptance Criteria**:
- [ ] `listDirectory(vault, relativePath)` returns sorted FileEntry array
- [ ] `readMarkdownFile(vault, relativePath)` returns content with truncation handling
- [ ] `isPathWithinVault(vaultPath, targetPath)` validates path boundaries
- [ ] Hidden files (starting with `.`) excluded from listings
- [ ] Symlinks detected and rejected (using lstat)
- [ ] Non-.md files rejected for reading
- [ ] Files >1MB truncated with flag set
- [ ] Directories sorted first, then files, alphabetically

**Files**:
- Create: `backend/src/file-browser.ts`
- Modify: `backend/src/vault-manager.ts` (export path validation utility)

**Testing**: Unit tests covering path traversal attacks, symlink rejection, hidden file filtering, 1MB truncation

---

### TASK-003: WebSocket Handler Integration

**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-002

**Description**: Add message routing for `list_directory` and `read_file` in WebSocketHandler.

**Acceptance Criteria**:
- [ ] `handleListDirectory()` validates vault selected, calls file-browser, sends response
- [ ] `handleReadFile()` validates vault selected, calls file-browser, sends response
- [ ] Errors return appropriate error codes (FILE_NOT_FOUND, PATH_TRAVERSAL, etc.)
- [ ] Pattern matches existing handlers (handleCaptureNote, handleDiscussionMessage)

**Files**:
- Modify: `backend/src/websocket-handler.ts`

**Testing**: Integration tests for WebSocket round-trip; error code verification

---

## State Management

### TASK-004: SessionContext Browser State

**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Extend SessionContext with browser state (current path, expanded dirs, directory cache).

**Acceptance Criteria**:
- [ ] `BrowserState` interface added with currentPath, expandedDirs, directoryCache
- [ ] `AppMode` extended to include "browse"
- [ ] Actions: `setCurrentPath`, `toggleDirectory`, `cacheDirectory`, `clearBrowserState`
- [ ] `SELECT_VAULT` action clears browser state (REQ-F-23)
- [ ] `SET_MODE` preserves browser state (REQ-F-22)
- [ ] Browser state persisted to localStorage (currentPath only)

**Files**:
- Modify: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Unit tests for reducer actions; verify vault switch clears state; verify mode switch preserves state

---

### TASK-005: ModeToggle Extension

**Priority**: High | **Complexity**: S | **Dependencies**: TASK-004

**Description**: Add "Browse" as third mode option in ModeToggle component.

**Acceptance Criteria**:
- [ ] Third segment added: { value: "browse", label: "Browse" }
- [ ] Mode toggle displays three segments with proper styling
- [ ] Clicking Browse sets mode to "browse" in SessionContext
- [ ] Touch targets maintain 44px minimum height

**Files**:
- Modify: `frontend/src/components/ModeToggle.tsx`
- Modify: `frontend/src/components/ModeToggle.css` (adjust segment widths if needed)

**Testing**: Visual verification of three-segment layout; click test for mode switching

---

## UI Components

### TASK-006: FileTree Component

**Priority**: High | **Complexity**: L | **Dependencies**: TASK-004

**Description**: Create collapsible file tree component with lazy-loading and expand/collapse state.

**Acceptance Criteria**:
- [ ] Renders directory structure from cached entries
- [ ] Directories show expand/collapse chevron; clicking toggles state
- [ ] Files show file icon; clicking dispatches file selection
- [ ] Lazy-loads subdirectory contents on first expand
- [ ] Shows loading indicator during fetch
- [ ] Empty directories show "(empty)" placeholder
- [ ] Uses existing CSS variables for styling (REQ-NF-6)
- [ ] Touch targets minimum 44px (REQ-NF-4)

**Files**:
- Create: `frontend/src/components/FileTree.tsx`
- Create: `frontend/src/components/FileTree.css`

**Testing**: Unit tests for expand/collapse logic; visual test for directory rendering

---

### TASK-007: MarkdownViewer Component with Wiki-Links

**Priority**: High | **Complexity**: L | **Dependencies**: TASK-004

**Description**: Create markdown viewer using marked with custom wiki-link rendering and breadcrumb navigation.

**Acceptance Criteria**:
- [ ] Renders markdown using `marked` library
- [ ] Custom renderer parses `[[note-name]]` and `[[note|display]]` as clickable links
- [ ] Wiki-link clicks attempt navigation (dispatch read_file)
- [ ] Broken links (after navigation failure) show red styling
- [ ] External URLs open in new tab with `target="_blank" rel="noopener"`
- [ ] Relative image paths resolved correctly (prepend asset route)
- [ ] Breadcrumb shows path segments; each clickable to navigate up
- [ ] Truncation warning banner displays when file was truncated
- [ ] Loading skeleton during file fetch

**Files**:
- Create: `frontend/src/components/MarkdownViewer.tsx`
- Create: `frontend/src/components/MarkdownViewer.css`
- Modify: `frontend/package.json` (add marked dependency)

**Testing**: Unit tests for wiki-link parsing; visual test for markdown rendering; external link behavior

---

### TASK-008: BrowseMode Container

**Priority**: High | **Complexity**: M | **Dependencies**: TASK-006, TASK-007

**Description**: Create split-pane container component that coordinates FileTree and MarkdownViewer.

**Acceptance Criteria**:
- [ ] CSS Grid layout with tree (left) and viewer (right)
- [ ] Tree pane collapsible via toggle button
- [ ] Mobile (<768px): tree collapses to overlay
- [ ] Loads root directory on mount if not cached
- [ ] Coordinates file selection between tree and viewer
- [ ] Shows empty state when no file selected

**Files**:
- Create: `frontend/src/components/BrowseMode.tsx`
- Create: `frontend/src/components/BrowseMode.css`

**Testing**: Visual test at various viewport widths; integration test for tree↔viewer coordination

---

### TASK-009: App Integration

**Priority**: High | **Complexity**: S | **Dependencies**: TASK-005, TASK-008

**Description**: Integrate BrowseMode into App.tsx main content area.

**Acceptance Criteria**:
- [ ] App renders BrowseMode when mode === "browse"
- [ ] Existing NoteCapture and Discussion continue working
- [ ] Mode switching between all three modes works correctly

**Files**:
- Modify: `frontend/src/App.tsx`

**Testing**: Manual test of mode switching; verify no regressions in Note/Discussion modes

---

## Assets & Finishing

### TASK-010: Image Asset Serving Route

**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Add HTTP route to serve vault image assets with path validation.

**Acceptance Criteria**:
- [ ] Route: `GET /vault/:vaultId/assets/*` serves binary files
- [ ] Only image extensions allowed (png, jpg, jpeg, gif, svg, webp)
- [ ] Path validation reuses `isPathWithinVault()` logic
- [ ] Symlinks rejected
- [ ] Appropriate Content-Type headers set
- [ ] 404 for missing files

**Files**:
- Modify: `backend/src/server.ts`

**Testing**: Integration test for image serving; path traversal attack test

---

### TASK-011: WebSocket Message Handlers (Frontend)

**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-001, TASK-004

**Description**: Extend useWebSocket and useServerMessageHandler to process file browser messages.

**Acceptance Criteria**:
- [ ] `directory_listing` message updates directoryCache in context
- [ ] `file_content` message updates current file content state
- [ ] Error messages (FILE_NOT_FOUND, etc.) display inline error in viewer
- [ ] Send helpers: `sendListDirectory(path)`, `sendReadFile(path)`

**Files**:
- Modify: `frontend/src/hooks/useWebSocket.ts`
- Modify: `frontend/src/contexts/SessionContext.tsx` (add message handling)

**Testing**: Unit tests for message handling; integration test for WebSocket round-trip

---

### TASK-012: Integration Tests & Polish

**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-009, TASK-010, TASK-011

**Description**: End-to-end integration tests covering all acceptance criteria from spec.

**Acceptance Criteria**:
- [ ] Test: Tree renders matching filesystem structure
- [ ] Test: Directory expand/collapse works
- [ ] Test: File content renders with formatting
- [ ] Test: Wiki-link navigation works
- [ ] Test: Broken link shows indicator
- [ ] Test: Path traversal blocked (server rejects)
- [ ] Test: Mobile layout (375px) works
- [ ] Test: Mode persistence across switches
- [ ] All existing tests continue passing

**Files**:
- Create: `backend/src/__tests__/file-browser.test.ts`
- Create: `frontend/src/components/__tests__/BrowseMode.test.tsx`

**Testing**: Run full test suite; manual smoke test of complete flow

---

## Dependency Graph

```
TASK-001 ──┬─> TASK-002 ──> TASK-003
           │       │
           │       └─> TASK-010
           │
           ├─> TASK-004 ──┬─> TASK-005 ──> TASK-009
           │              │
           │              ├─> TASK-006 ──┐
           │              │              ├─> TASK-008 ──> TASK-009
           │              └─> TASK-007 ──┘
           │
           └─> TASK-011 ──────────────────────────────> TASK-012
```

## Implementation Order

**Phase 1** (Foundation): TASK-001
**Phase 2** (Backend): TASK-002, TASK-003, TASK-010 (parallelizable)
**Phase 3** (State): TASK-004, TASK-011 (parallelizable)
**Phase 4** (UI): TASK-005, TASK-006, TASK-007 (parallelizable after TASK-004)
**Phase 5** (Integration): TASK-008, TASK-009
**Phase 6** (Testing): TASK-012

## Notes

- **Parallelization**: TASK-002/003/010 can run in parallel; TASK-006/007 can run in parallel after TASK-004
- **Critical path**: TASK-001 → TASK-004 → TASK-006/007 → TASK-008 → TASK-009 → TASK-012
- **External dependency**: `marked` library must be installed before TASK-007
