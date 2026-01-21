---
version: 1.0.0
status: Approved
created: 2026-01-21
last_updated: 2026-01-21
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# REST API Migration Specification

## Executive Summary

Memory Loop currently routes all client-server communication through WebSocket, including simple request/response operations that don't benefit from persistent connections. This creates unnecessary complexity: components must coordinate connection state, errors manifest as parsed messages rather than HTTP status codes, and the "forgot to send select_vault" bug class exists because stateless operations depend on connection state.

This specification defines which operations should migrate to REST endpoints while preserving WebSocket for genuinely streaming use cases (AI chat, progress updates). The result is a hybrid architecture where HTTP handles actions and WebSocket handles streams.

## User Story

As a developer maintaining Memory Loop, I want stateless operations to use REST endpoints, so that components can make independent API calls without coordinating WebSocket connection state.

## Stakeholders

- **Primary**: Memory Loop developers (simpler architecture, easier testing)
- **Secondary**: End users (more reliable behavior, better error feedback)
- **Tertiary**: Future API consumers (REST enables programmatic access without WebSocket)

## Success Criteria

1. All stateless operations (file browser, capture, tasks, etc.) work via REST without WebSocket connection
2. WebSocket is only required when entering Discussion mode
3. No regression in functionality or performance
4. Frontend components can fetch data independently without vault selection coordination

## Functional Requirements

### Message Classification

- **REQ-F-1**: Operations classified as "stateless" MUST be available via REST endpoints
- **REQ-F-2**: Operations classified as "streaming" MUST remain WebSocket-only
- **REQ-F-3**: REST endpoints MUST accept vault ID as a path or query parameter (no connection state)
- **REQ-F-4**: REST endpoints MUST return appropriate HTTP status codes (200, 400, 404, 500)

### Stateless Operations (Convert to REST)

File Browser:
- **REQ-F-5**: `list_directory` → `GET /api/vaults/:vaultId/files?path=`
- **REQ-F-6**: `read_file` → `GET /api/vaults/:vaultId/files/:path`
- **REQ-F-7**: `write_file` → `PUT /api/vaults/:vaultId/files/:path`
- **REQ-F-8**: `delete_file` → `DELETE /api/vaults/:vaultId/files/:path`
- **REQ-F-9**: `create_file` → `POST /api/vaults/:vaultId/files`
- **REQ-F-10**: `create_directory` → `POST /api/vaults/:vaultId/directories`
- **REQ-F-11**: `delete_directory` → `DELETE /api/vaults/:vaultId/directories/:path`
- **REQ-F-12**: `rename_file` → `PATCH /api/vaults/:vaultId/files/:path`
- **REQ-F-13**: `move_file` → `PATCH /api/vaults/:vaultId/files/:path` (with destination in body)
- **REQ-F-14**: `archive_file` → `POST /api/vaults/:vaultId/files/:path/archive`
- **REQ-F-15**: `get_directory_contents` → `GET /api/vaults/:vaultId/directories/:path/contents`

Capture:
- **REQ-F-16**: `capture_note` → `POST /api/vaults/:vaultId/capture`
- **REQ-F-17**: `get_recent_notes` → `GET /api/vaults/:vaultId/recent-notes`
- **REQ-F-18**: `get_recent_activity` → `GET /api/vaults/:vaultId/recent-activity`

Home/Dashboard:
- **REQ-F-19**: `get_goals` → `GET /api/vaults/:vaultId/goals`
- **REQ-F-20**: `get_inspiration` → `GET /api/vaults/:vaultId/inspiration`
- **REQ-F-21**: `get_tasks` → `GET /api/vaults/:vaultId/tasks`
- **REQ-F-22**: `toggle_task` → `PATCH /api/vaults/:vaultId/tasks`

Meeting:
- **REQ-F-23**: `start_meeting` → `POST /api/vaults/:vaultId/meetings`
- **REQ-F-24**: `stop_meeting` → `DELETE /api/vaults/:vaultId/meetings/current`
- **REQ-F-25**: `get_meeting_state` → `GET /api/vaults/:vaultId/meetings/current`

Search:
- **REQ-F-26**: `search_files` → `GET /api/vaults/:vaultId/search/files?q=`
- **REQ-F-27**: `search_content` → `GET /api/vaults/:vaultId/search/content?q=`
- **REQ-F-28**: `get_snippets` → `GET /api/vaults/:vaultId/search/snippets?path=&q=`

Configuration:
- **REQ-F-29**: `get_pinned_assets` → `GET /api/vaults/:vaultId/config/pinned-assets`
- **REQ-F-30**: `set_pinned_assets` → `PUT /api/vaults/:vaultId/config/pinned-assets`
- **REQ-F-31**: `update_vault_config` → `PATCH /api/vaults/:vaultId/config`
- **REQ-F-32**: `setup_vault` → `POST /api/vaults/:vaultId/setup`
- **REQ-F-33**: `create_vault` → `POST /api/vaults`
- **REQ-F-34**: `dismiss_health_issue` → `DELETE /api/vaults/:vaultId/health-issues/:issueId`

Memory:
- **REQ-F-35**: `get_memory` → `GET /api/vaults/:vaultId/memory`
- **REQ-F-36**: `save_memory` → `PUT /api/vaults/:vaultId/memory`
- **REQ-F-37**: `get_extraction_prompt` → `GET /api/config/extraction-prompt`
- **REQ-F-38**: `save_extraction_prompt` → `PUT /api/config/extraction-prompt`
- **REQ-F-39**: `reset_extraction_prompt` → `DELETE /api/config/extraction-prompt`

