# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memory Loop is a full-stack TypeScript monorepo providing a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. It has two modes: **Note Capture** for quick notes and **Discussion** for AI-powered conversations.

## Development Commands

```bash
# Root level (runs across all workspaces)
bun run dev        # Start backend (3000) + frontend (5173) with hot reload
bun run build      # Build all workspaces
bun run lint       # ESLint across all packages
bun run test       # All tests (339 tests)
bun run typecheck  # TypeScript checking

# Run single test file
bun test src/__tests__/note-capture.test.ts

# Test with mock SDK (no API calls)
MOCK_SDK=true bun run dev
```

## Architecture

```
memory-loop/
├── backend/     # Hono server + Claude Agent SDK
├── frontend/    # React 19 + Vite
└── shared/      # Protocol definitions (Zod schemas)
```

**Backend (Hono + Bun):**
- `server.ts` - Hono app with routes and middleware
- `websocket-handler.ts` - Connection state, message routing
- `vault-manager.ts` - Vault discovery, validates CLAUDE.md presence
- `session-manager.ts` - Persists session metadata, manages SDK instances
- `note-capture.ts` - Daily note creation in `YYYY-MM-DD.md` format

**Frontend (React + Vite):**
- `SessionContext.tsx` - State management (vault, mode, session)
- `useWebSocket.ts` - Real-time communication with backend
- Components: VaultSelect, ModeToggle, NoteCapture, Discussion, MessageBubble, ToolDisplay

**Shared:**
- `protocol.ts` - Zod schemas for WebSocket messages (discriminated unions)
- `types.ts` - VaultInfo, SessionMetadata, ErrorCode interfaces

## WebSocket Protocol

Client → Server: `select_vault`, `capture_note`, `discussion_message`, `resume_session`, `new_session`, `abort`, `ping`

Server → Client: `vault_list`, `session_ready`, `note_captured`, `response_start/chunk/end`, `tool_start/input/end`, `error`, `pong`

## Environment Variables

```bash
VAULTS_DIR=/path/to/vaults     # Required
PORT=3000                       # Optional (default 3000)
MOCK_SDK=true                   # Optional (testing without API)
```

## Testing

- Backend: Bun test with filesystem mocking (temp directories)
- Frontend: Bun test + @testing-library/react + happy-dom
- Preload setup in `frontend/bunfig.toml` configures happy-dom

## Key Patterns

- **Strict TypeScript** with `noEmit` (Bun handles transpilation)
- **ESLint 9 flat config** with TypeScript-ESLint projectService
- **Zod validation** with `safeParse` for untrusted input
- **Custom error classes** with `.code` property (e.g., `VAULT_NOT_FOUND`)
- **Sessions** stored in `.memory-loop/sessions/` as JSON
- **Daily notes** appended under `## Capture` section
