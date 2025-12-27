---
version: 1.0.0
status: Draft
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Unknown Author
---

# Vault Selection Specification

**Reverse-Engineered**: true
**Source Module**: frontend/src/components/VaultSelect.tsx, backend/src/vault-manager.ts

## Executive Summary

The Vault Selection feature provides users with the ability to discover and select Obsidian vaults configured on the server. This feature acts as the entry point to the Memory Loop application, presenting available vaults with metadata and enabling users to establish sessions for note capture and AI-powered discussions. The system performs vault discovery by scanning a configured directory for valid Obsidian vaults (identified by the presence of CLAUDE.md files), extracts vault metadata from these files, and manages session state across user interactions.

The feature supports both initial vault selection for new sessions and automatic session resumption for returning users. It provides visual feedback throughout the connection lifecycle and gracefully handles error conditions such as missing configuration, inaccessible directories, and connection failures.

## User Story

As a Memory Loop user, I want to select which Obsidian vault to work with from a list of available vaults, so that I can capture notes and have AI-powered conversations in the context of my chosen knowledge base.

## Stakeholders

- **Primary**: Memory Loop end users who manage one or more Obsidian vaults and want to interact with them through the web interface
- **Secondary**: System administrators configuring VAULTS_DIR environment variable; developers maintaining vault discovery and session management logic

## Success Criteria

1. Users can see all valid vaults (containing CLAUDE.md) within 2 seconds of application load
2. Vault selection completes and establishes a working session within 3 seconds of user click
3. Users can distinguish between vaults by name and path with visual clarity
4. Zero configuration errors reach production users (all errors show actionable guidance)
5. Session resumption occurs automatically when returning to a previously selected vault

## Functional Requirements

### Vault Discovery

- **REQ-F-1**: System must scan the VAULTS_DIR environment variable directory to discover available vaults
- **REQ-F-2**: System must identify valid vaults by the presence of a CLAUDE.md file in the root directory
- **REQ-F-3**: System must ignore hidden directories (names starting with `.`) during discovery
- **REQ-F-4**: System must ignore non-directory entries (files) during discovery
- **REQ-F-5**: System must extract vault name from the first H1 heading (`# Vault Name`) in CLAUDE.md
- **REQ-F-6**: System must fall back to directory name when CLAUDE.md has no H1 heading or is empty
- **REQ-F-7**: System must detect inbox directory location using pattern matching (00_Inbox, Inbox, inbox, etc.)
- **REQ-F-8**: System must detect goals.md file presence at 06_Metadata/memory-loop/goals.md
- **REQ-F-9**: System must sort discovered vaults alphabetically by name for consistent display

### Vault Information Display

- **REQ-F-10**: System must display each vault with its name and full path
- **REQ-F-11**: System must show a "CLAUDE.md" badge for vaults that have a CLAUDE.md file
- **REQ-F-12**: System must show WebSocket connection status (Connected/Connecting/Disconnected)
- **REQ-F-13**: System must provide visual loading feedback while fetching vaults from the server

### Vault Selection and Session Management

- **REQ-F-14**: System must check for existing session when user clicks a vault card
- **REQ-F-15**: System must send `resume_session` message when an existing session is found
- **REQ-F-16**: System must send `select_vault` message when no existing session is found
- **REQ-F-17**: System must disable all vault cards during selection to prevent concurrent selections
- **REQ-F-18**: System must show loading spinner on the selected vault card during connection
- **REQ-F-19**: System must update session context and notify parent component when `session_ready` is received
- **REQ-F-20**: System must fall back to `select_vault` when session resume fails with SESSION_NOT_FOUND

### Empty State

- **REQ-F-21**: System must display "No Vaults Configured" message when zero vaults are discovered
- **REQ-F-22**: System must provide setup instructions with environment variable configuration guidance
- **REQ-F-23**: System must include example configuration (e.g., `VAULTS_DIR=~/Documents/Obsidian`)

### Error Handling

