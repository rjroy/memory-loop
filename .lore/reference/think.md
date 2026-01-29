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
Frontend: addMessage(user), send WebSocket
      ↓
Backend: create/resume session with Claude SDK
      ↓
Claude SDK: generates response
      ↓
Backend: streams events via WebSocket
      ↓
Frontend: renders incrementally
      ↓
Backend: saves to session metadata + transcript
```

## WebSocket Protocol

### Client → Server

| Message | Purpose |
|---------|---------|
| `select_vault` | Associate connection with vault |
| `resume_session` | Continue existing conversation |
| `new_session` | Start fresh (clears context) |
| `discussion_message` | Send user message to Claude |
| `abort` | Stop current response |
| `tool_permission_response` | Allow/deny tool execution |
| `ask_user_question_response` | Answer Claude's questions |

### Server → Client

| Message | Purpose |
|---------|---------|
| `session_ready` | Session established, includes history if resuming |
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
1. Backend sends `tool_permission_request`
2. Modal shows tool name and parameters
3. User clicks Allow or Deny
4. Frontend sends `tool_permission_response`
5. Backend continues or aborts

### AskUserQuestion

Claude can ask structured questions:
1. Backend sends `ask_user_question_request` (1-4 questions)
2. Each question has options (2-4 choices)
3. User selects answers
4. Frontend sends `ask_user_question_response`

## Model Selection

**Config**: `.memory-loop.json` → `discussionModel`
**Options**: `"opus"` | `"sonnet"` | `"haiku"`
**Default**: `"opus"`

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
| `frontend/src/components/discussion/Discussion.tsx` | Main UI |
| `frontend/src/components/discussion/ConversationPane.tsx` | Message display |
| `frontend/src/components/discussion/SlashCommandAutocomplete.tsx` | Command popup |
| `frontend/src/components/discussion/ToolDisplay.tsx` | Tool invocation cards |
| `frontend/src/components/discussion/FileAttachButton.tsx` | Attachment UI |
| `backend/src/websocket-handler.ts` | Message routing, streaming |
| `backend/src/session-manager.ts` | Session CRUD, SDK integration |
| `backend/src/transcript-manager.ts` | Transcript file writing |
| `shared/src/protocol.ts` | Zod schemas for all messages |

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
