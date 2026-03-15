---
title: Daemon migration staging strategy
date: 2026-03-14
status: open
tags: [architecture, daemon, migration, staging, refactor]
modules: [session-manager, vault-manager, controller, extraction, spaced-repetition, file-browser, note-capture, search-cache, scheduler-bootstrap]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/retros/collapse-workspaces.md
  - .lore/retros/content-root-and-instrumentation-fix.md
  - .lore/brainstorm/collapse-workspaces.md
  - .lore/research/daemon-rest-api.md
  - .lore/research/claude-agent-sdk.md
  - .lore/research/claude-agent-sdk-ref-typescript.md
---

# Brainstorm: Daemon Migration Stages

## Context

The daemon-application-boundary spec (REQ-DAB-1 through REQ-DAB-25) describes extracting all domain logic from `nextjs/lib/` into a standalone daemon process. The web app becomes a UI client. A CLI becomes a second client. Agents interact through CLI commands and MCP tool definitions.

The migration is too large for a single plan. This brainstorm identifies discrete stages that can each be planned and executed independently. Stages don't need to produce a runnable system between them. The goal is containment: each stage has a clear scope, known dependencies, and predictable blast radius.

### What the dependency graph tells us

Before staging, it's worth recording what the codebase actually looks like. The dependency graph has clear tiers:

**Tier 0 (shared by everything):** `schemas/`, `logger.ts`. Approximately 25 modules import from schemas. These are the foundation that both daemon and web app need.

**Tier 1 (vault foundation):** `vault-manager.ts`, `vault-config.ts`. About 15 modules depend on vault-manager for path resolution and vault discovery. Everything that touches files goes through this layer.

**Tier 2 (stateless file operations):** `file-browser.ts`, `note-capture.ts`, `search-cache.ts`, `search/search-index.ts`, `meeting-capture.ts`, `transcript-manager.ts`, `task-manager.ts`, `daily-prep-manager.ts`, `file-upload.ts` (plus `utils/image-converter.ts`, `utils/file-types.ts`), `reference-updater.ts`. These read/write vault files with no persistent in-memory state. They depend on Tier 1 and Tier 0, nothing else. Exception: `meeting-store.ts` is listed here but holds in-memory state (active meeting per vault). It moves with this tier but is not truly stateless. `search-cache.ts` also holds an in-memory LRU cache, though it rebuilds from disk.

**Tier 3 (background schedulers):** `extraction/*` (5 files), `spaced-repetition/*` (9 files), `scheduler-bootstrap.ts`. Two self-contained subsystems that are already isolated behind `scheduler-bootstrap.ts`. Both depend on `vault-manager` for vault discovery and `sdk-provider` for LLM calls. Both manage their own state files. The only coupling to Next.js is that `instrumentation.ts` triggers bootstrap on server startup.

**Tier 4 (session lifecycle):** `sdk-provider.ts`, `session-manager.ts`, `streaming/active-session-controller.ts`, `streaming/session-streamer.ts`, `controller.ts`. This is the stateful heart. `controller.ts` is a globalThis singleton that survives HMR. `active-session-controller` holds the live SDK connection and manages the event stream. `session-manager` handles create/resume/save and configures MCP servers for vault sessions. This cluster has the most coupling to both the SDK and the request/response cycle.

**Tier 5 (SDK-dependent utilities):** `vault-setup.ts`, `inspiration-manager.ts`, `pair-writing-prompts.ts`. These use the SDK for one-off LLM calls but have no persistent state.

**API routes are thin.** Every route in `app/api/` follows the same pattern: validate request, call lib/ module, return JSON. They are wrappers, not logic. Converting them from direct imports to daemon API proxies is mechanical work.

## Proposed Stages

### Stage 1: Daemon Skeleton and Shared Package

**What it does:** Creates the daemon process, extracts schemas into a shared package, and establishes the build/test infrastructure for the new architecture.

