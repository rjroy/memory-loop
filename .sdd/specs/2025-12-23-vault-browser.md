---
version: 1.0.0
status: Approved
created: 2025-12-23
last_updated: 2025-12-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Browser Specification

## Executive Summary

Memory Loop currently supports two modes: Note Capture and Discussion. This feature adds a third mode—Browse—that allows users to navigate and view markdown files within their selected Obsidian vault.

The browser presents a split-pane interface with a collapsible file tree on the left and a markdown viewer on the right. Users can navigate directories, open files, and follow wiki-style links between notes. This provides read-only access to vault content without leaving the Memory Loop interface.

## User Story

As a Memory Loop user, I want to browse and read markdown files in my vault, so that I can reference my notes while capturing new ones or having discussions.

## Stakeholders

- **Primary**: Memory Loop end users viewing vault content
- **Secondary**: Developers maintaining the Memory Loop codebase
- **Tertiary**: Obsidian users sharing vaults, system administrators deploying Memory Loop

## Success Criteria

1. Users can view any markdown file in their vault within 500ms of selection
2. Directory tree renders with correct hierarchy matching filesystem structure
3. Wiki-style links (`[[note-name]]`) navigate to target files when clicked
4. Split-pane layout remains usable on mobile viewports (375px minimum width)

## Functional Requirements

### Mode & Navigation

- **REQ-F-1**: Add "Browse" as a third mode option in ModeToggle (alongside Note and Discussion)
- **REQ-F-2**: Browse mode displays a split-pane layout with file tree (left) and content viewer (right)
- **REQ-F-3**: File tree shows all directories and `.md` files in the selected vault
- **REQ-F-4**: Directories are expandable/collapsible; state persists during session
- **REQ-F-5**: Clicking a file loads its content in the viewer pane
- **REQ-F-6**: Breadcrumb trail shows current file path; segments are clickable to navigate up

### File Listing Backend

- **REQ-F-7**: Backend provides endpoint/message to list directory contents (files and subdirectories)
- **REQ-F-8**: Directory listing includes: name, type (file/directory), path relative to vault root
- **REQ-F-9**: Hidden files/directories (starting with `.`) are excluded from listings
- **REQ-F-10**: Symlinks are not followed (security boundary)
- **REQ-F-24**: Directory tree lazy-loads subdirectories on expand (not fetched upfront)

### File Reading Backend

- **REQ-F-11**: Backend provides endpoint/message to read a markdown file's content
- **REQ-F-12**: File read requests validate the path is within the vault boundary (no path traversal)
- **REQ-F-13**: Non-markdown files return an error (only `.md` files readable via this feature)
- **REQ-F-25**: Files exceeding 1MB display truncation warning instead of full content

### Markdown Rendering

- **REQ-F-14**: Markdown content renders as styled HTML in the viewer pane
- **REQ-F-15**: Rendering supports: headings, lists, code blocks, links, images, blockquotes, tables
- **REQ-F-16**: Wiki-style links (`[[note-name]]` and `[[note-name|display text]]`) render as clickable links
- **REQ-F-17**: Clicking a wiki link navigates to that file in the viewer (if it exists)
- **REQ-F-18**: Broken wiki links (target doesn't exist) display with visual indication (e.g., red styling)
- **REQ-F-19**: External URLs open in new browser tab
- **REQ-F-20**: Images with relative paths resolve correctly from the vault root

### State Management

- **REQ-F-21**: Currently viewed file path persists in session state
- **REQ-F-22**: Switching modes (Note/Discussion/Browse) and back preserves the last viewed file
- **REQ-F-23**: Switching vaults clears browser state (tree collapse state, current file)

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Directory listings return within 200ms for directories with up to 500 items
- **REQ-NF-2** (Performance): File content loads within 500ms for files up to 1MB
- **REQ-NF-3** (Security): Path traversal attacks prevented via server-side validation
- **REQ-NF-4** (Usability): Touch targets minimum 44px height for mobile accessibility
- **REQ-NF-5** (Responsiveness): Layout adapts to viewport; tree collapses to overlay on narrow screens
- **REQ-NF-6** (Consistency): Follow existing Memory Loop styling (CSS variables, component patterns)

## Explicit Constraints (DO NOT)

- Do NOT allow file editing or saving (read-only in this phase)
- Do NOT follow symlinks outside the vault directory
- Do NOT render non-markdown files (images can display inline, but not as standalone viewer)
- Do NOT cache file contents aggressively (vault may be edited externally in Obsidian)
- Do NOT implement search functionality (future enhancement)
- Do NOT support Obsidian plugins/custom syntax beyond standard wiki links

## Technical Context

- **Existing Stack**: React 19, Vite, Hono backend, WebSocket protocol, Zod validation
- **Integration Points**:
  - ModeToggle component (add "Browse" option)
  - SessionContext (add browser state)
  - WebSocket protocol (add list_directory, read_file messages)
  - vault-manager.ts (extend with file operations)
- **Patterns to Respect**:
  - Zod schemas for message validation
  - CSS modules/vanilla CSS (no Tailwind)
  - 44px touch targets
  - Custom error classes with `.code` property

## Acceptance Tests

1. **Tree Renders**: Open Browse mode, verify file tree shows vault structure matching filesystem
2. **Directory Expand**: Click directory, verify children appear; click again, verify collapse
3. **File View**: Click markdown file, verify content renders in viewer pane with formatting
4. **Wiki Link Navigation**: Click `[[other-note]]` in rendered content, verify navigation to that file
5. **Broken Link Styling**: Render file with `[[nonexistent]]`, verify link shows broken indicator
6. **Path Traversal Blocked**: Attempt to request `../../etc/passwd`, verify error response
7. **Mobile Layout**: View at 375px width, verify tree collapses and content remains usable
8. **Mode Persistence**: Open file in Browse, switch to Note mode, switch back, verify same file displayed

## Open Questions

*All questions resolved.*

## Out of Scope

- File editing/saving
- Full-text search across vault
- Obsidian plugin compatibility (dataview, templater, etc.)
- File creation or deletion
- Tag/backlink navigation
- Embedded note transclusion (`![[note]]` syntax)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
