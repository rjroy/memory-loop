---
specification: [.sdd/specs/2025-12-23-vault-browser.md](./../specs/2025-12-23-vault-browser.md)
status: Approved
version: 1.0.0
created: 2025-12-23
last_updated: 2025-12-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Browser - Technical Plan

## Overview

This plan describes how to implement the Vault Browser feature—a third mode in Memory Loop that provides read-only browsing and viewing of markdown files within Obsidian vaults.

**Key strategies**:
- Extend existing WebSocket protocol with `list_directory` and `read_file` messages
- Add browser state to SessionContext with lazy-loading tree data
- Render markdown client-side using a lightweight library with custom wiki-link handling
- Split-pane layout with responsive collapse for mobile

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────────────┐  │
│  │ModeToggle│  │FileTree  │  │MarkdownViewer             │  │
│  │(+browse) │  │Component │  │- renders markdown         │  │
│  └────┬─────┘  └────┬─────┘  │- handles wiki links       │  │
│       │             │         └────────────┬───────────────┘  │
│       └─────────────┴──────────────────────┘                  │
│                          │                                    │
│               SessionContext (browserState)                   │
│                          │                                    │
│                    useWebSocket                               │
└──────────────────────────┼────────────────────────────────────┘
                           │ WebSocket
┌──────────────────────────┼────────────────────────────────────┐
│                     Backend                                   │
│                          │                                    │
│              WebSocketHandler                                 │
│       ┌──────────┴──────────┐                                │
│       ▼                     ▼                                │
│  file-browser.ts      vault-manager.ts                       │
│  - listDirectory()    - existing vault ops                   │
│  - readFile()         - path validation                      │
└───────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **ModeToggle** | Extended to support 3 modes: note, discussion, browse |
| **BrowseMode** | Container for split-pane layout, coordinates tree + viewer |
| **FileTree** | Renders collapsible directory tree, handles expand/collapse |
| **MarkdownViewer** | Renders markdown with wiki-link support, breadcrumbs |
| **file-browser.ts** | New backend module for directory listing and file reading |

## Technical Decisions

### TD-1: WebSocket vs REST for File Operations

**Choice**: Use WebSocket messages (consistent with existing protocol)

**Requirements**: REQ-F-7, REQ-F-11

**Rationale**: The app already uses WebSocket for all client-server communication. Adding REST endpoints would:
- Require additional HTTP route configuration
- Create inconsistency in how the frontend communicates with the backend
- Not provide any performance benefit for the small payloads involved

WebSocket messages fit the existing pattern and keep the protocol unified.

### TD-2: Markdown Rendering Library

**Choice**: Use `marked` for markdown parsing with custom renderer for wiki-links

**Requirements**: REQ-F-14, REQ-F-15, REQ-F-16

**Rationale**:
- `marked` is lightweight (~32KB minified), widely used, and extensible
- Custom renderer allows intercepting link rendering for wiki-link support
- Alternatives considered:
  - `remark/rehype`: More powerful but heavier, overkill for read-only display
  - `markdown-it`: Similar to marked but slightly larger bundle
  - Raw DOM manipulation: Would require re-implementing markdown spec

### TD-3: Wiki-Link Resolution Strategy

**Choice**: Client-side resolution with backend validation on navigation

**Requirements**: REQ-F-16, REQ-F-17, REQ-F-18

**Rationale**:
- Parse wiki-links during markdown rendering: `[[note-name]]` → clickable link
- When clicked, attempt to read `note-name.md` via `read_file` message
- If file doesn't exist, backend returns error → frontend shows broken link state
- Alternative (pre-validate all links during render) rejected because:
  - Would require batch file existence check API
  - Adds latency to initial render
  - Stale validation if vault changes

### TD-4: File Tree State Management

**Choice**: Store tree state in SessionContext, not backend

**Requirements**: REQ-F-4, REQ-F-21, REQ-F-22, REQ-F-23

**Rationale**:
- Tree expand/collapse state is UI-only, doesn't need persistence
- CurrentFile path does need persistence (REQ-F-22)
- Using SessionContext keeps pattern consistent with existing mode/vault state
- Adding to existing context reducer avoids creating new state management