**What moves:**
- `lib/schemas/` becomes a shared package (both daemon and web app import from it)
- `lib/logger.ts` becomes shared infrastructure (or each side gets its own)
- A new `daemon/` directory gets created with an entry point, Unix socket listener, and health endpoint (REQ-DAB-2, REQ-DAB-21)
- The monorepo structure is restored (the collapse-workspaces retro documented the cost: 218 files changed, 127 import rewrites, so this is a known quantity)

**What it depends on:** Nothing. This is the bootstrap stage.

**What it enables:** Every subsequent stage needs this container to exist. The shared package eliminates the schema duplication problem before it starts. The health endpoint provides immediate validation that the daemon runs.

**Relative size:** Small. Mostly scaffolding and package configuration. The schema extraction is the most labor-intensive part, but schemas have no behavior to test, just type definitions and Zod validators to relocate.

**Risk:** The workspace split is the inverse of the collapse documented in the retro. That retro said the cost was mechanical but high-volume (218 files). This time it's smaller because we're only extracting schemas and logger, not all of lib/. But import path changes ripple.

---

### Stage 2: Vault Foundation

**What it does:** Moves vault discovery and configuration into the daemon and exposes them as API endpoints.

**What moves:**
- `vault-manager.ts` (discovery, path resolution, vault creation)
- `vault-config.ts` (config loading, saving, merging)
- `vault-helpers.ts` (vault lookup utility used by API routes)

**Daemon API surfaces:**
- `GET /vaults` (list discovered vaults)
- `GET /vaults/:id` (vault info)
- `POST /vaults` (create vault)
- `GET /vaults/:id/config`, `PUT /vaults/:id/config`

**What it depends on:** Stage 1 (daemon skeleton, shared schemas).

**What it enables:** Every subsequent stage. Vault-manager is imported by ~15 modules. Once the daemon owns vault resolution, all other modules can be migrated to call the daemon for vault paths instead of importing vault-manager directly. This is the load-bearing stage.

**Relative size:** Small. Three files with clear boundaries. The API surface is straightforward CRUD. But the testing matters: vault discovery is the system's bootstrap path, and getting it wrong means nothing else works.

**Risk:** Low in isolation. The risk is in how downstream stages consume this. During migration, Next.js API routes will need to proxy to the daemon for vault info while still importing other lib/ modules directly. That hybrid state is messy but explicitly allowed by REQ-DAB-23.

---

### Stage 3: Stateless File Operations

**What it does:** Moves all stateless file read/write modules into the daemon.

**What moves:**
- `file-browser.ts` (directory listing, file read, security path checks)
- `file-upload.ts` (file write with WebP conversion), plus `utils/image-converter.ts` and `utils/file-types.ts`
- `note-capture.ts` (daily note append)
- `meeting-capture.ts` (meeting file creation and append)
- `meeting-store.ts` (in-memory meeting state, small but stateful)
- `transcript-manager.ts` (transcript file creation)
- `task-manager.ts` (task discovery from vault files)
- `daily-prep-manager.ts` (daily prep content parsing)
- `reference-updater.ts` (reference path rewriting)
- `search-cache.ts` + `search/search-index.ts` + `search/fuzzy-matcher.ts` (search indexing)
- `handlers/search-handlers.ts`, `handlers/config-handlers.ts` (handler layer, may dissolve into daemon routes)

**Daemon API surfaces:**
- `GET/POST/PUT/DELETE /vaults/:id/files/...`
- `POST /vaults/:id/capture`
- `GET /vaults/:id/search/files`, `/search/content`, `/search/snippets`
- `GET /vaults/:id/tasks`
- `GET /vaults/:id/daily-prep/today`
- `POST/GET /vaults/:id/meetings`
- Plus: directories, recent-notes, recent-activity, pinned-assets, goals, upload

**What it depends on:** Stage 2 (vault foundation in daemon).

**What it enables:** Stage 6 (web conversion) becomes mostly done for non-chat routes. Also enables the CLI (Stage 7) for all file operations.

**Relative size:** Large. This is the biggest stage by file count (~12 source files, ~15 API endpoints to create in the daemon). But the work is repetitive and low-risk. Each module is a self-contained function that takes a vault path and does filesystem I/O. The pattern is the same every time: move module, create daemon route, write test.

