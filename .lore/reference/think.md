---
title: Think Feature
date: 2026-01-28
status: current
tags: [think, ai-conversation, streaming, agent-sdk, gctr]
modules: [discussion, session-manager, active-session-controller]
---

# Feature: Think

## What It Does

Think is the AI conversation interface. Chat with Claude about your vault, ask questions, get help with tasks. Conversations are streamed in real-time, tool usage is displayed inline, and transcripts are auto-saved for the Extraction pipeline.

**Tab**: Third in toolbar: `[ Ground ][ Capture ][ Think ][ Recall ]`
**Internal mode**: `"discussion"`

## User Flow

```
1. Open Think tab
2. Type message, press Enter
3. Claude responds (streaming)
4. See tool calls inline (Read, Glob, etc.)
5. Continue conversation
6. Transcript auto-saved to {inbox}/chats/
7. Extraction pipeline processes into memory
```

## Capabilities

- **Streaming responses**: Text appears as Claude generates it
- **Tool display**: See Claude reading files, searching, etc.
- **Slash commands**: `/expand-note`, `/commit`, etc. with autocomplete
- **Session persistence**: Conversations survive page refresh
- **File attachments**: Attach files for Claude to read
- **Context tracking**: See how much context window is used
- **Prefill**: Ground/Capture can pre-populate input

## Message Flow

```
User types message
      ↓
Frontend: mint sessionId (new chats), addMessage(user), POST /api/chat/{sessionId}
      ↓
Daemon: create/resume the keyed live session with Claude SDK
      ↓
Claude SDK: generates response
      ↓
Daemon: buffers + emits the turn's events to that session's subscribers
      ↓
Frontend (useChat): GET /api/chat/{sessionId}/stream, renders incrementally
      ↓
Daemon: saves to session metadata + transcript
```

## SSE Streaming Protocol

Chat is two-phase and keyed by session id in the URL path:

1. **Submit** — `POST /api/chat/{sessionId}` with `{ vaultId, vaultPath, prompt }`. For a new conversation the frontend mints the session id (`crypto.randomUUID()`) up front so it is in the path on the very first message; for a resume the id is already known. The id is never in the body or a query string. Returns `{ sessionId }` (a 409 with `ALREADY_PROCESSING` if that session is already mid-turn).
2. **View** — `GET /api/chat/{sessionId}/stream` attaches an SSE viewport. The daemon replays the turn's buffered events (so a reconnect restores full state), then streams live events until the terminal event. There is no separate snapshot wrapper; replayed and live events are identical. The server processes the turn to completion regardless of client connectivity, so clients may disconnect and reconnect freely.

Because every route is keyed by session id, two Think tabs on different sessions stream independently; neither can pull the other's events.

### REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/chat/{sessionId}` | Start a turn (body: vaultId, vaultPath, prompt) |
| GET | `/api/chat/{sessionId}/stream` | Attach SSE viewport (replay + live events) |
| POST | `/api/chat/{sessionId}/abort` | Stop current response |
| POST | `/api/chat/{sessionId}/permission/{toolUseId}` | Allow/deny tool execution |
| POST | `/api/chat/{sessionId}/answer/{toolUseId}` | Answer Claude's questions |
| GET | `/api/sessions/{vaultId}` | Resume: get latest session info |

### SSE Event Types (Server → Client)

| Event | Purpose |
|-------|---------|
| `session_ready` | First event on connect; carries the (client-minted) session id |
| `response_start` | Claude started responding |
| `response_chunk` | Incremental text content |
| `response_end` | Response complete, includes context usage |
| `tool_start` | Tool invocation started |
| `tool_input` | Tool parameters ready |
| `tool_end` | Tool completed with output |
| `tool_permission_request` | Ask user to approve tool |
| `ask_user_question_request` | Claude asking user questions |
| `error` | Something went wrong |

## Session Management

### Storage

**Session metadata**: `.memory-loop/sessions/{sessionId}.json`
```json
{
  "id": "abc123...",
  "vaultId": "work-vault",
  "createdAt": "2026-01-28T14:30:00.000Z",
  "lastActiveAt": "2026-01-28T14:45:00.000Z",
  "messages": [...],
  "transcriptPath": "00_Inbox/chats/2026-01-28-1430-abc1.md"
}
```

**Transcript**: `{inbox}/chats/YYYY-MM-DD-HHMM-{shortId}.md`
```markdown
---
date: 2026-01-28
time: "14:30"
session_id: abc123...
title: "First 60 chars of first message"
---

# Discussion - 2026-01-28 14:30

## [14:30] User

Help me understand the auth flow

## [14:31] Assistant

> **Tool:** Read
> File: `src/auth/handler.ts`
> ✓ Found 150 lines

The authentication flow starts in...
```

### Lifecycle

