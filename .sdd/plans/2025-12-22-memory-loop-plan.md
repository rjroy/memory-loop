---
specification: [.sdd/specs/2025-12-18-memory-loop.md](./../specs/2025-12-18-memory-loop.md)
status: Draft
version: 1.0.0
created: 2025-12-22
last_updated: 2025-12-22
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Memory Loop - Technical Plan

## Overview

Memory Loop is a mobile-friendly web application providing access to Obsidian vaults via the Claude Agent SDK. The architecture follows a pattern proven in adventure-engine-corvran: a Hono/Bun backend handling Claude Agent SDK interactions with WebSocket streaming, and a lightweight React frontend for real-time display.

Key strategies:
- **Two-mode interface**: Separate UX paths for quick note capture vs full chat discussion
- **Session persistence**: Store SDK session IDs for resumable conversations
- **Tool transparency**: Surface Claude's tool usage to build user trust
- **Mobile-first design**: Touch targets, responsive layout, minimal scrolling

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                         Local Network                           │
│                                                                 │
│  ┌──────────────┐    WebSocket/HTTP    ┌──────────────────────┐ │
│  │   Browser    │◄──────────────────►│      Bun Server       │ │
│  │  (React SPA) │                     │   (Hono + Agent SDK)  │ │
│  └──────────────┘                     └──────────┬────────────┘ │
│                                                   │              │
│                                                   ▼              │
│                                       ┌──────────────────────┐  │
│                                       │    Vault Filesystem  │  │
│                                       │  (CLAUDE.md, notes)  │  │
│                                       └──────────────────────┘  │
│                                                   │              │
│                                                   ▼              │
│                                       ┌──────────────────────┐  │
│                                       │     Anthropic API    │  │
│                                       │    (Claude Agent)    │  │
│                                       └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Components

**Backend (`backend/src/`):**
| Component | Responsibility |
|-----------|----------------|
| `server.ts` | Hono HTTP/WebSocket server, vault listing, static file serving |
| `session-manager.ts` | Claude Agent SDK query orchestration, session persistence |
| `vault-manager.ts` | Vault discovery, CLAUDE.md loading, daily note operations |
| `note-capture.ts` | Daily note creation/appending for note-adding mode |

**Frontend (`frontend/src/`):**
| Component | Responsibility |
|-----------|----------------|
| `App.tsx` | Root component, WebSocket connection, mode switching |
| `hooks/useWebSocket.ts` | WebSocket state, auto-reconnect, message handling |
| `contexts/SessionContext.tsx` | Session ID, vault selection, mode state |
| `components/NoteCapture.tsx` | Simple input for quick note capture |
| `components/Discussion.tsx` | Chat interface with history and tool display |
| `components/ToolDisplay.tsx` | Expandable tool invocation cards |

**Shared (`shared/`):**
| Module | Purpose |
|--------|---------|
| `protocol.ts` | Zod schemas for WebSocket messages |
| `types.ts` | Vault, Session, Message type definitions |

### Component Communication