**Risk:** The search subsystem has an in-memory LRU cache (`search-cache.ts`). In Next.js, the cache lives in the server process. In the daemon, it lives in the daemon process. This is actually cleaner (no HMR clearing the cache) but worth noting during planning.

`meeting-store.ts` has in-memory state (active meeting per vault). This is a small amount of state, but it means the daemon becomes the source of truth for "is a meeting active?" The web app can no longer check this locally.

---

### Stage 4: Background Schedulers

**What it does:** Moves the extraction pipeline and card discovery system into the daemon. Removes `scheduler-bootstrap.ts` and the scheduler block from `instrumentation.ts`.

**What moves:**
- `extraction/extraction-manager.ts` (orchestration)
- `extraction/extraction-state.ts` (checkpoint tracking)
- `extraction/transcript-reader.ts` (transcript discovery)
- `extraction/fact-extractor.ts` (LLM-based extraction)
- `extraction/memory-writer.ts` (sandbox/commit for memory files)
- `spaced-repetition/card-discovery-scheduler.ts` (orchestration)
- `spaced-repetition/card-discovery-state.ts` (checkpoint tracking)
- `spaced-repetition/card-generator.ts` (LLM-based card generation)
- `spaced-repetition/card-generator-config.ts` (generation config)
- `spaced-repetition/card-dedup.ts` (duplicate detection)
- `spaced-repetition/card-manager.ts` (card CRUD + SM-2 scheduling)
- `spaced-repetition/card-storage.ts` (card file I/O)
- `spaced-repetition/card-schema.ts` (data structures)
- `spaced-repetition/sm2-algorithm.ts` (scheduling algorithm)
- `scheduler-bootstrap.ts` (dissolves into daemon startup)
- `sdk-provider.ts` (must be available in daemon for LLM calls)

**Daemon API surfaces:**
- `POST /vaults/:id/extract/trigger` (manual extraction)
- `GET /vaults/:id/extract/status`
- `GET /vaults/:id/cards/due`
- `POST /vaults/:id/cards/:id/review`
- `GET /vaults/:id/cards/:id`
- `POST /vaults/:id/cards/:id/archive`
- `GET|PUT /config/memory` (memory config, currently at `/api/config/memory`)
- `GET|PUT|DELETE /config/extraction-prompt` (extraction prompt config)
- `POST /config/extraction-prompt/trigger`
- `GET|PATCH /config/card-generator` (card generator config)
- `GET /config/card-generator/requirements`
- `GET /config/card-generator/status`
- `POST /config/card-generator/trigger`

Note: the `app/api/config/*` routes are global (not vault-scoped) but call into extraction and spaced-repetition subsystem modules. In the daemon, they probably sit at `/config/` at the top level. All five must be accounted for in this stage.

**What it depends on:** Stage 2 (vault foundation). Does NOT depend on Stage 3 (stateless ops can move in parallel).

**What it enables:** Removes `instrumentation.ts` scheduler bootstrap entirely, which eliminates the bundler-related failure modes documented in the content-root-and-instrumentation-fix retro. This is a concrete reliability win. Also enables CLI commands for extraction triggering and card review.

**Relative size:** Medium. Two subsystems, ~15 files total. The extraction pipeline and card discovery system are internally well-structured with clear boundaries. The complication is `sdk-provider.ts`: both schedulers need it, and Stage 5 (session lifecycle) also needs it. The daemon must initialize its own SDK provider, which is currently a singleton pattern. This is straightforward (call `initializeSdkProvider()` on daemon startup), but the provider must be shared across both schedulers and the session system.

**Risk:** Low. These subsystems are already the most isolated parts of the codebase. The only external dependency is vault-manager (for vault discovery) and sdk-provider (for LLM calls). Both run on their own timers with their own state files. The retro confirmed the main risk was bundler-related, which extraction eliminates.

---

### Stage 5: Session Lifecycle and Chat

**What it does:** Moves the AI session system into the daemon. This is the architectural centerpiece: the daemon owns the SDK connection, session create/resume/save, streaming events, and the two-phase chat pattern.

