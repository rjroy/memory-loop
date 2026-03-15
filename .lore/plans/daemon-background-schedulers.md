---
title: "Stage 4: Daemon background schedulers"
date: 2026-03-14
status: active
tags: [daemon, migration, extraction, spaced-repetition, schedulers, sdk-provider, api]
modules: [extraction-manager, extraction-state, transcript-reader, fact-extractor, memory-writer, card-discovery-scheduler, card-discovery-state, card-generator, card-generator-config, card-dedup, card-manager, card-storage, card-schema, sm2-algorithm, scheduler-bootstrap, sdk-provider, config-handlers, instrumentation]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
  - .lore/research/daemon-rest-api.md
  - .lore/plans/daemon-skeleton-shared-package.md
  - .lore/plans/daemon-vault-foundation.md
  - .lore/plans/daemon-stateless-file-operations.md
---

# Plan: Stage 4 - Daemon Background Schedulers

## Spec Reference

**Spec**: `.lore/specs/daemon-application-boundary.md`
**Staging**: `.lore/brainstorm/daemon-migration-stages.md` (Stage 4 section)
**API conventions**: `.lore/research/daemon-rest-api.md`
**Stage 1 plan**: `.lore/plans/daemon-skeleton-shared-package.md`
**Stage 2 plan**: `.lore/plans/daemon-vault-foundation.md`
**Stage 3 plan**: `.lore/plans/daemon-stateless-file-operations.md`

Requirements addressed:
- REQ-DAB-1: Daemon is the authority boundary → All steps (scheduler modules move to daemon)
- REQ-DAB-3: Daemon owns filesystem reads/writes → Steps 3-6 (extraction and card I/O move to daemon)
- REQ-DAB-16: Extraction pipeline and spaced repetition are daemon-owned → Steps 3-6
- REQ-DAB-17: Background schedulers are daemon responsibilities, not Next.js instrumentation → Steps 7, 8
- REQ-DAB-21: Health endpoint reports scheduler status → Step 9
- REQ-DAB-22: Migration reduces boundary bypasses → Steps 10, 11

Staging goals addressed:
- Move extraction pipeline (~5 files) into daemon → Steps 3, 4
- Move card discovery system (~9 files, plus index.ts) into daemon → Steps 5, 6
- Move sdk-provider.ts into daemon → Step 1
- Dissolve scheduler-bootstrap.ts into daemon startup → Step 7
- Dissolve config-handlers.ts into daemon routes → Step 8 (partial; vault-setup parts stay for Stage 5)
- Remove instrumentation.ts scheduler bootstrap → Step 7
- Create daemon API endpoints for extraction, cards, and config → Steps 4, 6, 8

## Codebase Context

**Files in scope (16 source modules, 14 test files, 11 API route files):**

### Extraction Pipeline (5 source files)

| File | Lines | Role | Dependencies |
|------|-------|------|-------------|
| `lib/extraction/extraction-manager.ts` | ~450 | Orchestration, cron scheduling, catch-up | vault-manager, extraction-state, transcript-reader, fact-extractor, memory-writer, cron |
| `lib/extraction/extraction-state.ts` | ~345 | State persistence at ~/.config/memory-loop/extraction-state.json | zod, logger |
| `lib/extraction/transcript-reader.ts` | ~310 | Transcript discovery across vaults | vault-manager (discoverVaults), transcript-manager (getTranscriptsDirectory), schemas |
| `lib/extraction/fact-extractor.ts` | ~463 | LLM-based extraction with retry | sdk-provider (getSdkQuery), vault-manager (fileExists) |
| `lib/extraction/memory-writer.ts` | ~966 | Sandbox/commit for memory files, dedup | logger, vault-manager (fileExists, getVaultsDir) |

### Card Discovery System (10 source files)

| File | Lines | Role | Dependencies |
|------|-------|------|-------------|
| `lib/spaced-repetition/card-discovery-scheduler.ts` | ~1024 | Scheduler orchestration, daily/weekly passes | vault-manager (discoverVaults), card-discovery-state, card-generator, card-manager, card-storage, card-dedup, card-generator-config |
| `lib/spaced-repetition/card-discovery-state.ts` | ~379 | State persistence, stale-run recovery | logger |
| `lib/spaced-repetition/card-generator.ts` | ~388 | LLM card generation | sdk-provider (getSdkQuery) |
| `lib/spaced-repetition/card-generator-config.ts` | ~270 | Config with user overrides | logger |
| `lib/spaced-repetition/card-dedup.ts` | ~455 | Two-phase dedup (Jaccard + LLM) | sdk-provider (getSdkQuery) |
| `lib/spaced-repetition/card-manager.ts` | ~245 | Card CRUD + SM-2 scheduling | card-storage, card-schema, sm2-algorithm |
| `lib/spaced-repetition/card-storage.ts` | ~552 | File I/O with YAML frontmatter | card-schema, logger |
| `lib/spaced-repetition/card-schema.ts` | ~281 | Zod schemas, pure types | zod |
| `lib/spaced-repetition/sm2-algorithm.ts` | ~281 | Pure SM-2 algorithm | (none) |
| `lib/spaced-repetition/index.ts` | ~49 | Barrel re-exports | card-manager, sm2-algorithm, card-schema, card-storage |

### Infrastructure (3 files)

| File | Lines | Role | Dependencies |
|------|-------|------|-------------|
| `lib/sdk-provider.ts` | 81 | SDK query singleton | @anthropic-ai/claude-agent-sdk |
| `lib/scheduler-bootstrap.ts` | 57 | Bootstraps both schedulers | extraction-manager, card-discovery-scheduler, sdk-provider |
| `lib/handlers/config-handlers.ts` | 215 | REST wrappers for config operations | vault-config, vault-manager, vault-setup, logger |

### Test Files (14 + 1 e2e)

| Test File | Location | Portability |
|-----------|----------|-------------|
| extraction-manager.test.ts | extraction/__tests__/ | Clean, uses configureSdkForTesting |
| extraction-state.test.ts | extraction/__tests__/ | Clean, pure filesystem |
| fact-extractor.test.ts | extraction/__tests__/ | Clean, uses configureSdkForTesting |
| memory-writer.test.ts | extraction/__tests__/ | Clean, filesystem + mocked SDK |
| transcript-reader.test.ts | extraction/__tests__/ | Clean, filesystem |
| card-dedup.test.ts | spaced-repetition/__tests__/ | Clean, uses configureSdkForTesting |
| card-discovery-scheduler.test.ts | spaced-repetition/__tests__/ | Clean, uses configureSdkForTesting |
| card-discovery-state.test.ts | spaced-repetition/__tests__/ | Clean, pure filesystem |
| card-generator-config.test.ts | spaced-repetition/__tests__/ | Clean |
| card-generator.test.ts | spaced-repetition/__tests__/ | Clean, uses configureSdkForTesting |
| card-manager.test.ts | spaced-repetition/__tests__/ | Clean |
| card-schema.test.ts | spaced-repetition/__tests__/ | Clean, pure types |
| card-storage.test.ts | spaced-repetition/__tests__/ | Clean, filesystem |
| sm2-algorithm.test.ts | spaced-repetition/__tests__/ | Clean, pure algorithm |
| extraction-e2e.test.ts | lib/__tests__/ | End-to-end, filesystem + mocked SDK |

