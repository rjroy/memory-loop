---
specification: [.sdd/specs/2025-12-31-task-list.md](./../specs/2025-12-31-task-list.md)
status: Approved
version: 1.0.0
created: 2025-12-31
last_updated: 2025-12-31
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Task List - Technical Plan

## Overview

This plan implements a Task List view in the Recall tab that displays markdown tasks from vault directories. The implementation extends existing patterns: VaultConfig for path configuration, WebSocket protocol for task retrieval/updates, SessionContext for state management, and BrowseMode for view toggling.

Key strategies:
- **Leverage existing file-browser.ts patterns** for recursive directory scanning with path security
- **Extend the WebSocket protocol** with four new message types following existing Zod schema patterns
- **Build TaskList component** parallel to FileTree, reusing CSS conventions
- **Use note-capture.ts patterns** for line-level file manipulation

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌──────────────┐     ┌─────────────┐     ┌─────────────────┐  │
│  │  BrowseMode  │────▶│  TaskList   │────▶│ SessionContext  │  │
│  │ (view toggle)│     │ (new comp)  │     │ (task state)    │  │
│  └──────────────┘     └─────────────┘     └─────────────────┘  │
└──────────────────────────────────────────────────────────────────
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│  ┌──────────────────┐     ┌─────────────┐     ┌──────────────┐ │
│  │ websocket-handler│────▶│task-manager │────▶│ file-browser │ │
│  │  (routing)       │     │ (new module)│     │ (file ops)   │ │
│  └──────────────────┘     └─────────────┘     └──────────────┘ │
│                                │                                 │
│                                ▼                                 │
│                          ┌───────────────┐                      │
│                          │ vault-config  │                      │
│                          │(path config)  │                      │
│                          └───────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|----------------|
| `vault-config.ts` | Extends VaultConfig with projectPath, areaPath (REQ-F-1, REQ-F-2, REQ-F-3) |
| `task-manager.ts` | New module: scans directories, parses tasks, handles toggle (REQ-F-4-7, REQ-F-12-14) |
| `protocol.ts` | Four new WebSocket message schemas (REQ-F-18-21) |
| `websocket-handler.ts` | Routes get_tasks/toggle_task to task-manager |
| `SessionContext.tsx` | Task state: items, loading, view preference (REQ-F-17) |
| `TaskList.tsx` | New component: displays grouped tasks with indicators (REQ-F-8-11, REQ-NF-3) |
| `TaskList.css` | Styling matching FileTree patterns (REQ-NF-3) |
| `BrowseMode.tsx` | View toggle between FileTree and TaskList (REQ-F-15-16) |

## Technical Decisions

### TD-1: New task-manager.ts Module
**Choice**: Create dedicated task-manager.ts rather than extending file-browser.ts or note-capture.ts
**Requirements**: REQ-F-4, REQ-F-5, REQ-F-6, REQ-F-7, REQ-F-12, REQ-F-13, REQ-F-14
**Rationale**:
- file-browser.ts handles file/directory listing with security - task parsing is a distinct concern
- note-capture.ts handles daily note appending - task toggling requires line-by-line modification
- Dedicated module enables focused testing and clearer separation of concerns
- Can reuse validatePath from file-browser.ts for security

### TD-2: Recursive Directory Scanning with Parallel I/O
**Choice**: Use Promise.all with readdir for parallel scanning of inbox/projects/areas
**Requirements**: REQ-F-4, REQ-NF-1
**Rationale**:
- Three root directories can be scanned in parallel
- Within each, recursive descent uses Promise.all for subdirectories
- Pattern proven in existing vault-manager.ts directory scanning
- Meets 2-second performance target for 500 tasks across typical vault structures

### TD-3: Line-by-Line File Modification for Toggle
**Choice**: Read file → split lines → modify target line → write file
**Requirements**: REQ-F-12, REQ-F-13, REQ-F-14
**Rationale**:
- Preserves all file content outside the target line (REQ-F-14 constraint: only modify checkbox)
- Line numbers from initial parse can index directly into array
- Pattern similar to note-capture.ts appendToCaptureSection
- Atomic write prevents partial updates on failure

