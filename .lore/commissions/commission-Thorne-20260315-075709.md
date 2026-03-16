---
title: "Commission: Review: Stage 3 & 4 plans against current codebase state"
date: 2026-03-15
status: completed
type: one-shot
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "We've completed Stage 1 (daemon skeleton + shared package) and Stage 2 (vault foundation), plus a round of fixes from your prior review (Hono conversion, vault-client testability, file cleanup, cache race fix, error handling).\n\nBefore we proceed, review the Stage 3 and Stage 4 plans against the current state of the codebase. Things have shifted during implementation (e.g., Hono instead of raw Bun.serve(), vault-client provider pattern, DaemonUnavailableError). The plans may contain assumptions that no longer hold.\n\n## Plans to review\n\n- `.lore/plans/daemon-session-migration.md` (Stage 3: Session Management Migration)\n- `.lore/plans/daemon-web-app-conversion.md` (Stage 4: Web App Conversion)\n\n## What to check\n\n### For each plan, answer:\n\n1. **Stale assumptions**: Does the plan reference patterns, file locations, module names, or architectural decisions that have changed during Stage 1/2 implementation? List each one.\n\n2. **Missing prerequisites**: Does the plan assume something exists that doesn't, or assume something doesn't exist that now does? (e.g., the vault-client provider pattern now exists and could be reused for session-client)\n\n3. **Scope creep or underestimation**: Given what you've seen of the actual implementation complexity in Stages 1-2, are there tasks in these plans that are likely harder or easier than estimated?\n\n4. **Risk areas**: What parts of these plans are most likely to cause the same kinds of issues we saw in Stage 1/2 (test failures, boundary violations, silent failures)?\n\n5. **Ordering concerns**: Is the stage boundary between 3 and 4 in the right place? Should anything move between them?\n\n6. **Dependency on earlier fixes**: Do these plans need to be updated to account for the Hono conversion, vault-client provider pattern, DaemonUnavailableError, or other changes from the fix commission?\n\n### Also check:\n\n- The governing spec: `.lore/specs/daemon-application-boundary.md`\n- Current daemon code in `daemon/src/` (to understand what's actually there now)\n- Current nextjs code in `nextjs/lib/` (to see what needs to migrate)\n- The vault-client pattern in `nextjs/lib/vault-client.ts` (as a template for session-client)\n\n### What NOT to do\n\nDo not modify any code or plans. Review only. Present findings with specific line references and concrete recommendations for what needs to change in each plan.\n\n## Reference\n\n- Prior review: `.lore/commissions/commission-Thorne-20260315-062712.md`\n- Fix commission: `.lore/commissions/commission-Dalton-20260315-071619.md`\n- Stage 1 plan: `.lore/plans/daemon-skeleton-shared-package.md`\n- Stage 2 plan: `.lore/plans/daemon-vault-foundation.md`"
dependencies: []
linked_artifacts:
  - .lore/plans/daemon-stateless-file-operations.md

  - .lore/plans/daemon-background-schedulers.md
  - .lore/plans/daemon-session-lifecycle-chat.md
  - .lore/plans/daemon-web-app-conversion.md
  - .lore/plans/daemon-background-schedulers.md
  - .lore/plans/daemon-session-lifecycle-chat.md
  - .lore/plans/daemon-web-app-conversion.md
