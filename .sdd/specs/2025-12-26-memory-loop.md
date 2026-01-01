---
version: 1.0.0
status: Draft
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Claude Code <noreply@anthropic.com>
reverse_engineered: true
source_modules:
  - backend/
  - frontend/
  - shared/
child_specs:
  - memory-loop/2025-12-26-vault-selection.md
  - memory-loop/2025-12-26-navigation-bar.md
  - memory-loop/2025-12-26-home.md
  - memory-loop/2025-12-26-note-capture.md
  - memory-loop/2025-12-26-chat.md
  - memory-loop/2025-12-26-view.md
  - memory-loop/2025-12-31-task-list.md
---

# Memory Loop Specification

## Executive Summary

Memory Loop is a mobile-friendly web application for interacting with Obsidian vaults via Claude AI. It provides a streamlined interface for two primary workflows: quick note capture for fleeting thoughts and AI-powered discussions for deeper exploration of vault content.

The application is designed as a companion to Obsidian, enabling users to access their knowledge base from any device without requiring the desktop application. It respects vault structure, integrates with existing organizational patterns (daily notes, goals files), and uses Claude AI to provide contextual assistance grounded in the user's own knowledge.

Memory Loop is structured as 6 integrated features that share common infrastructure: Vault Selection, Navigation Bar, Home Dashboard, Note Capture, Chat, and View. Each feature has its own detailed specification; this document defines how they work together as a cohesive application.

## User Story

As an Obsidian user on a mobile device or away from my primary computer, I want to capture notes and have AI-assisted conversations with my vault, so that I can maintain my knowledge practice without friction regardless of where I am.

## Stakeholders

- **Primary**: Obsidian vault users who want mobile/web access to their knowledge base
- **Secondary**: Users who prefer AI-assisted workflows for exploring and building on their notes
- **Tertiary**: Developers maintaining the Memory Loop codebase

## Success Criteria

1. Users can select a vault, navigate between modes, and perform core actions (capture, chat, browse) within 3 taps from any state
2. All user input is preserved across connection interruptions (drafts persist locally, sessions resume server-side)
3. Application provides responsive experience on mobile (touch targets ≥44px, no horizontal scroll)
4. AI conversations maintain context within a session and can be resumed across browser sessions

## Feature Composition

Memory Loop consists of 7 features that integrate through shared state and infrastructure:

### User Flow

```
[Vault Selection] → [Home Dashboard] ⟷ [Navigation Bar] ⟷ [Note Capture]
                                                        ⟷ [Chat]
                                                        ⟷ [View] ⟷ [Task List]
```

1. **Vault Selection** (`2025-12-26-vault-selection.md`): Entry point. User selects which Obsidian vault to work with. Vaults must contain CLAUDE.md to be valid.

2. **Home Dashboard** (`2025-12-26-home.md`): Landing page after vault selection. Displays 4 sections: Goals (from vault), Inspiration (AI-generated), Recent Activity, and session stats. Provides quick-resume links.

3. **Navigation Bar** (`2025-12-26-navigation-bar.md`): Persistent mode switcher. Four modes: Home, Note, Chat, View. Enables fluid transitions without losing context.

4. **Note Capture** (`2025-12-26-note-capture.md`): Quick capture mode. Text goes to daily notes in `YYYY-MM-DD.md` format with HH:MM timestamps. Optimized for fast input.

5. **Chat** (`2025-12-26-chat.md`): Discussion mode. AI conversations powered by Claude Agent SDK. Sessions persist and can be resumed. Tool use is displayed inline.

6. **View** (`2025-12-26-view.md`): File browser mode. Navigate vault structure, read markdown files, follow wiki-links. Read-only access with security boundaries.

7. **Task List** (`2025-12-31-task-list.md`): Task aggregation within View mode. Displays markdown tasks from inbox/projects/areas directories. Toggle between File Tree and Task List via header click.

### Shared State

All features share state through `SessionContext`:
- `vault`: Currently selected VaultInfo (null until selected)
- `mode`: Current AppMode (home | note | chat | view)
- `sessionId`: Active discussion session (null until first chat message)
- `messages`: Conversation history for current session
- `browserPath`: Current location in file browser

### Integration Points

| From | To | Trigger |
|------|-----|---------|
| Home → Chat | Click discussion in Recent Activity | Prefills message, switches mode |
| Home → Note | Click capture in Recent Activity | Switches to note mode |
| Home → View | Click file path | Switches to view mode, navigates to file |
| Chat → View | AI references a file | User can click to open in viewer |
| View → Chat | User wants to discuss a file | Can reference current file in chat |
| View ⟷ Task List | Click "Files" header | Toggles between File Tree and Task List |
| Any → Home | Click Home in nav bar | Returns to dashboard |