**What moves:**
- `session-manager.ts` (create, resume, save, SDK session options)
- `streaming/active-session-controller.ts` (stateful session hub, event emitter)
- `streaming/session-streamer.ts` (SDK event transformation)
- `streaming/types.ts` (event type definitions)
- `controller.ts` (singleton wrapper, `ensureSdk()`, `getController()`)
- `pair-writing-prompts.ts` (prompt templates for pair writing mode)
- `vault-transfer.ts` (MCP server for cross-vault file operations, used by session-manager)
- `vault-setup.ts` (vault initialization, uses SDK for template generation)
- `inspiration-manager.ts` (contextual prompt generation, uses SDK)
- `mock-sdk.ts` (test/dev SDK simulator, must move with sdk-provider or be recreated for daemon tests)
- `sse.ts` (SSE response helper, may stay in web app or move)

**Daemon API surfaces:**
- `POST /chat` (send message, returns sessionId)
- `GET /chat/stream?sessionId=...` (SSE viewport)
- `POST /chat/:sessionId/abort`
- `POST /chat/:sessionId/permission/:toolUseId`
- `POST /chat/:sessionId/answer/:toolUseId`
- `GET /vaults/:id/sessions` (session history)
- `DELETE /vaults/:id/sessions/:id`
- `POST /vaults/:id/setup` (vault initialization)
- `GET /vaults/:id/inspiration`

**What it depends on:** Stage 2 (vault foundation), Stage 3 (stateless ops), and Stage 4 (sdk-provider must be in daemon). The dependency on Stage 3 is hard, not optional: `session-manager.ts` directly imports `note-capture.ts` (for filename formatting) and `transcript-manager.ts` (for transcript init/append). `vault-transfer.ts` imports `file-browser.ts`. These modules must already be in the daemon before the session system can migrate. If Stage 4 hasn't moved sdk-provider, this stage must.

**What it enables:** The daemon fully owns the application boundary. The web app becomes a pure UI client. The CLI can implement `chat send` and `chat stream` commands. Agent interaction becomes possible through CLI.

**Relative size:** Medium by file count (~9 files), but the highest difficulty of any stage. The complexity is in:

1. **Statefulness.** `active-session-controller` holds the live SDK conversation object, pending prompts, and streaming state. This is the only module with significant in-memory state that matters across requests. Moving it means the daemon owns this state and the web app observes it through SSE.

2. **The globalThis pattern.** `controller.ts` attaches to globalThis to survive Next.js HMR. In the daemon, this isn't needed (no HMR), but the migration must handle the transition.

3. **SSE plumbing.** The web app currently creates SSE responses directly from the controller's event stream. In the daemon architecture, the daemon produces SSE and the web app either proxies it or the browser connects to the daemon. The spec says the browser doesn't connect to the daemon directly (constraints section), so the web app must proxy SSE from the daemon to the browser. This is the most architecturally delicate part of the entire migration.

4. **MCP server registration.** `session-manager.ts` configures MCP servers when creating AI sessions (REQ-DAB-18). The vault-transfer MCP server for cross-vault file operations is set up here. This must continue to work from the daemon.

**Risk:** This is where the risk concentrates. The two-phase chat pattern (POST submit, SSE viewport) is already decoupled from client connectivity (REQ-DAB-24 says it requires the least adaptation), but the SSE proxying is new plumbing. A bug here means chat is broken, and chat is the primary feature.

The single-session constraint (REQ-DAB-25) is currently enforced in the controller via `AlreadyProcessingError`. In the daemon, it applies across all clients (web + CLI + agents). The daemon must be the authority for "is a session active?" and reject concurrent requests.

---

### Stage 6: Web App Conversion

**What it does:** Converts all remaining Next.js API routes from direct lib/ imports to daemon API proxies. After this stage, `nextjs/lib/` is empty (or contains only web-specific utilities). The web app is a UI client.

**What moves:** Nothing moves. This stage rewrites. Every API route in `app/api/` that currently imports from `@/lib/` gets converted to proxy to the daemon instead. The lib/ directory is deleted or reduced to web-only modules: `lib/api/client.ts` (frontend HTTP client), `lib/api/types.ts` (frontend API types), and `lib/sse.ts` (if the SSE proxy helper stays in Next.js).

