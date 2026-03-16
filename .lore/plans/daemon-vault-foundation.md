---
title: "Stage 2: Daemon vault foundation"
date: 2026-03-14
status: executed
tags: [daemon, vault, migration, monorepo, api, hybrid-state]
modules: [vault-manager, vault-config, vault-helpers, daemon]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/plans/daemon-skeleton-shared-package.md
---

# Plan: Stage 2 - Daemon Vault Foundation

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 2 section)
**API conventions**: `.lore/research/daemon-rest-api.md`
**Stage 1 plan**: `.lore/plans/daemon-skeleton-shared-package.md`

Requirements addressed:
- REQ-DAB-1: Daemon is the authority boundary for vault operations → Steps 3, 5
- REQ-DAB-2: REST over daemon's local socket → Step 5 (routes use socket established in Stage 1)
- REQ-DAB-3: Vault data on filesystem, daemon owns reads/writes → Steps 3, 5
- REQ-DAB-4: Next.js is a client, not a parallel runtime → Step 7 (API routes proxy to daemon)
- REQ-DAB-16: Vault discovery and configuration are daemon-owned → Steps 3, 5
- REQ-DAB-21: Health endpoint reports vault count → Step 6
- REQ-DAB-22: Migration reduces boundary bypasses → Steps 7, 8 (direct imports become API calls)
- REQ-DAB-23: Transitional direct imports allowed for unmigrated operations → Step 7 (vault-client facade)

Staging goals addressed:
- Move vault-manager.ts, vault-config.ts, vault-helpers.ts → Steps 2, 3, 4
- Create daemon vault API endpoints → Step 5
- Handle hybrid state during migration → Steps 7, 8

## Codebase Context

**Files in scope:**

| File | Lines | Role |
|------|-------|------|
| `nextjs/lib/vault-manager.ts` | 653 | Vault discovery, creation, path resolution, filesystem utilities |
| `nextjs/lib/vault-config.ts` | 845 | Config loading/saving, type definitions, resolver functions, slash commands |
| `nextjs/lib/vault-helpers.ts` | 44 | Next.js route helper (getVaultOrError, jsonError) using NextResponse |

**Dependency analysis:**

vault-manager.ts and vault-config.ts have a circular import. vault-config imports `fileExists` from vault-manager. vault-manager imports ~15 resolver functions from vault-config. This circular dependency must be broken during the move.

The files contain three categories of code with different destinations:

1. **Pure filesystem utilities** (`fileExists`, `directoryExists`): Used by ~15 modules across the codebase for general file checks, not vault-specific logic. Currently live in vault-manager because that's where they were first needed.

2. **Pure type definitions and derivations** (`VaultConfig` interface, `resolve*` functions, `DEFAULT_*` constants): No I/O, no state. Used by downstream modules that won't migrate until Stages 3-5. Both daemon and nextjs need these.

3. **Vault I/O operations** (`discoverVaults`, `getVaultById`, `createVault`, `parseVault`, `loadVaultConfig`, `saveVaultConfig`, slash command functions): Filesystem reads and writes that belong in the daemon per REQ-DAB-3.

**Downstream consumers (50+ files):**

The grep shows three consumption patterns:

- **API routes (~20 files)** import `vault-helpers.ts` for `getVaultOrError`. These become daemon API proxies.
- **lib/ domain modules (~12 files)** import specific functions from vault-manager (`fileExists`, `directoryExists`, `getVaultById`, `discoverVaults`, `getVaultsDir`, path helpers). These modules migrate in Stages 3-5 and need a transitional interface.
- **lib/ domain modules (~8 files)** import from vault-config (`loadVaultConfig`, resolver functions, defaults). Same transitional need.

**Stage 1 decisions this plan builds on:**

- D1: Hono as daemon HTTP framework → vault routes are Hono handlers
- D2: `@memory-loop/shared` workspace package → receives utility functions and config types
- D3: Logger in shared package → vault modules import from `@memory-loop/shared`
- D4: API conventions adapted from Guild Hall reference → vault routes follow the URL grammar, error format, and help discovery pattern

**Circular dependency resolution:**

