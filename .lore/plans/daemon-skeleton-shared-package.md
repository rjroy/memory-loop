---
title: "Stage 1: Daemon skeleton and shared package"
date: 2026-03-14
status: draft
tags: [daemon, monorepo, shared-package, schemas, migration, infrastructure]
modules: [schemas, logger, daemon]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/retros/collapse-workspaces.md
---

# Plan: Stage 1 - Daemon Skeleton and Shared Package

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 1 section)
**API conventions**: `.lore/research/daemon-rest-api.md`

Requirements addressed:
- REQ-DAB-2: Unix socket listener, localhost TCP fallback → Steps 4, 5
- REQ-DAB-21: Health endpoint (uptime, active sessions, scheduler status, vault count) → Step 6
- REQ-DAB-22: Migration reduces boundary bypasses → Step 3 (shared package prevents duplication)
- REQ-DAB-20: Single-user, no multi-tenant → Step 5 (no auth middleware)

Staging goals addressed:
- Extract `lib/schemas/` into a shared package → Steps 2, 3
- Decide logger strategy → Step 2
- Create `daemon/` directory with entry point, socket listener, health endpoint → Steps 4, 5, 6
- Restore monorepo workspace structure → Step 1
- Establish daemon API conventions → Step 5

## Codebase Context

**Current structure:** Single Next.js application with `"workspaces": ["nextjs"]` in the root `package.json`. All domain logic lives in `nextjs/lib/`. The workspace field was kept after the collapse (retro noted removing it broke `bun install` from root in CI).

**Schema files:** Three source files (`index.ts`, `protocol.ts`, `types.ts`) plus one test file (`__tests__/protocol.test.ts`) in `nextjs/lib/schemas/`. Only external dependency is `zod@^4.0.0`. 75 files across the project import from `@/lib/schemas` (the `@/` path alias resolves within Next.js).

**Logger:** Single file at `nextjs/lib/logger.ts`, 96 lines, zero dependencies. Uses `process.env.LOG_LEVEL` and `console.*`. 10 files import it. Pre-created module loggers at the bottom (`wsLog`, `vaultLog`, `sessionLog`, `serverLog`).

**Existing monorepo config:**
- Root `package.json`: workspaces, dev scripts that proxy to nextjs, devDependencies (eslint, prettier, typescript, bun-types, typescript-eslint)
- Root `tsconfig.json`: Base config with esnext/bundler, strict, bun-types
- `nextjs/tsconfig.json`: Extends nothing (standalone), has `@/*` path aliases, Next.js plugin, excludes tests
- `nextjs/package.json`: Named `@memory-loop/nextjs`, all runtime and dev dependencies

**Collapse-workspaces retro lessons (directly relevant):**
- The original collapse was 218 files changed, 127 import rewrites. This extraction is smaller (schemas only, not all of lib/).
- Root `bun install` requires workspace awareness. The `workspaces` field must list all packages.
- Scope sed/grep operations by searching for the pattern first, not assuming where it lives.
- Validate dev server (`next dev`) separately from production build. Turbopack and webpack resolve differently.

**Resolved decisions from brainstorm:**
- Schema package: everything in one shared package, tree-shaking handles unused imports.
- Logger: shared infrastructure (brainstorm listed it with schemas as Tier 0).
- Handler layer: dissolve during respective stages (not this stage).
- SDK provider sharing: single provider, shared across daemon subsystems.

## Decisions

### D1: Daemon HTTP framework — Hono

Hono is the right choice for the daemon's HTTP layer. It runs on Bun natively, supports Unix socket binding through Bun's `Bun.serve()`, and the project's TypeScript setup rules recommend it for API services. It has built-in SSE support for the streaming endpoints needed in later stages. Hono is a dependency of the daemon package only; the web app stays on Next.js.

### D2: Shared package mechanism — workspace package at `packages/shared`

Create `packages/shared/` as a workspace package named `@memory-loop/shared`. The root `package.json` workspaces become `["nextjs", "packages/shared"]`. Both `nextjs` and `daemon` declare `@memory-loop/shared` as a dependency. Bun resolves workspace dependencies without publishing.

The alternative (tsconfig path aliases pointing across directories) doesn't work cleanly because Next.js and the daemon have different tsconfigs, and path aliases don't survive bundling. A real package with its own `package.json` is the portable solution.

### D3: Logger strategy — shared in `@memory-loop/shared`

