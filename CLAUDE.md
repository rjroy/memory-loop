# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. Users can capture notes, have AI conversations with vault context, and browse files from any device. Organized around the GCTR framework: Ground (orient), Capture (record), Think (process), Recall (review).

## Commands

```bash
# Development
bun install              # Install all workspace dependencies
bun run dev              # Start both backend (:3000) and frontend (:5173)
bun run --cwd backend dev   # Backend only (watch mode)
bun run --cwd frontend dev  # Frontend only

# Testing
bun run test             # Run all tests (backend -> frontend -> shared)
bun run test:coverage    # Generate coverage reports
bun run --cwd backend test  # Backend tests only
LOG_LEVEL=silent bun run --cwd backend test  # Suppress logs during tests

# Quality
bun run typecheck        # TypeScript checking (all workspaces)
bun run lint             # ESLint (all workspaces)

# Production
bun run build            # Build frontend, typecheck backend
./scripts/launch.sh      # Run backend from TypeScript source (required for Agent SDK)
```

## Architecture

Bun monorepo with three workspaces:

```
backend/   # Hono server + Claude Agent SDK
frontend/  # React 19 + Vite SPA
shared/    # Zod schemas for WebSocket protocol
```

### Communication

Two channels between frontend and backend:
- **REST API** for stateless operations (file CRUD, search, config, cards)
- **WebSocket** for streaming (AI responses, tool execution, session state)

Both use Zod-validated message schemas. The protocol source of truth is `shared/src/protocol.ts`.

### Key Backend Modules

| File | Purpose |
|------|---------|
| `server.ts` | Hono app setup, routes, static asset serving |
| `websocket-handler.ts` | WebSocket upgrade, message dispatch, streaming |
| `session-manager.ts` | Claude Agent SDK session create/resume/save |
| `vault-manager.ts` | Vault discovery from VAULTS_DIR |
| `note-capture.ts` | Writes to daily notes (00_Inbox/YYYY-MM-DD.md) |
| `file-browser.ts` | Read-only markdown browsing with security checks |

### Key Frontend Modules

| File | Purpose |
|------|---------|
| `App.tsx` | Shell, mode routing, vault selection gate |
| `contexts/SessionContext.tsx` | Global state via useReducer |
| `hooks/useWebSocket.ts` | WebSocket client with auto-reconnect |

### Mode Mapping

| User-Facing | Internal | Component |
|-------------|----------|-----------|
| Ground | `home` | HomeView |
| Capture | `note` | NoteCapture |
| Think | `discussion` | Discussion |
| Recall | `browse` | BrowseMode |

## Environment

```bash
VAULTS_DIR=/path/to/vaults  # Directory containing vaults (default: ./vaults)
PORT=3000                   # Backend port
HOST=0.0.0.0                # Bind address
MOCK_SDK=true               # Disable real Anthropic API calls for testing
LOG_LEVEL=silent            # Suppress logs (useful in tests)
```

Each vault must contain a `CLAUDE.md` file at root to be discovered.

## Testing

Uses Bun's built-in test runner. Tests are colocated under `__tests__/` directories.

### Running Tests

**Tests cannot run in parallel.** Running multiple test suites simultaneously causes flaky failures due to filesystem contention and shared resource access. Always run tests sequentially:

```bash
bun run --cwd backend test src/__tests__/specific-file.test.ts  # Single file
./git-hooks/pre-commit.sh  # Full suite (runs sequentially)
```

Do not run `bun run test` from root expecting parallel execution to work.

### Constraints

**Do not use `mock.module()`**. Bun's module mocking causes infinite loops. Design for dependency injection: pass dependencies as parameters rather than importing them directly.

### Fake Timers

Use `jest.useFakeTimers()` from `bun:test` to eliminate sleeps and make tests deterministic.

```typescript
import { jest, setSystemTime } from "bun:test";

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-01-24T12:00:00.000Z"));
});

afterEach(() => {
  jest.useRealTimers();
});
```

**When to use:** Timer callbacks, Date.now() logic, auto-dismiss timeouts, debouncing.

**When NOT to use:** Async generators, `waitFor()` from testing-library, complex async state machines.

### SDK Provider Pattern

The Claude Agent SDK uses a centralized provider (`backend/src/sdk-provider.ts`) to prevent accidental API calls in tests. Only `backend/src/index.ts` calls `initializeSdkProvider()`. All other modules use `getSdkQuery()`, which throws `SdkNotInitializedError` if not initialized.

In tests, use `configureSdkForTesting(mockFn)` to inject a mock:

```typescript
import { configureSdkForTesting } from "../sdk-provider.js";

let cleanup: () => void;
beforeEach(() => { cleanup = configureSdkForTesting(mockQueryFn); });
afterEach(() => { cleanup(); });
```

This ensures tests never accidentally spend API tokens.

## Documentation

- `.lore/specs/` contains feature specifications following the GCTR framework
- `docs/usage/` has user-facing guides for each mode
- `docs/adr/` contains architecture decision records

### Documentation Maintenance

When making changes that affect user-facing behavior, update the relevant docs. A feature is not complete until its documentation is updated. This includes:

- Usage docs in `docs/usage/` when tab behavior changes
- ADRs for significant architectural decisions
- Specs in `.lore/specs/` when features are added or modified