### TD-4: Extend BrowseMode for View Toggle
**Choice**: Add viewMode state to BrowseMode component, toggle on header click
**Requirements**: REQ-F-15, REQ-F-16, REQ-F-17
**Rationale**:
- BrowseMode already manages tree pane state (collapsed/expanded)
- Click on "Files" header toggles viewMode: "files" | "tasks"
- localStorage persistence for viewMode preference (same pattern as pinnedFolders)
- Both desktop and mobile use same toggle mechanism - mobile accesses via hamburger

### TD-5: Task State in SessionContext
**Choice**: Add TaskState interface to BrowserState in SessionContext
**Requirements**: REQ-F-8, REQ-F-9, REQ-F-10, REQ-F-11
**Rationale**:
- Follows existing pattern: BrowserState holds directoryCache, currentFileContent, etc.
- TaskState holds: tasks array, isTasksLoading, tasksError
- Reducer actions: SET_TASKS, SET_TASKS_LOADING, SET_TASKS_ERROR, UPDATE_TASK
- Enables optimistic UI updates on toggle with rollback on failure

### TD-6: Task Grouping and Sorting in Frontend
**Choice**: Backend returns flat task array; frontend groups by file path
**Requirements**: REQ-F-8, REQ-F-9
**Rationale**:
- Backend parsing is simpler: just extract tasks with metadata
- Frontend grouping enables future filtering/sorting options without protocol changes
- Sort: tasks already ordered by file path (directory scan order), then line number
- Grouping is O(n) with Map<filePath, Task[]>

### TD-7: Rollup Count Calculation
**Choice**: Frontend calculates rollup from task array
**Requirements**: REQ-F-10
**Rationale**:
- Count = tasks.filter(t => t.state === ' ').length for incomplete
- Total = tasks.length
- Display: "{incomplete} / {total}"
- Reactive: auto-updates when tasks state changes from toggle

### TD-8: Error Handling Strategy
**Choice**: Graceful degradation with user feedback
**Requirements**: REQ-F-22, REQ-F-23, REQ-F-24, REQ-NF-4
**Rationale**:
- Missing directories: log warning, return empty array (no error to user)
- No tasks: display "No tasks found" message (REQ-F-23)
- Toggle failure: show error toast, revert optimistic update, checkbox unchanged (REQ-F-24)
- Pattern follows existing file-browser.ts error handling with FileBrowserError

### TD-9: Styling Consistency with FileTree
**Choice**: Use BEM naming `.task-list__*` parallel to `.file-tree__*`, shared CSS variables
**Requirements**: REQ-NF-3
**Rationale**:
- Codebase uses BEM convention (`.file-tree__item`, `.browse-mode__tree-pane`)
- TaskList.css mirrors FileTree.css structure for visual consistency
- Reuse existing CSS variables: `--glass-bg`, `--glass-border`, `--color-text-secondary`
- Same 44px touch targets, same icon sizes, same indentation patterns
- Ensures Task List feels native to existing Browse mode

## Data Model

### TaskEntry (shared/src/protocol.ts)

```typescript
interface TaskEntry {
  /** Task text content (after checkbox) */
  text: string;
  /** Checkbox state character: ' ', 'x', '/', '?', 'b', 'f' */
  state: string;
  /** Relative file path from content root */
  filePath: string;
  /** Line number in file (1-indexed) */
  lineNumber: number;
}
```

### Task State Cycle

```
' ' (incomplete) → 'x' (complete) → '/' (partial) → '?' (needs info) → 'b' (bookmark) → 'f' (urgent) → ' '
```

### VaultConfig Extension

```typescript
interface VaultConfig {
  // Existing fields...
  contentRoot?: string;
  inboxPath?: string;
  metadataPath?: string;

  // New fields (REQ-F-1, REQ-F-2)
  projectPath?: string;  // Default: "01_Projects"
  areaPath?: string;     // Default: "02_Areas"
}
```

## API Design

### WebSocket Messages

#### Client → Server

**get_tasks** (REQ-F-18)
```typescript
{ type: "get_tasks" }
```
No parameters. Server returns all tasks from configured directories.

**toggle_task** (REQ-F-20)
```typescript
{
  type: "toggle_task",
  filePath: string,    // Relative path from content root
  lineNumber: number   // 1-indexed line number
}
```

#### Server → Client

