---
specification: [.sdd/specs/2025-12-30-recall-adjust.md](./../specs/2025-12-30-recall-adjust.md)
status: Approved
version: 1.0.0
created: 2025-12-30
last_updated: 2025-12-30
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Recall Tab Adjust Feature - Technical Plan

## Overview

This plan extends the Recall tab (BrowseMode) with lightweight file editing capability. The approach adds minimal new code by reusing existing patterns:

- **State**: Extend `BrowserState` in SessionContext with `isAdjusting` and `adjustContent` fields
- **Protocol**: Add `write_file` / `file_written` message types following existing Zod patterns
- **Backend**: Add `writeMarkdownFile()` to file-browser.ts mirroring `readMarkdownFile()`
- **Frontend**: Conditionally render textarea in MarkdownViewer when `isAdjusting` is true

The implementation prioritizes simplicity: no new components, no new contexts, no external dependencies.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐ │
│  │  BrowseMode  │───▶│  MarkdownViewer   │◀───│SessionContext│ │
│  │  (container) │    │  (view/edit mode) │    │(browser state)│ │
│  └──────────────┘    └─────────┬─────────┘    └──────────────┘ │
│                                │                                 │
│                        useWebSocket                              │
└────────────────────────────────┼────────────────────────────────┘
                                 │ WebSocket
┌────────────────────────────────┼────────────────────────────────┐
│                         Backend│                                 │
│  ┌──────────────────┐    ┌─────▼─────────┐    ┌──────────────┐ │
│  │websocket-handler │───▶│ file-browser  │───▶│  Filesystem  │ │
│  │  (routing)       │    │ (read/write)  │    │    (vault)   │ │
│  └──────────────────┘    └───────────────┘    └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Components Modified

| Component | Change | Requirements |
|-----------|--------|--------------|
| `SessionContext.tsx` | Add `isAdjusting`, `adjustContent` to BrowserState; add actions | REQ-F-7, REQ-F-8, REQ-F-9 |
| `MarkdownViewer.tsx` | Conditional textarea rendering; Adjust/Save/Cancel buttons with ARIA labels | REQ-F-1 to REQ-F-6, REQ-NF-2 to REQ-NF-4 |
| `MarkdownViewer.css` | Styles for adjust mode UI | REQ-NF-2, REQ-NF-4 |
| `protocol.ts` | `write_file`, `file_written` schemas | REQ-F-10, REQ-F-11 |
| `file-browser.ts` | `writeMarkdownFile()` function | REQ-F-12, REQ-F-13, REQ-NF-5 |
| `websocket-handler.ts` | `handleWriteFile()` handler | REQ-F-12, REQ-F-16 |

## Technical Decisions

### TD-1: Extend BrowserState vs. New Context

**Choice**: Extend existing `BrowserState` interface in SessionContext

**Requirements**: REQ-F-7, REQ-F-8, REQ-F-9

**Rationale**: The adjust state is tightly coupled to the browser's current file view:
- `isAdjusting` depends on `currentFileContent` being loaded
- `adjustContent` is initialized from `currentFileContent`
- Clearing adjust state on navigation (REQ-F-9) naturally happens in `SET_CURRENT_PATH` reducer

Creating a separate context would require synchronization between two state sources. BrowserState already manages file-related state, so extending it keeps related state co-located.

### TD-2: Textarea in MarkdownViewer vs. New Component

**Choice**: Conditional rendering within MarkdownViewer

**Requirements**: REQ-F-1, REQ-F-2, REQ-F-3

**Rationale**: MarkdownViewer already handles all file content display states (loading, error, empty, content). Adding adjust mode as another conditional branch keeps the component's responsibility cohesive: "display/interact with the current file's content."

A separate AdjustEditor component would require:
- Prop drilling or context for file content
- Coordination with MarkdownViewer for mode switching
- Duplicate breadcrumb rendering

The conditional approach is simpler and the component remains under 400 lines.

### TD-3: Synchronous Save with Loading State

**Choice**: Show loading indicator during save; block UI until complete

**Requirements**: REQ-F-4, REQ-NF-1, REQ-F-15

**Rationale**: Optimistic updates (immediately returning to view mode) risk data loss if save fails. With the synchronous approach:
- User sees explicit feedback that save is in progress
- On success, content is refreshed from `file_written` response
- On error, textarea remains with user's content intact (REQ-F-15)