```
┌─────────────────────────────────────────────────────────────────┐
│                           Frontend                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                        App.tsx                             │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌───────────────┐  │  │
│  │  │ VaultSelect │  │  Mode Toggle    │  │ SessionInfo   │  │  │
│  │  └─────────────┘  └─────────────────┘  └───────────────┘  │  │
│  │                           │                                │  │
│  │         ┌─────────────────┴─────────────────┐              │  │
│  │         ▼                                   ▼              │  │
│  │  ┌─────────────────┐              ┌──────────────────┐    │  │
│  │  │  NoteCapture    │              │   Discussion     │    │  │
│  │  │  (simple input) │              │  (chat + tools)  │    │  │
│  │  └─────────────────┘              └──────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                    WebSocket │                                  │
│                              ▼                                  │
├─────────────────────────────────────────────────────────────────┤
│                           Backend                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      server.ts                             │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌───────────────┐  │  │
│  │  │/api/vaults  │  │   WebSocket     │  │ Static Files  │  │  │
│  │  └─────────────┘  │   Handler       │  └───────────────┘  │  │
│  │                   └────────┬────────┘                      │  │
│  │                            │                               │  │
│  │         ┌──────────────────┼──────────────────┐           │  │
│  │         ▼                  ▼                  ▼           │  │
│  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │  │
│  │  │VaultManager │   │SessionMgr   │   │  NoteCapture    │  │  │
│  │  └─────────────┘   └──────┬──────┘   └─────────────────┘  │  │
│  │                           │                                │  │
│  │                           ▼                                │  │
│  │                   ┌─────────────────┐                      │  │
│  │                   │Claude Agent SDK │                      │  │
│  │                   │    query()      │                      │  │
│  │                   └─────────────────┘                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Technical Decisions

### TD-1: Hono + Bun Runtime
**Choice**: Use Hono web framework on Bun runtime
**Requirements**: REQ-NF-1, REQ-NF-9
**Rationale**:
- adventure-engine-corvran demonstrates this stack works well with Claude Agent SDK
- Hono's `createBunWebSocket` provides native WebSocket support
- Bun offers faster startup and lower memory than Node.js
- Native TypeScript support without build step for development
- Same framework pattern reduces learning curve

### TD-2: WebSocket for Real-Time Communication
**Choice**: WebSocket primary transport (not HTTP SSE)
**Requirements**: REQ-NF-4, REQ-F-20
**Rationale**:
- Bidirectional: client can send abort signals, pings, and mode switches mid-stream
- adventure-engine-corvran's WebSocket approach handles streaming well
- Single connection for both modes (note capture confirmation, discussion streaming)
- Better mobile support than SSE (no reconnection flicker)

### TD-3: React + Vite Frontend
**Choice**: React 19 with Vite dev server
**Requirements**: REQ-F-30, REQ-F-31, REQ-F-32
**Rationale**:
- React 19's concurrent features improve streaming UX
- Vite provides fast HMR for development
- Established ecosystem for mobile-responsive components
- adventure-engine-corvran uses same stack successfully

### TD-4: Claude Agent SDK V1 (Not V2 Preview)
**Choice**: Use stable V1 async generator API
**Requirements**: REQ-F-17, REQ-F-25
**Rationale**:
- V2 is marked "unstable preview" - APIs may change
- V1 `query()` with async generators is proven in adventure-engine-corvran
- Session forking only available in V1 (may be useful later)
- Resume via `resume: sessionId` option works reliably

### TD-5: Zod for Protocol Validation
**Choice**: Zod 3.24.x for message schemas
**Requirements**: REQ-NF-9
**Rationale**:
- Claude Agent SDK requires Zod 3.x (constraint from adventure-engine)
- Shared schemas between frontend and backend
- Runtime validation at message boundaries prevents desync
- Type inference reduces duplication

### TD-6: File-Based Session Storage
**Choice**: Store session metadata in `.memory-loop/sessions/` as JSON
**Requirements**: REQ-F-25, REQ-F-26, REQ-F-27
**Rationale**:
- No database dependency for simple LAN-only app
- Session files are small (ID, vault, timestamps)
- Easy inspection and debugging
- Matches adventure-engine pattern with adventures directory
- Claude Agent SDK handles actual conversation state

### TD-7: Vault Directory Configuration
**Choice**: Environment variable `VAULTS_DIR` pointing to parent of all vaults
**Requirements**: REQ-F-1, REQ-F-3
**Rationale**:
- Similar to adventure-engine's `ADVENTURES_DIR` pattern
- Single config point for vault discovery
- Supports multiple vaults without code changes
- Each vault's CLAUDE.md loaded via `settingSources: ['project']`

### TD-8: Mode-Specific System Prompts
**Choice**: Different system prompts for note-adding vs discussion mode
**Requirements**: REQ-F-11, REQ-F-15, REQ-F-16
**Rationale**:
- Note-adding mode: focused prompt for daily note appending only
- Discussion mode: full vault context with all tools enabled
- Prevents accidental file modifications in note mode
- Clearer intent for Claude = better responses

### TD-9: Single Session Per Vault (Not Per Mode)
**Choice**: One Claude Agent SDK session spans both modes
**Requirements**: REQ-F-9
**Rationale**:
- Context preserved when switching modes (user can reference captured notes in discussion)
- Fewer SDK sessions = simpler state management
- Mode is a frontend concern; backend sees same session
- Note capture can still be constrained via system prompt additions

### TD-10: Mode Toggle as Segmented Control
**Choice**: Single segmented control for mode switching (Note | Discussion)
**Requirements**: REQ-F-6, REQ-F-7, REQ-F-8, REQ-NF-6
**Rationale**:
- Segmented control is a familiar iOS/Android pattern for binary choices
- Single tap switches mode (meets REQ-NF-6)
- Visual state is always clear - selected segment is highlighted
- Works well on mobile with large touch targets
- Position: fixed at top of viewport, always visible

### TD-11: Tool Display as Collapsible Cards
**Choice**: Tool invocations displayed as expandable cards with loading states
**Requirements**: REQ-F-21, REQ-F-22, REQ-F-23, REQ-F-24
**Rationale**:
- Cards show tool name + brief summary when collapsed (REQ-F-21)
- Tap/click expands to show input parameters (REQ-F-22)
- Completed tools show output in expanded view (REQ-F-23)
- Loading spinner on card during active execution (REQ-F-24)
- Collapsible by default keeps chat scrollable on mobile

### TD-12: Daily Note Format and Location
**Choice**: `YYYY-MM-DD.md` files in vault's inbox, created from minimal template
**Requirements**: REQ-F-12, REQ-F-13
**Rationale**:
- Standard ISO date format ensures chronological sorting
- Inbox location configurable via vault CLAUDE.md, fallback to `00_Inbox/`
- Template: `# YYYY-MM-DD` heading + `## Capture` section if vault template unavailable
- Append-only to existing files preserves Obsidian edits