**What it depends on:** Stages 1-5 (all domain logic must be in the daemon before routes can proxy to it).

**What it enables:** The web app is clean. New features go in the daemon, not in lib/. The architectural invariant from REQ-DAB-22 is fully enforced.

**Relative size:** Medium. About 40 route files need conversion. The work is mechanical (replace import + function call with HTTP request to daemon), but every route must be converted and tested. The risk is in completeness, not complexity. A few routes stay web-local (e.g., `GET /api/health` for the web app's own health, which is separate from the daemon's health endpoint). The plan should enumerate which routes stay vs. proxy.

**Risk:** Low per-route, but the volume means regression risk is real. The pre-commit hook running typecheck + lint + tests + build is the safety net here. The type system will catch any remaining direct imports from lib/ modules that no longer exist.

One subtle risk: the web app currently has `lib/api/client.ts` which is the frontend HTTP client for calling its own API routes. After conversion, this client still calls the Next.js API routes, which now proxy to the daemon. The client doesn't change, but the latency characteristics do (one more hop). For most operations this is negligible, but SSE streaming adds a proxy layer that could introduce buffering issues.

---

### Stage 7: CLI Client

**What it does:** Builds the CLI as a second client of the daemon API. Implements progressive discovery (REQ-DAB-8), machine-readable output (REQ-DAB-10), and MCP tool definition generation (REQ-DAB-13).

**What moves:** Nothing moves. This is new code.

**What it depends on:** Stages 1-5 (daemon API must exist). Does NOT depend on Stage 6 (CLI and web conversion can happen in parallel).

**What it enables:** Agent interaction through MCP tool definitions (REQ-DAB-11, REQ-DAB-12). Human-agent parity at the application boundary (REQ-DAB-15). The full vision from the spec is realized.

**Relative size:** Medium. The CLI command table in REQ-DAB-9 lists ~18 commands. Each command is a thin wrapper around a daemon API call with argument parsing and output formatting. The MCP tool definition generation (REQ-DAB-13) is the most architecturally interesting part: CLI command metadata is the canonical source, and MCP definitions are projected from it.

**Risk:** Low. This is new code with a clear contract (daemon API). The main risk is UX: progressive discovery means the CLI must be self-documenting, and that takes design work. The spec has a stub exit point for this ([STUB: cli-progressive-discovery]).

## Ordering Tradeoffs

### Stage 3 vs Stage 4: Stateless ops vs schedulers

These two stages are independent. Neither depends on the other. The question is which to do first.

**Arguments for Stage 3 first:**
- More routes converted means the web app gets closer to "pure client" faster.
- The work is repetitive and builds confidence with the daemon API pattern before tackling the SDK-dependent schedulers.
- Search indexing in the daemon is a natural win (no HMR clearing the cache).

**Arguments for Stage 4 first:**
- Schedulers are the most isolated subsystems. They're already behind `scheduler-bootstrap.ts`. Moving them is surgically clean.
- Removing instrumentation.ts scheduler bootstrap eliminates a documented source of bundler bugs immediately.
- The scheduler subsystems are smaller in total than the stateless ops, so the feedback loop is shorter.

**Recommendation:** Stage 4 first if the goal is quick wins and reliability improvement. Stage 3 first if the goal is building momentum on the daemon API pattern. Either order works. They could even run in parallel if two people are working.

### Stage 5 timing

Stage 5 (session lifecycle) must come after Stages 2, 3, and 4. The dependency on Stage 3 is hard, not just a preference: `session-manager.ts` imports `note-capture.ts` and `transcript-manager.ts`, and `vault-transfer.ts` imports `file-browser.ts`. These modules must be in the daemon before the session system can migrate. This also means the simpler stateless ops are done first, so daemon API patterns are established and tested before tackling the hardest piece.

### Stage 6 vs Stage 7: Web conversion vs CLI

These can run in parallel. Stage 6 converts existing routes to proxy to the daemon. Stage 7 creates new CLI commands that call the daemon. Neither depends on the other. The only shared concern is the daemon API design, which should be stable after Stages 2-5.

