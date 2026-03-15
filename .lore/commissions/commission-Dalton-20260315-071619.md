---
title: "Commission: Fix: Convert daemon to Hono, address Thorne review blockers"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Thorne reviewed Stage 1 and Stage 2 and found blockers that need to be resolved before we can proceed to Stage 3. Address ALL of the following:\n\n## Review findings to fix\n\n### 1. Convert daemon from raw Bun.serve() to Hono (plan deviation)\n\nThe plan specified Hono for its built-in SSE support needed in later stages. The current raw Bun.serve() implementation works but will require rework. Convert now while the surface area is small.\n\n- Replace `daemon/src/server.ts` and `daemon/src/router.ts` with Hono\n- Install `hono` as a dependency in the daemon package\n- All existing routes (health, help, vault endpoints) must work identically after conversion\n- All 258 daemon tests must still pass\n- Hono's native request/response handling replaces the manual routing\n\n### 2. Fix 103 nextjs test failures (ECONNREFUSED)\n\n`nextjs/lib/vault-client.ts` makes HTTP calls to the daemon, but during tests no daemon is running. The client has no mock mechanism.\n\n- Create a testable vault-client following the same pattern as `sdk-provider.ts` (provider pattern with `configureSdkForTesting`)\n- Tests should be able to inject mock responses without hitting the network\n- The mock mechanism must be opt-in (production code unchanged)\n- All 103 previously-failing nextjs tests must pass\n- vault-client silent failures (returning empty arrays/nulls) should be distinguishable from \"no data\" — throw or return error types when the daemon is unreachable\n\n### 3. Fix lint failures\n\nRemove the two unused imports in `nextjs/lib/vault-client.ts` (`resolveGoalsPath`, `fileExists`).\n\n### 4. Delete vault-manager.ts and vault-config.ts from nextjs\n\nThe plan required these to be deleted. They are dead code now that vault-client exists.\n\n- Move `SaveConfigResult` type to `@memory-loop/shared` (it's the only thing keeping vault-config.ts alive)\n- Delete `nextjs/lib/vault-manager.ts`\n- Delete `nextjs/lib/vault-config.ts`\n- Grep for any remaining imports of these modules and update them\n- If any test files import from the deleted modules, update those imports\n\n### 5. Fix vault cache fire-and-forget race\n\nThe daemon's vault cache initialization is fire-and-forget, meaning early requests could hit an empty cache.\n\n- Ensure the cache is populated before the server starts accepting requests, OR\n- Ensure requests that arrive before cache population wait for it to complete\n\n### 6. Add daemon-down error handling to vault-client\n\nCurrently vault-client returns empty arrays/nulls when the daemon is unreachable, indistinguishable from \"no data.\" This means silent production failures.\n\n- vault-client must distinguish between \"daemon returned empty\" and \"daemon unreachable\"\n- When the daemon is down, callers should know it's an error, not empty data\n- Consider throwing a specific error type (e.g., `DaemonUnavailableError`) or returning a result type\n\n## Verification\n\nAfter all changes:\n- `bun run typecheck` passes\n- `bun run lint` passes  \n- `bun run test` passes (ALL packages, including the previously-failing 103 nextjs tests)\n- `bun run --cwd nextjs build` passes\n- No nextjs file imports from vault-manager.ts or vault-config.ts\n- Daemon uses Hono, not raw Bun.serve()\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-062712.md`\n- Stage 1 plan: `.lore/plans/daemon-skeleton-shared-package.md`\n- Stage 2 plan: `.lore/plans/daemon-vault-foundation.md`\n- Spec: `.lore/specs/daemon-application-boundary.md`"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T14:16:19.907Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T14:16:19.910Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