The logger has zero dependencies and is used by both sides. Putting it in the shared package avoids duplication. The pre-created module loggers (`wsLog`, `vaultLog`, etc.) stay in the files that use them; only `createLogger` and `setLogLevel` go into the shared package. This is cleaner than maintaining two identical logger implementations.

### D4: Daemon API conventions — adapted from Guild Hall reference

Adapted from `.lore/research/daemon-rest-api.md`, Memory Loop's daemon API follows these conventions:

**URL grammar:** `/<domain>/<resource>/<action>` (simplified from Guild Hall's four-segment model, which fits a larger system). Memory Loop has fewer capability domains, so three segments provide clarity without artificial padding.

**Discovery:** `GET /help` at every hierarchy level returns structured JSON describing available children. This is the progressive discovery primitive from the reference design. The health endpoint is the first concrete implementation.

**HTTP methods:**
- `GET` for reads and discovery (`/help`, `/health`, vault listings)
- `POST` for mutations and capability invocations (send message, trigger extraction)
- `PUT` for full replacement (config updates)
- `DELETE` for removal (session deletion)

**Error format:** All errors return JSON with `{ "error": string, "code": string, "detail"?: string }`. HTTP status codes follow standard semantics (400 bad request, 404 not found, 409 conflict for session contention per REQ-DAB-25, 500 internal error).

**Streaming:** SSE with unnamed events, JSON payloads with `type` discriminator. Errors sent in-stream as `{ "type": "error", "reason": "..." }`. Matches the existing Next.js SSE format, so the web app proxy in Stage 6 is byte-transparent.

**Structured responses:** All responses are JSON. The health endpoint establishes the pattern: structured data that both CLI and web app can consume directly.

## Implementation Steps

### Step 1: Restore monorepo workspace structure

**Files**: `package.json` (root), new `packages/shared/package.json`, new `packages/shared/tsconfig.json`

Create the `packages/shared/` directory and register it as a workspace. This is infrastructure; no code moves yet.

1. Create `packages/shared/package.json`:
   ```json
   {
     "name": "@memory-loop/shared",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts"
     },
     "dependencies": {
       "zod": "^4.0.0"
     }
   }
   ```
   Use `exports` instead of `main`/`types`. The `exports` field is the modern standard and works consistently across Bun, Next.js's webpack, and turbopack. No build step. Both consumers import TypeScript source directly. Next.js transpiles workspace packages through its bundler (with `transpilePackages` in `next.config.ts`). The daemon runs on Bun, which executes TypeScript natively.

2. Create `packages/shared/tsconfig.json` that extends the root tsconfig:
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "rootDir": "src"
     },
     "include": ["src"]
   }
   ```

3. Update root `package.json` workspaces to `["nextjs", "packages/shared"]`.

4. Run `bun install` from root. Verify the workspace link resolves.

**Verification**: `bun install` succeeds. `packages/shared/` exists with valid package.json.

### Step 2: Move schemas and logger into shared package

**Files**: `nextjs/lib/schemas/*` → `packages/shared/src/schemas/`, `nextjs/lib/logger.ts` → `packages/shared/src/logger.ts`, new `packages/shared/src/index.ts`
**Addresses**: Staging goal (extract schemas), D3 (logger strategy)

1. Create `packages/shared/src/` directory.

2. Move schema files:
   - `nextjs/lib/schemas/index.ts` → `packages/shared/src/schemas/index.ts`
   - `nextjs/lib/schemas/protocol.ts` → `packages/shared/src/schemas/protocol.ts`
   - `nextjs/lib/schemas/types.ts` → `packages/shared/src/schemas/types.ts`
   - `nextjs/lib/schemas/__tests__/protocol.test.ts` → `packages/shared/src/schemas/__tests__/protocol.test.ts`

   Use `git mv` to preserve history.

3. Move logger:
   - `nextjs/lib/logger.ts` → `packages/shared/src/logger.ts`

   Strip the pre-created module loggers (`wsLog`, `vaultLog`, `sessionLog`, `serverLog`) from the shared version. These are consumer-specific conveniences. Each consumer creates its own named loggers. The shared package exports only `createLogger`, `setLogLevel`, and the `LogLevel` type.

4. Create `packages/shared/src/index.ts` as the package entry point:
   - Re-export everything from `./schemas/index` (preserving the existing export surface)
   - Export `createLogger`, `setLogLevel`, and `LogLevel` type from `./logger`

5. Remove the now-empty `nextjs/lib/schemas/` directory and `nextjs/lib/logger.ts`.

**Verification**: `packages/shared/` contains schemas and logger. Old locations are gone. `bun install` still resolves.

### Step 3: Rewrite imports across the codebase

**Files**: 75 files importing `@/lib/schemas`, 10 files importing `@/lib/logger`
**Addresses**: REQ-DAB-22 (reduces boundary bypasses by centralizing shared types)

1. Add `@memory-loop/shared` as a dependency in `nextjs/package.json`:
   ```json
   "@memory-loop/shared": "workspace:*"
   ```

2. Run `bun install` to link the workspace dependency.

3. Add `transpilePackages: ["@memory-loop/shared"]` to `next.config.ts`. The collapse-workspaces retro removed this config because there was only one package, but adding a workspace package with TypeScript source reintroduces the need. Apply it now rather than debugging a cryptic bundler error later. The cost of adding it when it isn't needed is zero.

4. Rewrite schema imports. Grep found all 75 files use `from "@/lib/schemas"` (the root index). No files use sub-path imports like `from "@/lib/schemas/protocol"`. The single replacement pattern:
   - `from "@/lib/schemas"` → `from "@memory-loop/shared"`

   Before running bulk replacement, verify this is still true by grepping for every distinct import path variant. The collapse-workspaces retro says: "scope sed operations by grepping for the pattern first."

5. Rewrite logger imports. The 10 files importing `@/lib/logger` fall into two groups:
   - Files importing only `createLogger`: change the import path to `from "@memory-loop/shared"`. No other changes needed.
   - Files importing pre-created loggers (`wsLog`, `vaultLog`, `sessionLog`, `serverLog`): change the import to `{ createLogger } from "@memory-loop/shared"` and add a local `const log = createLogger("module-name")` call.

   Run `grep -r "wsLog\|vaultLog\|sessionLog\|serverLog" nextjs/` to identify which files need the extra `createLogger` call vs. which just need the import path changed.

6. Run full verification: `bun run typecheck && bun run lint && bun run test && bun run build`.

7. Run `bun run --cwd nextjs dev` separately (turbopack resolves differently from webpack, per collapse-workspaces retro).

**Risk**: This is the highest-volume step. 85 files change. The import rewrite is mechanical, but completeness matters. Missing one file means a runtime crash, not a type error, if the import path doesn't resolve. The typecheck catches most of these, but the dev server test (step 6) catches turbopack-specific resolution failures.

**Verification**: All five quality gates pass (typecheck, lint, test, build, dev). No remaining imports from `@/lib/schemas` or `@/lib/logger`.

### Step 4: Create daemon package skeleton

**Files**: New `daemon/package.json`, `daemon/tsconfig.json`, `daemon/src/index.ts`
**Addresses**: REQ-DAB-2 (daemon process), staging goal (daemon directory)

1. Create `daemon/` directory at the project root.

2. Create `daemon/package.json`:
   ```json
   {
     "name": "@memory-loop/daemon",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "bun --watch src/index.ts",
       "start": "bun src/index.ts",
       "test": "LOG_LEVEL=silent bun test",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@memory-loop/shared": "workspace:*",
       "hono": "^4.0.0"
     },
     "devDependencies": {
       "bun-types": "^1.3.4",
       "typescript": "^5.7.2"
     }
   }
   ```

3. Create `daemon/tsconfig.json`:
   ```json
   {
     "extends": "../tsconfig.json",
     "compilerOptions": {
       "rootDir": "src",
       "paths": {
         "@/*": ["./src/*"]
       }
     },
     "include": ["src", "src/**/*.test.ts"]
   }
   ```

4. Create `daemon/src/index.ts` as a minimal entry point (placeholder for Step 5).

5. Update root `package.json`:
   - Add `daemon` to workspaces: `["nextjs", "packages/shared", "daemon"]`
   - Add root scripts for daemon: `"daemon:dev"`, `"daemon:start"`, `"daemon:test"`, `"daemon:typecheck"`

6. Update root quality scripts to cover daemon. The root `typecheck` and `lint` scripts should run across all workspaces, or at minimum be extended to include daemon.

7. Run `bun install` to link all workspace dependencies.

**Verification**: `daemon/` exists with valid package structure. `bun install` succeeds. `bun run --cwd daemon typecheck` passes. Importing from `@memory-loop/shared` in `daemon/src/index.ts` resolves correctly.

### Step 5: Implement Unix socket listener with Hono

**Files**: `daemon/src/index.ts`, new `daemon/src/server.ts`
**Addresses**: REQ-DAB-2 (Unix socket listener, localhost TCP fallback), REQ-DAB-20 (single-user)

1. Create `daemon/src/server.ts` with the Hono app factory:
   - Create a Hono instance
   - Export a function that starts the server on a Unix socket path (default: `$XDG_RUNTIME_DIR/memory-loop.sock` or `/tmp/memory-loop.sock`)
   - Accept `DAEMON_SOCKET` env var to override the socket path
   - Accept `DAEMON_PORT` env var to use localhost TCP instead (fallback for platforms without Unix socket support, per REQ-DAB-2)
   - If the socket file already exists at startup, attempt to remove it (stale socket from a crash). Log a warning when doing so.
   - Use `Bun.serve()` with the Hono fetch handler. Bun.serve supports `unix:` socket paths natively.

2. Wire up `daemon/src/index.ts`:
   - Import and call the server start function
   - Log startup with the socket path or TCP port
   - Handle SIGTERM/SIGINT for clean shutdown (remove socket file)
   - Record process start time for the health endpoint's uptime field

3. No auth middleware (REQ-DAB-20: single-user, local machine).

**Verification**: `bun run --cwd daemon start` starts the daemon. The socket file appears (or the TCP port opens). `curl --unix-socket /tmp/memory-loop.sock http://localhost/` returns a response (404 is fine at this point, it means the server is listening). Clean shutdown removes the socket file.