### TD-13: Project Structure (Monorepo)
**Choice**: Single repository with `backend/`, `frontend/`, `shared/` directories
**Requirements**: REQ-NF-10
**Rationale**:
- Matches adventure-engine-corvran structure for consistency
- Shared types in `shared/` avoid duplication
- Single git history for frontend/backend coordination
- Bun workspaces for dependency management

## Data Model

### Session Metadata
```typescript
interface SessionMetadata {
  id: string;              // Claude Agent SDK session ID
  vaultId: string;         // Vault directory name
  vaultPath: string;       // Absolute path to vault
  createdAt: string;       // ISO 8601
  lastActiveAt: string;    // ISO 8601
}
```

### WebSocket Message Types

**Client → Server:**
```typescript
type ClientMessage =
  | { type: 'select_vault'; vaultId: string }
  | { type: 'capture_note'; text: string }
  | { type: 'discussion_message'; text: string }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'new_session' }
  | { type: 'abort' }
  | { type: 'ping' };
```

**Server → Client:**
```typescript
type ServerMessage =
  | { type: 'vault_list'; vaults: VaultInfo[] }
  | { type: 'session_ready'; sessionId: string; vaultId: string }
  | { type: 'note_captured'; timestamp: string }
  | { type: 'response_start'; messageId: string }
  | { type: 'response_chunk'; messageId: string; content: string }
  | { type: 'response_end'; messageId: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string }
  | { type: 'tool_input'; toolUseId: string; input: unknown }
  | { type: 'tool_end'; toolUseId: string; output: unknown }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'pong' };
```

### Vault Discovery
```typescript
interface VaultInfo {
  id: string;           // Directory name
  name: string;         // From CLAUDE.md title or fallback to id
  path: string;         // Relative path for display
  hasClaudeMd: boolean; // Whether CLAUDE.md exists
  inboxPath: string;    // Resolved inbox location for daily notes
}
```

## API Design

### REST Endpoints

**`GET /api/health`**
- Health check for process monitoring
- Returns: `200 "Memory Loop Backend"`

**`GET /api/vaults`**
- List configured vaults from `VAULTS_DIR`
- Returns: `{ vaults: VaultInfo[] }`
- Error: `500` if `VAULTS_DIR` inaccessible

### WebSocket Protocol

**Connection**: `ws://host:port/ws`

**Flow - Vault Selection:**
1. Client connects
2. Server sends `vault_list`
3. Client sends `select_vault` with chosen vault
4. Server initializes SDK session with vault's working directory
5. Server sends `session_ready` with session ID

**Flow - Note Capture:**
1. Client sends `capture_note` with text
2. Server appends to today's daily note (creates if needed)
3. Server sends `note_captured` confirmation
4. (Optional) Server may also stream brief AI acknowledgment

**Flow - Discussion:**
1. Client sends `discussion_message`
2. Server sends `response_start`
3. Server streams `response_chunk` messages
4. Server sends tool events (`tool_start`, `tool_input`, `tool_end`)
5. Server sends `response_end`

**Session Resume:**
1. Client sends `resume_session` with stored session ID
2. Server loads session metadata, validates vault exists
3. Server initializes SDK with `resume: sessionId`
4. Server sends `session_ready`

## Integration Points

### Claude Agent SDK
- **Type**: Library dependency
- **Purpose**: AI conversation and tool execution
- **Data Flow**: Backend → SDK → Anthropic API
- **Configuration**:
  - `cwd`: Vault directory path
  - `settingSources: ['project']`: Load vault's CLAUDE.md and .claude/ config
  - `allowedTools`: Full set in discussion mode, restricted in note mode
  - `resume`: Session ID for continuation

