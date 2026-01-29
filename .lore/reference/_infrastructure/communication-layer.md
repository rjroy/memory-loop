# Infrastructure: Communication Layer

## What It Does

Frontend and backend communicate via two channels: **REST API** for stateless operations and **WebSocket** for streaming and bidirectional communication. This separation emerged from a deliberate migration effort.

## The Split

### REST API (Stateless CRUD)

Used for operations that don't need real-time feedback.

**Vault-scoped routes** (under `/api/vaults/:vaultId/`):

| Area | Endpoints | Purpose |
|------|-----------|---------|
| Files | `GET/PUT/POST/DELETE/PATCH /files/*` | Read, write, rename, move, delete |
| Directories | `GET/POST/DELETE /directories/*` | List, create, delete folders |
| Capture | `POST /capture`, `GET /recent-notes`, `GET /recent-activity` | Daily notes |
| Meetings | `POST/GET/DELETE /meetings/*` | Start, stop, get current meeting |
| Search | `GET /search/files`, `/content`, `/snippets` | Name and content search |
| Home | `GET /goals`, `/inspiration`, `/tasks` | Dashboard data |
| Cards | `GET /cards/due`, `POST /cards/:id/review`, `/archive` | Spaced repetition |
| Config | `GET/PUT /config`, `/pinned-assets`, `POST /setup` | Vault settings |
| Memory | `GET/PUT /memory` | Vault-specific memory file |
| Sessions | `DELETE /sessions/:sessionId` | Remove old sessions |

**Global routes** (no vault scope):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check |
| `GET /api/vaults` | List available vaults |
| `GET /api/sessions/:vaultId` | Find session ID for auto-resume |
| `GET/PUT /api/config/memory` | Global memory file (~/.config) |
| `GET /vault/:vaultId/assets/*` | Serve vault files (images, PDFs) |
| `POST /vault/:vaultId/upload` | File upload |

### WebSocket (Streaming/Bidirectional)

Used when real-time feedback matters:

| Area | Why WebSocket |
|------|---------------|
| AI Conversation | Streaming text chunks, tool execution display |
| Pair Writing | Quick Actions stream Claude's edits |
| Session Establishment | Vault selection triggers health checks, initializes state |
| Extraction Prompt | Config management (migration candidate) |
| Card Generator | Config management (migration candidate) |

## Protocol

### Shared Schemas

All messages validated with Zod schemas in `shared/src/protocol.ts`:

```typescript
// Client → Server: 26 message types
ClientMessageSchema = z.discriminatedUnion("type", [...])

// Server → Client: 21 message types
ServerMessageSchema = z.discriminatedUnion("type", [...])
```

Both ends validate incoming messages. Invalid messages are rejected with error responses.

### Message Categories

**Client → Server**:
- Vault/Session: `select_vault`, `resume_session`, `new_session`
- AI: `discussion_message`, `abort`, `tool_permission_response`
- Pair Writing: `quick_action_request`, `advisory_action_request`
- Config: `get_extraction_prompt`, `save_*`, `reset_*`, `trigger_*`

**Server → Client**:
- Session: `vault_list`, `session_ready`
- Streaming: `response_start`, `response_chunk`, `response_end`
- Tools: `tool_start`, `tool_input`, `tool_end`
- Interactive: `tool_permission_request`, `ask_user_question_request`
- Status: `error`, `health_report`, `*_status`

## Connection Lifecycle

### WebSocket

```
1. Client connects to /ws
2. Server sends vault_list
3. Client sends select_vault
4. Server initializes state, sends session_ready
5. Bidirectional messages flow
6. On disconnect: cleanup, interrupt active queries
7. Client auto-reconnects with exponential backoff
```

### Connection State (Server-Side)

Each WebSocket connection maintains isolated state:

```typescript
interface ConnectionState {
  vaultId: string | null;
  sessionId: string | null;
  activeQuery: AbortController | null;
  pendingPermission: { ... } | null;
  pendingQuestion: { ... } | null;
  searchIndex: SearchIndex | null;
  tokenUsage: { input: number; output: number };
  healthCollector: HealthCollector;
  activeMeeting: ActiveMeeting | null;
}
```

### Auto-Reconnect (Client-Side)