activity_timeline:
  - timestamp: 2026-03-15T14:57:09.938Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T14:57:09.940Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-15T14:57:09.989Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-15T14:57:18.478Z
    event: progress_report
    reason: "Beginning review. Reading plans, spec, and current codebase state in parallel."
  - timestamp: 2026-03-15T14:58:32.021Z
    event: progress_report
    reason: "All documents read. Now analyzing plans against codebase state. Key finding: commission references non-existent plan filename (daemon-session-migration.md). Actual plans are daemon-stateless-file-operations (Stage 3), daemon-background-schedulers (Stage 4), daemon-session-lifecycle-chat (Stage 5), daemon-web-app-conversion (Stage 6). Reviewing all four against current implementation."
  - timestamp: 2026-03-15T14:58:57.255Z
    event: progress_report
    reason: "Context gathered. Writing findings for all four remaining plans (Stage 3: file ops, Stage 4: schedulers, Stage 5: session lifecycle, Stage 6: web app conversion)."
  - timestamp: 2026-03-15T15:01:36.546Z
    event: result_submitted
    reason: "Reviewed all four remaining daemon migration plans (Stages 3-6) against the current codebase state after Stage 1/2 implementation and the fix commission.\n\nKey findings:\n\n**Critical (blocks correct implementation):**\n- All plans' import rewrite instructions reference `vault-manager.ts` as the source, but it was deleted in the fix commission. Extraction/card modules now import from `vault-client.ts`. Every import rewrite step needs updating.\n- Stage 5's session-client uses `DAEMON_URL` env var instead of the established Unix socket pattern from vault-client (DAEMON_SOCKET/DAEMON_PORT + DaemonUnavailableError).\n- All plans reference `server.ts` for route registration; the actual location is `router.ts:registerRoutes()`.\n\n**Architectural (prevents rework):**\n- Three daemon-facing client facades (vault-client, file-client, session-client) will duplicate connection logic. Extract a shared daemon-fetch module before Stage 3 creates file-client.\n- test-daemon-helpers.ts only configures vault-client. It needs to scale for file-client and session-client.\n- Hono SSE API choice needs explicit specification in Stage 5 (this was the original reason for Hono).\n\n**Scope (prevents the same failures as Stage 1/2):**\n- Stage 3 Step 16 (~17 route conversions + lib/ import rewriting) is too large for a single step. Split it.\n- Stage 4's sdk-provider discussion is 40 lines settling on \"copy the file.\" Condense.\n- Stage 5 SSE latency test (100ms) will be flaky. Relax to correctness check (ordering + 1s).\n\n**Ordering:**\n- Stage boundary between 5 and 6 is correctly placed.\n- Stage 3 should run before Stage 4 (despite independence claim) to establish route patterns.\n\nTotal: 7 critical findings, 3 architectural, 3 scope, 2 ordering across 4 plans. No code modified."
  - timestamp: 2026-03-15T15:01:43.286Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Writing findings for all four remaining plans (Stage 3: file ops, Stage 4: schedulers, Stage 5: session lifecycle, Stage 6: web app conversion)."
projectName: memory-loop
---
Reviewed all four remaining daemon migration plans (Stages 3-6) against the current codebase state after Stage 1/2 implementation and the fix commission.

Key findings:

**Critical (blocks correct implementation):**
- All plans' import rewrite instructions reference `vault-manager.ts` as the source, but it was deleted in the fix commission. Extraction/card modules now import from `vault-client.ts`. Every import rewrite step needs updating.
- Stage 5's session-client uses `DAEMON_URL` env var instead of the established Unix socket pattern from vault-client (DAEMON_SOCKET/DAEMON_PORT + DaemonUnavailableError).
- All plans reference `server.ts` for route registration; the actual location is `router.ts:registerRoutes()`.

**Architectural (prevents rework):**
- Three daemon-facing client facades (vault-client, file-client, session-client) will duplicate connection logic. Extract a shared daemon-fetch module before Stage 3 creates file-client.
- test-daemon-helpers.ts only configures vault-client. It needs to scale for file-client and session-client.
- Hono SSE API choice needs explicit specification in Stage 5 (this was the original reason for Hono).

**Scope (prevents the same failures as Stage 1/2):**
- Stage 3 Step 16 (~17 route conversions + lib/ import rewriting) is too large for a single step. Split it.
- Stage 4's sdk-provider discussion is 40 lines settling on "copy the file." Condense.
- Stage 5 SSE latency test (100ms) will be flaky. Relax to correctness check (ordering + 1s).

**Ordering:**
- Stage boundary between 5 and 6 is correctly placed.
- Stage 3 should run before Stage 4 (despite independence claim) to establish route patterns.

Total: 7 critical findings, 3 architectural, 3 scope, 2 ordering across 4 plans. No code modified.