### Step 6: Implement health endpoint and help discovery root

**Files**: New `daemon/src/routes/health.ts`, new `daemon/src/routes/help.ts`, update `daemon/src/server.ts`
**Addresses**: REQ-DAB-21 (health endpoint), D4 (API conventions)

1. Create `daemon/src/routes/health.ts`:
   - `GET /health` returns JSON:
     ```json
     {
       "status": "ok",
       "uptime": 12345,
       "version": "0.0.0",
       "vaults": 0,
       "activeSessions": 0,
       "schedulers": {
         "extraction": { "status": "idle", "lastRun": null, "nextRun": null },
         "cardDiscovery": { "status": "idle", "lastRun": null, "nextRun": null }
       }
     }
     ```
   - `uptime` is seconds since process start (from Step 5).
   - `activeSessions` is a number (0 or 1, per REQ-DAB-25's single-session constraint). Using a count rather than a nullable object keeps the contract simple and consistent with the spec's "active session count" language.
   - `vaults`, `activeSessions`, and `schedulers` are hardcoded placeholders (0, 0, idle). They get wired to real data as domain modules migrate in Stages 2-5.
   - The response shape is the contract. Placeholder values are acceptable for Stage 1; the shape is not.

2. Create `daemon/src/routes/help.ts`:
   - `GET /help` returns the API discovery root:
     ```json
     {
       "name": "memory-loop",
       "version": "0.0.0",
       "description": "Memory Loop daemon API",
       "endpoints": [
         {
           "path": "/health",
           "method": "GET",
           "description": "Daemon health and status"
         }
       ]
     }
     ```
   - This is the seed of progressive discovery. Each stage adds entries as endpoints are created.

3. Create `daemon/src/routes/__tests__/health.test.ts`:
   - Test that `GET /health` returns 200 with the expected JSON shape.
   - Test that uptime is a non-negative number.
   - Use Hono's `app.request()` test helper (no real server needed).

4. Create `daemon/src/routes/__tests__/help.test.ts`:
   - Test that `GET /help` returns 200 with the expected structure.
   - Test that the health endpoint is listed in the discovery response.

5. Register routes in `daemon/src/server.ts`.

**Verification**: Tests pass. `curl --unix-socket $SOCKET http://localhost/health` returns valid JSON with the documented shape. `curl --unix-socket $SOCKET http://localhost/help` returns the discovery root.

### Step 7: Update build and test infrastructure

**Files**: Root `package.json` scripts, `.git-hooks/pre-commit.sh` (if it exists), `scripts/launch.sh`

1. Update root `package.json` scripts to run quality checks across all workspaces:
   - `"test"` should run tests in both nextjs and daemon
   - `"typecheck"` should typecheck all three packages (shared, nextjs, daemon)
   - `"lint"` should lint all packages

2. Update `.git-hooks/pre-commit.sh` to add a daemon quality block. The hook currently has a Next.js block that runs typecheck, lint, tests, and build from `nextjs/`. Add a parallel block for the daemon:
   - `bun run --cwd daemon typecheck`
   - `bun run --cwd daemon test`
   - `bun run --cwd packages/shared typecheck` (if shared has its own tsconfig, which it does from Step 1)

   The shared package has no tests of its own to run separately (the schema test runs from within the shared package's `bun test`). The daemon block should run after the Next.js block.

3. Review `scripts/launch.sh`. It currently builds and starts Next.js. It should not start the daemon (that's a separate process with its own lifecycle, per REQ-DAB-19). But note in the script that the daemon must be running for full functionality (comment, not code change, since the daemon isn't wired to anything yet).

4. Add a `.gitignore` entry for the daemon socket file if it could end up in the repo tree (unlikely since it defaults to `/tmp/` or `$XDG_RUNTIME_DIR`, but defensive).

**Verification**: `bun run test` from root runs tests in both nextjs and daemon. `bun run typecheck` from root checks all three packages. The pre-commit hook passes.

### Step 8: Validate against spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md`, the staging goals from `.lore/brainstorm/daemon-migration-stages.md` (Stage 1 section), and reviews the implementation. Flag any requirements not met.

Checklist for validation:
- [ ] Schemas are importable from `@memory-loop/shared` by both daemon and nextjs
- [ ] Logger is importable from `@memory-loop/shared` by both daemon and nextjs
- [ ] Daemon listens on a Unix socket (REQ-DAB-2)
- [ ] Daemon has localhost TCP fallback (REQ-DAB-2)
- [ ] Health endpoint returns uptime, vault count, activeSessions (number), scheduler status (REQ-DAB-21)
- [ ] No remaining imports from `@/lib/schemas` or `@/lib/logger` in nextjs
- [ ] All existing tests pass unchanged (schema extraction is a move, not a rewrite)
- [ ] `bun test` from `packages/shared/` discovers and runs `schemas/__tests__/protocol.test.ts`
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` all pass from root
- [ ] `bun run --cwd nextjs dev` works (turbopack resolution check)
- [ ] Daemon API conventions are documented and implemented (help endpoint)

## Delegation Guide

Most steps are straightforward infrastructure work. Two steps warrant attention:

- **Step 3** (import rewriting): High-volume mechanical change. The implementer should run the grep-first approach before any bulk replacement, and verify all five quality gates plus dev server after. No specialized expertise needed, but careful execution matters. A code-reviewer agent should check the diff for missed imports.
- **Step 5** (Unix socket listener): The Bun.serve() + Hono + Unix socket combination should be verified against Bun's current API. If Hono's Bun adapter doesn't support Unix sockets directly, the fallback is using `Bun.serve({ fetch: app.fetch, unix: socketPath })` without Hono's serve helper.

Consult `.lore/lore-agents.md` for available review agents. The `plan-reviewer` and `code-reviewer` agents are relevant.

## Risks

**R1: Bun workspace resolution in Next.js bundler.** Next.js must be able to import TypeScript source from `@memory-loop/shared` without a build step. This works with Bun's workspace linking and Next.js's `transpilePackages` (or automatic workspace transpilation in Next.js 15). If transpilation fails, the fallback is adding `transpilePackages: ["@memory-loop/shared"]` to `next.config.ts`. The collapse-workspaces retro removed `transpilePackages` because there was only one package, but adding a workspace package may require it again.

**R2: Turbopack resolution of workspace packages.** The collapse-workspaces retro documented that turbopack (dev) and webpack (build) resolve modules differently. Test `bun run --cwd nextjs dev` explicitly after the import rewrite.

**R3: Import path completeness.** 75 files is a lot of rewrites. A missed import won't cause a type error if the old path still partially resolves (e.g., through a stale node_modules link). The defense is: delete the old `nextjs/lib/schemas/` directory completely, then typecheck. Any unresolved import will fail.

**R4: Hono + Unix socket on Bun.** Verify that `Bun.serve()` with a `unix` option works with Hono's fetch handler. Bun's docs show this pattern, but the exact Hono adapter wiring should be tested early in Step 5.

## Open Questions

None blocking. All questions from the brainstorm's resolved questions section apply to this stage and are already resolved.

## Acceptance Criteria

Stage 1 is complete when:

1. The monorepo has three packages: `packages/shared`, `nextjs`, `daemon`
2. `@memory-loop/shared` contains all Zod schemas and the logger, importable by both sides
3. No file in `nextjs/` imports from `@/lib/schemas` or `@/lib/logger`
4. The daemon process starts, listens on a Unix socket, and responds to `GET /health` and `GET /help`
5. All existing tests pass (schema test runs from its new location in `packages/shared`)
6. Root-level `typecheck`, `lint`, `test`, and `build` scripts cover all packages
7. `bun run --cwd nextjs dev` works (turbopack resolution verified)
