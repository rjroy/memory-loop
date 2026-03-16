---
title: Daemon application boundary
date: 2026-03-14
status: implemented
tags: [architecture, daemon, cli, web, agents, domain-boundary, refactor]
modules: [session-manager, vault-manager, note-capture, file-browser, scheduler-bootstrap, controller, extraction, spaced-repetition]
related:
  - .lore/specs/server-driven-chat.md
  - .lore/retros/next-js-migration.md
  - .lore/retros/collapse-workspaces.md
  - .lore/retros/content-root-and-instrumentation-fix.md
  - .lore/brainstorm/collapse-workspaces.md
  - .lore/brainstorm/agentic-data-source-pattern.md
  - .lore/reference/_overview.md
  - .lore/example/daemon-application-boundary.md
req-prefix: DAB
---

# Spec: Daemon Application Boundary

## Overview

Memory Loop's target architecture treats a long-running daemon process as the application. The daemon owns vault operations, AI session lifecycle, note capture, file management, scheduled extraction, card discovery, and all other domain logic that currently lives in `nextjs/lib/`. The Next.js web app becomes a UI client that renders state and relays user intent. A CLI becomes a second client, and AI agents interact with the system by invoking CLI commands through MCP tool definitions.

This spec records the target architecture without rewriting the specs that describe the system as it exists today. The existing server-driven chat spec (REQ-SDC-*) remains valid; this spec reframes where that processing model runs.

## Entry Points

- Architecture needs a clear statement of what counts as the application boundary (from CLAUDE.md)
- The two-phase chat pattern (POST submit, SSE viewport) already decouples processing from client connectivity and maps naturally to daemon API semantics (from server-driven-chat spec)
- Background schedulers (extraction, card discovery) run inside Next.js instrumentation and are a persistent source of bundler bugs (from content-root-and-instrumentation-fix retro)
- The workspace collapse was done because there was only one consumer; a daemon reintroduces multi-consumer architecture that justifies separation (from collapse-workspaces retro)
- Agent interaction with Memory Loop needs a stable, discoverable capability surface (from agentic-data-source-pattern brainstorm)

## Requirements

### Application Boundary

- REQ-DAB-1: The daemon is Memory Loop's application runtime and authority boundary. Vault operations, AI session lifecycle, scheduled tasks, and filesystem writes are owned by the daemon even when other processes initiate them.

- REQ-DAB-2: Memory Loop's application API is REST over the daemon's local socket. The daemon listens on a Unix socket (or localhost TCP as fallback on platforms without Unix socket support). Other transports may proxy to this API, but application clients do not define alternate authority paths around the daemon.

- REQ-DAB-3: All vault data remains on the filesystem (no database). The daemon reads and writes vault files directly. Clients access vault data through the daemon API, not through independent filesystem access. The "vault as source of truth" pattern is preserved; the daemon is the process that reads and writes that source of truth.

### Web Client

- REQ-DAB-4: The Next.js web app is a UI client, not a parallel application runtime. Reads and writes that depend on vault state must flow through the daemon API rather than importing `lib/` modules directly.

- REQ-DAB-5: The two-phase chat pattern transfers to the daemon API. The web app sends a message (POST to daemon), then opens an SSE viewport (GET from daemon) to observe processing. The daemon processes each message to completion regardless of client connectivity, preserving all REQ-SDC-* guarantees.

- REQ-DAB-6: The web app retains ownership of React components, state management (SessionContext, useReducer), hooks, and presentation logic. These are client concerns that do not belong in the daemon.

### CLI Client

- REQ-DAB-7: A CLI is a first-class client of the daemon API. CLI commands map to daemon operations and use the same application boundary as the web app.

- REQ-DAB-8: The CLI provides progressive discovery of Memory Loop capabilities. Running the CLI without arguments shows available commands. Each command has a description, accepted arguments, and structured output. A user who knows no commands can explore the full capability surface by following help text.

