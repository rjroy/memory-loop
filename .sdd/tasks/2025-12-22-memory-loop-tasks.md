---
specification: [.sdd/specs/2025-12-18-memory-loop.md](./../specs/2025-12-18-memory-loop.md)
plan: [.sdd/plans/2025-12-22-memory-loop-plan.md](./../plans/2025-12-22-memory-loop-plan.md)
status: Ready for Implementation
version: 1.0.0
created: 2025-12-22
last_updated: 2025-12-22
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Memory Loop - Task Breakdown

## Task Summary
Total: 18 tasks | Complexity Distribution: 5×S, 10×M, 3×L

## Foundation

### TASK-001: Project Setup and Configuration
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Initialize Bun workspace monorepo with backend/, frontend/, shared/ directories. Configure TypeScript strict mode, ESLint, and shared dependencies.

**Acceptance Criteria**:
- [ ] Bun workspace with three packages configured in root `package.json`
- [ ] TypeScript strict mode enabled in all packages
- [ ] ESLint with typescript-eslint configured
- [ ] `.gitignore` covers node_modules, dist, .env, .memory-loop/
- [ ] Root scripts: `dev`, `build`, `lint`, `test`

**Files**: Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `backend/package.json`, `backend/tsconfig.json`, `frontend/package.json`, `frontend/tsconfig.json`, `shared/package.json`, `shared/tsconfig.json`

**Testing**: `bun install` succeeds, `bun run lint` passes on empty project

---

### TASK-002: Shared Types and Protocol Definitions
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Create shared Zod schemas for WebSocket protocol and TypeScript types for Vault, Session, and Message models per plan Data Model section.

**Acceptance Criteria**:
- [ ] `VaultInfo` type with id, name, path, hasClaudeMd, inboxPath
- [ ] `SessionMetadata` type with id, vaultId, vaultPath, createdAt, lastActiveAt
- [ ] Client→Server message schemas: select_vault, capture_note, discussion_message, resume_session, new_session, abort, ping
- [ ] Server→Client message schemas: vault_list, session_ready, note_captured, response_start/chunk/end, tool_start/input/end, error, pong
- [ ] Zod schemas export inferred TypeScript types

**Files**: Create: `shared/src/types.ts`, `shared/src/protocol.ts`, `shared/src/index.ts`

**Testing**: Import types in backend/frontend, TypeScript compiles without errors

---

## Backend

### TASK-003: Hono Server Bootstrap
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Create Hono server with health endpoint, static file serving, and WebSocket upgrade handler using `createBunWebSocket`.

**Acceptance Criteria**:
- [ ] Server listens on configurable PORT (default 3000)
- [ ] `GET /api/health` returns 200 "Memory Loop Backend"
- [ ] WebSocket upgrade at `/ws` path
- [ ] Static file serving from frontend build directory
- [ ] CORS headers for local development

**Files**: Create: `backend/src/server.ts`, `backend/src/index.ts`

**Testing**: `curl localhost:3000/api/health` returns expected response

---

### TASK-004: Vault Manager
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-002

**Description**: Implement vault discovery from `VAULTS_DIR` environment variable. Parse CLAUDE.md for vault name, detect inbox location.

**Acceptance Criteria**:
- [ ] List directories in `VAULTS_DIR` that contain CLAUDE.md
- [ ] Extract vault name from first H1 heading in CLAUDE.md, fallback to directory name
- [ ] Detect inbox path from vault config or default to `00_Inbox/`
- [ ] Return `VaultInfo[]` for all valid vaults
- [ ] Handle missing/inaccessible `VAULTS_DIR` with clear error

**Files**: Create: `backend/src/vault-manager.ts`

**Testing**: Unit tests with mock filesystem, verify vault discovery and CLAUDE.md parsing

---

### TASK-005: Vaults API Endpoint
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-003, TASK-004

**Description**: Add `GET /api/vaults` endpoint that returns vault list from VaultManager.

