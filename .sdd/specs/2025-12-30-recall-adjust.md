---
version: 1.0.0
status: Approved
created: 2025-12-30
last_updated: 2025-12-30
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Recall Tab Adjust Feature Specification

## Executive Summary

Memory Loop's Recall tab (BrowseMode) currently provides read-only access to vault files. Users frequently need to make small adjustments to recalled notes - marking tasks done, fixing typos, promoting bullets to tasks - but must leave Memory Loop entirely to do so.

This feature adds a minimal "Adjust" button that switches the MarkdownViewer from rendered output to a plain textarea for direct editing, with Save/Cancel controls. The intentionally basic interface signals that this is for quick tweaks, not comprehensive editing.

## User Story

As a Memory Loop user viewing a recalled note, I want to make small adjustments directly in the app, so that I don't have to switch to another tool for minor edits.

## Stakeholders

- **Primary**: Mobile users who discovered something to fix while reviewing notes
- **Secondary**: Desktop users preferring in-app quick edits over opening Obsidian

## Success Criteria

1. User can edit any `.md` file currently displayed in the Recall tab
2. Edits persist to the vault filesystem immediately on Save
3. No data loss - original content preserved if user cancels or encounters an error
4. Mobile-first: touch-friendly textarea and buttons work on small screens

## Functional Requirements

### Core Edit Flow

- **REQ-F-1**: Display an "Adjust" button in the MarkdownViewer header when a file is loaded
- **REQ-F-2**: Clicking "Adjust" replaces the rendered markdown with a plain `<textarea>` containing the raw file content
- **REQ-F-3**: Display "Save" and "Cancel" buttons while in adjust mode
- **REQ-F-4**: "Save" writes the textarea content back to the vault file and returns to view mode
- **REQ-F-5**: "Cancel" discards changes and returns to view mode without saving
- **REQ-F-6**: Pressing Escape while in adjust mode triggers Cancel behavior

### State Management

- **REQ-F-7**: Track adjust mode state (`isAdjusting: boolean`) in the browser context
- **REQ-F-8**: Store pending content (`adjustContent: string`) while editing
- **REQ-F-9**: Clear adjust state when navigating to a different file

### Backend Protocol

- **REQ-F-10**: Add `write_file` message type to ClientMessage schema (path, content)
- **REQ-F-11**: Add `file_written` message type to ServerMessage schema (path, success)
- **REQ-F-12**: Backend validates path is within vault boundary before writing
- **REQ-F-13**: Backend only allows writing to `.md` files

### Error Handling

- **REQ-F-14**: Display inline error if save fails (permissions, path issues)
- **REQ-F-15**: Preserve textarea content on error so user can retry or copy content
- **REQ-F-16**: Log errors server-side with appropriate error codes

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Save operation completes within 500ms for files under 100KB
- **REQ-NF-2** (Usability): Textarea fills available viewport; minimum height 200px
- **REQ-NF-3** (Accessibility): Adjust/Save/Cancel buttons have appropriate ARIA labels
- **REQ-NF-4** (Consistency): Button styling matches existing BrowseMode header buttons
- **REQ-NF-5** (Security): All write operations use same path validation as read operations

## Explicit Constraints (DO NOT)

- Do NOT implement syntax highlighting in the textarea
- Do NOT implement live markdown preview
- Do NOT add undo/redo functionality beyond browser defaults
- Do NOT support creating new files from the Recall tab
- Do NOT allow editing non-markdown files
- Do NOT add auto-save functionality
- Do NOT add a confirmation dialog before canceling (simple Cancel is sufficient for this minimal feature)

## Technical Context

- **Existing Stack**: React 19 frontend, Hono backend, WebSocket protocol with Zod validation
- **Integration Points**:
  - `BrowseMode.tsx` - Container that coordinates FileTree and MarkdownViewer
  - `MarkdownViewer.tsx` - Currently read-only; will conditionally render textarea
  - `SessionContext.tsx` - State management; needs `isAdjusting` and `adjustContent`
  - `protocol.ts` - Shared Zod schemas for WebSocket messages
  - `file-browser.ts` - Backend file operations; needs `writeMarkdownFile` function
  - `websocket-handler.ts` - Routes messages; needs `write_file` handler
- **Patterns to Respect**:
  - All file operations validate paths via `validatePath()` before access
  - Messages use Zod discriminated unions for type safety
  - Error responses use `ErrorCode` enum (`PATH_TRAVERSAL`, `INVALID_FILE_TYPE`, etc.)
  - CSS follows BEM naming with component-specific class prefixes

## Acceptance Tests

1. **Basic edit round-trip**: Load a file, click Adjust, modify text, click Save. Verify file on disk reflects changes.
2. **Cancel discards changes**: Load a file, click Adjust, modify text, click Cancel. Verify original content is restored in viewer.
3. **Escape key cancels**: While in adjust mode, press Escape. Verify returns to view mode without saving.
4. **Navigation clears state**: While in adjust mode, click a different file. Verify new file loads normally (no stale edit state).
5. **Error handling**: Attempt to save to a path that fails (mock permission error). Verify error message displays and content remains in textarea.
6. **Path security**: Attempt to write a path containing `../`. Verify backend rejects with PATH_TRAVERSAL error.
7. **File type validation**: Attempt to write to a `.txt` file. Verify backend rejects with INVALID_FILE_TYPE error.
8. **Mobile layout**: On viewport under 600px, verify Adjust button is accessible and textarea is usable.

## Open Questions

- [ ] None - scope is well-defined by issue #86

## Out of Scope

- Syntax highlighting
- Live markdown preview
- Inline task checkbox toggling (future enhancement per issue)
- Creating new notes from Recall
- Collaborative editing / conflict detection
- Version history / undo beyond single session

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