### TD-5: Path Traversal Prevention

**Choice**: Use `realpath` resolution and vault boundary check on every file operation

**Requirements**: REQ-F-12, REQ-NF-3

**Rationale**:
- Resolve requested path to absolute using `path.resolve(vaultPath, relativePath)`
- Verify resolved path starts with vault path
- Reject symlinks that resolve outside vault (check with `lstat`)
- This is defense-in-depth: even if client sends malicious path, server rejects

### TD-6: Split-Pane Layout Implementation

**Choice**: CSS Grid with collapsible left pane, no third-party splitter library

**Requirements**: REQ-F-2, REQ-NF-5

**Rationale**:
- CSS Grid provides simple two-column layout
- Toggle button collapses tree pane on mobile (under 768px)
- Avoids dependency on react-split-pane or similar
- Pattern matches existing responsive design (media queries at 768px, 1024px)

### TD-7: Large File Handling

**Choice**: Backend truncates files over 1MB, includes truncation flag in response

**Requirements**: REQ-F-25, REQ-NF-2

**Rationale**:
- Read file up to 1MB + 1 byte
- If length > 1MB, truncate and set `truncated: true` in response
- Frontend displays warning banner when truncated
- Prevents memory issues and ensures <500ms response time

### TD-8: UI Component Design

**Choice**: Extend existing patterns with new Browse components following established conventions

**Requirements**: REQ-F-1, REQ-F-3, REQ-F-5, REQ-F-6, REQ-NF-4, REQ-NF-6

**Rationale**:
- **ModeToggle extension**: Add "Browse" to existing modes array; component already handles N segments
- **FileTree component**: New component showing directories and `.md` files; uses existing CSS variable system
- **File click handling**: Click dispatches `read_file` message; loading state while fetching
- **Breadcrumbs**: Render path segments as clickable links; each segment navigates to parent directory listing
- **Touch targets**: All clickable elements use existing `--touch-target-min: 44px` variable
- **Styling**: Use existing CSS custom properties (colors, spacing, radius) for consistency

Follows existing component patterns (VaultSelect, NoteCapture) rather than introducing new abstractions.

### TD-9: Asset and Link Resolution

**Choice**: Custom link handler in marked renderer with URL detection and path resolution

**Requirements**: REQ-F-19, REQ-F-20

**Rationale**:
- **External URLs**: Detect `http://` / `https://` links in renderer; add `target="_blank"` and `rel="noopener"`
- **Relative images**: Resolve image paths relative to current file; prepend vault asset serving route
- **Implementation**: Custom `marked.Renderer` overrides `link()` and `image()` methods
- Vault assets served via static route (images only, not markdown files) to avoid path traversal on binary files

Image serving requires additional backend route to serve binary assets from vault with same path validation as file reading.

### TD-10: Directory Listing Format

**Choice**: Return entries sorted with directories first, then files, alphabetically within each group

**Requirements**: REQ-F-8, REQ-F-24

**Rationale**:
- Consistent display order familiar to file browser users
- Backend handles sorting (not frontend) for efficiency
- Lazy-loading: only fetch root initially; subdirectories fetched on expand
- Cache directory listings in SessionContext to avoid re-fetching on collapse/expand

## Data Model

### FileEntry (new shared type)

```typescript
interface FileEntry {
  name: string;           // "my-note.md" or "subfolder"
  type: "file" | "directory";
  path: string;           // Relative to vault root: "subfolder/my-note.md"
}
```

### BrowserState (added to SessionContext)

```typescript
interface BrowserState {
  currentPath: string | null;      // Currently viewed file path
  expandedDirs: Set<string>;       // Paths of expanded directories
  directoryCache: Map<string, FileEntry[]>;  // Cached directory listings
}
```

### WebSocket Protocol Extensions

**Client → Server**:
- `list_directory`: `{ type: "list_directory", path: string }` (path relative to vault, "" for root)
- `read_file`: `{ type: "read_file", path: string }` (path relative to vault)

**Server → Client**:
- `directory_listing`: `{ type: "directory_listing", path: string, entries: FileEntry[] }`
- `file_content`: `{ type: "file_content", path: string, content: string, truncated: boolean }`