- **REQ-F-24**: System must throw VaultsDirError when VAULTS_DIR environment variable is not set
- **REQ-F-25**: System must throw VaultsDirError when VAULTS_DIR directory does not exist or is inaccessible
- **REQ-F-26**: System must display HTTP error status and message when vault fetch fails
- **REQ-F-27**: System must provide a "Retry" button when vault loading fails
- **REQ-F-28**: System must show inline error banner for selection errors (e.g., VAULT_NOT_FOUND)
- **REQ-F-29**: System must continue discovery when individual vault parsing fails (log warning, skip vault)
- **REQ-F-30**: System must prevent vault selection when WebSocket connection status is not "connected"

### API Endpoints

- **REQ-F-31**: System must provide GET /api/vaults endpoint returning `{ vaults: VaultInfo[] }`
- **REQ-F-32**: System must provide GET /api/sessions/:vaultId endpoint returning `{ sessionId: string | null }`
- **REQ-F-33**: GET /api/vaults must return HTTP 500 with error message when VAULTS_DIR is misconfigured

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Vault discovery must complete in under 2 seconds for directories with up to 50 entries
- **REQ-NF-2** (Performance): Vault list rendering must complete in under 100ms for up to 20 vaults
- **REQ-NF-3** (Usability): Loading state must be visible within 16ms of component mount (1 frame at 60fps)
- **REQ-NF-4** (Usability): Empty state must clearly explain required environment variable configuration
- **REQ-NF-5** (Usability): Error messages must include actionable guidance (not just technical error codes)
- **REQ-NF-6** (Reliability): Component must handle vault_list messages from WebSocket as fallback to HTTP fetch
- **REQ-NF-7** (Reliability): Session check API failures must gracefully fall back to creating new sessions
- **REQ-NF-8** (Reliability): Individual vault discovery errors must not prevent discovery of other vaults
- **REQ-NF-9** (Maintainability): All vault metadata extraction logic must be testable without filesystem access
- **REQ-NF-10** (Maintainability): Filesystem operations must use temporary directories in tests (no mocking required)
- **REQ-NF-11** (Consistency): VaultInfo interface must be shared between frontend and backend via @memory-loop/shared package
- **REQ-NF-12** (Accessibility): Loading spinner must have aria-label="Loading vaults"
- **REQ-NF-13** (Accessibility): Vault list must use role="listbox" with role="option" for each card
- **REQ-NF-14** (Accessibility): Selected vault must have aria-selected="true"

## Explicit Constraints (DO NOT)

- Do NOT allow vault selection when WebSocket is disconnected (must wait for connection)
- Do NOT expose absolute file paths to frontend (backend uses absolute paths, frontend receives relative display paths)
- Do NOT continue vault discovery if VAULTS_DIR does not exist (must throw VaultsDirError immediately)
- Do NOT validate vault structure beyond CLAUDE.md presence (no requirement for .obsidian folder, notes, etc.)
- Do NOT sort vaults by any metric other than name (no recency sorting, no favorites)
- Do NOT cache vault list indefinitely (refetch on component mount)
- Do NOT allow multiple concurrent vault selections (disable all cards during selection)
- Do NOT expose raw filesystem errors to users (wrap in VaultsDirError with setup guidance)
- Do NOT require CLAUDE.md to have specific content (empty files are valid, directory name used as fallback)
- Do NOT block the UI thread during vault discovery (async filesystem operations only)

## Technical Context

### Existing Stack

- **Frontend**: React 19 with TypeScript, Vite build system, Bun test runner with happy-dom
- **Backend**: Bun runtime with Hono framework, native WebSocket support
- **Shared**: Zod schemas for WebSocket protocol validation, shared TypeScript interfaces
- **Testing**: Bun test with temporary filesystem directories (no mocking), @testing-library/react for component tests

### Integration Points

