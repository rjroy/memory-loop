---
title: "Commission: Fix: Convert daemon to Hono, address Thorne review blockers"
date: 2026-03-15
status: completed
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Thorne reviewed Stage 1 and Stage 2 and found blockers that need to be resolved before we can proceed to Stage 3. Address ALL of the following:\n\n## Review findings to fix\n\n### 1. Convert daemon from raw Bun.serve() to Hono (plan deviation)\n\nThe plan specified Hono for its built-in SSE support needed in later stages. The current raw Bun.serve() implementation works but will require rework. Convert now while the surface area is small.\n\n- Replace `daemon/src/server.ts` and `daemon/src/router.ts` with Hono\n- Install `hono` as a dependency in the daemon package\n- All existing routes (health, help, vault endpoints) must work identically after conversion\n- All 258 daemon tests must still pass\n- Hono's native request/response handling replaces the manual routing\n\n### 2. Fix 103 nextjs test failures (ECONNREFUSED)\n\n`nextjs/lib/vault-client.ts` makes HTTP calls to the daemon, but during tests no daemon is running. The client has no mock mechanism.\n\n- Create a testable vault-client following the same pattern as `sdk-provider.ts` (provider pattern with `configureSdkForTesting`)\n- Tests should be able to inject mock responses without hitting the network\n- The mock mechanism must be opt-in (production code unchanged)\n- All 103 previously-failing nextjs tests must pass\n- vault-client silent failures (returning empty arrays/nulls) should be distinguishable from \"no data\" — throw or return error types when the daemon is unreachable\n\n### 3. Fix lint failures\n\nRemove the two unused imports in `nextjs/lib/vault-client.ts` (`resolveGoalsPath`, `fileExists`).\n\n### 4. Delete vault-manager.ts and vault-config.ts from nextjs\n\nThe plan required these to be deleted. They are dead code now that vault-client exists.\n\n- Move `SaveConfigResult` type to `@memory-loop/shared` (it's the only thing keeping vault-config.ts alive)\n- Delete `nextjs/lib/vault-manager.ts`\n- Delete `nextjs/lib/vault-config.ts`\n- Grep for any remaining imports of these modules and update them\n- If any test files import from the deleted modules, update those imports\n\n### 5. Fix vault cache fire-and-forget race\n\nThe daemon's vault cache initialization is fire-and-forget, meaning early requests could hit an empty cache.\n\n- Ensure the cache is populated before the server starts accepting requests, OR\n- Ensure requests that arrive before cache population wait for it to complete\n\n### 6. Add daemon-down error handling to vault-client\n\nCurrently vault-client returns empty arrays/nulls when the daemon is unreachable, indistinguishable from \"no data.\" This means silent production failures.\n\n- vault-client must distinguish between \"daemon returned empty\" and \"daemon unreachable\"\n- When the daemon is down, callers should know it's an error, not empty data\n- Consider throwing a specific error type (e.g., `DaemonUnavailableError`) or returning a result type\n\n## Verification\n\nAfter all changes:\n- `bun run typecheck` passes\n- `bun run lint` passes  \n- `bun run test` passes (ALL packages, including the previously-failing 103 nextjs tests)\n- `bun run --cwd nextjs build` passes\n- No nextjs file imports from vault-manager.ts or vault-config.ts\n- Daemon uses Hono, not raw Bun.serve()\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-062712.md`\n- Stage 1 plan: `.lore/_archive/daemon-skeleton-shared-package.md`\n- Stage 2 plan: `.lore/_archive/daemon-vault-foundation.md`\n- Spec: `.lore/specs/daemon-application-boundary.md`"
dependencies: []
linked_artifacts:
  - daemon/src/server.ts

  - daemon/src/router.ts
  - daemon/src/routes/vaults.ts
  - daemon/src/routes/health.ts
  - daemon/src/routes/help.ts
  - daemon/src/index.ts
  - nextjs/lib/vault-client.ts
  - nextjs/test-daemon-helpers.ts
  - nextjs/tsconfig.json
  - nextjs/eslint.config.mjs
  - nextjs/lib/__tests__/vault-transfer.test.ts
  - nextjs/lib/__tests__/vault-setup.test.ts
  - nextjs/lib/__tests__/session-manager.test.ts
  - nextjs/lib/spaced-repetition/__tests__/card-discovery-scheduler.test.ts
  - packages/shared/src/schemas/types.ts
  - packages/shared/src/schemas/index.ts
  - daemon/src/vault/vault-config.ts
  - daemon/src/router.ts
  - daemon/src/routes/vaults.ts
  - daemon/src/routes/health.ts
  - daemon/src/routes/help.ts
  - daemon/src/index.ts
  - nextjs/lib/vault-client.ts
  - nextjs/test-daemon-helpers.ts
  - nextjs/tsconfig.json
  - nextjs/eslint.config.mjs
  - nextjs/lib/__tests__/vault-transfer.test.ts
  - nextjs/lib/__tests__/vault-setup.test.ts
  - nextjs/lib/__tests__/session-manager.test.ts
  - nextjs/lib/spaced-repetition/__tests__/card-discovery-scheduler.test.ts
  - packages/shared/src/schemas/types.ts
  - packages/shared/src/schemas/index.ts
  - daemon/src/vault/vault-config.ts