- Exponential backoff: 1s → 2s → 4s → ... → 30s max
- Visibility-aware: pauses when tab is hidden
- Resumes session automatically on reconnect

### Session Management Split

Sessions span both channels:

| Channel | Operations |
|---------|-----------|
| REST | `GET /api/sessions/:vaultId` (find session), `DELETE /sessions/:sessionId` (cleanup) |
| WebSocket | `select_vault` (create), `resume_session` (load), `new_session` (clear), messaging |

**Auto-resume flow:**
1. User selects vault
2. Frontend calls `GET /api/sessions/:vaultId` to find existing session
3. If found, sends `resume_session` via WebSocket
4. Server loads conversation history into SDK context
5. `session_ready` sent with message history

**Session cleanup:**
- Ground tab shows recent sessions with delete buttons
- `DELETE /sessions/:sessionId` removes metadata file
- Cannot delete currently active session (UI disables button)

## Migration Status

The codebase shows an ongoing migration from WebSocket to REST:

| Status | Areas |
|--------|-------|
| ✅ Migrated | Files, Capture, Meetings, Search, Home, Cards, Config, Sessions |
| ⏳ Candidates | Extraction Prompt, Card Generator (config CRUD doesn't need streaming) |
| ❌ Must Stay | AI Conversation, Pair Writing (streaming essential for UX) |

Comments in handler files note which features are "not yet migrated to REST".

## Implementation

### Files Involved

| File | Role |
|------|------|
| `shared/src/protocol.ts` | Zod schemas for all messages |
| `backend/src/server.ts` | WebSocket upgrade at `/ws`, REST route mounting |
| `backend/src/websocket-handler.ts` | Message routing, SDK streaming |
| `backend/src/session-manager.ts` | Session persistence, SDK integration |
| `backend/src/handlers/*.ts` | Domain-specific message handlers |
| `backend/src/routes/*.ts` | REST API endpoints |
| `backend/src/routes/index.ts` | Vault-scoped route aggregation |
| `frontend/src/hooks/useWebSocket.ts` | Connection management, auto-reconnect |
| `frontend/src/contexts/SessionContext.tsx` | Client state (useReducer pattern) |

### SDK Streaming Complexity

The WebSocket handler's `streamEvents()` method (400+ lines) handles:
- Content block differentiation (text vs tool_use)
- Delta accumulation for tool input JSON
- Tool lifecycle tracking (start → input → end)
- Context usage calculation (cumulative tokens, compact boundaries)
- Error handling (stream errors, budget limits, execution failures)

This is the critical path for AI conversation UX.

## Design Rationale

### Why Two Channels?

| Concern | REST | WebSocket |
|---------|------|-----------|
| Caching | HTTP caching works | No caching |
| Simplicity | Stateless, easy to test | Connection state management |
| Real-time | Polling required | Native streaming |
| Tooling | Standard HTTP clients | Custom protocol |

REST is simpler and more cacheable. WebSocket is necessary only when streaming or bidirectional communication provides meaningful UX benefit.

### Migration Direction

The trend is toward REST for everything except streaming. This reduces complexity:
- Fewer message types to maintain
- Standard HTTP semantics
- Better testability (no WebSocket mocking)
- Frontend can use React Query / SWR patterns

## Connected Features

| Feature | Uses |
|---------|------|
| [Think](../think.md) | WebSocket streaming |
| [Pair Writing](../pair-writing.md) | WebSocket streaming |
| [Recall](../recall.md) | REST for files |
| [Capture](../capture.md) | REST for notes |
| [Spaced Repetition](../spaced-repetition.md) | REST for cards |
| [System Settings](./system-settings.md) | WebSocket (migration candidate) |

## Diagrams

- [Session Auto-Resume Flow](../../diagrams/session-auto-resume.md) - How REST lookup and WebSocket establishment work together
- [WebSocket Connection Lifecycle](../../diagrams/websocket-connection-lifecycle.md) - Connect, operate, reconnect, cleanup

## Notes

- Health issues surfaced via `health_report` messages (file watcher failures, config problems)
- Slash commands fetched from SDK and cached per-vault on session establishment
- `MOCK_SDK=true` enables testing without API calls
- Protocol changes require updating `shared/src/protocol.ts` and both consumers