Sessions:
- **REQ-F-40**: `delete_session` → `DELETE /api/vaults/:vaultId/sessions/:sessionId`

### Streaming Operations (Keep WebSocket)

- **REQ-F-41**: `discussion_message` MUST remain WebSocket (streams AI response chunks)
- **REQ-F-42**: `response_start`, `response_chunk`, `response_end` MUST remain WebSocket
- **REQ-F-43**: `tool_start`, `tool_input`, `tool_end` MUST remain WebSocket
- **REQ-F-44**: `tool_permission_request/response` MUST remain WebSocket (interactive)
- **REQ-F-45**: `ask_user_question_request/response` MUST remain WebSocket (interactive)
- **REQ-F-46**: `index_progress` MUST remain WebSocket (progress streaming)
- **REQ-F-47**: `trigger_extraction` MUST remain WebSocket (long-running with progress)

### Session Management (WebSocket)

- **REQ-F-48**: `select_vault` → WebSocket (establishes session context for streaming)
- **REQ-F-49**: `resume_session` → WebSocket (loads conversation for streaming)
- **REQ-F-50**: `new_session` → WebSocket (clears context for streaming)
- **REQ-F-51**: `abort` → WebSocket (interrupts active stream)

### Pair Writing (Keep WebSocket)

- **REQ-F-52**: `quick_action_request` MUST remain WebSocket (Claude uses tools, streams response)
- **REQ-F-53**: `advisory_action_request` MUST remain WebSocket (Claude streams response)

### Utility

- **REQ-F-54**: `ping/pong` MUST remain WebSocket (keeps Discussion sessions alive through proxies/idle timeouts)

### Error Handling

- **REQ-F-55**: REST endpoints MUST return 404 when vault ID does not exist
- **REQ-F-56**: REST endpoints MUST return 404 when requested file/directory does not exist
- **REQ-F-57**: REST endpoints MUST return 400 for malformed requests (invalid JSON, missing required fields)
- **REQ-F-58**: REST endpoints MUST return 403 for path traversal attempts (paths outside vault)
- **REQ-F-59**: REST endpoints MUST return 500 for unexpected server errors with safe error messages
- **REQ-F-60**: REST endpoints MUST handle URL-encoded file paths correctly (spaces, special characters)

### Protocol Cleanup

- **REQ-F-61**: WebSocket protocol schemas MUST be updated to remove migrated message types
- **REQ-F-62**: Deprecated WebSocket handlers MUST be removed after REST migration
- **REQ-F-63**: Frontend MUST be updated to use fetch() for stateless operations

### Implementation Consistency

- **REQ-F-64**: REST and WebSocket handlers MUST share the same business logic functions (no duplication)

## Non-Functional Requirements

- **REQ-NF-1** (Performance): REST endpoints MUST respond within 200ms for file operations
- **REQ-NF-2** (Performance): REST endpoints MUST respond within 500ms for search operations
- **REQ-NF-3** (Consistency): REST response schemas MUST match existing WebSocket response schemas
- **REQ-NF-4** (Testing): REST endpoints MUST have integration tests covering happy path and error cases
- **REQ-NF-5** (Backward Compatibility): WebSocket handlers MAY remain during transition period
- **REQ-NF-6** (Security): REST endpoints MUST validate vault ID and prevent path traversal

## Explicit Constraints (DO NOT)

- Do NOT require WebSocket connection for stateless operations
- Do NOT duplicate business logic between REST and WebSocket handlers (extract shared functions)
- Do NOT change the response data structures (only transport mechanism changes)
- Do NOT remove WebSocket support for streaming operations
- Do NOT add authentication in this phase (separate concern)

## Technical Context

- **Existing Stack**: Hono (backend), React 19 (frontend), Zod (validation), TypeScript
- **Integration Points**:
  - `shared/src/protocol.ts` (message schemas)
  - `backend/src/server.ts` (route registration)
  - `backend/src/websocket-handler.ts` (current message routing)
  - `backend/src/handlers/*.ts` (extracted handler functions)
  - `frontend/src/hooks/useWebSocket.ts` (client connection)
  - `frontend/src/contexts/SessionContext.tsx` (state management)
- **Patterns to Respect**:
  - Zod schemas for request/response validation
  - Dependency injection for testability
  - Handler extraction pattern (handlers/ directory)

## Acceptance Tests

1. **File Browser Without WebSocket**: Navigate directories and read files using only REST (no WebSocket connection)
2. **Capture Without WebSocket**: Submit a note capture and receive confirmation via REST
3. **Search Without WebSocket**: Search files and content, load snippets via REST
4. **Discussion Still Streams**: AI chat messages stream correctly via WebSocket
5. **Tool Invocations Display**: Tool use events still appear during Discussion
6. **Error Handling**: REST 404 for missing vault, 400 for invalid paths, 500 for server errors
7. **No select_vault Bug**: Components fetch data without needing prior vault selection message

## Open Questions

- [x] Should meeting state be per-connection (WebSocket) or persisted (REST)? → **REST with server-side state**
- [x] Should health issues be pushed via WebSocket or polled via REST? → **REST (polled on demand), health is not real-time critical**
- [x] Migration strategy: big bang or incremental endpoint-by-endpoint? → **Incremental by domain (file browser first, then capture, etc.) with WebSocket fallback during transition**

## Out of Scope

- Authentication/authorization (separate feature)
- Rate limiting (separate feature)
- API versioning (can add later if needed)
- OpenAPI/Swagger documentation generation
- GraphQL consideration

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
