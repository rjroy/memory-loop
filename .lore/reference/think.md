---
title: Think Feature
date: 2026-01-28
status: current
tags: [think, ai-conversation, streaming, claude-sdk, gctr]
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
Frontend: addMessage(user), POST /api/chat
      ↓
Controller: create/resume session with Claude SDK
      ↓
Claude SDK: generates response
      ↓
Controller: streams SessionEvents via SSE
      ↓
Frontend (useChat): renders incrementally
      ↓
Controller: saves to session metadata + transcript
```

## SSE Streaming Protocol

The frontend sends a prompt via `POST /api/chat` with vaultId, optional sessionId, and the prompt text. The response is an SSE stream of typed events.

### REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/chat` | Send message, receive SSE stream |
| POST | `/api/chat/{sessionId}/abort` | Stop current response |
| POST | `/api/chat/{sessionId}/permission/{toolUseId}` | Allow/deny tool execution |
| POST | `/api/chat/{sessionId}/answer/{toolUseId}` | Answer Claude's questions |
| GET | `/api/sessions/{vaultId}` | Resume: get latest session info |

### SSE Event Types (Server → Client)

| Event | Purpose |
|-------|---------|
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
| `nextjs/components/discussion/Discussion.tsx` | Main UI |
| `nextjs/components/discussion/MessageBubble.tsx` | Message display |
| `nextjs/components/discussion/SlashCommandAutocomplete.tsx` | Command popup |
| `nextjs/components/discussion/ToolDisplay.tsx` | Tool invocation cards |
| `nextjs/components/discussion/FileAttachButton.tsx` | Attachment UI |
| `nextjs/hooks/useChat.ts` | SSE chat client |
| `nextjs/lib/controller.ts` | Active Session Controller (SDK orchestration) |
| `nextjs/app/api/chat/route.ts` | SSE chat endpoint |
| `backend/src/session-manager.ts` | Session CRUD, SDK integration |
| `backend/src/transcript-manager.ts` | Transcript file writing |
| `shared/src/types.ts` | Zod schemas |

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