The 500ms performance target (REQ-NF-1) makes this acceptable UX.

### TD-4: Reuse Existing Path Validation

**Choice**: `writeMarkdownFile()` calls `validatePath()` before writing

**Requirements**: REQ-F-12, REQ-NF-5

**Rationale**: `validatePath()` in file-browser.ts already handles:
- Path traversal detection (`../` sequences)
- Symlink rejection
- Vault boundary enforcement

Reusing this ensures write operations have identical security guarantees to read operations. The function is already tested and battle-hardened.

### TD-5: No New Error Codes

**Choice**: Reuse existing `ErrorCode` values for write failures

**Requirements**: REQ-F-14, REQ-F-16

**Rationale**: The existing error codes cover all write failure scenarios:
- `PATH_TRAVERSAL` - Path escapes vault boundary
- `INVALID_FILE_TYPE` - Non-.md file
- `FILE_NOT_FOUND` - Target path doesn't exist (parent directory missing)
- `INTERNAL_ERROR` - Permission denied, disk full, etc.

Adding `FILE_WRITE_FAILED` would require protocol schema changes, frontend error handling updates, and provides no additional user-actionable information over `INTERNAL_ERROR`.

### TD-6: Escape Key Handling via onKeyDown

**Choice**: Attach `onKeyDown` handler to textarea element

**Requirements**: REQ-F-6

**Rationale**: Options considered:
1. **Global keydown listener** - Would interfere with other components; requires cleanup
2. **useEffect with document listener** - Same issues; complexity for simple case
3. **onKeyDown on textarea** - Fires only when textarea focused; automatically scoped

The textarea is always focused in adjust mode, so option 3 handles REQ-F-6 with minimal code. The handler checks `e.key === "Escape"` and calls the cancel action.

## Data Model

### BrowserState Extension

```typescript
interface BrowserState {
  // Existing fields...
  currentPath: string;
  currentFileContent: string | null;
  // ...

  // New fields for adjust mode
  isAdjusting: boolean;        // REQ-F-7
  adjustContent: string;        // REQ-F-8
  adjustError: string | null;   // REQ-F-14
  isSaving: boolean;            // Loading state for save operation
}
```

### New Reducer Actions

```typescript
type SessionAction =
  // Existing actions...
  | { type: "START_ADJUST" }                    // Enter adjust mode
  | { type: "UPDATE_ADJUST_CONTENT"; content: string }  // Track edits
  | { type: "CANCEL_ADJUST" }                   // Exit without saving
  | { type: "START_SAVE" }                      // Begin save operation
  | { type: "SAVE_SUCCESS" }                    // Save completed
  | { type: "SAVE_ERROR"; error: string };      // Save failed
```

## API Design

### WebSocket Protocol Extensions

**Client → Server: `write_file`**
```typescript
const WriteFileMessageSchema = z.object({
  type: z.literal("write_file"),
  path: z.string().min(1, "File path is required"),
  content: z.string(),  // Empty string is valid (clearing file)
});
```

**Server → Client: `file_written`**
```typescript
const FileWrittenMessageSchema = z.object({
  type: z.literal("file_written"),
  path: z.string().min(1),
  success: z.literal(true),
});
```

Write failures use the existing `error` message type with appropriate `ErrorCode`.

### Backend Function

```typescript
// file-browser.ts
export async function writeMarkdownFile(
  vaultPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  // 1. Validate .md extension
  // 2. Validate path within vault via validatePath()
  // 3. Check file exists (no creating new files)
  // 4. Write content with writeFile()
  // Throws FileBrowserError on failure
}
```

## Integration Points

### SessionContext Integration

**Entry point**: `setStartAdjust()` action
**Data flow**:
1. User clicks "Adjust" → dispatches `START_ADJUST`
2. Reducer copies `currentFileContent` to `adjustContent`
3. Sets `isAdjusting: true`
4. MarkdownViewer renders textarea with `adjustContent`

**Exit points**:
- Cancel: `setCancelAdjust()` → clears `isAdjusting` and `adjustContent`
- Save success: `file_written` message → clears adjust state, refreshes content
- Navigation: `SET_CURRENT_PATH` → clears adjust state (REQ-F-9)

### WebSocket Handler Integration