## Functional Requirements

### Application Lifecycle

- **REQ-F-1**: Application must discover vaults from configured `VAULTS_DIR` on startup
- **REQ-F-2**: Application must validate vault has CLAUDE.md before allowing selection
- **REQ-F-3**: Application must establish WebSocket connection on page load
- **REQ-F-4**: Application must reconnect WebSocket automatically on disconnect (exponential backoff)
- **REQ-F-5**: Application must preserve vault selection in SessionContext (not localStorage)
- **REQ-F-6**: Application must clear all state when user selects a different vault

### Session Management

- **REQ-F-7**: Sessions must be created lazily (on first `discussion_message`, not on vault select)
- **REQ-F-8**: Sessions must persist to disk at `.memory-loop/sessions/{sessionId}.json`
- **REQ-F-9**: Sessions must be resumable via `resume_session` message with sessionId
- **REQ-F-10**: Session history must be sent to client on resume (messages array)
- **REQ-F-11**: "New Session" action must create fresh session while preserving vault binding
- **REQ-F-12**: Application must track most recent session per vault for auto-resume

### WebSocket Protocol

- **REQ-F-13**: All client-server communication must use WebSocket (except initial vault list via HTTP)
- **REQ-F-14**: All messages must be validated with Zod schemas before processing
- **REQ-F-15**: Invalid messages must return `error` with code `VALIDATION_ERROR`
- **REQ-F-16**: Server must respond to `ping` with `pong` for connection keepalive
- **REQ-F-17**: Client must send `ping` every 30 seconds to maintain connection
- **REQ-F-18**: `abort` message must cancel any in-progress AI response

### Vault Binding

- **REQ-F-19**: All file operations must be scoped to selected vault
- **REQ-F-20**: Path traversal attempts (../) must be rejected with `PATH_TRAVERSAL` error
- **REQ-F-21**: File reads must be restricted to .md files only
- **REQ-F-22**: Vault goals must be extracted from CLAUDE.md `## Goals` section if present

### Error Handling

- **REQ-F-23**: All errors must use typed ErrorCode enum (12 defined codes)
- **REQ-F-24**: Errors must include human-readable message alongside code
- **REQ-F-25**: Frontend must display errors appropriately (toast, inline, or modal based on severity)
- **REQ-F-26**: Network errors must trigger reconnection, not error display

## Non-Functional Requirements

### Performance

- **REQ-NF-1**: Initial page load must complete in <2 seconds on 4G connection
- **REQ-NF-2**: Mode switches must complete in <200ms (no server round-trip required)
- **REQ-NF-3**: AI response streaming must begin within 2 seconds of message send
- **REQ-NF-4**: File tree expansion must complete in <500ms for directories with <100 items

### Reliability

- **REQ-NF-5**: Draft text must persist to localStorage on every keystroke
- **REQ-NF-6**: WebSocket must reconnect automatically with exponential backoff (max 30s)
- **REQ-NF-7**: Application must remain usable during temporary disconnection (local state preserved)
- **REQ-NF-8**: Session data must survive server restart (persisted to disk)

### Usability

- **REQ-NF-9**: All interactive elements must have minimum 44px touch target
- **REQ-NF-10**: Application must be fully usable without horizontal scrolling on 320px viewport
- **REQ-NF-11**: Current mode must be visually indicated in navigation bar
- **REQ-NF-12**: Loading states must be indicated for all async operations

### Accessibility

- **REQ-NF-13**: All interactive elements must have ARIA labels
- **REQ-NF-14**: Focus must be managed appropriately on mode switches
- **REQ-NF-15**: Color contrast must meet WCAG 2.1 AA standards

### Security

- **REQ-NF-16**: All file paths must be validated to prevent traversal attacks
- **REQ-NF-17**: Session IDs must be cryptographically random (UUID v4)
- **REQ-NF-18**: No vault content may be cached in localStorage (only drafts and UI state)

### Maintainability

- **REQ-NF-19**: All WebSocket messages must be validated with Zod schemas
- **REQ-NF-20**: All errors must use typed ErrorCode (no string literals)
- **REQ-NF-21**: Protocol definitions must be shared between frontend and backend (shared/ package)

## Explicit Constraints (DO NOT)