- REQ-DAB-9: CLI commands cover the same domain operations available to the web app. The full set includes but is not limited to:

  | Command | Purpose | Maps to current module |
  |---------|---------|----------------------|
  | `vault list` | List discovered vaults | `vault-manager.ts` |
  | `vault info <id>` | Show vault details and config | `vault-manager.ts`, `vault-config.ts` |
  | `vault create <title>` | Create a new vault | `vault-manager.ts` |
  | `capture <vault> <text>` | Append to today's daily note | `note-capture.ts` |
  | `chat send <vault> <message>` | Start or continue a discussion | `session-manager.ts`, `controller.ts` |
  | `chat stream <session>` | Attach to a session's event stream | `session-streamer.ts` |
  | `chat abort <session>` | Stop active processing | `controller.ts` |
  | `chat history <vault>` | List recent sessions | `session-manager.ts` |
  | `browse <vault> [path]` | List files or read a file | `file-browser.ts` |
  | `search <vault> <query>` | Search vault content | `search-cache.ts` |
  | `cards due <vault>` | List due spaced repetition cards | `card-manager.ts` |
  | `cards review <vault> <id> <rating>` | Submit a card review | `card-manager.ts` |
  | `extract trigger <vault>` | Trigger memory extraction now | `extraction-manager.ts` |
  | `config get <vault>` | Show vault configuration | `vault-config.ts` |
  | `config set <vault> <key> <value>` | Update vault configuration | `vault-config.ts` |
  | `health` | Daemon health and status | `health` route |

- REQ-DAB-10: CLI output is machine-readable by default (JSON), with a `--human` or `--format` flag for human-friendly rendering. Machine-readable output enables agent consumption without parsing heuristics.

### Agent Interaction

- REQ-DAB-11: An AI agent interacts with Memory Loop by invoking CLI commands. The agent does not receive a separate privileged API surface. The CLI is the agent's interface to the application, just as it is for a human at a terminal.

- REQ-DAB-12: Agent discovery of Memory Loop capabilities uses MCP tool definitions. Each CLI command is described as an MCP tool with a name, description, input schema (arguments), and output schema. An agent's MCP client reads these definitions to learn what operations are available.

- REQ-DAB-13: MCP tool definitions are generated from CLI command metadata, not maintained separately. The CLI is the canonical source of command names, descriptions, argument shapes, and output schemas. MCP definitions are a projection of that metadata into the MCP protocol format.