### Could stages be combined?

Stage 2 (vault foundation) is small enough to fold into Stage 1 (skeleton). But keeping them separate means Stage 1 is pure infrastructure with no domain logic decisions, and Stage 2 is the first domain extraction. The separation makes each more plannable.

Stages 3 and 4 could combine into "all non-session domain logic." But that's ~25 files and ~20 API endpoints, which is too large for a single plan. The natural seam (stateless ops vs background schedulers) is worth preserving.

## Resolved Questions

1. **Daemon API design spec.** Resolved: use the middle ground. The Guild Hall daemon REST API design (`.lore/research/daemon-rest-api.md`, stored as reference material) provides proven conventions: capability-oriented URL grammar, `help` as a discovery primitive, structured error format, SSE streaming wire format, HTTP method guidance. Stage 1 establishes Memory Loop's conventions by adapting these patterns (without adopting Guild Hall's domain model), and each subsequent stage applies them. No separate API design spec needed.

2. **SSE proxying architecture.** Resolved: no standalone design document needed. The daemon-side wire format is established (unnamed SSE messages, JSON payloads with `type` discriminator, errors in-stream). The Next.js proxy is mechanical: a route handler opens a `fetch()` to the daemon's SSE endpoint and pipes the `ReadableStream` body into the response. The proxy is byte-transparent since it doesn't parse or transform events. The only open implementation question is buffering behavior (whether Next.js or its HTTP layer buffers SSE frames), which is a "test and observe" question during Stage 5, not an upfront design question.

3. **SDK provider sharing.** Resolved: single provider, shared. Confirmed by direct experience that the Agent SDK's `query()` handles concurrent calls from multiple Promises without issues. The daemon initializes one SDK provider at startup. Both schedulers and interactive chat use it. No need for separate instances or concurrency wrappers.

4. **Schema package structure.** Resolved: move everything into one shared package. Web-specific protocol types (client message schemas) go with the rest. Tree-shaking handles unused imports on each side. Splitting adds package boundaries that would be wrong within two stages. Finalized during Stage 1 planning.

5. **Test migration.** Resolved: per-stage audit. The SDK provider test pattern (`configureSdkForTesting`) is already dependency-injection-based and portable. The main risk is tests using Next.js `Request`/`Response` objects, but those live in route tests (Stage 6), not domain module tests. Each stage plan audits its module tests for portability before starting work.

6. **Handlers layer.** Resolved: dissolve them. `search-handlers.ts` and `config-handlers.ts` are thin wrappers that exist because API routes wanted a layer between route and domain logic. In the daemon, route handlers ARE that layer. Keeping them adds indirection. Dissolved during their respective stage (Stage 3 for search-handlers, Stage 4 for config-handlers).

7. **Legacy session route.** Resolved: normalize during migration. The `/api/sessions/[vaultId]` route becomes vault-scoped in the daemon (e.g., `GET /vaults/:id/session`). Migration is the right time to fix URL shape. Handled during Stage 5 planning.

## Next Steps

All open questions are resolved. Each stage can proceed to planning via `/lore-development:prep-plan`. The recommended order:

1. Stage 1 (skeleton) and Stage 2 (vault foundation) can be planned together or sequentially. Stage 1 should establish daemon API conventions adapted from the Guild Hall reference design (`.lore/research/daemon-rest-api.md`).
2. Stages 3 and 4 can be planned in parallel once Stage 2's plan is approved.
3. Stage 5 should be planned after Stages 3 and 4 are at least planned (if not executed), because the patterns established there inform the session migration. SSE proxy buffering should be tested during Stage 5 implementation, not designed upfront.
4. Stages 6 and 7 can be planned in parallel once Stage 5's plan exists.

Reference material for planning:
- `.lore/research/daemon-rest-api.md` (Guild Hall API design, adapt conventions)
- `.lore/research/claude-agent-sdk.md` (SDK capabilities and concurrency behavior)
- `.lore/research/claude-agent-sdk-ref-typescript.md` (TypeScript SDK API reference)
