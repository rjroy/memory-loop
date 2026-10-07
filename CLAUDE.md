# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. Users can capture notes, have AI conversations with vault context, and browse files from any device. Organized around the GCTR framework: Ground (orient), Capture (record), Think (process), Recall (review).

## Commands

```bash
# Development
bun install              # Install dependencies
bun run --cwd nextjs dev # Start Next.js dev server (:3000)
bun run daemon:dev       # Start daemon with --watch

# Testing
bun run test             # Run all tests (shared, nextjs, daemon)
bun run test:coverage    # Generate coverage report (nextjs)
bun run --cwd nextjs test lib/__tests__/specific-file.test.ts  # Single file
LOG_LEVEL=silent bun run --cwd nextjs test  # Suppress logs during tests

# Quality
bun run typecheck        # TypeScript checking (all packages)
bun run lint             # ESLint

# Production
bun run --cwd nextjs build  # Build Next.js
bun run daemon:start        # Start daemon
./scripts/launch.sh         # Build and start Next.js in production
```

## Architecture

Monorepo with three packages:

```
packages/shared/ # @memory-loop/shared: Zod schemas, logger
nextjs/          # @memory-loop/nextjs: Next.js 15 web app
daemon/          # @memory-loop/daemon: Background daemon process
```

Shared types and schemas live in `@memory-loop/shared`. Both nextjs and daemon import from it. Never import from `@/lib/schemas` or `@/lib/logger` in nextjs (those paths no longer exist).

### Next.js App (Pure Frontend)

```
nextjs/
  app/           # Pages and API proxy routes
  components/    # React components
  hooks/         # React hooks
  contexts/      # State management
  lib/           # Daemon client layer, browser API client
  lib/daemon/    # HTTP clients for daemon communication
  lib/api/       # Browser-side fetch wrapper and types
```

The Next.js app contains no domain logic. All API routes are thin proxies that forward requests to the daemon via Unix socket. Domain logic, SDK calls, and filesystem access all happen in the daemon.

### Daemon

```
daemon/
  src/index.ts         # Entry point (Unix socket or TCP listener)
  src/server.ts        # Bun.serve() configuration
  src/router.ts        # Request routing
  src/routes/health.ts # GET /health
  src/routes/help.ts   # GET /help (API discovery)
```

The daemon listens on a Unix socket by default (`$XDG_RUNTIME_DIR/memory-loop.sock`). Set `DAEMON_PORT` for localhost TCP fallback.

### Communication

- **REST API** (Next.js API routes) for stateless operations (file CRUD, search, config, cards)
- **Two-phase chat**: POST `/api/chat` (submit message, returns `{ sessionId }`) then GET `/api/chat/stream` (SSE viewport)

The server processes each message to completion regardless of client connectivity. SSE connections are viewports into processing state, not drivers of it. Clients can disconnect and reconnect freely; the first SSE event is always a snapshot of current state. Stop/permission/answer requests are separate REST calls.

### Daemon Client Layer

The `lib/daemon/` directory contains HTTP client modules that communicate with the daemon. These are the only modules that know daemon API URLs.

| File | Purpose |
|------|---------|
| `lib/daemon/fetch.ts` | Unix socket/TCP connection, `DaemonUnavailableError`, test injection |
| `lib/daemon/vaults.ts` | Vault discovery, config, pinned assets, slash commands |
| `lib/daemon/files.ts` | File operations, transcripts, path validation |
| `lib/daemon/sessions.ts` | Chat send/stream, abort, permission, session lifecycle |
| `lib/daemon/index.ts` | Barrel export |

### Key Application Modules

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout |
| `app/page.tsx` | Main SPA entry (client component) |
| `app/api/chat/route.ts` | Proxy: POST chat to daemon |
| `app/api/chat/stream/route.ts` | Proxy: SSE stream from daemon |
| `lib/api/client.ts` | Browser-side fetch wrapper for Next.js API routes |
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
DAEMON_SOCKET=/path/to.sock # Daemon Unix socket path (default: $XDG_RUNTIME_DIR/memory-loop.sock)
DAEMON_PORT=9876            # Daemon TCP port (overrides socket if set)
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

Two background processes run in the daemon (not in Next.js):

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

### Daemon Client Testing Pattern

The daemon client layer (`lib/daemon/`) uses a centralized fetch provider for test injection. In tests, use `configureDaemonFetchForTesting` to inject a mock:

```typescript
import { configureDaemonFetchForTesting } from "../daemon/fetch";

let cleanup: () => void;
beforeEach(() => { cleanup = configureDaemonFetchForTesting(mockFetchFn); });
afterEach(() => { cleanup(); });
```

This mock covers all daemon client modules (vaults, files, sessions) since they all use the shared fetch layer. SDK provider and domain logic testing lives in the daemon package.

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

- Trace config changes end-to-end: When adding a new config field, grep for all places the config object is constructed, copied, or merged. In this codebase: schema definition in `packages/shared/src/schemas/`, config loading in `lib/vault-config.ts`, frontend initialConfig props (multiple components), reducer cases, and post-save state updates.
- When the SDK returns a different session ID than the one passed to `resume`, that means the session wasn't found. Don't adapt to it (migrate metadata, rename files). Treat it as a failure and investigate why the SDK can't find the session.
- Error events that aren't rendered to the user are the same as no error handling. Every SSE error event must be visible in the UI. If `useChat` captures an error but the component doesn't display it, the user sees a working response followed by silent corruption.
- Instrumentation compiles for all runtimes the app uses. Node.js-only imports must go inside `if (process.env.NEXT_RUNTIME === "nodejs") { ... }` blocks, not after early returns. Webpack replaces `NEXT_RUNTIME` at compile time and dead-code-eliminates the unused branch. Early returns (`if (NEXT_RUNTIME !== "nodejs") return;`) do NOT prevent webpack from tracing imports that follow. Always test both `bun run --cwd nextjs dev` and `bun run --cwd nextjs build` when touching instrumentation.
- When multiple event handlers need to check current state before deciding what to do (e.g., "is the last message a streaming assistant?"), that logic belongs in the reducer, not in the handler. Handlers that read state via `useRef` will see stale data when events arrive faster than React renders. The reducer always operates on the latest state.
- In two-phase architectures (POST then SSE), errors during the POST phase must be thrown, not just emitted. Emitting to zero subscribers is silent failure. The POST handler converts exceptions to HTTP error responses, which the frontend already handles. If a catch block calls `emit()` but the subscriber list might be empty, that catch block must also `throw`.
- Spec validation and code review verify correctness, not assembly. Code can satisfy every requirement in isolation while never working in the running system. Plans that change user-facing behavior should include a manual smoke test step: start the system, open the browser, do the thing.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