- **WebSocket Protocol**: Uses `vault_list`, `select_vault`, `resume_session`, `session_ready`, and `error` messages (see shared/src/protocol.ts)
- **Session Manager**: backend/src/session-manager.ts provides session persistence and lookup via getSessionForVault()
- **SessionContext**: frontend/src/contexts/SessionContext.tsx manages global vault and session state
- **useWebSocket Hook**: frontend/src/hooks/useWebSocket.ts manages WebSocket connection and message passing
- **HTTP API**: RESTful endpoints for vault list (/api/vaults) and session lookup (/api/sessions/:vaultId)

### Patterns to Respect

- **Zod Validation**: All WebSocket messages validated with safeParse before processing
- **Custom Error Classes**: VaultsDirError extends Error with descriptive setup guidance
- **Strict TypeScript**: All code uses strict mode with noEmit (Bun handles transpilation)
- **Temporary Test Directories**: Tests use tmpdir() with unique names, cleanup in afterEach
- **Loading States**: Use discriminated union type `"loading" | "loaded" | "error"` for fetch state
- **CSS Modules**: Component styles in VaultSelect.css with BEM naming (vault-select__element)

## Acceptance Tests

1. **Vault Discovery - Valid Vaults**: Given a VAULTS_DIR with two directories (vault-1 and vault-2) each containing CLAUDE.md with H1 headings, when discoverVaults() is called, then the system returns 2 VaultInfo objects sorted alphabetically by name.

2. **Vault Discovery - Mixed Content**: Given a VAULTS_DIR containing one valid vault with CLAUDE.md, one directory without CLAUDE.md, one hidden directory (.hidden), and one file (not directory), when discoverVaults() is called, then the system returns 1 VaultInfo object (only the valid vault).

3. **Vault Discovery - Missing VAULTS_DIR**: Given VAULTS_DIR environment variable is not set, when getVaultsDir() is called, then the system throws VaultsDirError with message including "VAULTS_DIR environment variable is not set".

4. **Vault Discovery - Inaccessible Directory**: Given VAULTS_DIR points to a non-existent directory, when discoverVaults() is called, then the system throws VaultsDirError with message including "does not exist or is not accessible".

5. **CLAUDE.md Parsing - H1 Extraction**: Given a CLAUDE.md file containing "# Personal Notes\n\nSome content", when extractVaultName() is called, then the system returns "Personal Notes".

6. **CLAUDE.md Parsing - No H1 Fallback**: Given a CLAUDE.md file with no H1 heading, when parseVault() is called with directory name "my-vault", then the system returns VaultInfo with name="my-vault".

7. **CLAUDE.md Parsing - Multiple H1s**: Given a CLAUDE.md file containing multiple H1 headings, when extractVaultName() is called, then the system returns the first H1 heading.

8. **Inbox Detection - Standard Pattern**: Given a vault directory containing subdirectory "00_Inbox", when detectInboxPath() is called, then the system returns "00_Inbox".

9. **Inbox Detection - Priority Ordering**: Given a vault directory containing both "00_Inbox" and "Inbox" subdirectories, when detectInboxPath() is called, then the system returns "00_Inbox" (higher priority).

10. **Inbox Detection - No Match Fallback**: Given a vault directory with no standard inbox patterns, when detectInboxPath() is called, then the system returns "00_Inbox" (default).

11. **Goals Detection - File Exists**: Given a vault directory containing file at "06_Metadata/memory-loop/goals.md", when detectGoalsPath() is called, then the system returns "06_Metadata/memory-loop/goals.md".

12. **Goals Detection - File Missing**: Given a vault directory without goals.md, when detectGoalsPath() is called, then the system returns undefined.

13. **UI - Loading State**: Given the component mounts with a pending fetch, when rendered, then the system displays a loading spinner with text "Loading vaults..." and aria-label="Loading vaults".

14. **UI - Loaded State**: Given vaults fetch completes successfully with 2 vaults, when rendered, then the system displays 2 vault cards showing name, path, and CLAUDE.md badge (if hasClaudeMd=true).

15. **UI - Empty State**: Given vaults fetch returns empty array, when rendered, then the system displays "No Vaults Configured" heading with setup instructions including VAULTS_DIR environment variable guidance.