1. **Create**: First message generates session ID via SDK
2. **Persist**: Each message saved to metadata + transcript
3. **Resume**: Page refresh restores via `GET /api/sessions/{vaultId}`
4. **New**: "+" button clears context but preserves old session files

## Slash Commands

Dynamically loaded from Claude SDK, cached in vault.

**Autocomplete triggers**: Input starts with "/" and has no spaces

**UI**:
- Popup above input (max 5 visible)
- Keyboard: ↑/↓ navigate, Enter/Tab select, Esc close
- Shows command name, description, argument hint

**Common commands**:
- `/expand-note {path}` - AI-assisted note expansion
- `/commit` - Create git commit
- `/review-goals` - Reflect on vault goals

## Tool Display

Tools are shown inline as Claude uses them:

```
🔧 Read  README.md  ▸
```

Click to expand and see full input/output:
```
🔧 Read  README.md  ▾
   Input: { "file_path": "README.md" }
   Output: "# Memory Loop\n\n..."
```

**States**: Running (spinner) → Complete (checkmark)

### Permission Dialogs

Some tools require approval:
1. SSE stream emits `tool_permission_request` event
2. Modal shows tool name and parameters
3. User clicks Allow or Deny
4. Frontend calls `POST /api/chat/{sessionId}/permission/{toolUseId}`
5. Controller continues or aborts

### AskUserQuestion

Claude can ask structured questions:
1. SSE stream emits `ask_user_question_request` event (1-4 questions)
2. Each question has options (2-4 choices)
3. User selects answers
4. Frontend calls `POST /api/chat/{sessionId}/answer/{toolUseId}`

## Model Selection

**Config**: `.memory-loop.json` → `discussionModel`
**Options**: any key defined in the global model registry (see Global Config)
**Default**: none — unset vaults fall back to the pi-agent default
**Resolution**: at session creation, the daemon looks up the vault's `discussionModel` string in the runtime registry. Unknown names log a warning and fall back to pi-agent default.

Passed to Claude SDK when creating session.

## File Attachments

**UI**: Paperclip button (📎) next to input

**Flow**:
1. Click attach, select file
2. Upload to `{vault}/06_Metadata/memory-loop/attachments/`
3. Path inserted into input
4. Claude reads file when you send message

**Limits**: 10MB max, common file types supported

## Context Usage

**Tracking**: Cumulative tokens across session turns
**Display**: Percentage sent in `response_end`
**Compaction**: SDK summarizes history when approaching limit

## Implementation

### Files Involved

| File | Role |
|------|------|
| `nextjs/components/discussion/Discussion.tsx` | Main UI |
| `nextjs/components/discussion/MessageBubble.tsx` | Message display |
| `nextjs/components/discussion/SlashCommandAutocomplete.tsx` | Command popup |
| `nextjs/components/discussion/ToolDisplay.tsx` | Tool invocation cards |
| `nextjs/components/discussion/FileAttachButton.tsx` | Attachment UI |
| `nextjs/hooks/useChat.ts` | Two-phase SSE chat client (mints ids, POST then stream) |
| `nextjs/app/api/chat/[sessionId]/route.ts` | Keyed chat-submit proxy to daemon |
| `nextjs/app/api/chat/[sessionId]/stream/route.ts` | Keyed SSE viewport proxy to daemon |
| `nextjs/lib/daemon/sessions.ts` | Browser-side daemon client (keyed session calls) |
| `daemon/src/streaming/live-session-registry.ts` | Per-session live state, keyed by id |
| `daemon/src/streaming/live-session-controller.ts` | Per-session SDK orchestration + event buffer |
| `daemon/src/routes/session/` | Keyed daemon session routes (chat, abort, permission, answer, state) |
| `packages/shared/src/` | Zod schemas, logger |

### Claude SDK Integration

**Tools available**:
- `Read`, `Glob`, `Grep` - File operations
- `WebFetch`, `WebSearch` - Web access
- `Task`, `TodoWrite`, `TodoRead` - Task management
- `AskUserQuestion` - Interactive prompts

**Permission mode**: `acceptEdits` (auto-accept edits in vault)
**Budget**: $2.00 max per session

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Ground](./home-dashboard.md) | Recent discussions, prefill, debrief buttons |
| [Capture](./capture.md) | Meeting stop → Think with `/expand-note` |
| [Recall](./recall.md) | Tool reads files from vault |
| [Extraction](./_infrastructure/extraction.md) | Transcripts → memory |
| [Configuration](./_infrastructure/configuration.md) | discussionModel setting |

## Notes

- Transcripts saved incrementally (survives crashes)
- Session ID from SDK, not generated by backend
- Old sessions pruned to `recentDiscussions` count
- Mock mode available for testing (`MOCK_SDK=true`)
- Context compaction handled automatically by SDK
