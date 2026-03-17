---
title: "Commission: Update Stage 3-6 plans: incorporate Thorne's review findings"
date: 2026-03-15
status: completed
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Thorne reviewed the four remaining daemon migration plans against the current codebase (after Stage 1/2 implementation and a fix commission). The plans have stale assumptions that will produce wrong code if not corrected.\n\n## Plans to update\n\n- `.lore/_archive/daemon-stateless-file-operations.md` (Stage 3)\n- `.lore/_archive/daemon-background-schedulers.md` (Stage 4)\n- `.lore/_archive/daemon-session-lifecycle-chat.md` (Stage 5)\n- `.lore/_archive/daemon-web-app-conversion.md` (Stage 6)\n\n## Thorne's review findings\n\nRead the full review: `.lore/commissions/commission-Thorne-20260315-075709.md`\n\n### Critical (all plans will produce wrong code without these fixes)\n\n1. **Stale import source**: All plans' import rewrite instructions reference `vault-manager.ts` as the source module, but it was deleted in the fix commission. Modules now import from `vault-client.ts`. Every import rewrite step across all four plans needs updating to reflect reality.\n\n2. **Session-client connection pattern**: Stage 5's session-client uses a `DAEMON_URL` env var that doesn't exist. It must use the established Unix socket pattern from vault-client: `DAEMON_SOCKET` / `DAEMON_PORT` + `DaemonUnavailableError`. Read `nextjs/lib/vault-client.ts` to see the actual pattern.\n\n3. **Route registration location**: All plans reference `server.ts` for route registration. The actual location is `router.ts:registerRoutes()`. Update all references.\n\n### Architectural (prevents rework across stages)\n\n4. **Shared daemon-fetch module**: Three client facades (vault-client, file-client, session-client) will each need Unix socket connection logic, error handling, and DaemonUnavailableError. Extract a shared `daemon-fetch` module as a preliminary step in Stage 3, before file-client is created. vault-client should be refactored to use it too. This prevents three copy-paste implementations.\n\n5. **Test helper scaling**: `nextjs/test-daemon-helpers.ts` only configures vault-client today. The plans for Stage 3 and 5 will need similar test helpers for file-client and session-client. Update the plans to extend the test helper pattern rather than creating new ones.\n\n6. **Hono SSE specification**: Stage 5 needs explicit specification of which Hono SSE API to use. This was the reason we converted to Hono. Don't leave it vague.\n\n### Scope (prevents same failures as Stage 1/2)\n\n7. **Stage 3 Step 16 too large**: ~17 route conversions + lib/ import rewriting in one step. Split into smaller steps (group by domain: file ops, search, config handlers, etc.).\n\n8. **Stage 4 sdk-provider verbosity**: 40 lines discussing what amounts to \"copy the file.\" Condense to the decision and the steps.\n\n9. **Stage 5 SSE latency test**: 100ms threshold will be flaky. Change to correctness check (event ordering + 1s timeout).\n\n### Ordering\n\n10. **Stage 3 before Stage 4**: The plans claim these can run in parallel. They can't. Stage 3 establishes the route and client patterns that Stage 4 needs to follow. Make this dependency explicit.\n\n## What to do\n\n- Read the current codebase state (especially `daemon/src/router.ts`, `nextjs/lib/vault-client.ts`, `nextjs/test-daemon-helpers.ts`) to understand what actually exists\n- Update all four plans to fix the critical issues (1-3)\n- Incorporate the architectural recommendations (4-6)\n- Address the scope concerns (7-9)\n- Make the ordering dependency explicit (10)\n- Preserve the existing plan structure and level of detail; don't rewrite from scratch\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-075709.md`\n- Governing spec: `.lore/specs/daemon-application-boundary.md`\n- Stage 1 plan (completed): `.lore/_archive/daemon-skeleton-shared-package.md`\n- Stage 2 plan (completed): `.lore/_archive/daemon-vault-foundation.md`\n- Current vault-client: `nextjs/lib/vault-client.ts`\n- Current test helpers: `nextjs/test-daemon-helpers.ts`\n- Current router: `daemon/src/router.ts`"
dependencies: []
linked_artifacts:
  - .lore/_archive/daemon-stateless-file-operations.md

  - .lore/_archive/daemon-background-schedulers.md
  - .lore/_archive/daemon-session-lifecycle-chat.md
  - .lore/_archive/daemon-web-app-conversion.md
  - .lore/_archive/daemon-background-schedulers.md
  - .lore/_archive/daemon-session-lifecycle-chat.md
  - .lore/_archive/daemon-web-app-conversion.md
resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T15:36:22.356Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T15:36:22.359Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-15T15:36:22.405Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-15T15:36:31.092Z
    event: progress_report
    reason: "Starting plan updates. Reading current codebase state and all four plans."
  - timestamp: 2026-03-15T15:37:05.157Z
    event: progress_report
    reason: "All four plans and codebase files read. Now applying the 10 findings from Thorne's review across all four plans."
  - timestamp: 2026-03-15T15:37:25.682Z
    event: progress_report
    reason: "Beginning edits. Starting with Stage 3 plan (daemon-stateless-file-operations.md) - fixing route registration reference, adding daemon-fetch module, splitting Step 16, making Stage 3→4 dependency explicit."
  - timestamp: 2026-03-15T15:42:48.969Z
    event: progress_report
    reason: "Stage 3 and 4 plans updated. Now editing Stage 5 (session lifecycle) - fixing DAEMON_URL pattern, adding Hono SSE spec, fixing latency test threshold, and vault-manager references."
  - timestamp: 2026-03-15T15:49:51.252Z
    event: progress_report
    reason: "All four plans updated. Final verification pass complete: no stale vault-manager references in nextjs context, no DAEMON_URL, no server.ts route registration references, no 100ms latency thresholds. Ready to submit."
  - timestamp: 2026-03-15T15:50:06.993Z
    event: result_submitted
    reason: "Updated all four daemon migration plans to fix Thorne's 10 review findings.\n\n**Critical fixes (1-3):**\n- Replaced all stale `vault-manager.ts` import references with `vault-client.ts` across all plans' codebase context tables and import rewrite instructions\n- Replaced `DAEMON_URL` session-client pattern in Stage 5 with daemon-fetch shared module pattern (Unix socket / TCP via `DAEMON_SOCKET` / `DAEMON_PORT`)\n- Fixed all route registration references from `server.ts` to `router.ts:registerRoutes()` in Stages 3-6\n\n**Architectural recommendations (4-6):**\n- Added Step 0 to Stage 3: extract `daemon-fetch` shared module from vault-client before creating file-client, preventing three copy-paste implementations\n- Updated Stage 3 and Stage 5 test helper sections to extend existing `test-daemon-helpers.ts` pattern rather than creating new helpers\n- Added explicit Hono SSE specification to Stage 5 with `streamSSE` from `hono/streaming` code example\n\n**Scope fixes (7-9):**\n- Split Stage 3 Step 16 (monolithic ~17 route import rewrites) into Steps 16-20 grouped by domain (file ops, search, config, capture, task/prep/goals)\n- Condensed Stage 4 sdk-provider decision (D1) and Step 1 from ~60 verbose lines to ~13 focused lines\n- Changed Stage 5 SSE test from 100ms latency threshold to correctness check (event ordering + 1s timeout)\n\n**Ordering fix (10):**\n- Added explicit Stage 3→4 dependency in Stage 3 Precondition section and replaced Stage 4's \"Stage Independence\" with \"Stage Dependency: Stage 3 must complete first\""
  - timestamp: 2026-03-15T15:50:11.442Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All four plans updated. Final verification pass complete: no stale vault-manager references in nextjs context, no DAEMON_URL, no server.ts route registration references, no 100ms latency thresholds. Ready to submit."
projectName: memory-loop
---
Updated all four daemon migration plans to fix Thorne's 10 review findings.

**Critical fixes (1-3):**
- Replaced all stale `vault-manager.ts` import references with `vault-client.ts` across all plans' codebase context tables and import rewrite instructions
- Replaced `DAEMON_URL` session-client pattern in Stage 5 with daemon-fetch shared module pattern (Unix socket / TCP via `DAEMON_SOCKET` / `DAEMON_PORT`)
- Fixed all route registration references from `server.ts` to `router.ts:registerRoutes()` in Stages 3-6

**Architectural recommendations (4-6):**
- Added Step 0 to Stage 3: extract `daemon-fetch` shared module from vault-client before creating file-client, preventing three copy-paste implementations
- Updated Stage 3 and Stage 5 test helper sections to extend existing `test-daemon-helpers.ts` pattern rather than creating new helpers
- Added explicit Hono SSE specification to Stage 5 with `streamSSE` from `hono/streaming` code example

**Scope fixes (7-9):**
- Split Stage 3 Step 16 (monolithic ~17 route import rewrites) into Steps 16-20 grouped by domain (file ops, search, config, capture, task/prep/goals)
- Condensed Stage 4 sdk-provider decision (D1) and Step 1 from ~60 verbose lines to ~13 focused lines
- Changed Stage 5 SSE test from 100ms latency threshold to correctness check (event ordering + 1s timeout)

**Ordering fix (10):**
- Added explicit Stage 3→4 dependency in Stage 3 Precondition section and replaced Stage 4's "Stage Independence" with "Stage Dependency: Stage 3 must complete first"