- Do NOT store vault content in localStorage (security: other sites could access)
- Do NOT auto-submit forms on Enter in multi-line inputs (Shift+Enter for newline, Enter to submit in single-line only)
- Do NOT make API calls without vault selected (all operations require vault context)
- Do NOT expose Claude Agent SDK events directly to frontend (translate to protocol messages)
- Do NOT allow file writes from frontend (read-only vault access, except note capture to inbox)
- Do NOT bundle backend code (Claude Agent SDK requires running from source)
- Do NOT use relative imports across workspace boundaries (use package imports)

## Technical Context

### Existing Stack

- **Runtime**: Bun (backend and frontend build)
- **Backend**: Hono (HTTP/WebSocket server), Claude Agent SDK (AI conversations)
- **Frontend**: React 19, Vite, TypeScript strict mode
- **Shared**: Zod schemas for protocol validation
- **Testing**: Bun test, @testing-library/react, happy-dom

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              SessionContext (state)               │   │
│  │  vault | mode | sessionId | messages | browser   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │
│  │VaultSel.│ │  Home   │ │  Note   │ │    Chat     │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │
│  ┌─────────┐ ┌─────────────────────────────────────┐   │
│  │  View   │ │         Navigation Bar              │   │
│  └─────────┘ └─────────────────────────────────────┘   │
│                    useWebSocket (hook)                   │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket
┌────────────────────────┴────────────────────────────────┐
│                    Backend (Hono)                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │            WebSocket Handler (router)             │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐   │
│  │VaultManager │ │SessionMgr   │ │ NoteCapture     │   │
│  └─────────────┘ └─────────────┘ └─────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐   │
│  │FileBrowser  │ │InspirationMgr│ │ Claude SDK     │   │
│  └─────────────┘ └─────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### WebSocket Message Types

**Client → Server** (13 message types):
- `select_vault`, `capture_note`, `discussion_message`, `resume_session`, `new_session`, `abort`, `ping`
- `list_directory`, `read_file`, `get_recent_notes`, `get_recent_activity`, `get_goals`, `get_inspiration`

**Server → Client** (16 message types):
- `vault_list`, `session_ready`, `note_captured`, `pong`, `error`
- `response_start`, `response_chunk`, `response_end` (AI streaming)
- `tool_start`, `tool_input`, `tool_end` (tool use display)
- `directory_listing`, `file_content`, `recent_notes`, `recent_activity`, `goals`, `inspiration`

### Patterns to Respect

- **Discriminated unions**: All message types use `type` field for discrimination
- **Custom error classes**: Backend errors have `.code` property matching ErrorCode
- **Zod safeParse**: Use `safeParse` for untrusted input, `parse` for trusted
- **Ref-based state**: Use refs for values needed in callbacks but not for rendering
- **Mobile-first CSS**: Design for smallest viewport first, enhance for larger

## Acceptance Tests

1. **Full user journey**: User can select vault → view home → capture note → start chat → browse files → return home
2. **Session persistence**: Close browser, reopen → can resume previous chat session with history intact
3. **Draft recovery**: Type note, lose connection, reconnect → draft text still in textarea
4. **Mode switching**: Switch between all 4 modes rapidly → no state corruption, current mode always indicated
5. **Vault isolation**: Select vault A, capture note, select vault B → note only in vault A's daily file
6. **Error recovery**: Disconnect during AI response → reconnects, can send new message
7. **Mobile layout**: View on 320px width → all features accessible, no horizontal scroll
8. **Deep linking**: Click file in Recent Activity → switches to View mode with file loaded
9. **Session resume from Home**: Click discussion in Recent Activity → Chat opens with prefilled context

## Open Questions

- [ ] Should sessions expire after inactivity? (Currently persist indefinitely)
- [ ] Should there be a maximum number of sessions per vault?
- [ ] Should file browser support image preview or only markdown?
- [ ] Should note capture support voice input on mobile?

## Out of Scope

- Vault creation or management (users manage vaults in Obsidian)
- File editing or deletion (read-only except note capture to inbox)
- Offline mode with sync (requires connection to backend)
- Multi-vault views or cross-vault search
- User authentication (single-user local deployment assumed)
- Plugin system or extensibility
- Desktop application wrapper

---

**Child Specifications**:
- [Vault Selection](memory-loop/2025-12-26-vault-selection.md)
- [Navigation Bar](memory-loop/2025-12-26-navigation-bar.md)
- [Home Dashboard](memory-loop/2025-12-26-home.md)
- [Note Capture](memory-loop/2025-12-26-note-capture.md)
- [Chat](memory-loop/2025-12-26-chat.md)
- [View](memory-loop/2025-12-26-view.md)
- [Task List](memory-loop/2025-12-31-task-list.md)

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
