---
title: "Commission: Update Stage 3-6 plans: incorporate Thorne's review findings"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Thorne reviewed the four remaining daemon migration plans against the current codebase (after Stage 1/2 implementation and a fix commission). The plans have stale assumptions that will produce wrong code if not corrected.\n\n## Plans to update\n\n- `.lore/plans/daemon-stateless-file-operations.md` (Stage 3)\n- `.lore/plans/daemon-background-schedulers.md` (Stage 4)\n- `.lore/plans/daemon-session-lifecycle-chat.md` (Stage 5)\n- `.lore/plans/daemon-web-app-conversion.md` (Stage 6)\n\n## Thorne's review findings\n\nRead the full review: `.lore/commissions/commission-Thorne-20260315-075709.md`\n\n### Critical (all plans will produce wrong code without these fixes)\n\n1. **Stale import source**: All plans' import rewrite instructions reference `vault-manager.ts` as the source module, but it was deleted in the fix commission. Modules now import from `vault-client.ts`. Every import rewrite step across all four plans needs updating to reflect reality.\n\n2. **Session-client connection pattern**: Stage 5's session-client uses a `DAEMON_URL` env var that doesn't exist. It must use the established Unix socket pattern from vault-client: `DAEMON_SOCKET` / `DAEMON_PORT` + `DaemonUnavailableError`. Read `nextjs/lib/vault-client.ts` to see the actual pattern.\n\n3. **Route registration location**: All plans reference `server.ts` for route registration. The actual location is `router.ts:registerRoutes()`. Update all references.\n\n### Architectural (prevents rework across stages)\n\n4. **Shared daemon-fetch module**: Three client facades (vault-client, file-client, session-client) will each need Unix socket connection logic, error handling, and DaemonUnavailableError. Extract a shared `daemon-fetch` module as a preliminary step in Stage 3, before file-client is created. vault-client should be refactored to use it too. This prevents three copy-paste implementations.\n\n5. **Test helper scaling**: `nextjs/test-daemon-helpers.ts` only configures vault-client today. The plans for Stage 3 and 5 will need similar test helpers for file-client and session-client. Update the plans to extend the test helper pattern rather than creating new ones.\n\n6. **Hono SSE specification**: Stage 5 needs explicit specification of which Hono SSE API to use. This was the reason we converted to Hono. Don't leave it vague.\n\n### Scope (prevents same failures as Stage 1/2)\n\n7. **Stage 3 Step 16 too large**: ~17 route conversions + lib/ import rewriting in one step. Split into smaller steps (group by domain: file ops, search, config handlers, etc.).\n\n8. **Stage 4 sdk-provider verbosity**: 40 lines discussing what amounts to \"copy the file.\" Condense to the decision and the steps.\n\n9. **Stage 5 SSE latency test**: 100ms threshold will be flaky. Change to correctness check (event ordering + 1s timeout).\n\n### Ordering\n\n10. **Stage 3 before Stage 4**: The plans claim these can run in parallel. They can't. Stage 3 establishes the route and client patterns that Stage 4 needs to follow. Make this dependency explicit.\n\n## What to do\n\n- Read the current codebase state (especially `daemon/src/router.ts`, `nextjs/lib/vault-client.ts`, `nextjs/test-daemon-helpers.ts`) to understand what actually exists\n- Update all four plans to fix the critical issues (1-3)\n- Incorporate the architectural recommendations (4-6)\n- Address the scope concerns (7-9)\n- Make the ordering dependency explicit (10)\n- Preserve the existing plan structure and level of detail; don't rewrite from scratch\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-075709.md`\n- Governing spec: `.lore/specs/daemon-application-boundary.md`\n- Stage 1 plan (completed): `.lore/plans/daemon-skeleton-shared-package.md`\n- Stage 2 plan (completed): `.lore/plans/daemon-vault-foundation.md`\n- Current vault-client: `nextjs/lib/vault-client.ts`\n- Current test helpers: `nextjs/test-daemon-helpers.ts`\n- Current router: `daemon/src/router.ts`"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T15:05:13.966Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T15:05:13.968Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