All test files use `node:fs/promises` for setup and `configureSdkForTesting` for SDK mocking. No Next.js `Request`/`Response` objects. All port cleanly.

### API Routes That Consume These Modules (11 route files)

**Config routes (global, not vault-scoped):**

| Route | Method | Module Imports |
|-------|--------|---------------|
| `/api/config/memory` | GET, PUT | extraction/memory-writer, vault-manager (fileExists) |
| `/api/config/extraction-prompt` | GET, PUT, DELETE | extraction/fact-extractor |
| `/api/config/extraction-prompt/trigger` | POST | extraction/extraction-manager, controller (ensureSdk) |
| `/api/config/card-generator` | GET, PUT | spaced-repetition/card-generator-config, card-discovery-scheduler |
| `/api/config/card-generator/requirements` | DELETE | spaced-repetition/card-generator-config |
| `/api/config/card-generator/status` | GET | spaced-repetition/card-discovery-scheduler |
| `/api/config/card-generator/trigger` | POST | spaced-repetition/card-discovery-scheduler, controller (ensureSdk) |

**Card routes (vault-scoped):**

| Route | Method | Module Imports |
|-------|--------|---------------|
| `/api/vaults/[vaultId]/cards/due` | GET | spaced-repetition (getDueCards), vault-helpers |
| `/api/vaults/[vaultId]/cards/[cardId]` | GET | spaced-repetition (getCard), vault-helpers |
| `/api/vaults/[vaultId]/cards/[cardId]/review` | POST | spaced-repetition (submitReview, isValidResponse), vault-helpers |
| `/api/vaults/[vaultId]/cards/[cardId]/archive` | POST | spaced-repetition (archiveCard), vault-helpers |

**Config-handlers consumers (via handlers/index.ts barrel):**

| Route | Config-handlers functions used |
|-------|-------------------------------|
| `/api/vaults/[vaultId]/setup` | handleSetupVault (calls vault-setup, Stage 5) |
| `/api/vaults/[vaultId]/pinned-assets` | handleGetPinnedAssets, handleSetPinnedAssets |
| `/api/vaults/[vaultId]/config` | handleUpdateVaultConfig |

### Import Rewiring After Stages 1-3

By the time Stage 4 begins, these imports will already be updated:
- `fileExists`, `directoryExists` → `@memory-loop/shared`
- `discoverVaults`, `getVaultsDir`, `getVaultById` → vault-client (transitional) or daemon vault module
- `getTranscriptsDirectory` → `@memory-loop/shared` (moved in Stage 3, Step 6)
- `VaultInfo`, schemas → `@memory-loop/shared`
- Logger → `@memory-loop/shared`

What remains are internal cross-references within the extraction and spaced-repetition subsystems (these resolve naturally since all modules move together), and the `sdk-provider` import (resolved by moving sdk-provider to daemon in Step 1).

### Stage Independence

Stage 4 depends on Stage 2 (vault foundation) but NOT on Stage 3 (stateless file operations). The only Stage 3 dependency is `getTranscriptsDirectory` in `transcript-reader.ts`, but Stage 3 moves that function to `@memory-loop/shared` (Stage 3, Step 6). If Stage 4 runs before Stage 3, this function must be moved to shared as part of Stage 4 instead. The plan includes a precondition check for this.

## Decisions

### D1: SDK provider moves to daemon, stays available in nextjs via re-export

`sdk-provider.ts` is the centralized SDK query singleton. Three modules in Stage 4 scope call `getSdkQuery()`: `fact-extractor.ts`, `card-generator.ts`, `card-dedup.ts`. Post-Stage 4, only Stage 5 modules (`session-manager.ts`, `inspiration-manager.ts`, `vault-setup.ts`) still need SDK access from nextjs.

Move `sdk-provider.ts` to `daemon/src/sdk-provider.ts`. The daemon calls `initializeSdkProvider()` on startup, before schedulers start. This is identical to what `scheduler-bootstrap.ts` does today.

For the Stage 5 transition period, nextjs modules that still need `getSdkQuery()` (session-manager, inspiration-manager, vault-setup) continue importing from their local copy. Create a `nextjs/lib/sdk-provider.ts` that re-exports from the daemon package. This is transitional; when those modules move to the daemon in Stage 5, the nextjs re-export is deleted.

Alternative considered: keep sdk-provider in `@memory-loop/shared`. Rejected because `@anthropic-ai/claude-agent-sdk` is a daemon dependency (it manages the LLM connection). Putting it in the shared package would make the shared package depend on the Agent SDK, which the web app doesn't need. The shared package should stay infrastructure-only (schemas, logger, types, utilities).

### D2: Scheduler startup replaces scheduler-bootstrap.ts

`scheduler-bootstrap.ts` does three things:
1. Calls `initializeSdkProvider()`
2. Starts the extraction scheduler
3. Starts the card discovery scheduler

In the daemon, these three operations happen in the daemon's startup sequence (`daemon/src/index.ts`). The daemon's entry point already initializes the SDK provider (D1) and can call both `startScheduler()` functions directly. `scheduler-bootstrap.ts` is deleted, not moved. Its logic dissolves into the daemon startup.

### D3: Sub-phase organization

Following Stage 3's pattern (D1), this stage organizes into three sub-phases:

1. **SDK provider and shared types** (sdk-provider move, card-schema/sm2 to shared if needed)
2. **Extraction pipeline** (5 files + 5 tests + daemon routes)
3. **Card discovery system** (10 files + 9 tests + daemon routes)

Sub-phase 1 must complete first. Sub-phases 2 and 3 are independent of each other.

### D4: Daemon directory structure

Extraction and card discovery get their own directories under `daemon/src/`:

```
daemon/src/
  sdk-provider.ts
  extraction/
    extraction-manager.ts
    extraction-state.ts
    transcript-reader.ts
    fact-extractor.ts
    memory-writer.ts
    __tests__/
      extraction-manager.test.ts
      extraction-state.test.ts
      fact-extractor.test.ts
      memory-writer.test.ts
      transcript-reader.test.ts
      extraction-e2e.test.ts
  spaced-repetition/
    card-discovery-scheduler.ts
    card-discovery-state.ts
    card-generator.ts
    card-generator-config.ts
    card-dedup.ts
    card-manager.ts
    card-storage.ts
    card-schema.ts
    sm2-algorithm.ts
    index.ts
    __tests__/
      card-dedup.test.ts
      card-discovery-scheduler.test.ts
      card-discovery-state.test.ts
      card-generator-config.test.ts
      card-generator.test.ts
      card-manager.test.ts
      card-schema.test.ts
      card-storage.test.ts
      sm2-algorithm.test.ts
  routes/
    extraction.ts      (extraction trigger, status, memory, prompt)
    cards.ts           (card CRUD, review, archive, due)
    config.ts          (card-generator config, status, trigger)
```

### D5: Config-handlers partial dissolution

`config-handlers.ts` wraps five functions. Three are already covered by Stage 2's vault config routes:
- `handleGetPinnedAssets` → `GET /vaults/:id/config` (pinned assets are part of vault config)
- `handleSetPinnedAssets` → `PUT /vaults/:id/config`
- `handleUpdateVaultConfig` → `PUT /vaults/:id/config`

Two depend on Stage 5 modules:
- `handleSetupVault` → calls `vault-setup.ts` (Stage 5 module, uses SDK)
- `handleCreateVault` → calls `createVault` (already in daemon from Stage 2) then `runVaultSetup` (Stage 5)

For Stage 4: delete `config-handlers.ts` entirely. The three vault-config functions are already served by daemon routes. The `handleSetupVault` and `handleCreateVault` logic stays in the Next.js API routes that call them (`/api/vaults/[vaultId]/setup` and the vault creation route), importing from vault-client and calling vault-setup directly. These routes migrate to daemon proxies in Stage 5/6.

Update `handlers/index.ts` to remove config-handlers exports. The search-handlers exports were already removed in Stage 3. If `handlers/index.ts` becomes empty, delete it.

The API routes that import from `@/lib/handlers` for config-handlers functions must be updated:
- `/api/vaults/[vaultId]/setup` → import `handleSetupVault` logic directly (vault-setup still in nextjs)
- `/api/vaults/[vaultId]/pinned-assets` → convert to daemon proxy (calls `GET/PUT /vaults/:id/config`)
- `/api/vaults/[vaultId]/config` → convert to daemon proxy (calls `PUT /vaults/:id/config`)

### D6: Config routes in daemon are global, not vault-scoped

The current Next.js config routes live at `/api/config/*` and are global (not vault-scoped). Memory file (`~/.claude/rules/memory.md`), extraction prompt (`~/.config/memory-loop/durable-facts.md`), and card generator config are all user-global settings.

In the daemon, these become `/config/*` top-level routes:
- `GET|PUT /config/memory`
- `GET|PUT|DELETE /config/extraction-prompt`
- `POST /config/extraction/trigger`
- `GET|PUT /config/card-generator`
- `DELETE /config/card-generator/requirements`
- `GET /config/card-generator/status`
- `POST /config/card-generator/trigger`

The extraction trigger moves from `/config/extraction-prompt/trigger` to `/config/extraction/trigger` because triggering extraction is not about the prompt; it's about running the extraction pipeline.

### D7: Card routes remain vault-scoped

Card CRUD and review are vault-scoped operations. In the daemon:
- `GET /vaults/:id/cards/due`
- `GET /vaults/:id/cards/:cardId`
- `POST /vaults/:id/cards/:cardId/review`
- `POST /vaults/:id/cards/:cardId/archive`

These match the existing Next.js route structure. The card-manager functions already take a `VaultInfo` parameter, so they naturally fit under the vault hierarchy.

### D8: Extraction status endpoint

The extraction trigger route currently checks `isExtractionRunning()` before starting. Add an explicit status endpoint so clients can poll:

`GET /config/extraction/status` returns:
```json
{
  "schedulerRunning": true,
  "extractionRunning": false,
  "lastRun": { ... },
  "nextScheduledRun": "2026-03-15T03:00:00.000Z",
  "schedule": "0 3 * * *"
}
```

This uses the existing `isSchedulerRunning()`, `isExtractionRunning()`, `getLastRunResult()`, `getNextScheduledRun()`, and `getCronSchedule()` functions.

### D9: `cron` package dependency moves to daemon

The `cron` package is dynamically imported in `extraction-manager.ts` (`const { CronJob } = await import("cron")`). Move the `cron` dependency from `nextjs/package.json` to `daemon/package.json`. The dynamic import pattern can stay or convert to a static import since the daemon doesn't have the same bundler constraints that necessitated dynamic imports in Next.js.

## Precondition

Stage 2 must be complete before beginning any step below. That means: vault-manager lives in `daemon/src/vault/`, vault API routes are serving, and vault-client exists as the transitional facade.

Stage 3 is NOT required. However, if Stage 3 has completed, `getTranscriptsDirectory` will already be in `@memory-loop/shared`. If Stage 3 has NOT completed, Step 2 of this plan must handle moving `getTranscriptsDirectory` to the shared package.

Check: Before starting, verify that `getTranscriptsDirectory` is available in `@memory-loop/shared`. If not, add it during Step 2.

## Implementation Steps

### Sub-Phase A: SDK Provider and Shared Types

#### Step 1: Move sdk-provider.ts to daemon

**Files**: `nextjs/lib/sdk-provider.ts` → `daemon/src/sdk-provider.ts`, new `nextjs/lib/sdk-provider.ts` (re-export shim)
**Addresses**: D1

1. Copy `nextjs/lib/sdk-provider.ts` to `daemon/src/sdk-provider.ts`.
   - No import changes needed. It imports only from `@anthropic-ai/claude-agent-sdk`.

2. Add `@anthropic-ai/claude-agent-sdk` to `daemon/package.json` dependencies.