### Vault Filesystem
- **Type**: Local filesystem
- **Purpose**: Note storage and CLAUDE.md configuration
- **Data Flow**: Read vault list, read/write daily notes
- **Key Paths**:
  - `{vault}/CLAUDE.md` - Vault instructions
  - `{vault}/.claude/` - Skills, commands, settings
  - `{vault}/{inbox}/YYYY-MM-DD.md` - Daily notes

### Session Storage
- **Type**: Local filesystem
- **Purpose**: Persist session metadata for resume
- **Location**: `.memory-loop/sessions/{sessionId}.json`
- **Data Flow**: Write on session create, read on resume

## Error Handling, Performance, Security

### Error Strategy
- **Invalid vault**: Return error with vault path, clear UI state
- **SDK errors**: Map to user-friendly messages (adventure-engine pattern)
- **Network failures**: Note capture retries 3x with exponential backoff (REQ-F-35)
- **Session not found**: Prompt to start new session
- **Empty vault list**: Show setup instructions (REQ-F-36)

### Performance Targets
- **Page load**: < 2s (REQ-NF-1) - minimal bundle, no heavy frameworks
- **Note capture**: < 3s (REQ-NF-2) - direct file operation, brief confirmation
- **Discussion response**: < 10s typical (REQ-NF-3) - depends on Claude API
- **Stream start**: < 1s (REQ-NF-4) - SDK streaming enabled by default

### Security Measures
- **LAN-only**: No authentication, but CSRF protection on WebSocket upgrade (check Origin header)
- **No external exposure**: Documentation warns against port forwarding
- **Input sanitization**: Validate vault IDs, prevent path traversal
- **No secrets in repo**: ANTHROPIC_API_KEY via environment

## Testing Strategy

### Unit Tests
- **Backend**: Vault discovery, note formatting, message parsing
- **Frontend**: Component rendering, hook behavior, mode switching
- **Coverage target**: 80% for core logic

### Integration Tests
- **Mock SDK mode**: `MOCK_SDK=true` for tests without API calls
- **Key scenarios**:
  - Vault selection and session creation
  - Note capture round-trip
  - Discussion message streaming
  - Session resume after "disconnect"
  - Error handling paths

### E2E Tests
- **Tool**: Playwright for cross-browser testing
- **Mobile viewport**: 375px iPhone SE simulation
- **Test cases map to acceptance tests in spec**

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Agent SDK API changes | M | H | Pin to specific version, monitor changelog |
| Large vault causes slow loading | M | M | Lazy load vault contents, only read CLAUDE.md initially |
| Session ID storage fills disk | L | L | Prune sessions older than 30 days |
| Daily note conflicts with Obsidian | M | M | Append-only strategy, use file locks if needed |
| Mobile Safari WebSocket issues | M | M | Test on iOS Safari, implement reconnection logic |

## Dependencies

### Technical
- `@anthropic-ai/claude-agent-sdk`: ^0.1.69
- `hono`: ^4.6.0
- `zod`: 3.24.x (pinned for SDK compatibility)
- `react`: ^19.0.0
- `vite`: ^6.0.0

### Infrastructure
- Bun runtime (latest stable)
- Local network access
- Anthropic API key

### Team
- None (single developer, self-contained)

## UI Implementation Details

### Vault Selection (REQ-F-2)
- Initial screen shows vault list from `/api/vaults`
- Each vault displayed as a card with name and last activity
- Tap selects vault and initiates session

### Note Capture Mode (REQ-F-10, REQ-F-14)
- Large text input area (multiline, auto-growing)
- Submit button below input (44px+ height for touch)
- On success: toast notification "Note captured" with timestamp
- Input clears after successful capture

### Discussion Mode (REQ-F-18, REQ-F-19)
- Scrollable chat history with alternating user/assistant messages
- User messages right-aligned, assistant left-aligned (familiar pattern)
- Slash commands: input prefixed with `/` triggers command autocomplete
- Skill tool invocations from vault's `.claude/skills/` directory work via `settingSources` (REQ-F-5)

### Session Controls (REQ-F-28)
- "New Session" button in header/menu
- Confirmation dialog before clearing context
- On confirm: send `new_session` message, reset chat history

