# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun install            # Install dependencies
bun run dev            # Start both frontend (Vite) and backend with hot reload
bun run --cwd backend dev   # Backend only
bun run --cwd frontend dev  # Frontend only

# Testing (two approaches)
# Targeted: run specific tests within a module
bun run --cwd backend test src/__tests__/file-upload.test.ts
bun run --cwd frontend test src/hooks/__tests__/useFileUpload.test.ts

# Full review: runs all tests (frontend, backend, shared) plus lint and typecheck
./git-hooks/pre-commit.sh

# Type checking and linting
bun run typecheck      # TypeScript checking across all workspaces
bun run lint           # ESLint across all workspaces

# Production
bun run build          # Build frontend (backend runs from source)
./scripts/launch.sh    # Run production server
```

## Architecture

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI.

### Monorepo Structure

```
backend/     # Hono server + Claude Agent SDK (runs from TypeScript source)
frontend/    # React 19 + Vite SPA
shared/      # Zod schemas for WebSocket protocol (type-safe message validation)
```

### Communication Pattern

Frontend and backend communicate over **WebSocket** with Zod-validated message schemas:

- **`shared/src/protocol.ts`** - All message schemas (ClientMessage, ServerMessage discriminated unions)
- **`backend/src/websocket-handler.ts`** - Server-side message routing
- **`frontend/src/hooks/useWebSocket.ts`** - Client connection with auto-reconnect
- **`frontend/src/contexts/SessionContext.tsx`** - Client state management (useReducer pattern)

Messages are validated on both ends using `safeParseClientMessage()` and `safeParseServerMessage()`.

### Backend Modules

- **`server.ts`** - Hono app setup, routes, WebSocket upgrade
- **`websocket-handler.ts`** - Message routing to domain handlers
- **`session-manager.ts`** - Claude Agent SDK session lifecycle
- **`vault-manager.ts`** - Vault discovery, goals parsing
- **`note-capture.ts`** - Daily note appending with timestamps
- **`file-browser.ts`** - Directory listing, file reading with security validation
- **`inspiration-manager.ts`** - Context-aware prompts and quotes

### Frontend Modes

Four modes managed by `SessionContext`:
- **Home** - Dashboard with goals, inspiration, recent activity
- **Note** - Quick capture to daily notes
- **Discussion** - AI chat with streaming responses and tool display
- **Browse** - File tree navigation and markdown viewing

### Vault Requirements

Each vault needs a `CLAUDE.md` at root. Optional structure:
- `00_Inbox/` - Daily notes destination
- Goals section in `CLAUDE.md` - Displayed on Home dashboard
- `06_Metadata/memory-loop/` - Inspiration prompt sources

## Environment Variables

```bash
VAULTS_DIR=/path/to/vaults  # Required: directory containing vaults
PORT=3000                   # Backend port
HOST=0.0.0.0               # Bind address
MOCK_SDK=true              # Test without API calls
```

## Testing Patterns

- Backend tests use filesystem operations in temp directories
- Frontend tests use `@testing-library/react` + happy-dom
- Mock the WebSocket and SDK for isolation
- **Do not run `bun run test`** (the combined command). Running multiple test instances concurrently causes resource conflicts. Use targeted tests or `./git-hooks/pre-commit.sh` instead.
