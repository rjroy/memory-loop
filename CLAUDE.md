# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. Users can capture notes, have AI conversations with vault context, and browse files from any device. Organized around the GCTR framework: Ground (orient), Capture (record), Think (process), Recall (review).

## Commands

```bash
# Development
bun install              # Install dependencies
bun run --cwd nextjs dev # Start Next.js dev server (:3000)

# Testing
bun run test             # Run all tests
bun run test:coverage    # Generate coverage report
bun run --cwd nextjs test lib/__tests__/specific-file.test.ts  # Single file
LOG_LEVEL=silent bun run --cwd nextjs test  # Suppress logs during tests

# Quality
bun run typecheck        # TypeScript checking
bun run lint             # ESLint

# Production
bun run --cwd nextjs build  # Build Next.js
./scripts/launch.sh         # Build and start Next.js in production
```

## Architecture

Next.js 15 App Router application. Domain logic lives in `lib/`, UI in `components/`, `hooks/`, and `contexts/`.

```
nextjs/
  app/           # Pages and API routes
  components/    # React components
  hooks/         # React hooks
  contexts/      # State management
  lib/           # Domain logic, schemas, utilities
  lib/schemas/   # Zod schemas and TypeScript types
```

### Communication

- **REST API** (Next.js API routes) for stateless operations (file CRUD, search, config, cards)
- **Two-phase chat**: POST `/api/chat` (submit message, returns `{ sessionId }`) then GET `/api/chat/stream` (SSE viewport)

The server processes each message to completion regardless of client connectivity. SSE connections are viewports into processing state, not drivers of it. Clients can disconnect and reconnect freely; the first SSE event is always a snapshot of current state. Stop/permission/answer requests are separate REST calls.

### Key Domain Modules

Domain logic lives in `nextjs/lib/`. These modules are imported by API routes and contain no HTTP server of their own.

| File | Purpose |
|------|---------|
| `lib/session-manager.ts` | Claude Agent SDK session create/resume/save |
| `lib/streaming/session-streamer.ts` | Transforms SDK events into SessionEvents |
| `lib/vault-manager.ts` | Vault discovery from VAULTS_DIR |
| `lib/note-capture.ts` | Writes to daily notes (00_Inbox/YYYY-MM-DD.md) |
| `lib/file-browser.ts` | Read-only markdown browsing with security checks |
| `lib/scheduler-bootstrap.ts` | Isolates scheduler startup from instrumentation.ts (turbopack can't trace into it) |

### Key Application Modules

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout |
| `app/page.tsx` | Main SPA entry (client component) |
| `app/api/chat/route.ts` | REST chat send (POST, returns sessionId) |
| `app/api/chat/stream/route.ts` | SSE viewport (GET, snapshot-first) |
| `lib/controller.ts` | Active Session Controller (SDK orchestration) |
| `contexts/SessionContext.tsx` | Global state via useReducer |
| `hooks/useChat.ts` | Two-phase chat client (POST then SSE) |

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
PORT=3000                   # Server port
HOSTNAME=0.0.0.0            # Bind address (Next.js uses HOSTNAME, not HOST)
MOCK_SDK=true               # Disable real Anthropic API calls for testing
LOG_LEVEL=silent            # Suppress logs (useful in tests)
```

Each vault must contain a `CLAUDE.md` file at root to be discovered.

**Vault paths:** `vault.path` is the vault root (for config, sessions). `vault.contentRoot` is the content directory (for files, search, cards). Use `contentRoot` for all content operations.

## Service Operation

When running as a systemd user service (`memory-loop.service`), check logs with:

```bash
journalctl --user -u memory-loop --since "1 hour ago"  # Recent logs
journalctl --user -u memory-loop -f                    # Follow live
journalctl --user -u memory-loop | grep -i error       # Search for errors
```

### Scheduled Tasks

Two background processes run via Next.js instrumentation (`nextjs/instrumentation.ts`), started once on server boot:

| Task | Default Time | Purpose |
|------|--------------|---------|
| Memory extraction | 3:00 AM | Extracts durable facts from chat transcripts |
| Card discovery | 4:00 AM | Generates spaced repetition cards from modified files |

Logs use module prefixes: `[extraction-manager]`, `[fact-extractor]`, `[card-discovery-scheduler]`, `[card-generator]`.

## Testing

Uses Bun's built-in test runner. Tests are colocated under `__tests__/` directories.

### Running Tests

**Tests cannot run in parallel.** Running multiple test suites simultaneously causes flaky failures due to filesystem contention and shared resource access. Always run tests sequentially:

```bash
bun run --cwd nextjs test lib/__tests__/specific-file.test.ts  # Single file
./.git-hooks/pre-commit.sh  # Full suite (runs sequentially)
```

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

The Claude Agent SDK uses a centralized provider (`lib/sdk-provider.ts`) to prevent accidental API calls in tests. In the app, `lib/controller.ts` calls `initializeSdkProvider()` lazily on first use. All other modules use `getSdkQuery()`, which throws `SdkNotInitializedError` if not initialized.

In tests, use `configureSdkForTesting(mockFn)` to inject a mock:

```typescript
import { configureSdkForTesting } from "../sdk-provider";

let cleanup: () => void;
beforeEach(() => { cleanup = configureSdkForTesting(mockQueryFn); });
afterEach(() => { cleanup(); });
```

This ensures tests never accidentally spend API tokens.

## Documentation

- `.lore/reference/` contains technical reference documentation for implemented features
- `docs/usage/` has user-facing guides for each mode
- `docs/adr/` contains architecture decision records

### Documentation Maintenance

When making changes that affect user-facing behavior, update the relevant docs. A feature is not complete until its documentation is updated. This includes:

- Usage docs in `docs/usage/` when tab behavior changes
- ADRs for significant architectural decisions
- Reference docs in `.lore/reference/` when features are added or modified

## Critical Lessons

- Trace config changes end-to-end: When adding a new config field, grep for all places the config object is constructed, copied, or merged. In this codebase: schema definition in `lib/schemas/`, config loading in `lib/vault-config.ts`, frontend initialConfig props (multiple components), reducer cases, and post-save state updates.
- When the SDK returns a different session ID than the one passed to `resume`, that means the session wasn't found. Don't adapt to it (migrate metadata, rename files). Treat it as a failure and investigate why the SDK can't find the session.
- Error events that aren't rendered to the user are the same as no error handling. Every SSE error event must be visible in the UI. If `useChat` captures an error but the component doesn't display it, the user sees a working response followed by silent corruption.
- Instrumentation compiles for all runtimes the app uses. Node.js-only imports must go inside `if (process.env.NEXT_RUNTIME === "nodejs") { ... }` blocks, not after early returns. Webpack replaces `NEXT_RUNTIME` at compile time and dead-code-eliminates the unused branch. Early returns (`if (NEXT_RUNTIME !== "nodejs") return;`) do NOT prevent webpack from tracing imports that follow. Always test both `bun run --cwd nextjs dev` and `bun run --cwd nextjs build` when touching instrumentation.
- When multiple event handlers need to check current state before deciding what to do (e.g., "is the last message a streaming assistant?"), that logic belongs in the reducer, not in the handler. Handlers that read state via `useRef` will see stale data when events arrive faster than React renders. The reducer always operates on the latest state.