16. **UI - Error State**: Given vaults fetch fails with HTTP 500, when rendered, then the system displays "Failed to Load Vaults" heading with error message and a "Retry" button.

17. **UI - Connection Status**: Given WebSocket connection status is "connected", when rendered, then the system displays "Connected" status badge in the header.

18. **Vault Selection - New Session**: Given user clicks a vault card and no existing session exists (/api/sessions/:vaultId returns null), when the selection completes, then the system sends `{ type: "select_vault", vaultId: "vault-1" }` message.

19. **Vault Selection - Resume Session**: Given user clicks a vault card and an existing session exists (/api/sessions/:vaultId returns sessionId), when the selection completes, then the system sends `{ type: "resume_session", sessionId: "session-123" }` message.

20. **Vault Selection - Session Ready**: Given user selects a vault and server sends `session_ready` message, when the message is received, then the system calls selectVault() context method and triggers onReady() callback.

21. **Vault Selection - Disabled During Selection**: Given user clicks a vault card, when the selection is in progress, then the system disables all vault cards (disabled=true) and shows a spinner on the selected card.

22. **Vault Selection - Requires Connection**: Given WebSocket connection status is "connecting" or "disconnected", when user clicks a vault card, then the system displays error "Not connected to server. Please wait..." and does not send selection message.

23. **Error Handling - Session Not Found Fallback**: Given user selects a vault for resumption and server sends `{ type: "error", code: "SESSION_NOT_FOUND" }`, when the error is received, then the system automatically sends `select_vault` message to start a fresh session.

24. **Error Handling - Other Errors**: Given user selects a vault and server sends an error with code other than SESSION_NOT_FOUND, when the error is received, then the system displays the error message to the user and re-enables vault selection.

25. **API - Vaults Endpoint Success**: Given GET /api/vaults is called and vaults are discovered, when the response is returned, then the system returns HTTP 200 with JSON body `{ vaults: VaultInfo[] }`.

26. **API - Vaults Endpoint Error**: Given GET /api/vaults is called and VAULTS_DIR is not set, when the response is returned, then the system returns HTTP 500 with JSON body `{ error: "VAULTS_DIR environment variable is not set..." }`.

27. **API - Sessions Endpoint with Session**: Given GET /api/sessions/vault-1 is called and a session exists, when the response is returned, then the system returns HTTP 200 with JSON body `{ sessionId: "session-123" }`.

28. **API - Sessions Endpoint without Session**: Given GET /api/sessions/vault-1 is called and no session exists, when the response is returned, then the system returns HTTP 200 with JSON body `{ sessionId: null }`.

## Open Questions

- [ ] Should vault discovery recurse into subdirectories, or only scan the top level of VAULTS_DIR? (Current implementation: top level only)
- [ ] Should the system cache vault discovery results in memory to reduce filesystem I/O on subsequent /api/vaults calls?
- [ ] Should session resumption be opt-in (user prompt "Resume previous session?") rather than automatic?
- [ ] Should vault cards display last active session timestamp to help users identify recently used vaults?
- [ ] Should the system validate that detected inbox paths are writable before marking vaults as available?
- [ ] Should goals.md detection support alternative paths beyond 06_Metadata/memory-loop/goals.md?

## Out of Scope

- Multi-vault selection (selecting multiple vaults simultaneously)
- Vault creation or editing from the web UI
- Vault metadata editing (changing name, inbox path, etc.) from the web UI
- Vault health checks (verifying .obsidian folder, note counts, etc.)
- Vault search or filtering (e.g., "show only vaults with CLAUDE.md")
- Vault favorites or pinning
- Vault usage statistics (note count, last modified date, etc.)
- Automatic vault discovery without VAULTS_DIR configuration
- Remote vault access (network drives, cloud storage)
- Vault permission management (read-only vs. read-write access)
- Vault backup or export from the web UI
- Custom inbox pattern configuration via UI

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