activity_timeline:
  - timestamp: 2026-03-15T14:16:19.907Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T14:16:19.910Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-15T14:16:19.957Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-15T14:16:27.880Z
    event: progress_report
    reason: "Starting work on Thorne's 6 review findings. Reading current codebase state."
  - timestamp: 2026-03-15T14:17:21.446Z
    event: progress_report
    reason: "Context gathered. Starting implementation: (1) Hono conversion, (2) vault cache race fix, (3) SaveConfigResult to shared, (4) vault-client provider pattern + DaemonUnavailableError, (5) delete dead code, (6) fix lint. Working in dependency order."
  - timestamp: 2026-03-15T14:24:45.037Z
    event: progress_report
    reason: "Daemon Hono conversion complete (258/258 tests pass). Vault cache race fixed (await before server start). Now working on nextjs: moving SaveConfigResult to shared, adding vault-client provider pattern with DaemonUnavailableError, deleting dead code."
  - timestamp: 2026-03-15T14:49:04.152Z
    event: progress_report
    reason: "All 5 test files fixed with setupTestDaemon(). Individual results:\n- vault-transfer: 25/25 pass\n- vault-setup: 77/77 pass  \n- card-discovery-scheduler: 67/67 pass\n- session-manager: 66/66 pass\n- active-session-controller: 3 pre-existing timing failures (confirmed same on main)\n\nRunning full verification suite next."
  - timestamp: 2026-03-15T14:53:27.252Z
    event: result_submitted
    reason: "All 6 review findings resolved:\n\n1. **Hono conversion**: daemon/src/server.ts and daemon/src/router.ts rewritten to use Hono. `createApp()` exports the Hono app for in-process testing via `app.request()`. `startServer()` wraps `Bun.serve()` with Hono's fetch handler. All 258 daemon tests pass.\n\n2. **103 nextjs test failures fixed**: Created `nextjs/test-daemon-helpers.ts` with `setupTestDaemon()` that routes vault-client through an in-process Hono app (no network). Added to 4 test files: vault-transfer, vault-setup, card-discovery-scheduler, session-manager. vault-client uses provider pattern (`configureVaultClientForTesting`) matching sdk-provider.ts design. 3913 nextjs tests pass (3 pre-existing timing failures in active-session-controller confirmed identical on main).\n\n3. **Lint failures fixed**: Removed unused imports (`resolveGoalsPath`, `fileExists`) from vault-client.ts.\n\n4. **Dead code deleted**: `nextjs/lib/vault-manager.ts` and `nextjs/lib/vault-config.ts` removed. `SaveConfigResult` type moved to `@memory-loop/shared` (packages/shared/src/schemas/types.ts). Zero remaining imports of the deleted modules.\n\n5. **Vault cache race fixed**: daemon/src/index.ts awaits `initVaultCache()` before calling `startServer()`. Test helper uses `resetCache()` (not init) so the cache starts stale and refreshes on demand, supporting test vaults created after setup.\n\n6. **DaemonUnavailableError**: vault-client throws `DaemonUnavailableError` (with cause chain) when the daemon is unreachable, distinguishing network errors from empty data responses.\n\nVerification: `bun run typecheck` pass, `bun run lint` pass, `bun run test` 258+3913 pass, `bun run --cwd nextjs build` pass."
  - timestamp: 2026-03-15T14:53:31.283Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All 5 test files fixed with setupTestDaemon(). Individual results:\n- vault-transfer: 25/25 pass\n- vault-setup: 77/77 pass  \n- card-discovery-scheduler: 67/67 pass\n- session-manager: 66/66 pass\n- active-session-controller: 3 pre-existing timing failures (confirmed same on main)\n\nRunning full verification suite next."
projectName: memory-loop
---
All 6 review findings resolved:

1. **Hono conversion**: daemon/src/server.ts and daemon/src/router.ts rewritten to use Hono. `createApp()` exports the Hono app for in-process testing via `app.request()`. `startServer()` wraps `Bun.serve()` with Hono's fetch handler. All 258 daemon tests pass.

2. **103 nextjs test failures fixed**: Created `nextjs/test-daemon-helpers.ts` with `setupTestDaemon()` that routes vault-client through an in-process Hono app (no network). Added to 4 test files: vault-transfer, vault-setup, card-discovery-scheduler, session-manager. vault-client uses provider pattern (`configureVaultClientForTesting`) matching sdk-provider.ts design. 3913 nextjs tests pass (3 pre-existing timing failures in active-session-controller confirmed identical on main).

3. **Lint failures fixed**: Removed unused imports (`resolveGoalsPath`, `fileExists`) from vault-client.ts.

4. **Dead code deleted**: `nextjs/lib/vault-manager.ts` and `nextjs/lib/vault-config.ts` removed. `SaveConfigResult` type moved to `@memory-loop/shared` (packages/shared/src/schemas/types.ts). Zero remaining imports of the deleted modules.

5. **Vault cache race fixed**: daemon/src/index.ts awaits `initVaultCache()` before calling `startServer()`. Test helper uses `resetCache()` (not init) so the cache starts stale and refreshes on demand, supporting test vaults created after setup.

6. **DaemonUnavailableError**: vault-client throws `DaemonUnavailableError` (with cause chain) when the daemon is unreachable, distinguishing network errors from empty data responses.

Verification: `bun run typecheck` pass, `bun run lint` pass, `bun run test` 258+3913 pass, `bun run --cwd nextjs build` pass.