**Entry point**: `routeMessage()` switch case for `write_file`
**Data flow**:
1. Validate vault is selected
2. Call `writeMarkdownFile(vaultPath, path, content)`
3. On success: send `file_written` message
4. On error: send `error` message with appropriate code

Pattern matches existing `handleReadFile()` handler.

### MarkdownViewer Integration

**Conditional rendering logic**:
```
if (isLoading) → LoadingSkeleton
else if (fileError) → Error display
else if (!currentFileContent) → Empty state
else if (isAdjusting) → Textarea with Save/Cancel  ← NEW
else → Rendered markdown
```

The Adjust button renders in the header area (alongside breadcrumb) only when `currentFileContent` exists and `!isAdjusting`.

**Accessibility (REQ-NF-3)**: All buttons include ARIA labels:
- `aria-label="Adjust file"` on Adjust button
- `aria-label="Save changes"` on Save button
- `aria-label="Cancel editing"` on Cancel button

## Error Handling, Performance, Security

### Error Strategy

- **Validation errors** (path, file type): Return immediately with specific error code
- **Filesystem errors** (permissions, disk): Catch and wrap in `INTERNAL_ERROR`
- **Frontend display**: Show inline error above textarea; preserve content for retry

Error flow:
```
writeMarkdownFile throws → handleWriteFile catches → sends error message
                                                           ↓
MarkdownViewer receives → dispatches SAVE_ERROR → shows adjustError
```

### Performance Targets

- **Save latency**: < 500ms for files under 100KB (REQ-NF-1)
  - Node.js `writeFile` is fast for small files
  - No additional processing (no validation of markdown syntax, no indexing)

- **UI responsiveness**: Textarea input should not lag
  - React's controlled input with local state update is sufficient
  - `adjustContent` updates on every keystroke via `onChange`

### Security Measures

All inherited from existing read path:
- **Path validation**: `validatePath()` rejects traversal attempts
- **File type restriction**: Only `.md` files writable
- **Vault boundary**: `isPathWithinVault()` check before any operation
- **Symlink rejection**: `lstat()` check rejects symbolic links

Additional for write:
- **File must exist**: No creating new files via adjust (prevents arbitrary file creation)

## Testing Strategy

### Unit Tests

**SessionContext reducer tests** (frontend/src/contexts/__tests__/):
- `START_ADJUST` copies content, sets flag
- `UPDATE_ADJUST_CONTENT` updates content
- `CANCEL_ADJUST` clears state
- `SET_CURRENT_PATH` clears adjust state when navigating
- `SAVE_ERROR` preserves content, sets error

**file-browser.ts tests** (backend/src/__tests__/):
- `writeMarkdownFile` writes content correctly
- Rejects non-.md extensions
- Rejects path traversal attempts
- Rejects paths outside vault
- Handles write permission errors

### Integration Tests

**WebSocket handler tests** (backend/src/__tests__/):
- `write_file` message writes file and returns `file_written`
- Returns `PATH_TRAVERSAL` error for `../` paths
- Returns `INVALID_FILE_TYPE` for non-.md files
- Returns `VAULT_NOT_FOUND` when no vault selected

**MarkdownViewer tests** (frontend/src/components/__tests__/):
- Renders Adjust button when file is loaded
- Switches to textarea on Adjust click
- Escape key triggers cancel
- Shows error message on save failure

### E2E Test Scenarios

Mapping to acceptance tests from spec:
1. Basic edit round-trip → Verify file content changes on disk
2. Cancel discards changes → Verify file unchanged
3. Escape key cancels → Keyboard interaction test
4. Navigation clears state → State cleanup verification
5. Error handling → Mock permission error, verify UI
6. Path security → Attempt `../` path, verify rejection
7. File type validation → Attempt `.txt`, verify rejection
8. Mobile layout → Viewport test at 375px width

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race condition: user saves while file changed externally | Low | Medium | Document limitation; future: add conflict detection |
| Large file causes UI lag | Low | Low | Files > 1MB already truncated on read |
| Mobile keyboard covers textarea | Medium | Low | CSS ensures textarea scrolls into view |

## Dependencies

### Technical
- No new npm packages required
- Uses existing Zod, React, Node.js fs/promises

### Team
- No external approvals needed
- Self-contained within Memory Loop codebase

## Open Questions

None - all technical decisions resolved.

---

**Next Phase**: Once approved, use `/spiral-grove:task-breakdown` to decompose into implementable tasks.