**tasks** (REQ-F-19)
```typescript
{
  type: "tasks",
  tasks: TaskEntry[],
  incomplete: number,  // Count for rollup display
  total: number        // Count for rollup display
}
```

**task_toggled** (REQ-F-21)
```typescript
{
  type: "task_toggled",
  filePath: string,
  lineNumber: number,
  newState: string     // The new checkbox character
}
```

**error** (existing, for failures)
```typescript
{
  type: "error",
  code: "FILE_NOT_FOUND" | "PATH_TRAVERSAL" | "INTERNAL_ERROR",
  message: string
}
```

## Integration Points

### vault-config.ts
- Add `projectPath` and `areaPath` to VaultConfig interface
- Add `resolveProjectPath()` and `resolveAreaPath()` functions
- Follow pattern of `resolveMetadataPath()` - return string relative to contentRoot
- Default values: "01_Projects", "02_Areas"

### file-browser.ts
- Import `validatePath` for security checks in task-manager.ts
- No modifications to file-browser.ts itself

### websocket-handler.ts
- Add case handlers for "get_tasks" and "toggle_task" in routeMessage()
- Import and call task-manager functions
- Follow pattern of handleListDirectory/handleReadFile

### SessionContext.tsx
- Add TaskState to BrowserState interface
- Add reducer actions: SET_TASKS, SET_TASKS_LOADING, UPDATE_TASK, SET_TASKS_ERROR
- Add action creators: setTasks, setTasksLoading, updateTask, setTasksError
- Add viewMode: "files" | "tasks" to BrowserState with localStorage persistence

### BrowseMode.tsx
- Add viewMode state (default: "files", persisted to localStorage)
- Modify header "Files" to be clickable, cycling viewMode
- Conditionally render FileTree or TaskList based on viewMode
- Add get_tasks WebSocket message on component mount when viewMode is "tasks"

### protocol.ts (shared)
- Add TaskEntrySchema with Zod validation
- Add GetTasksMessageSchema, TasksMessageSchema
- Add ToggleTaskMessageSchema, TaskToggledMessageSchema
- Add to ClientMessageSchema and ServerMessageSchema discriminated unions

## Error Handling, Performance, Security

### Error Strategy
- **Directory not found**: Return empty task array, log warning (REQ-F-22)
- **Task toggle failure**: Return error message with file path, frontend shows toast (REQ-F-24)
- **Empty results**: Frontend displays "No tasks found" (REQ-F-23)
- **Pattern**: Use FileBrowserError for consistency with existing error handling

### Performance Targets
- **REQ-NF-1**: Task list loads in under 2 seconds for 500 tasks
- Parallel directory scanning reduces I/O wait
- Regex parsing is O(n) per file line count
- Frontend grouping is O(n) with single pass

### Security Measures
- **Path validation**: Reuse validatePath() from file-browser.ts
- **Line number bounds**: Validate lineNumber is within file bounds before modification
- **State character validation**: Only accept valid state characters (' ', 'x', '/', '?', 'b', 'f')
- **No new file creation**: Only modify existing files

## Testing Strategy

### Unit Tests
- **task-manager.test.ts**: Task parsing regex, state cycling, file modification
- **protocol.ts**: Zod schema validation for new message types
- **SessionContext**: TaskState reducer actions

### Integration Tests
- **WebSocket flow**: get_tasks → tasks response with mock filesystem
- **Toggle flow**: toggle_task → task_toggled with temp file verification
- **Error scenarios**: Missing directories, read-only files

### Performance Tests
- Generate vault with 500+ tasks across 100 files
- Measure get_tasks response time
- Target: < 2 seconds (REQ-NF-1)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Line number drift after file modification | M | M | Re-fetch tasks after toggle to resync; document that external edits require refresh |
| Large vaults slow task loading | L | M | Profile scanning; consider caching if needed (not in MVP) |
| Regex edge cases in task parsing | L | L | Comprehensive unit tests for various task formats |
| Mobile touch target too small | L | M | Use 44px minimum height per REQ-NF-2; test on actual devices |

## Dependencies

### Technical
- Existing: Zod, React, Hono WebSocket, Node.js fs/promises
- No new dependencies required

### Team
- No external approvals needed
- Self-contained feature within existing architecture

## Open Questions

None - all questions resolved during spec phase.