**Acceptance Criteria**:
- [ ] Returns `{ vaults: VaultInfo[] }` JSON
- [ ] Returns 500 with error message if `VAULTS_DIR` inaccessible
- [ ] Returns empty array with 200 if no vaults found (triggers setup instructions on frontend)

**Files**: Modify: `backend/src/server.ts`

**Testing**: Integration test verifying endpoint response format

---

### TASK-006: Session Manager
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-002, TASK-004

**Description**: Implement Claude Agent SDK session lifecycle: create, resume, query. Store session metadata to `.memory-loop/sessions/`. Handle SDK event streaming.

**Acceptance Criteria**:
- [ ] Create new session with vault's cwd, `settingSources: ['project']`
- [ ] Resume existing session via `resume: sessionId` option
- [ ] Persist `SessionMetadata` to JSON files in `.memory-loop/sessions/`
- [ ] Load session by ID for resume
- [ ] Expose async generator for SDK query events (text, tool_use)
- [ ] Handle SDK errors with user-friendly messages

**Files**: Create: `backend/src/session-manager.ts`

**Testing**: Unit tests with mocked SDK, verify session creation/resume/persistence

---

### TASK-007: Note Capture Service
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Implement daily note creation and appending for note-adding mode. Handle date formatting, template creation, and `## Capture` section management.

**Acceptance Criteria**:
- [ ] Create daily note `YYYY-MM-DD.md` in vault's inbox if not exists
- [ ] Use template: `# YYYY-MM-DD` heading + `## Capture` section
- [ ] Append captured text under `## Capture` section with timestamp prefix
- [ ] Preserve existing content when appending
- [ ] Return success/failure with timestamp

**Files**: Create: `backend/src/note-capture.ts`

**Testing**: Unit tests for note creation, appending, and template generation

---

### TASK-008: WebSocket Message Handler
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-003, TASK-006, TASK-007

**Description**: Implement WebSocket message routing: vault selection, note capture, discussion messages, session management. Stream SDK responses to client.

**Acceptance Criteria**:
- [ ] Parse incoming messages with Zod validation
- [ ] `select_vault`: Initialize session, send `session_ready`
- [ ] `capture_note`: Call NoteCapture, send `note_captured`
- [ ] `discussion_message`: Query SDK, stream `response_*` and `tool_*` events
- [ ] `resume_session`: Load and resume existing session
- [ ] `new_session`: Clear context, create fresh session
- [ ] `abort`: Cancel in-flight SDK request
- [ ] `ping`/`pong`: Keep-alive handling
- [ ] Send `error` messages for invalid requests

**Files**: Modify: `backend/src/server.ts`, Create: `backend/src/websocket-handler.ts`

**Testing**: Integration tests for each message type flow

---

## Frontend

### TASK-009: Vite + React Project Setup
**Priority**: Critical | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Initialize React 19 project with Vite. Configure development proxy to backend, CSS setup for responsive design.

**Acceptance Criteria**:
- [ ] Vite project with React 19 and TypeScript
- [ ] Dev server proxies `/api` and `/ws` to backend
- [ ] CSS variables for responsive breakpoints (320px, 768px, 1024px)
- [ ] Base App.tsx renders "Memory Loop" heading

**Files**: Create: `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`

**Testing**: `bun run dev` starts frontend, proxies to backend

---

### TASK-010: WebSocket Hook
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-002, TASK-009

**Description**: Create `useWebSocket` hook for connection management, message sending, auto-reconnect with exponential backoff.

**Acceptance Criteria**:
- [ ] Connect to `/ws` on mount
- [ ] Expose `sendMessage(msg: ClientMessage)` function
- [ ] Expose `lastMessage: ServerMessage | null` state
- [ ] Expose `connectionStatus: 'connecting' | 'connected' | 'disconnected'`
- [ ] Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- [ ] Clean disconnect on unmount

**Files**: Create: `frontend/src/hooks/useWebSocket.ts`

**Testing**: Unit tests for connection state machine, reconnect logic

---

### TASK-011: Session Context
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-010

**Description**: Create React context for session state: current vault, session ID, mode (note/discussion), conversation history.