Moving `fileExists`/`directoryExists` to the shared package breaks the vault-manager → vault-config → vault-manager cycle. Moving `VaultConfig` type and resolver functions to shared breaks the remaining coupling. The daemon's vault module imports pure types from shared and owns the I/O operations. Clean separation.

## Decisions

### D1: Three-way split for vault-config content

vault-config.ts contains three kinds of code that belong in different packages:

| Content | Destination | Reason |
|---------|-------------|--------|
| `VaultConfig` interface, `DiscussionModel` type, `DEFAULT_*` constants, `VALID_*` arrays, `resolve*` functions, `slashCommandsEqual` | `@memory-loop/shared` | Pure types and derivations, needed by both daemon and nextjs during hybrid period |
| `loadVaultConfig`, `saveVaultConfig`, `savePinnedAssets`, `loadSlashCommands`, `saveSlashCommands` | `daemon/src/vault/` | Filesystem I/O, daemon-owned per REQ-DAB-3 |
| `SaveConfigResult` type, `isAllDefaults` helper | `daemon/src/vault/` | Only used by `saveVaultConfig` |

This avoids the antipattern of putting I/O functions in the shared package (which would let nextjs bypass the daemon boundary) while keeping types accessible to both sides.

### D2: Filesystem utilities go to shared package

`fileExists` and `directoryExists` are general-purpose stat wrappers with zero vault logic. They're imported by ~15 modules. Moving them to `@memory-loop/shared` is justified because:

- They're infrastructure, not domain logic
- Keeping them in the daemon would force every nextjs module to call the daemon for basic file existence checks, which is both wasteful and architecturally wrong (these modules do their own file I/O that will move to the daemon in later stages)
- The shared package already contains the logger, which is the same category of infrastructure

### D3: Path derivation helpers go to shared package

`getVaultInboxPath(vault)` is `join(vault.contentRoot, vault.inboxPath)`. `getVaultMetadataPath(vault)` is `join(vault.contentRoot, vault.metadataPath)`. These are one-line derivations from VaultInfo with no I/O. They belong with the type they derive from, in the shared package.

### D4: Transitional vault-client facade in nextjs

During the hybrid period, ~20 downstream modules still need vault data but vault-manager no longer lives in nextjs. A `nextjs/lib/vault-client.ts` module provides the same async interface as vault-manager's I/O functions but calls the daemon API over the Unix socket.

This is explicitly transitional (REQ-DAB-23). Each subsequent stage reduces its surface: when a lib/ module moves to the daemon (Stages 3-5), it switches from the vault-client to direct imports of the daemon's vault module. When the web app conversion completes (Stage 6), vault-client is deleted.

The alternative (passing VaultInfo through function parameters instead of letting modules look it up themselves) would require refactoring every downstream module's interface before it migrates. That's premature and increases the blast radius of Stage 2 beyond what's needed.

### D5: vault-helpers.ts stays in nextjs, rewritten

vault-helpers.ts uses `NextResponse` and is Next.js-specific by design. It stays in `nextjs/lib/` but gets rewritten to use vault-client instead of importing vault-manager directly. Its interface stays the same: `getVaultOrError(vaultId)` returns either a `VaultInfo` or a `NextResponse` error. The ~20 API routes that import it don't change.

### D6: Daemon caches vault list on startup

`discoverVaults()` scans the filesystem on every call. In the daemon, this runs once on startup and the result is cached. The `GET /vaults` endpoint returns the cached list. A cache invalidation mechanism (re-scan on `POST /vaults` or on a timer) keeps it fresh. This also provides the vault count for the health endpoint without re-scanning.

### D7: getVaultsDir path resolution in daemon

vault-manager's `getProjectRoot()` calculates the project root relative to the file's location using `import.meta.url`. This breaks when the file moves to `daemon/src/vault/`. In the daemon, `VAULTS_DIR` env var is the primary configuration. The fallback to a project-root-relative default should use the daemon's known root, not filesystem path arithmetic. The daemon's entry point sets a `DAEMON_ROOT` that vault-manager can reference.

### D8: Slash command endpoints are part of vault config surface

`loadSlashCommands` and `saveSlashCommands` are vault-config file operations that move with the config system. They're exposed as:
- `GET /vaults/:id/config/slash-commands`
- `PUT /vaults/:id/config/slash-commands`