### Mobile Layout (REQ-NF-7)
- Mode toggle + session controls in fixed header (always visible)
- Input area fixed at bottom of viewport
- Chat/capture area fills middle, scrollable
- No horizontal scrolling required

### Error Messages (REQ-F-33, REQ-F-34)
- Vault access errors: "Unable to access vault at [path]. Check permissions."
- API errors: "Connection issue. Your message has been saved." + preserve input
- Network retry UI: subtle spinner during retry attempts

### Data Loss Prevention (REQ-NF-5)
- Pending note text stored in localStorage before submission
- On reconnect: prompt to retry with preserved text
- Clear localStorage only after `note_captured` confirmation

## Requirements Traceability Matrix

| Requirement | Implementation | Technical Decision |
|-------------|----------------|-------------------|
| **Vault Management** | | |
| REQ-F-1 | Environment variable `VAULTS_DIR` | TD-7 |
| REQ-F-2 | Vault selection UI, `/api/vaults` endpoint | Architecture |
| REQ-F-3 | SDK `cwd` set to vault path | TD-7 |
| REQ-F-4 | SDK `settingSources: ['project']` | TD-7 |
| REQ-F-5 | Auto-loaded via `settingSources` | TD-7 |
| **Mode Switching** | | |
| REQ-F-6 | Segmented control component | TD-10 |
| REQ-F-7 | Single tap on segment | TD-10 |
| REQ-F-8 | Highlighted segment shows current mode | TD-10 |
| REQ-F-9 | Session spans both modes | TD-9 |
| **Note Adding Mode** | | |
| REQ-F-10 | Large multiline input | UI Details |
| REQ-F-11 | System prompt for appending | TD-8 |
| REQ-F-12 | `YYYY-MM-DD.md` naming | TD-12 |
| REQ-F-13 | Template fallback logic | TD-12 |
| REQ-F-14 | Toast notification | UI Details |
| REQ-F-15 | Original text preserved | TD-8 |
| **Discussion Mode** | | |
| REQ-F-16 | Full vault context in prompt | TD-8 |
| REQ-F-17 | All tools in `allowedTools` | TD-4 |
| REQ-F-18 | Alternating message display | UI Details |
| REQ-F-19 | Slash command autocomplete | UI Details |
| REQ-F-20 | WebSocket streaming | TD-2 |
| **Tool Transparency** | | |
| REQ-F-21 | Tool card with name/summary | TD-11 |
| REQ-F-22 | Expandable input section | TD-11 |
| REQ-F-23 | Expandable output section | TD-11 |
| REQ-F-24 | Loading spinner on card | TD-11 |
| **Session Management** | | |
| REQ-F-25 | Capture from SDK init message | TD-4, TD-6 |
| REQ-F-26 | JSON files in `.memory-loop/` | TD-6 |
| REQ-F-27 | Resume via `resume_session` | TD-6 |
| REQ-F-28 | "New Session" button | UI Details |
| REQ-F-29 | `vaultId` in SessionMetadata | Data Model |
| **Frontend** | | |
| REQ-F-30 | Responsive breakpoints | TD-3 |
| REQ-F-31 | 44px+ touch targets | TD-10, TD-11 |
| REQ-F-32 | Standard DOM APIs | TD-3 |
| **Error Handling** | | |
| REQ-F-33 | Vault error with path | UI Details |
| REQ-F-34 | Preserve input on error | UI Details |
| REQ-F-35 | 3x retry with backoff | Error Strategy |
| REQ-F-36 | Setup instructions | Error Strategy |
| **Non-Functional** | | |
| REQ-NF-1 | Minimal bundle | TD-1, Performance |
| REQ-NF-2 | Direct file operation | Performance |
| REQ-NF-3 | SDK streaming | Performance |
| REQ-NF-4 | Streaming enabled | TD-2, Performance |
| REQ-NF-5 | localStorage backup | UI Details |
| REQ-NF-6 | Segmented control | TD-10 |
| REQ-NF-7 | Fixed header/footer | UI Details |
| REQ-NF-8 | Origin header check | Security |
| REQ-NF-9 | TypeScript strict | TD-1, TD-5 |
| REQ-NF-10 | Monorepo structure | TD-13 |

## Open Questions

- [x] Daily note inbox location - resolved: use vault's configured inbox or fallback to `00_Inbox/`
- [x] CLAUDE.md parsing for vault name - resolved: read title from first H1, fallback to directory name
- [x] Should session storage be in vault or app directory? - resolved: app directory (`.memory-loop/`) to avoid polluting vaults