**Acceptance Criteria**:
- [ ] `SessionProvider` wraps app with context
- [ ] Store: `vaultId`, `sessionId`, `mode`, `messages[]`
- [ ] Actions: `selectVault`, `setMode`, `addMessage`, `clearMessages`
- [ ] Persist `sessionId` to localStorage for resume
- [ ] Load persisted session on mount

**Files**: Create: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Unit tests for state transitions and persistence

---

### TASK-012: Vault Selection UI
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-011

**Description**: Implement vault list screen with cards for each vault. Handle loading, empty state, and selection.

**Acceptance Criteria**:
- [ ] Fetch vaults from `/api/vaults` on mount
- [ ] Display vault cards with name and path
- [ ] Loading spinner during fetch
- [ ] Empty state: "No vaults configured" with setup instructions
- [ ] Tap/click selects vault, sends `select_vault` message
- [ ] Navigate to main UI after `session_ready` received

**Files**: Create: `frontend/src/components/VaultSelect.tsx`

**Testing**: Component tests for loading, empty, and populated states

---

### TASK-013: Mode Toggle Component
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-011

**Description**: Implement segmented control for Note/Discussion mode switching per TD-10.

**Acceptance Criteria**:
- [ ] Two-segment control: "Note" | "Discussion"
- [ ] Visual highlight on selected segment
- [ ] 44px minimum height for touch targets
- [ ] Single tap/click switches mode
- [ ] Calls `setMode` in SessionContext

**Files**: Create: `frontend/src/components/ModeToggle.tsx`, `frontend/src/components/ModeToggle.css`

**Testing**: Component tests for mode switching, visual states

---

### TASK-014: Note Capture Component
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-011, TASK-013

**Description**: Implement note-adding mode UI with multiline input, submit button, success/error feedback.

**Acceptance Criteria**:
- [ ] Auto-growing multiline textarea
- [ ] Submit button (44px+ height) below input
- [ ] Store input in localStorage before submission (data loss prevention)
- [ ] Send `capture_note` message on submit
- [ ] Toast notification on `note_captured` response
- [ ] Clear input and localStorage after success
- [ ] Retry up to 3x on network failure with exponential backoff

**Files**: Create: `frontend/src/components/NoteCapture.tsx`, `frontend/src/components/NoteCapture.css`

**Testing**: Component tests for input, submission, retry logic

---

### TASK-015: Discussion Component
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-011, TASK-013

**Description**: Implement chat interface with message history, streaming response display, slash command input.

**Acceptance Criteria**:
- [ ] Scrollable message list with user/assistant distinction
- [ ] User messages right-aligned, assistant left-aligned
- [ ] Streaming text appended progressively during `response_chunk`
- [ ] Input field at bottom with send button
- [ ] Detect `/` prefix for slash commands (basic detection, not autocomplete)
- [ ] Preserve unsent input on error
- [ ] Auto-scroll to bottom on new messages

**Files**: Create: `frontend/src/components/Discussion.tsx`, `frontend/src/components/Discussion.css`, `frontend/src/components/MessageBubble.tsx`

**Testing**: Component tests for message rendering, streaming, scroll behavior

---

### TASK-016: Tool Display Component
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-015

**Description**: Implement expandable tool invocation cards per TD-11. Show tool name, loading state, expandable input/output.

**Acceptance Criteria**:
- [ ] Collapsed: tool name + brief summary
- [ ] Loading spinner during `tool_start` until `tool_end`
- [ ] Tap/click expands card
- [ ] Expanded: input parameters (formatted JSON)
- [ ] Expanded: output (formatted, truncated if large)
- [ ] Visual distinction from text messages

**Files**: Create: `frontend/src/components/ToolDisplay.tsx`, `frontend/src/components/ToolDisplay.css`

**Testing**: Component tests for collapsed/expanded states, loading

---

### TASK-017: App Shell and Layout
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-012, TASK-013, TASK-014, TASK-015, TASK-016

**Description**: Assemble main App with responsive layout: fixed header (mode toggle, session controls), scrollable middle, fixed bottom input.