This keeps them under the config resource hierarchy rather than inventing a separate resource.

## Precondition

Stage 1 must be complete before beginning any step below. That means: `packages/shared/` exists as a workspace package with schemas and logger, `daemon/` exists as a workspace package with Hono socket listener and health endpoint, and the root workspace configuration links all three packages. Do not begin Stage 2 until Stage 1's acceptance criteria are met.

## Implementation Steps

### Step 1: Extract filesystem utilities to @memory-loop/shared

**Files**: `packages/shared/src/fs-utils.ts` (new), `packages/shared/src/index.ts` (update), `nextjs/lib/vault-manager.ts` (remove functions)
**Addresses**: D2

Move `fileExists` and `directoryExists` from vault-manager.ts to a new `packages/shared/src/fs-utils.ts`. These functions use only `node:fs/promises` and have no project-specific imports.

1. Create `packages/shared/src/fs-utils.ts` with both functions.
2. Export from `packages/shared/src/index.ts`.
3. Remove both functions from `nextjs/lib/vault-manager.ts`.
4. Update all importers (~15 files) to import from `@memory-loop/shared` instead of `./vault-manager` or `../vault-manager`.
5. Update `nextjs/lib/vault-config.ts` to import `fileExists` from `@memory-loop/shared` instead of `./vault-manager`.

This breaks the circular dependency between vault-manager and vault-config.

**Verification**: `bun run typecheck && bun run lint && bun run test` from root. Grep for any remaining imports of `fileExists` or `directoryExists` from vault-manager.

### Step 2: Extract vault config types and resolvers to @memory-loop/shared

**Files**: `packages/shared/src/vault-config.ts` (new), `packages/shared/src/vault-paths.ts` (new), `packages/shared/src/index.ts` (update)
**Addresses**: D1, D3

Move pure types and derivation functions from vault-config.ts and vault-manager.ts to the shared package.

1. Create `packages/shared/src/vault-config.ts` containing:
   - `VaultConfig` interface
   - `DiscussionModel` type and `VALID_DISCUSSION_MODELS`
   - All `DEFAULT_*` constants
   - All `resolve*` functions (resolveContentRoot, resolveMetadataPath, resolveGoalsPath, resolveContextualPromptsPath, resolveGeneralInspirationPath, resolveProjectPath, resolveAreaPath, resolveAttachmentPath, resolvePromptsPerGeneration, resolveMaxPoolSize, resolveQuotesPerWeek, resolveBadges, resolvePinnedAssets, resolveRecentCaptures, resolveRecentDiscussions, resolveDiscussionModel, resolveOrder, resolveCardsEnabled, resolveViMode)
   - `VALID_BADGE_COLORS` array
   - `CONFIG_FILE_NAME` and `SLASH_COMMANDS_FILE` constants
   - `slashCommandsEqual` function

   Note: `SaveConfigResult` type and `isAllDefaults` helper stay in the daemon (per D1). They're only used by `saveVaultConfig` and don't need to be shared.

   Note: `resolveContentRoot` imports `normalize` and `join` from `node:path` and uses the logger. It references no vault I/O. It stays pure.

2. Create `packages/shared/src/vault-paths.ts` containing:
   - `getVaultInboxPath(vault: VaultInfo): string`
   - `getVaultMetadataPath(vault: VaultInfo): string`
   - `getVaultGoals` does NOT go here (it reads files, so it goes to the daemon)
   - `GOALS_FILE_PATH`, `DEFAULT_INBOX_PATH`, `INBOX_PATTERNS`, `ATTACHMENT_PATTERNS` constants
   - `ExtractedTitle` interface and `extractVaultName` function (pure string parsing)
   - `titleToDirectoryName` function (pure string transformation)

3. Export everything from `packages/shared/src/index.ts`.

4. Update `nextjs/lib/vault-config.ts`: remove everything that moved to shared. The file now contains only I/O functions: `loadVaultConfig`, `saveVaultConfig`, `savePinnedAssets`, `loadSlashCommands`, `saveSlashCommands`. Update its imports to pull types and resolvers from `@memory-loop/shared`.