- REQ-DAB-14: The primary agent interaction mechanism is an MCP server that wraps CLI commands. The daemon can serve this MCP endpoint directly (or a standalone adapter process can invoke the CLI on the agent's behalf). The agent does not link against daemon internals, import daemon libraries, or hold a persistent connection beyond what an MCP session requires. The MCP server's implementation and hosting model are defined in [STUB: mcp-tool-projection].

- REQ-DAB-15: Human-agent parity holds at the application boundary. Any vault operation available to humans through the web app or CLI is available to agents through the same CLI commands and daemon API. Any operation an agent can perform is discoverable in human-facing surfaces.

### Domain Ownership

- REQ-DAB-16: The daemon owns all domain modules currently in `nextjs/lib/`. The boundary between daemon-owned and web-owned is:

  **Daemon-owned** (moves out of Next.js):
  - Vault discovery and configuration (`vault-manager.ts`, `vault-config.ts`)
  - AI session lifecycle (`session-manager.ts`, `sdk-provider.ts`)
  - Active session orchestration (`controller.ts`, `streaming/`)
  - Note capture (`note-capture.ts`)
  - File operations (`file-browser.ts`, `file-upload.ts`)
  - Search (`search-cache.ts`)
  - Memory extraction pipeline (`extraction/`)
  - Spaced repetition system (`spaced-repetition/`)
  - Transcript management (`transcript-manager.ts`)
  - Meeting capture and storage (`meeting-capture.ts`, `meeting-store.ts`)
  - Daily prep (`daily-prep-manager.ts`)
  - Inspiration generation (`inspiration-manager.ts`)
  - Task management (`task-manager.ts`)
  - Vault setup (`vault-setup.ts`)
  - Background schedulers (`scheduler-bootstrap.ts`)
  - Zod schemas (`schemas/`)

  **Web-owned** (stays in Next.js):
  - React components (`components/`)
  - React hooks (`hooks/`)
  - State management (`contexts/`)
  - SSE client consumption (`hooks/useChat.ts`)
  - Page routing (`app/`)
  - Presentation logic and formatting
  - Auth middleware (if present)

- REQ-DAB-17: Background schedulers (memory extraction at 3am, card discovery at 4am) are daemon responsibilities. They run as part of the daemon process lifecycle, not through Next.js instrumentation. This eliminates the bundler-related failure modes documented in the content-root-and-instrumentation-fix retro.

- REQ-DAB-18: The daemon manages MCP server registration for vault sessions. When the daemon creates an AI session for a vault, it configures MCP servers as part of session setup (e.g., vault-transfer, the existing per-session MCP server for cross-vault file operations, currently created in `session-manager.ts`). Clients do not independently configure MCP servers for sessions they initiate.

### Session Concurrency

- REQ-DAB-25: Only one active AI session exists at a time across all clients. The single-session constraint from REQ-SDC-5 applies to the daemon, not per-client. If the web app has an active discussion and the CLI sends `chat send`, the daemon rejects the CLI request with a conflict error. This preserves the existing processing model where one message processes to completion before the next is accepted.

### Daemon Lifecycle

- REQ-DAB-19: The daemon runs as a long-lived process, started at boot (via systemd user service or equivalent). It holds in-memory state for active sessions and subscriptions. Process restart clears in-memory state; persistent state lives on the filesystem in vault directories.

- REQ-DAB-20: The daemon is single-user. Memory Loop is a personal tool that runs on the user's machine. The daemon does not implement multi-tenant isolation, user accounts, or access control beyond what the filesystem provides.

- REQ-DAB-21: The daemon exposes a health endpoint that reports process uptime, active session count, scheduler status, and discovered vault count. Both CLI (`health` command) and web app use this to confirm the daemon is running.

### Migration

- REQ-DAB-22: Migration toward this architecture must reduce boundary bypasses rather than deepen them. New work should move domain logic toward the daemon API rather than adding new direct-import paths from Next.js into domain modules.

- REQ-DAB-23: During migration, the Next.js app may continue to import `lib/` modules directly for operations not yet exposed through the daemon API. This is transitional, not architectural. Each migration phase should convert a set of direct imports to daemon API calls.

- REQ-DAB-24: The two-phase chat pattern requires the least adaptation because it already separates submission (POST) from observation (SSE). The daemon API for chat can match the current HTTP interface almost verbatim.

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Daemon REST API design | Need concrete resource model, request/response shapes, and streaming rules | [STUB: daemon-rest-api] |
| CLI command grammar and UX | Need exact command syntax, output formats, and discovery flow | [STUB: cli-progressive-discovery] |
| MCP tool definition format | Need the schema for projecting CLI commands into MCP tool definitions | [STUB: mcp-tool-projection] |
| Daemon process management | Need systemd unit, startup sequence, and crash recovery details | [STUB: daemon-lifecycle] |
| Migration plan | Ready to sequence the extraction of domain modules from Next.js | [STUB: daemon-migration-plan] |

## Success Criteria

- [ ] The daemon is stated as the sole application boundary for future-state work
- [ ] The spec clearly distinguishes current implementation (domain logic in Next.js lib/) from target architecture (domain logic in daemon)
- [ ] Web app is defined as a UI client of the daemon API, not a parallel filesystem-facing runtime
- [ ] CLI is defined as a first-class daemon client with progressive discovery
- [ ] Agent interaction is defined through CLI commands and MCP tool definitions, not a separate privileged surface
- [ ] Human-agent parity is stated as an application-boundary invariant
- [ ] Domain module ownership (daemon vs web) is enumerated explicitly
- [ ] Background schedulers are identified as daemon responsibilities, not Next.js instrumentation concerns
- [ ] Migration principles are documented without turning this spec into an implementation plan
- [ ] The two-phase chat pattern (POST submit, SSE viewport) is preserved in the daemon API surface
- [ ] No implementing work introduces new direct-import paths from Next.js into domain modules (behavioral invariant for migration)

## AI Validation

This is a target-architecture spec with no implementation deliverable. Standard test defaults do not apply.

**Validation approach:**
- Implementing work governed by this spec must satisfy standard defaults (unit tests, 90%+ coverage, fresh-context review)
- Each implementing spec or plan must verify that no new direct-import paths from Next.js into domain modules were introduced
- The spec itself is validated by its success criteria and by fresh-context spec review

## Constraints

- This spec defines the target architecture, not the currently implemented behavior.
- This spec does not define rollout order, endpoint catalogs, or transport payload formats. Those belong in the stub exit points.
- This spec does not prohibit daemon-internal implementation patterns (helper modules, internal abstractions) as long as they do not replace the public daemon API boundary.
- This spec does not change the data model. Vault data stays on the filesystem in the same directory structure. The daemon is the process that owns reads and writes to that data, not a new storage layer.
- The CLI command table (REQ-DAB-9) is illustrative, not exhaustive. The canonical command set will be defined in the CLI progressive discovery spec.
- This spec assumes single-machine deployment. Distributed or multi-node architectures are out of scope.
- The web app reaches the daemon through Next.js API routes that proxy to the daemon socket. The browser does not connect to the daemon directly. Whether these proxy routes are the permanent architecture or a migration artifact is defined in [STUB: daemon-rest-api].

## Context

- **CLAUDE.md** documents the current architecture: domain logic in `nextjs/lib/`, API routes in `nextjs/app/api/`, two-phase chat pattern. This spec reframes that architecture with the daemon as the application boundary.
- **Server-driven chat spec** (`.lore/specs/server-driven-chat.md`) defines REQ-SDC-1 through REQ-SDC-16. The processing model (server processes to completion, SSE as viewport, snapshot-on-connect) transfers directly to the daemon. This spec does not replace it; it reframes where that processing runs.
- **Next.js migration retro** (`.lore/retros/next-js-migration.md`) validated that domain logic in `lib/` is already a transport-independent library: "Backend modules that are pure libraries transferred to Next.js with zero modifications." This confirms extraction feasibility.
- **Collapse workspaces retro** (`.lore/retros/collapse-workspaces.md`) documents collapsing the three-workspace structure (backend/, shared/, nextjs/) into one because there was only one consumer. A daemon reintroduces multi-consumer architecture. The retro notes the mechanical cost: 218 files changed, 127 import rewrites.
- **Content-root and instrumentation fix retro** (`.lore/retros/content-root-and-instrumentation-fix.md`) documents bundler-related failures in background schedulers running through `instrumentation.ts`. Moving schedulers to the daemon eliminates this failure class entirely.
- **Agentic data source pattern brainstorm** (`.lore/brainstorm/agentic-data-source-pattern.md`) defines how external services integrate via MCP servers. The daemon would own MCP server registration for vault sessions.
- **Guild Hall daemon application boundary** (`.lore/example/daemon-application-boundary.md`) is the reference pattern this spec adapts. Key concepts carried forward: daemon as authority boundary, web as client, CLI as first-class client, human-agent parity. Concepts not carried forward: "skills" terminology (replaced by CLI commands and MCP tool definitions), five internal concerns model (Guild Hall-specific), toolbox abstractions.