**Acceptance Criteria**:
- [ ] Fixed header with mode toggle and "New Session" button
- [ ] Confirmation dialog before new session
- [ ] Conditional render: VaultSelect or main UI based on session state
- [ ] Conditional render: NoteCapture or Discussion based on mode
- [ ] Mobile-first layout (320px+), scales to tablet/desktop
- [ ] No horizontal scroll at any viewport size

**Files**: Modify: `frontend/src/App.tsx`, Create: `frontend/src/App.css`

**Testing**: E2E tests for responsive layout at 320px, 768px, 1024px

---

## Integration & Testing

### TASK-018: E2E Tests and Polish
**Priority**: Medium | **Complexity**: M | **Dependencies**: All previous tasks

**Description**: Implement Playwright E2E tests for acceptance criteria. Add mock SDK mode for testing without API calls.

**Acceptance Criteria**:
- [ ] `MOCK_SDK=true` environment variable enables mock responses
- [ ] E2E test: Vault selection flow
- [ ] E2E test: Note capture round-trip
- [ ] E2E test: Discussion with tool transparency
- [ ] E2E test: Session resume after refresh
- [ ] E2E test: Mode switching preserves context
- [ ] E2E test: Mobile viewport (375px) layout
- [ ] All tests pass in CI environment

**Files**: Create: `e2e/`, `playwright.config.ts`, `backend/src/mock-sdk.ts`

**Testing**: `bun run test:e2e` passes all acceptance criteria tests

---

## Dependency Graph
```
TASK-001 (Setup)
    ├──> TASK-002 (Types) ──┬──> TASK-003 (Server) ──> TASK-005 (Vaults API)
    │                       │         │
    │                       │         └──> TASK-008 (WebSocket Handler)
    │                       │                   │
    │                       ├──> TASK-004 (Vault Mgr) ──> TASK-007 (Note Capture)
    │                       │         │
    │                       │         └──> TASK-006 (Session Mgr)
    │                       │
    │                       └──> TASK-010 (WS Hook) ──> TASK-011 (Context)
    │                                                        │
    └──> TASK-009 (Vite) ──────────────────────────────────┘
                                                             │
                                    ┌────────────────────────┤
                                    ▼                        ▼
                              TASK-012 (Vault UI)     TASK-013 (Mode Toggle)
                                                             │
                                    ┌────────────────────────┤
                                    ▼                        ▼
                              TASK-014 (Note)         TASK-015 (Discussion)
                                                             │
                                                             ▼
                                                      TASK-016 (Tool Display)
                                                             │
                                    ┌────────────────────────┘
                                    ▼
                              TASK-017 (App Shell)
                                    │
                                    ▼
                              TASK-018 (E2E Tests)
```

## Implementation Order

**Phase 1 - Foundation** (3 tasks, ~8 pts):
TASK-001, TASK-002, TASK-009

**Phase 2 - Backend Core** (4 tasks, ~12 pts):
TASK-003, TASK-004, TASK-006, TASK-007
*(TASK-003 and TASK-004 can run in parallel)*

**Phase 3 - Backend Integration** (2 tasks, ~6 pts):
TASK-005, TASK-008

**Phase 4 - Frontend Core** (3 tasks, ~7 pts):
TASK-010, TASK-011, TASK-012
*(TASK-012 depends on TASK-011)*

**Phase 5 - Frontend Features** (4 tasks, ~12 pts):
TASK-013, TASK-014, TASK-015, TASK-016
*(TASK-013 can run parallel to TASK-014/15; TASK-016 depends on TASK-015)*

**Phase 6 - Assembly & Testing** (2 tasks, ~6 pts):
TASK-017, TASK-018

## Notes

- **Parallelization**: In Phase 2, TASK-003 and TASK-004 have no dependencies on each other. In Phase 5, TASK-013 can be done in parallel with TASK-014.
- **Critical path**: TASK-001 → TASK-002 → TASK-006 → TASK-008 → TASK-017 → TASK-018
- **Mock SDK**: TASK-018 introduces mock mode; consider implementing mock stubs earlier in TASK-006 if faster iteration needed.