5. Update `nextjs/lib/vault-manager.ts`: remove everything that moved to shared (path constants, extractVaultName, titleToDirectoryName, getVaultInboxPath, getVaultMetadataPath). Update imports to pull from `@memory-loop/shared`.

6. Update all downstream importers:
   - Files importing types/resolvers from `vault-config` → import from `@memory-loop/shared`
   - Files importing path helpers/constants from `vault-manager` → import from `@memory-loop/shared`
   - Affected files (~10): vault-setup.ts, handlers/config-handlers.ts, task-manager.ts, session-manager.ts, inspiration-manager.ts, and API routes that import config types

**Verification**: `bun run typecheck && bun run lint && bun run test` from root. Verify no remaining imports of moved items from their old locations.

### Step 3: Move vault I/O modules to daemon

**Files**: `nextjs/lib/vault-manager.ts` → `daemon/src/vault/vault-manager.ts`, `nextjs/lib/vault-config.ts` → `daemon/src/vault/vault-config.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

After Steps 1 and 2, vault-manager.ts contains only I/O operations: `getVaultsDir`, `getDefaultVaultsDir`, `getProjectRoot`, `ensureVaultsDir`, `detectInboxPath`, `detectAttachmentPath`, `detectGoalsPath`, `parseVault`, `discoverVaults`, `getVaultById`, `getVaultGoals`, `getUniqueDirectoryName`, `createVault`, `VaultsDirError`, `VaultCreationError`.

vault-config.ts contains only I/O operations: `loadVaultConfig`, `saveVaultConfig`, `savePinnedAssets`, `loadSlashCommands`, `saveSlashCommands`.

1. Create `daemon/src/vault/` directory.

2. Move vault-manager.ts to `daemon/src/vault/vault-manager.ts`:
   - Update imports: schemas and types from `@memory-loop/shared`, logger from `@memory-loop/shared`, filesystem utilities from `@memory-loop/shared`, config types and resolvers from `@memory-loop/shared`.
   - Fix `getProjectRoot()` per D7: Replace `import.meta.url` path arithmetic with a `DAEMON_ROOT` reference. The daemon entry point (`daemon/src/index.ts`) should set this. The fallback `getDefaultVaultsDir()` becomes `join(DAEMON_ROOT, "vaults")`.
   - Remove `getProjectRoot()` entirely. Replace with a module-level `getDaemonRoot()` that reads from `process.env.DAEMON_ROOT` or falls back to the daemon package's parent directory.

3. Move vault-config.ts to `daemon/src/vault/vault-config.ts`:
   - Update imports: `fileExists` from `@memory-loop/shared`, types and constants from `@memory-loop/shared`, logger from `@memory-loop/shared`.

4. Create `daemon/src/vault/index.ts` as the barrel export for the vault module.

5. Delete `nextjs/lib/vault-manager.ts` and `nextjs/lib/vault-config.ts`.

**Verification**: `bun run --cwd daemon typecheck` passes. Importing from `daemon/src/vault/` resolves all types and functions.

### Step 4: Move tests to daemon

**Files**: `nextjs/lib/__tests__/vault-manager.test.ts` → `daemon/src/vault/__tests__/vault-manager.test.ts`, `nextjs/lib/__tests__/vault-config.test.ts` → `daemon/src/vault/__tests__/vault-config.test.ts`

1. Move both test files using `git mv`.

2. Update imports in test files:
   - Production imports point to `../vault-manager` and `../vault-config`
   - Schema imports from `@memory-loop/shared`
   - Filesystem utility imports from `@memory-loop/shared`

3. Audit test files for Next.js-specific dependencies:
   - vault-manager.test.ts: Uses `node:fs/promises` for test setup. No Next.js dependencies. Should port cleanly.
   - vault-config.test.ts: Same. Pure filesystem tests.

4. Run `bun run --cwd daemon test` to verify all tests pass in the daemon context.

5. Delete the old test files from `nextjs/lib/__tests__/`.

**Verification**: `bun run --cwd daemon test` passes. Tests exercise the same behavior from their new location.

### Step 5: Create daemon vault API routes

**Files**: `daemon/src/routes/vaults.ts` (new), `daemon/src/routes/__tests__/vaults.test.ts` (new), `daemon/src/server.ts` (update), `daemon/src/routes/help.ts` (update)
**Addresses**: REQ-DAB-1, REQ-DAB-2, REQ-DAB-3

Create Hono route handlers for the vault API surface.

1. Create `daemon/src/routes/vaults.ts` with these endpoints:

   **`GET /vaults`** - List discovered vaults.
   Returns `{ vaults: VaultInfo[] }`. Uses the cached vault list (D6).

   **`GET /vaults/:id`** - Get single vault by ID.
   Returns `VaultInfo` or 404 `{ "error": "Vault not found", "code": "VAULT_NOT_FOUND" }`.

   **`POST /vaults`** - Create a new vault.
   Request body: `{ "title": string }`.
   Returns 201 with the new `VaultInfo`.
   Errors: 400 for empty/invalid title (code `INVALID_TITLE`).
   After creation, refreshes the cached vault list.

   **`GET /vaults/:id/config`** - Get vault configuration.
   Loads `.memory-loop.json` for the vault. Returns the raw config object.
   If vault not found: 404. If no config file: returns `{}`.

   **`PUT /vaults/:id/config`** - Update vault configuration.
   Request body: `EditableVaultConfig` (from shared schemas).
   Merges with existing config per `saveVaultConfig` behavior.
   Returns updated config. After save, refreshes cached vault info for this vault.

   **`GET /vaults/:id/config/slash-commands`** - Get cached slash commands.
   Returns `{ commands: SlashCommand[] }` or `{ commands: null }` if no cache.

   **`PUT /vaults/:id/config/slash-commands`** - Save slash commands cache.
   Request body: `{ commands: SlashCommand[] }`.
   Returns 200 on success.

   **`GET /vaults/help`** - Discovery for vault operations.
   Returns structured help per D4 conventions.

   All error responses follow the Stage 1 convention: `{ "error": string, "code": string, "detail"?: string }`.

2. Implement vault cache (D6):
   - Create `daemon/src/vault/vault-cache.ts` with:
     - `initVaultCache()`: calls `discoverVaults()`, stores result
     - `getVaults()`: returns cached list
     - `getVaultById(id)`: finds in cached list, falls back to `parseVault` for cache miss
     - `invalidateCache()`: triggers re-discovery
   - Call `initVaultCache()` during daemon startup in `daemon/src/index.ts`.

3. Register routes in `daemon/src/server.ts`.

4. Update `daemon/src/routes/help.ts` to include vault endpoints in the discovery response.

5. Write tests in `daemon/src/routes/__tests__/vaults.test.ts`:
   - Test each endpoint with Hono's `app.request()` test helper.
   - Create a temp vaults directory with fixture vaults for test isolation.
   - Test 404 for nonexistent vault.
   - Test vault creation and subsequent listing.
   - Test config GET/PUT round-trip.
   - Test help endpoint includes vault entries.

**Verification**: `bun run --cwd daemon test` passes. Manual test with curl over the Unix socket confirms each endpoint returns the expected shape.

### Step 6: Wire health endpoint to vault count

**Files**: `daemon/src/routes/health.ts` (update)
**Addresses**: REQ-DAB-21

1. Update the health endpoint to return the real vault count from the vault cache instead of the hardcoded `0`.

2. Import `getVaults` from the vault cache. Return `vaults.length` in the health response.

3. Update the health test to verify vault count reflects the cache state.

**Verification**: Health endpoint returns accurate vault count.

### Step 7: Create transitional vault-client in nextjs

**Files**: `nextjs/lib/vault-client.ts` (new), `nextjs/lib/vault-helpers.ts` (update)
**Addresses**: REQ-DAB-22, REQ-DAB-23, D4, D5

Create the HTTP client that nextjs uses to call the daemon for vault operations during the hybrid period.

1. Create `nextjs/lib/vault-client.ts`:

   This module provides the same async interface that vault-manager provided, but calls the daemon API instead of doing filesystem I/O.

   ```
   // Functions exposed (same signatures as the original vault-manager):
   discoverVaults(): Promise<VaultInfo[]>
   getVaultById(vaultId: string): Promise<VaultInfo | null>
   createVault(title: string): Promise<VaultInfo>
   getVaultGoals(vault: VaultInfo): Promise<string | null>

   // Functions from vault-config:
   loadVaultConfig(vaultPath: string): Promise<VaultConfig>
   saveVaultConfig(vaultPath: string, config: EditableVaultConfig): Promise<SaveConfigResult>
   savePinnedAssets(vaultPath: string, paths: string[]): Promise<void>
   loadSlashCommands(vaultPath: string): Promise<SlashCommand[] | undefined>
   saveSlashCommands(vaultPath: string, commands: SlashCommand[]): Promise<void>
   ```

   Implementation: Each function makes an HTTP request to the daemon socket. The daemon socket path comes from `DAEMON_SOCKET` env var (same as the daemon uses). Use `fetch()` with Bun's Unix socket support: `fetch("http://localhost/vaults", { unix: socketPath })`.

   Note on the config/slash-command functions: The originals take `vaultPath` as a parameter. The client needs a vault ID to call the daemon API. Since `vaultPath` includes the vault directory name (which is the ID), extract it. Alternatively, add overloads that accept vault ID directly and deprecate the path-based signatures. The cleaner approach: add vault-ID-based functions and update callers as they migrate. For the transitional period, extract the ID from the path using `path.basename(vaultPath)`.

   Note on `getVaultGoals`: This reads a file from the vault. In the target architecture, this would be a daemon file-read operation (Stage 3). For now, implement it as a direct filesystem read in the client since the file-browser hasn't migrated yet. Mark it with a `// TODO: Stage 3 - move to daemon file read endpoint` comment.