## API Design

### WebSocket Messages

| Message | Direction | Fields | Notes |
|---------|-----------|--------|-------|
| `list_directory` | C→S | `path: string` | Empty string = vault root |
| `directory_listing` | S→C | `path`, `entries: FileEntry[]` | Sorted: dirs first, then files, alphabetically |
| `read_file` | C→S | `path: string` | Must end with `.md` |
| `file_content` | S→C | `path`, `content`, `truncated` | `truncated: true` if >1MB |

### Error Codes (extensions to ErrorCode)

| Code | When |
|------|------|
| `FILE_NOT_FOUND` | Requested file doesn't exist |
| `DIRECTORY_NOT_FOUND` | Requested directory doesn't exist |
| `PATH_TRAVERSAL` | Path escapes vault boundary |
| `INVALID_FILE_TYPE` | Requested non-.md file |

## Integration Points

### ModeToggle Component

- Extend `AppMode` type: `"note" | "discussion" | "browse"`
- Add third segment to modes array
- No other changes needed—mode switching already wired to SessionContext

### SessionContext

- Add `BrowserState` to `SessionState`
- Add actions: `setCurrentPath`, `toggleDirectory`, `cacheDirectory`, `clearBrowserState`
- `SELECT_VAULT` action clears browser state (REQ-F-23)
- `SET_MODE` does NOT clear browser state (REQ-F-22)

### WebSocketHandler

- Add cases for `list_directory` and `read_file` in `routeMessage()`
- Call new `file-browser.ts` functions
- Pattern matches existing `handleCaptureNote`, `handleDiscussionMessage`

### vault-manager.ts

- Export `isPathWithinVault(vaultPath, targetPath): boolean` utility
- Reuse existing `directoryExists()`, `fileExists()`

## Error Handling, Performance, Security

### Error Strategy

- Backend returns typed errors with codes (extends existing ErrorCode pattern)
- Frontend catches errors and displays inline (file not found, permission denied)
- Network errors trigger reconnection (existing WebSocket behavior)
- UI shows loading skeleton during directory/file fetch

### Performance Targets

| Operation | Target | How |
|-----------|--------|-----|
| Directory listing | <200ms | `readdir` is fast, limit to 500 entries |
| File read | <500ms | Single `readFile` call, 1MB limit |
| Tree expand | <50ms | Client-side state toggle, lazy fetch |
| Markdown render | <100ms | `marked` is fast, cache rendered HTML |

### Security Measures

- **Path traversal**: Server validates every path against vault boundary
- **Symlink restriction**: `lstat` check rejects symlinks (REQ-F-10)
- **File type restriction**: Only `.md` files readable (REQ-F-13)
- **Hidden file exclusion**: Skip entries starting with `.` (REQ-F-9)

## Testing Strategy

### Unit Tests

- **file-browser.ts**: Path validation, hidden file filtering, symlink detection
- **MarkdownViewer**: Wiki-link parsing, broken link detection, external link handling
- **FileTree**: Expand/collapse state, lazy loading triggers
- **SessionContext**: Browser state actions, vault switch clearing

Coverage target: 80%+ for new code

### Integration Tests

- WebSocket round-trip for `list_directory` / `read_file`
- Full flow: select vault → browse mode → expand directory → view file → wiki-link navigation
- Path traversal attack scenarios (blocked by server)

### Performance Tests

- Measure directory listing time with 500 files
- Measure file render time with 1MB markdown
- Verify lazy-loading doesn't block UI

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wiki-link format edge cases | M | M | Test with real Obsidian vaults; handle aliases, paths with spaces |
| Large vault performance | M | M | Lazy-load directories; pagination if needed (future) |
| Symlink traversal bypass | L | H | Defense-in-depth: realpath + boundary check + lstat |
| Markdown rendering XSS | L | H | Use `marked` with sanitization; no raw HTML in markdown |

## Dependencies

### Technical

- `marked`: Markdown parsing (~32KB)
- No other new dependencies required

### Team

- None—feature is self-contained

## Open Questions

*All questions resolved during spec phase.*