3. Replace `nextjs/lib/sdk-provider.ts` with a transitional re-export shim:
   ```typescript
   /**
    * SDK Provider (transitional)
    *
    * Re-exports from the daemon's sdk-provider for modules that haven't
    * migrated yet (session-manager, inspiration-manager, vault-setup).
    * Delete this file when those modules move to daemon in Stage 5.
    */
   export {
     initializeSdkProvider,
     getSdkQuery,
     configureSdkForTesting,
     _resetForTesting,
     SdkNotInitializedError,
     type QueryFunction,
   } from "@memory-loop/daemon/src/sdk-provider";
   ```

   Wait: this won't work. The daemon is a separate workspace package, and importing its source files directly from nextjs would create a cross-package dependency on a non-exported internal path. That defeats the package boundary.

   Better approach: keep `sdk-provider.ts` in nextjs as-is until Stage 5. The daemon gets its own copy. Both copies are identical, and both work independently. The daemon initializes its copy on startup. Nextjs modules continue using their local copy (session-manager, inspiration-manager, vault-setup call `initializeSdkProvider()` through controller.ts's `ensureSdk()`). The duplication is acceptable for one stage's lifetime.

   Revised plan:
   - Copy `sdk-provider.ts` to `daemon/src/sdk-provider.ts` (not `git mv`, since the original stays)
   - Update daemon's copy imports if needed (none needed, it only imports from the SDK package)
   - The original `nextjs/lib/sdk-provider.ts` stays unchanged for Stage 5 consumers
   - When Stage 5 moves session-manager and friends to daemon, `nextjs/lib/sdk-provider.ts` is deleted

4. Move `nextjs/lib/__tests__/sdk-provider.test.ts` to `daemon/src/__tests__/sdk-provider.test.ts`:
   - Copy (not move) the test file to daemon. The nextjs copy can be deleted since the canonical location is now daemon, and nextjs consumers don't test the provider itself.
   - Update test imports to `../sdk-provider`.

5. Add `@anthropic-ai/claude-agent-sdk` to daemon's devDependencies if it's not already a runtime dep.

**Verification**: `bun run --cwd daemon typecheck` passes. `bun run --cwd daemon test` runs sdk-provider tests. `bun run --cwd nextjs typecheck` still passes (nextjs sdk-provider unchanged).

#### Step 2: Ensure extraction/card shared types are available

**Files**: `packages/shared/src/index.ts` (update if needed)
**Addresses**: D3 precondition check

1. Check if `getTranscriptsDirectory` is in `@memory-loop/shared` (Stage 3 may have done this).
   - If YES: no action needed.
   - If NO: Extract `getTranscriptsDirectory` from `nextjs/lib/transcript-manager.ts` into `packages/shared/src/vault-paths.ts`. It's a pure path derivation: `join(getVaultInboxPath(vault), "chats")`. Export it from `packages/shared/src/index.ts`. Update `transcript-reader.ts` to import from `@memory-loop/shared`.

2. Verify `card-schema.ts` and `sm2-algorithm.ts` don't need to move to shared.
   - `card-schema.ts` defines Zod schemas for cards. Only consumed by spaced-repetition modules and the card API routes. Since card routes will become daemon proxies, the schemas don't need to be in the shared package. They stay with the spaced-repetition module in the daemon.
   - `sm2-algorithm.ts` is a pure algorithm. Same reasoning: only consumed by card-manager, which moves to daemon. Stays in daemon.

**Verification**: `bun run typecheck` from root passes.

### Sub-Phase B: Extraction Pipeline

#### Step 3: Move extraction modules to daemon

**Files**: `nextjs/lib/extraction/*.ts` → `daemon/src/extraction/*.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

1. Create `daemon/src/extraction/` directory.

2. Move all five extraction modules using `git mv`:
   - `nextjs/lib/extraction/extraction-manager.ts` → `daemon/src/extraction/extraction-manager.ts`
   - `nextjs/lib/extraction/extraction-state.ts` → `daemon/src/extraction/extraction-state.ts`
   - `nextjs/lib/extraction/transcript-reader.ts` → `daemon/src/extraction/transcript-reader.ts`
   - `nextjs/lib/extraction/fact-extractor.ts` → `daemon/src/extraction/fact-extractor.ts`
   - `nextjs/lib/extraction/memory-writer.ts` → `daemon/src/extraction/memory-writer.ts`

3. Update imports in each file:
   - `extraction-manager.ts`:
     - `../logger` → `@memory-loop/shared`
     - `../vault-manager` (`getVaultsDir`) → `../vault/vault-manager` (daemon's own vault module)
     - Internal extraction imports (`./extraction-state`, `./transcript-reader`, etc.) stay relative
     - `cron` → static import instead of dynamic (no bundler constraint in daemon, per D9)
   - `extraction-state.ts`:
     - `../logger` → `@memory-loop/shared`
     - `zod` stays as-is
   - `transcript-reader.ts`:
     - `../vault-manager` (`discoverVaults`, `directoryExists`) → `../vault/vault-manager` for `discoverVaults`, `@memory-loop/shared` for `directoryExists`
     - `../transcript-manager` (`getTranscriptsDirectory`) → `@memory-loop/shared` (moved in Step 2 or Stage 3)
     - `@/lib/schemas` → `@memory-loop/shared`
     - `../logger` → `@memory-loop/shared`
   - `fact-extractor.ts`:
     - `../sdk-provider` → `../sdk-provider` (daemon's own copy from Step 1)
     - `../vault-manager` (`fileExists`) → `@memory-loop/shared`
     - `../logger` → `@memory-loop/shared`
   - `memory-writer.ts`:
     - `../logger` → `@memory-loop/shared`
     - `../vault-manager` (`fileExists`, `getVaultsDir`) → `@memory-loop/shared` for `fileExists`, `../vault/vault-manager` for `getVaultsDir`

4. Move `cron` from `nextjs/package.json` dependencies to `daemon/package.json` dependencies (D9).

5. Delete `nextjs/lib/extraction/` directory.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 4: Move extraction tests and create daemon extraction routes

**Files**: `nextjs/lib/extraction/__tests__/*.test.ts` → `daemon/src/extraction/__tests__/`, `nextjs/lib/__tests__/extraction-e2e.test.ts` → `daemon/src/extraction/__tests__/`, new `daemon/src/routes/extraction.ts`
**Addresses**: REQ-DAB-1, D6, D8

**Move tests:**

1. Move all five extraction test files plus the e2e test using `git mv`:
   - `nextjs/lib/extraction/__tests__/extraction-manager.test.ts` → `daemon/src/extraction/__tests__/`
   - `nextjs/lib/extraction/__tests__/extraction-state.test.ts` → `daemon/src/extraction/__tests__/`
   - `nextjs/lib/extraction/__tests__/fact-extractor.test.ts` → `daemon/src/extraction/__tests__/`
   - `nextjs/lib/extraction/__tests__/memory-writer.test.ts` → `daemon/src/extraction/__tests__/`
   - `nextjs/lib/extraction/__tests__/transcript-reader.test.ts` → `daemon/src/extraction/__tests__/`
   - `nextjs/lib/__tests__/extraction-e2e.test.ts` → `daemon/src/extraction/__tests__/`

2. Update imports in test files:
   - Production imports point to `../extraction-manager`, `../fact-extractor`, etc.
   - SDK provider: `../../sdk-provider` (daemon's copy)
   - Schema imports from `@memory-loop/shared`
   - `configureSdkForTesting` from `../../sdk-provider`

3. Handle `transcript-reader.test.ts` import for `getTranscriptsDirectory`:
   - This test imports `getTranscriptsDirectory` directly from `../../transcript-manager`. After Step 2, that function lives in `@memory-loop/shared`. Update the import to `@memory-loop/shared`. The test cases for `getTranscriptsDirectory` (lines 196-216) should stay in this test file since they exercise transcript discovery behavior.

4. Run `bun run --cwd daemon test` to verify all extraction tests pass.

**Create daemon routes (`daemon/src/routes/extraction.ts`):**

**`GET /config/extraction/status`** - Get extraction scheduler and run status.
Returns:
```json
{
  "schedulerRunning": true,
  "extractionRunning": false,
  "lastRun": { "success": true, "transcriptsProcessed": 3, "durationMs": 4500, ... },
  "nextScheduledRun": "2026-03-15T03:00:00.000Z",
  "schedule": "0 3 * * *"
}
```
Uses: `isSchedulerRunning()`, `isExtractionRunning()`, `getLastRunResult()`, `getNextScheduledRun()`, `getCronSchedule()`.

**`POST /config/extraction/trigger`** - Manually trigger extraction.
Checks `isExtractionRunning()` first. If already running, returns `{ "status": "running", "message": "..." }`.
Otherwise calls `runExtraction(false)` and returns the result.
No `ensureSdk()` call needed; the daemon has already initialized the SDK on startup.
Returns:
```json
{ "status": "complete", "transcriptsProcessed": 3 }
```
Error: `{ "status": "error", "error": "...", "message": "..." }` with 500.

**`GET /config/memory`** - Get memory.md content and metadata.
Calls `readMemoryFile()` and `getMemoryFilePath()`. Checks file existence and size.
Returns: `{ "content": "...", "sizeBytes": 1234, "exists": true }`.

**`PUT /config/memory`** - Save memory.md content.
Request body: `{ "content": "..." }`.
Calls `writeMemoryFile(content)`.
Returns: `{ "success": true, "sizeBytes": 1234 }`.

**`GET /config/extraction-prompt`** - Get extraction prompt content and override status.
Calls `loadExtractionPrompt()`.
Returns: `{ "content": "...", "isOverride": false }`.

**`PUT /config/extraction-prompt`** - Save extraction prompt override.
Request body: `{ "content": "..." }`.
Writes to `USER_PROMPT_PATH`.
Returns: `{ "success": true, "isOverride": true }`.

**`DELETE /config/extraction-prompt`** - Reset extraction prompt to default.
Removes user override file, returns default prompt.
Returns: `{ "success": true, "content": "..." }`.

Register routes in `daemon/src/server.ts`. Update help discovery.

Write tests in `daemon/src/routes/__tests__/extraction.test.ts`:
- Test status endpoint returns expected shape
- Test trigger when idle vs. when already running
- Test memory GET/PUT round-trip
- Test extraction-prompt GET/PUT/DELETE round-trip

**Verification**: All extraction tests pass. Route tests pass.

### Sub-Phase C: Card Discovery System

#### Step 5: Move spaced-repetition modules to daemon

**Files**: `nextjs/lib/spaced-repetition/*.ts` → `daemon/src/spaced-repetition/*.ts`
**Addresses**: REQ-DAB-3, REQ-DAB-16

1. Create `daemon/src/spaced-repetition/` directory.

2. Move all ten spaced-repetition files using `git mv`:
   - `card-discovery-scheduler.ts` → `daemon/src/spaced-repetition/`
   - `card-discovery-state.ts` → `daemon/src/spaced-repetition/`
   - `card-generator.ts` → `daemon/src/spaced-repetition/`
   - `card-generator-config.ts` → `daemon/src/spaced-repetition/`
   - `card-dedup.ts` → `daemon/src/spaced-repetition/`
   - `card-manager.ts` → `daemon/src/spaced-repetition/`
   - `card-storage.ts` → `daemon/src/spaced-repetition/`
   - `card-schema.ts` → `daemon/src/spaced-repetition/`
   - `sm2-algorithm.ts` → `daemon/src/spaced-repetition/`
   - `index.ts` → `daemon/src/spaced-repetition/`

3. Update imports in each file:
   - `card-discovery-scheduler.ts`:
     - `../vault-manager` (`discoverVaults`) → `../vault/vault-manager`
     - `@/lib/schemas` (`VaultInfo`) → `@memory-loop/shared`
     - `../logger` → `@memory-loop/shared`
     - Internal imports (`./card-discovery-state`, `./card-generator`, etc.) stay relative
   - `card-generator.ts`:
     - `../sdk-provider` → `../sdk-provider` (daemon's copy)
     - `../logger` → `@memory-loop/shared`
   - `card-dedup.ts`:
     - `../sdk-provider` → `../sdk-provider` (daemon's copy)
     - `../logger` → `@memory-loop/shared`
   - `card-generator-config.ts`:
     - `../logger` → `@memory-loop/shared`
   - `card-storage.ts`:
     - `../logger` → `@memory-loop/shared`
   - `card-discovery-state.ts`:
     - `../logger` → `@memory-loop/shared`
   - `card-manager.ts`, `card-schema.ts`, `sm2-algorithm.ts`, `index.ts`:
     - Internal imports stay relative. `card-schema.ts` imports `zod` (stays). `sm2-algorithm.ts` has no external imports.

4. Delete `nextjs/lib/spaced-repetition/` directory.

**Verification**: `bun run --cwd daemon typecheck` passes.

#### Step 6: Move card tests and create daemon card/config routes

**Files**: `nextjs/lib/spaced-repetition/__tests__/*.test.ts` → `daemon/src/spaced-repetition/__tests__/`, new `daemon/src/routes/cards.ts`, new `daemon/src/routes/config.ts`
**Addresses**: REQ-DAB-1, D6, D7

**Move tests:**

1. Move all nine test files using `git mv`:
   - Move each `nextjs/lib/spaced-repetition/__tests__/*.test.ts` to `daemon/src/spaced-repetition/__tests__/`

2. Update imports:
   - Production imports point to `../card-manager`, `../card-schema`, etc.
   - SDK provider: `../../sdk-provider` (daemon's copy)
   - `configureSdkForTesting` from `../../sdk-provider`
   - Schemas from `@memory-loop/shared`

3. Run `bun run --cwd daemon test` to verify all spaced-repetition tests pass.

**Create daemon card routes (`daemon/src/routes/cards.ts`):**

All card routes are vault-scoped (D7).

**`GET /vaults/:id/cards/due`** - Get cards due for review.
Calls `getDueCards(vault)`. Maps to preview objects (id, question, next_review).
Returns: `{ "cards": [...], "count": 5 }`.

**`GET /vaults/:id/cards/:cardId`** - Get full card details.
Validates UUID format. Calls `getCard(vault, cardId)`.
Returns card object with question, answer, scheduling metadata.
Error: 404 if not found.

**`POST /vaults/:id/cards/:cardId/review`** - Submit review response.
Request body: `{ "response": "good" }`. Validates response value (again, hard, good, easy).
Calls `submitReview(vault, cardId, response)`.
Returns: `{ "id": "...", "next_review": "...", "interval": 3, "ease_factor": 2.6 }`.
Error: 404 if card not found.

**`POST /vaults/:id/cards/:cardId/archive`** - Archive a card.
Validates UUID format. Calls `archiveCard(vault, cardId)`.
Returns: `{ "id": "...", "archived": true }`.
Error: 404 if not found.

**Create daemon config routes (`daemon/src/routes/config.ts`):**

Global config routes (D6).

**`GET /config/card-generator`** - Get card generator config with usage.
Calls `loadRequirements()` and `getWeeklyUsage()` in parallel.
Returns: `{ "requirements": "...", "isOverride": false, "weeklyByteLimit": 500000, "weeklyBytesUsed": 12000 }`.

**`PUT /config/card-generator`** - Save card generator config.
Request body: `{ "requirements"?: string, "weeklyByteLimit"?: number }`.
Calls `saveRequirementsOverride` and/or `saveCardGeneratorConfig`.
Returns updated state.

**`DELETE /config/card-generator/requirements`** - Reset requirements to default.
Calls `deleteRequirementsOverride()`.
Returns: `{ "success": true, "content": "..." }`.

**`GET /config/card-generator/status`** - Get generation status.
Calls `isGenerationRunning()`.
Returns: `{ "status": "running" | "idle", "message": "..." }`.

**`POST /config/card-generator/trigger`** - Manually trigger card generation.
Calls `triggerManualGeneration()`. No `ensureSdk()` needed (daemon initialized SDK on startup).
Returns: `{ "status": "complete", "filesProcessed": 5, "cardsCreated": 3 }`.
Error: 400 if generation can't start (already running, no budget).

Register both route modules in `daemon/src/server.ts`. Update help discovery.

Write tests:
- `daemon/src/routes/__tests__/cards.test.ts`: Test each card endpoint with fixture vault and test cards.
- `daemon/src/routes/__tests__/config.test.ts`: Test card-generator config GET/PUT/DELETE, status, trigger.

**Verification**: All card and config tests pass.

### Sub-Phase D: Scheduler Startup and Cleanup

#### Step 7: Dissolve scheduler-bootstrap into daemon startup and remove from instrumentation

**Files**: `daemon/src/index.ts` (update), `nextjs/instrumentation.ts` (update), delete `nextjs/lib/scheduler-bootstrap.ts`
**Addresses**: REQ-DAB-17, D2

1. Update `daemon/src/index.ts` to start schedulers on daemon boot:

   The startup sequence becomes:
   ```
   1. Initialize SDK provider (initializeSdkProvider())
   2. Initialize vault cache (from Stage 2)
   3. Start extraction scheduler (startScheduler())
   4. Start card discovery scheduler (startCardDiscoveryScheduler())
   5. Start HTTP server
   ```

   The extraction scheduler startup includes recovery check and catch-up (same logic currently in `extraction-manager.ts:startScheduler()`). The card discovery scheduler accepts `{ discoveryHour, catchUpOnStartup: true }` (same as current `scheduler-bootstrap.ts`).

   Wrap each scheduler start in try/catch. Log success/failure. A scheduler failure should not prevent the daemon from starting. This matches the current behavior where `scheduler-bootstrap.ts` catches errors individually.

2. Delete `nextjs/lib/scheduler-bootstrap.ts`.

3. Update `nextjs/instrumentation.ts`:
   - Remove the `bootstrapSchedulers` call from the production block.
   - Keep the `checkCwebpAvailability()` call (it checks the cwebp binary for image conversion, which is a Stage 3 concern, not scheduler-related).
   - If Stage 3 has already moved image-converter to daemon, `checkCwebpAvailability` may already be gone. If so, `instrumentation.ts` reduces to just the cwebp check or becomes empty.
   - Remove the `bootstrapSchedulers` parameter from `register()`'s dependency injection interface.
   - Remove the import of `scheduler-bootstrap`.

   After this change, the production block in `instrumentation.ts` no longer imports or calls any scheduler code. The documented bundler bug (webpack traces imports after early returns; schedulers inside conditional block) is eliminated for schedulers. The `cwebp` check remains but is simpler and doesn't depend on `cron` or the SDK.

4. Handle SIGTERM/SIGINT in daemon to stop schedulers cleanly:
   - Call `stopScheduler()` from `extraction-manager` and `stopScheduler()` from `card-discovery-scheduler` on shutdown.
   - This ensures cron jobs don't fire after the HTTP server is closed.

**Verification**: Daemon starts successfully, logs scheduler startup. `nextjs/instrumentation.ts` no longer references schedulers. `bun run --cwd nextjs build` succeeds (the bundler bug source is gone).

#### Step 8: Dissolve config-handlers and update Next.js route consumers

**Files**: delete `nextjs/lib/handlers/config-handlers.ts`, update `nextjs/lib/handlers/index.ts`, update API routes
**Addresses**: D5

1. Delete `nextjs/lib/handlers/config-handlers.ts`.

2. Update `nextjs/lib/handlers/index.ts`:
   - Remove all config-handlers exports.
   - If Stage 3 has already removed search-handlers exports, `index.ts` becomes empty. Delete it and the `handlers/` directory.

3. Update API routes that imported from `@/lib/handlers` for config-handlers functions:

   **`/api/vaults/[vaultId]/pinned-assets/route.ts`**: Currently imports `handleGetPinnedAssets`, `handleSetPinnedAssets` from `@/lib/handlers`. These are vault-config operations already served by daemon's `GET/PUT /vaults/:id/config` routes (Stage 2). Convert this route to a daemon proxy: call `GET /vaults/:id/config` and extract `pinnedAssets` from the response for GET, call `PUT /vaults/:id/config` with the pinned assets update for PUT.

   **`/api/vaults/[vaultId]/config/route.ts`**: Currently imports `handleUpdateVaultConfig` from `@/lib/handlers`. Convert to daemon proxy: call `PUT /vaults/:id/config`.

   **`/api/vaults/[vaultId]/setup/route.ts`**: Currently imports `handleSetupVault`, `ConfigValidationError`, `VaultNotFoundError` from `@/lib/handlers`. `handleSetupVault` calls `vault-setup.ts`, which is a Stage 5 module. For now, inline the setup logic directly in the route: call `getVaultById` via vault-client, validate, call `runVaultSetup` directly (vault-setup.ts still in nextjs). Remove the dependency on config-handlers.

4. Update the Next.js config API routes to proxy to the daemon:

   **`/api/config/memory/route.ts`**: Currently imports from `extraction/memory-writer` and `vault-manager`. Both are now in daemon. Convert to daemon proxy: call `GET/PUT /config/memory`.

   **`/api/config/extraction-prompt/route.ts`**: Currently imports from `extraction/fact-extractor`. Now in daemon. Convert to daemon proxy: call `GET/PUT/DELETE /config/extraction-prompt`.

   **`/api/config/extraction-prompt/trigger/route.ts`**: Currently imports from `extraction/extraction-manager` and `controller`. Now in daemon. Convert to daemon proxy: call `POST /config/extraction/trigger`.

   **`/api/config/card-generator/route.ts`**: Currently imports from `spaced-repetition/card-generator-config` and `card-discovery-scheduler`. Now in daemon. Convert to daemon proxy: call `GET/PUT /config/card-generator`.

   **`/api/config/card-generator/requirements/route.ts`**: Currently imports from `spaced-repetition/card-generator-config`. Convert to daemon proxy: call `DELETE /config/card-generator/requirements`.

   **`/api/config/card-generator/status/route.ts`**: Currently imports from `spaced-repetition/card-discovery-scheduler`. Convert to daemon proxy: call `GET /config/card-generator/status`.

   **`/api/config/card-generator/trigger/route.ts`**: Currently imports from `spaced-repetition/card-discovery-scheduler` and `controller`. Convert to daemon proxy: call `POST /config/card-generator/trigger`.

   **Card API routes** (4 routes under `/api/vaults/[vaultId]/cards/`): Currently import from `@/lib/spaced-repetition`. Now in daemon. Convert to daemon proxy: call the corresponding `GET/POST /vaults/:id/cards/*` daemon endpoints.

5. Run grep to verify completeness:
   ```
   grep -r "from.*extraction\|from.*spaced-repetition\|from.*scheduler-bootstrap\|from.*config-handlers\|from.*handlers" nextjs/lib/ nextjs/app/
   ```
   Expected: no matches for deleted modules except:
   - `sdk-provider` imports in nextjs are expected (unchanged per D1, stays for Stage 5 consumers)
   - `vault-setup.ts` import stays (Stage 5)
   - `vault-helpers` import stays (unchanged)

   The grep pattern should exclude `sdk-provider` to avoid false positives, or the implementer should know these matches are expected and correct.

**Verification**: `bun run typecheck && bun run lint && bun run test && bun run build` from root. `bun run --cwd nextjs dev` works. No nextjs file imports from deleted modules.

#### Step 9: Wire health endpoint to scheduler status

**Files**: `daemon/src/routes/health.ts` (update)
**Addresses**: REQ-DAB-21

1. Update the health endpoint to report real scheduler status instead of placeholder values:

   ```json
   {
     "schedulers": {
       "extraction": {
         "status": "running",
         "lastRun": { "success": true, "transcriptsProcessed": 3, "durationMs": 4500 },
         "nextRun": "2026-03-15T03:00:00.000Z"
       },
       "cardDiscovery": {
         "status": "running",
         "lastRun": null,
         "nextRun": null
       }
     }
   }
   ```

2. Import scheduler status functions:
   - `isSchedulerRunning()`, `getLastRunResult()`, `getNextScheduledRun()` from extraction-manager
   - `isGenerationRunning()` from card-discovery-scheduler (for the "is it currently running" check)
   - Note: `card-discovery-scheduler.ts` does not currently export a `getNextScheduledRun()` function. The health endpoint should report `nextRun: null` for card discovery, or add a `getNextScheduledRun()` export to `card-discovery-scheduler.ts` during Step 5. The extraction scheduler has this function; the card discovery scheduler does not. Keep the health shape consistent by including the field but allowing null.

3. Update health endpoint tests.

**Verification**: Health endpoint returns real scheduler data.

#### Step 10: Integration test

**Files**: `daemon/src/__tests__/scheduler-integration.test.ts` (new)

End-to-end test validating the scheduler subsystems work through the daemon HTTP layer.

1. Start the daemon in-process using Hono's test helper.
2. Create temp vaults with fixture data (transcripts for extraction, markdown files for card discovery).
3. Configure SDK mock via `configureSdkForTesting`.
4. Test the full sequence:
   - `GET /config/extraction/status` returns scheduler info
   - `POST /config/extraction/trigger` triggers extraction, returns result
   - `GET /config/memory` returns memory content
   - `PUT /config/memory` updates memory, `GET` reflects changes
   - `GET /config/extraction-prompt` returns default prompt
   - `PUT /config/extraction-prompt` creates override
   - `DELETE /config/extraction-prompt` resets to default
   - `GET /vaults/:id/cards/due` returns due cards (from fixture)
   - `POST /vaults/:id/cards/:id/review` submits review, returns updated schedule
   - `GET /config/card-generator` returns config
   - `PUT /config/card-generator` updates byte limit
   - `GET /config/card-generator/status` returns idle
   - `POST /config/card-generator/trigger` triggers generation
   - `GET /health` shows scheduler status
5. Cleanup temp directory.

**Verification**: Integration test passes end-to-end.

#### Step 11: Validate against spec

Launch a sub-agent that reads the spec at `.lore/specs/daemon-application-boundary.md`, the staging goals from `.lore/brainstorm/daemon-migration-stages.md` (Stage 4 section), and reviews the implementation. Flag any requirements not met.

Checklist for validation:
- [ ] All 5 extraction modules live in `daemon/src/extraction/`, not in `nextjs/lib/`
- [ ] All 10 spaced-repetition modules live in `daemon/src/spaced-repetition/`, not in `nextjs/lib/`
- [ ] `sdk-provider.ts` exists in `daemon/src/` (canonical copy)
- [ ] `scheduler-bootstrap.ts` is deleted
- [ ] `config-handlers.ts` is deleted
- [ ] `handlers/index.ts` is deleted (or empty)
- [ ] `instrumentation.ts` no longer references schedulers
- [ ] Daemon starts both schedulers on boot
- [ ] Daemon health endpoint reports real scheduler status
- [ ] Daemon endpoints exist for: extraction status/trigger, memory GET/PUT, extraction-prompt GET/PUT/DELETE, card-generator config GET/PUT, card-generator requirements DELETE, card-generator status GET, card-generator trigger POST
- [ ] Daemon endpoints exist for: cards due GET, card detail GET, card review POST, card archive POST
- [ ] All 14 domain test suites plus e2e test pass from daemon locations
- [ ] Route tests cover each new endpoint
- [ ] Integration test validates end-to-end flow
- [ ] `cron` package is a daemon dependency, not nextjs
- [ ] No nextjs files import from deleted modules (extraction/*, spaced-repetition/*, scheduler-bootstrap, config-handlers)
- [ ] `nextjs/lib/sdk-provider.ts` still exists for Stage 5 consumers (unchanged)
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
- [ ] `bun run --cwd nextjs dev` works (turbopack resolution check)
- [ ] `bun run --cwd nextjs build` succeeds (bundler bug source eliminated)
- [ ] No new direct-import paths from Next.js into daemon domain modules (REQ-DAB-22 invariant)

## Delegation Guide

Most steps are mechanical (move files, rewrite imports, create route handlers). The following steps warrant focused attention:

- **Step 1** (sdk-provider): The decision to duplicate rather than share is pragmatic but requires cleanup tracking. The implementer should leave a clear `// TODO: Stage 5 - delete this file when session-manager moves to daemon` comment in the nextjs copy.

- **Step 3** (extraction modules): `memory-writer.ts` is the largest file (~966 lines). Its sandbox operations (setupSandbox, commitSandbox, cleanupSandbox) do filesystem operations with error recovery. Review that the daemon has appropriate filesystem permissions for the memory file location (`~/.claude/rules/memory.md`) and the sandbox temp directory.

- **Step 4** (extraction routes): The extraction trigger endpoint runs a potentially long-running operation. It should return immediately with a "started" status and let the extraction run in the background, or run synchronously (as the current Next.js route does). The current route runs synchronously (awaits `runExtraction`). Keep this behavior. The extraction itself has a concurrent-run guard (`isRunning` flag).

- **Step 7** (scheduler dissolution): This is the step that eliminates the documented bundler bug. Verify that `bun run --cwd nextjs build` succeeds after removing scheduler references from `instrumentation.ts`. This is the concrete reliability win that motivated moving schedulers to the daemon.

- **Step 8** (import rewriting): High-volume change (~15 API routes). Run grep-first, then update, then all quality gates. A code-reviewer agent should specifically verify no imports from deleted modules remain. The `silent-failure-hunter` agent should check the updated `instrumentation.ts` for any remaining catch-and-suppress patterns.

Consult `.lore/lore-agents.md` for available review agents. The `plan-reviewer`, `code-reviewer`, and `silent-failure-hunter` agents are relevant. The silent-failure-hunter is particularly valuable given the instrumentation.ts history of silent scheduler failures.

## Risks

**R1: SDK provider duplication.** Two copies of `sdk-provider.ts` (daemon and nextjs) must stay in sync if either is modified. Mitigation: sdk-provider is stable (81 lines, unchanged since creation). Stage 5 is the next stage and will delete the nextjs copy. The risk window is short.

**R2: `cron` package compatibility with Bun.** The extraction scheduler uses `CronJob` from the `cron` package. Verify it works under Bun's runtime. The current codebase runs on Bun (via Next.js), so this is likely fine, but the import path changes (static vs. dynamic import) should be tested.

**R3: Daemon filesystem permissions.** The extraction pipeline writes to `~/.claude/rules/memory.md` and `~/.config/memory-loop/extraction-state.json`. The card discovery system writes to `.memory-loop/` metadata directories inside vaults. These paths must be writable by the daemon process. In the current architecture, the Next.js process writes these files. If the daemon runs as a different user or with different permissions, writes will fail. Mitigation: the daemon runs as the same user (REQ-DAB-20: single-user, personal tool).

**R4: Import rewrite completeness.** Steps 3, 5, and 8 collectively affect ~30 files. Missing one import means a runtime crash. Defense: delete old directories before typechecking. The type checker catches unresolved imports.

**R5: Extraction trigger is synchronous.** The current extraction trigger route awaits `runExtraction()`, which can take minutes for large transcript sets. This blocks the HTTP response. For a daemon endpoint, this is acceptable (the daemon isn't serving browser requests for this endpoint; the web app proxies it). But if the client times out, the extraction still completes (the `isRunning` flag prevents concurrent runs, and the result is stored in `lastResult`). The status endpoint provides polling.

**R6: Card discovery scheduler test complexity.** `card-discovery-scheduler.test.ts` is the most complex test file (~1024 lines in the source). It uses `configureSdkForTesting`, filesystem fixtures, and validates scheduler lifecycle. Ensure the test environment in daemon provides the same isolation guarantees.

## Acceptance Criteria

Stage 4 is complete when:

1. All 5 extraction modules and 10 spaced-repetition modules (plus index.ts) live in `daemon/src/`, with their tests
2. `sdk-provider.ts` has a canonical copy in `daemon/src/` and a transitional copy in `nextjs/lib/`
3. `scheduler-bootstrap.ts` is deleted; scheduler startup lives in `daemon/src/index.ts`
4. `config-handlers.ts` and `handlers/index.ts` are deleted
5. `instrumentation.ts` no longer references schedulers, `cron`, or `scheduler-bootstrap`
6. `bun run --cwd nextjs build` succeeds without scheduler-related bundler issues
7. The daemon starts both schedulers on boot and reports their status via `/health`
8. The daemon serves **18 new endpoints**: extraction status (1), extraction trigger (1), memory GET/PUT (2), extraction-prompt GET/PUT/DELETE (3), card-generator config GET/PUT (2), card-generator requirements DELETE (1), card-generator status GET (1), card-generator trigger POST (1), cards due GET (1), card detail GET (1), card review POST (1), card archive POST (1)
9. `cron` is a daemon dependency, not a nextjs dependency
10. No file in `nextjs/` imports from extraction/*, spaced-repetition/*, scheduler-bootstrap, or config-handlers
11. All 14 domain test suites plus e2e test pass from daemon locations
12. Route tests cover each new endpoint
13. Integration test validates end-to-end scheduler flow
14. `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass from root
15. `bun run --cwd nextjs dev` works (turbopack resolution verified)