2. Rewrite `nextjs/lib/vault-helpers.ts`:
   - Replace `import { getVaultById } from "@/lib/vault-manager"` with `import { getVaultById } from "@/lib/vault-client"`
   - The rest of the file (NextResponse helpers) stays unchanged.

3. No changes to the ~20 API routes that import vault-helpers. They continue to work because vault-helpers' interface is unchanged.

**Verification**: `bun run --cwd nextjs typecheck` passes. The vault-client module compiles and its types align with the original vault-manager signatures.

### Step 8: Rewrite downstream imports across nextjs

**Files**: ~20 files in `nextjs/lib/` and `nextjs/app/`

Switch all remaining nextjs imports from the deleted vault-manager and vault-config modules to their new sources.

1. **Files that imported from vault-manager** (now deleted):

   | Old import | New source | Files affected |
   |-----------|-----------|----------------|
   | `fileExists`, `directoryExists` | `@memory-loop/shared` | note-capture, vault-setup, daily-prep-manager, meeting-capture, file-upload, transcript-manager, session-manager, extraction/*, spaced-repetition/*, vault-transfer |
   | `getVaultInboxPath`, `getVaultMetadataPath` | `@memory-loop/shared` | note-capture, meeting-capture, transcript-manager |
   | `getVaultById` | `@/lib/vault-client` | vault-setup, session-manager, API route (goals, sessions) |
   | `discoverVaults` | `@/lib/vault-client` | extraction/transcript-reader, spaced-repetition/card-discovery-scheduler |
   | `getVaultsDir` | `@/lib/vault-client` | extraction/extraction-manager, extraction/memory-writer |
   | `getVaultGoals` | `@/lib/vault-client` | API route (goals) |
   | `DEFAULT_INBOX_PATH` | `@memory-loop/shared` | task-manager |
   | `createVault` | `@/lib/vault-client` | handlers/config-handlers |
   | `extractVaultName`, `titleToDirectoryName` | `@memory-loop/shared` | (only used internally by vault-manager, but pure string functions) |

   Note on error classes: `VaultsDirError` and `VaultCreationError` are daemon-internal error types thrown by vault I/O operations. They do NOT go to `@memory-loop/shared`. The `handlers/config-handlers.ts` module currently catches `VaultCreationError` from `createVault`. After Stage 2, `createVault` is called through vault-client, which makes an HTTP request. Errors surface as HTTP status codes and JSON error codes (e.g., `{ "error": "...", "code": "INVALID_TITLE" }`), not as JavaScript exception classes. `config-handlers.ts` must be updated to handle HTTP error responses from vault-client rather than catching exception types. This is part of `config-handlers`'s natural evolution; it migrates fully to the daemon in Stage 3 where it dissolves into daemon route handlers (per the brainstorm's resolved question on handler dissolution).

   Note: `getVaultsDir` is used by extraction-manager and memory-writer for constructing paths to vault state files. In the hybrid period, these modules still run inside nextjs (they migrate in Stage 4). The vault-client can expose `getVaultsDir()` by calling the daemon or by reading `VAULTS_DIR` env var directly (it's the same env var the daemon reads). The env var approach is simpler and correct since both processes share the same environment.

2. **Files that imported from vault-config** (now deleted):

   | Old import | New source | Files affected |
   |-----------|-----------|----------------|
   | `loadVaultConfig` | `@/lib/vault-client` | session-manager, API routes (tasks, sessions) |
   | `saveVaultConfig` | `@/lib/vault-client` | API route (config) |
   | `loadSlashCommands`, `saveSlashCommands` | `@/lib/vault-client` | API route (sessions) |
   | `resolveRecentDiscussions`, `resolveDiscussionModel` | `@memory-loop/shared` | session-manager |
   | `DEFAULT_MAX_POOL_SIZE` | `@memory-loop/shared` | inspiration-manager |
   | `resolvePinnedAssets`, `resolveProjectPath`, `resolveAreaPath`, `resolveAttachmentPath` | `@memory-loop/shared` | API route (recent-activity) |

3. Run grep to verify completeness:
   ```
   grep -r "from.*vault-manager\|from.*vault-config" nextjs/
   ```
   The only remaining match should be `vault-helpers.ts` importing from `vault-client`, and test files that may need updating.

4. Handle test files that imported from vault-manager or vault-config:
   - `nextjs/lib/__tests__/vault-setup.test.ts` imports `directoryExists`, `fileExists` from vault-manager → switch to `@memory-loop/shared`
   - `nextjs/lib/__tests__/vault-transfer.test.ts` imports `fileExists` from vault-manager → switch to `@memory-loop/shared`
   - `nextjs/lib/extraction/__tests__/memory-writer.test.ts` imports `fileExists`, `directoryExists` → switch to `@memory-loop/shared`

**Verification**: `bun run typecheck && bun run lint && bun run test && bun run build` from root. `bun run --cwd nextjs dev` works (turbopack resolution check). Grep confirms zero imports from the deleted modules.

### Step 9: Integration test

**Files**: `daemon/src/__tests__/integration.test.ts` (new or extend)

End-to-end test that validates the vault API works through the HTTP layer.

1. Start the daemon in-process using Hono's test helper (not a real socket, but full route stack).
2. Create a temp vaults directory with two fixture vaults.
3. Test the full sequence:
   - `GET /vaults` returns both vaults
   - `GET /vaults/:id` returns the correct vault
   - `POST /vaults` with `{ "title": "Test Vault" }` creates a vault and returns it
   - `GET /vaults` now returns three vaults
   - `PUT /vaults/:id/config` with config changes persists them
   - `GET /vaults/:id/config` reflects the changes
   - `GET /health` shows accurate vault count
4. Cleanup temp directory.

**Verification**: Integration test passes. The daemon's vault subsystem works end-to-end.

### Step 10: Validate against spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md`, the staging goals from `.lore/brainstorm/daemon-migration-stages.md` (Stage 2 section), and reviews the implementation. Flag any requirements not met.

Checklist for validation:
- [ ] vault-manager.ts and vault-config.ts live in `daemon/src/vault/`, not in `nextjs/lib/`
- [ ] Daemon API endpoints exist: GET/POST /vaults, GET /vaults/:id, GET/PUT /vaults/:id/config
- [ ] Slash command endpoints exist: GET/PUT /vaults/:id/config/slash-commands
- [ ] Help discovery includes vault endpoints
- [ ] Health endpoint reports real vault count
- [ ] No nextjs files import directly from the daemon's vault module
- [ ] nextjs modules use vault-client (transitional) or @memory-loop/shared (permanent) for vault data
- [ ] All existing tests pass from their new locations
- [ ] New daemon route tests cover each endpoint
- [ ] Integration test validates end-to-end flow
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
- [ ] `bun run --cwd nextjs dev` works (turbopack resolution check)
- [ ] No new direct-import paths from Next.js into daemon domain modules (REQ-DAB-22 invariant)
- [ ] vault-client's `getVaultGoals` uses direct filesystem read (intentional transitional bypass, documented for Stage 3 migration)

## Delegation Guide

Most steps are mechanical (move files, rewrite imports). Two areas warrant attention:

- **Step 5** (daemon vault routes): The vault cache implementation should be reviewed for correctness. Cache invalidation on vault creation is straightforward, but ensuring the cache stays consistent if vault directories are modified outside the daemon (e.g., user adds a vault manually) is worth considering. A simple approach: re-scan on `GET /vaults` if the cached list is older than 60 seconds. A more sophisticated approach: filesystem watcher. Recommendation: start with TTL-based refresh and add watchers if needed.

- **Step 7** (vault-client): The Bun `fetch()` + Unix socket pattern should be verified early. Bun's docs show `fetch("http://localhost/path", { unix: "/path/to/socket" })` as the interface. Test this against the daemon socket before building the full client. If Bun's fetch doesn't support Unix sockets directly, the fallback is using the daemon's TCP port (DAEMON_PORT env var from Stage 1).

- **Step 8** (import rewriting): High-volume mechanical change (~25 files). Same risk as Stage 1's Step 3. Run grep-first, then bulk replace, then all quality gates. A code-reviewer agent should check the diff for missed imports.

Consult `.lore/lore-agents.md` for available review agents. The `plan-reviewer`, `code-reviewer`, and `silent-failure-hunter` agents are relevant.

## Risks

**R1: Bun fetch + Unix socket support.** The vault-client relies on Bun's ability to `fetch()` over a Unix socket. If this isn't supported, the fallback is TCP (DAEMON_PORT). Test this in Step 7 before building the full client.

**R2: Import rewrite completeness.** Steps 1, 2, and 8 collectively touch ~30 files. Missing one import means a runtime crash. Defense: delete the old files before typechecking. The type checker catches unresolved imports.

**R3: Vault-client adds latency to all vault operations.** Operations that were direct function calls now go through HTTP to the daemon. For vault discovery (called once per page load) and config operations (called rarely), this is negligible. For `fileExists`/`directoryExists` (called frequently in hot paths), these stay in the shared package and don't go through HTTP.

**R4: getVaultsDir in hybrid period.** Extraction modules call `getVaultsDir()` to construct paths to state files. During hybrid, these modules run in nextjs. The vault-client can provide `getVaultsDir()` by reading `VAULTS_DIR` directly (no daemon call needed, since it's an env var). But this means both daemon and nextjs read the same env var independently, which is fine for a shared environment variable that doesn't change at runtime.

**R5: Circular startup dependency.** If the Next.js app starts before the daemon, vault-client calls will fail. The vault-client should handle connection failures gracefully (retry with backoff, or return an error that the API route can surface). In production, systemd ordering (`After=memory-loop-daemon.service`) handles this. In development, both processes start independently and the web app shows a "daemon not running" error until the daemon is ready.

## Acceptance Criteria

Stage 2 is complete when:

1. `vault-manager.ts` and `vault-config.ts` live in `daemon/src/vault/`, with their tests
2. `@memory-loop/shared` contains: `fileExists`, `directoryExists`, `VaultConfig` type, all `resolve*` functions, all `DEFAULT_*` constants, path derivation helpers (`getVaultInboxPath`, `getVaultMetadataPath`), and string utilities (`extractVaultName`, `titleToDirectoryName`)
3. The daemon serves: `GET/POST /vaults`, `GET /vaults/:id`, `GET/PUT /vaults/:id/config`, `GET/PUT /vaults/:id/config/slash-commands`, `GET /vaults/help`
4. The daemon health endpoint reports real vault count
5. `nextjs/lib/vault-client.ts` provides the transitional interface for downstream modules
6. `nextjs/lib/vault-helpers.ts` uses vault-client, not vault-manager
7. No file in `nextjs/` imports from `vault-manager` or `vault-config` (the deleted modules)
8. All existing tests pass from their new locations
9. New tests cover each daemon endpoint and the vault cache
10. `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
11. `bun run --cwd nextjs dev` works (turbopack resolution verified)
