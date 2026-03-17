---
title: "Daemon migration (7 stages) and ephemeral SDK sessions"
date: 2026-03-16
status: complete
tags: [daemon, architecture, migration, sdk, streaming, commission-system, process]
modules: [daemon, nextjs, shared, cli]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/specs/ephemeral-sdk-sessions.md
  - .lore/retros/ephemeral-sdk-sessions.md
  - .lore/brainstorm/daemon-migration-stages.md
---

# Retro: Daemon Migration and Ephemeral SDK Sessions

## Summary

Over ~24 hours on March 14-16, 2026, 39 commissions executed a complete architectural refactor of Memory Loop. The work had two phases:

**Phase 1: Daemon Migration (Stages 1-7).** Extracted all domain logic from the Next.js app into a standalone daemon process. Created a shared package for types and schemas, migrated vault management, file operations, background schedulers, and session/chat handling to the daemon. Converted Next.js into a pure frontend proxy. Built a CLI client as a second daemon consumer.

**Phase 2: Ephemeral SDK Sessions.** Refactored the daemon's SDK session handling to use per-turn subprocesses with an intermediate event translator, consolidated option assembly, improved resume failure detection, and added abort/crash handling during pending prompts.

Workers: Octavia (planning, spec, brainstorm, plan updates, retro), Dalton (implementation, fixes), Thorne (reviews after every stage), Sable (test writing).

## What Went Well

- **Staged planning worked.** The spec-then-brainstorm-then-plan-per-stage approach kept each commission scoped. No single commission needed to hold the full migration in its head. The brainstorm (daemon-migration-stages.md) correctly identified the seven stages and their dependencies.

- **Review-after-every-stage caught real problems.** Thorne caught a security vulnerability (transcript path traversal), a plan deviation (raw Bun.serve instead of Hono), 103 test failures from missing daemon client mocking, dead code, vault cache race conditions, asset route boundary violation, and stale plan assumptions. Fixing these between stages prevented compounding.

- **The commission dependency chain worked.** Stages 1-7 flowed sequentially via dependencies. Plans were updated mid-flight when Stage 1-2 implementation revealed stale assumptions in Stage 3-6 plans. The plan update commission (Octavia 083622) fixed critical issues before Dalton hit them during implementation.

- **The daemon-fetch extraction.** Thorne's review identified that three client facades would each duplicate Unix socket connection logic. The shared daemon-fetch module, extracted as Step 0 of Stage 3, prevented three copy-paste implementations and gave all clients consistent error handling with DaemonUnavailableError.

- **Post-deployment bug diagnosis was fast.** When the user tested and things broke, root causes were identified quickly (emit-to-zero-subscribers, missing daemon in dev server). The fixes were surgical.

## What Could Improve

- **"All tests pass" is not "system works."** The entire quality pipeline (unit tests, integration tests, code review, spec validation) gave a green light on a fundamentally broken system. Two bugs survived to user testing: (1) sendMessage's catch block emitted errors to zero SSE subscribers and didn't rethrow, so POST returned 200 OK with null sessionId; (2) `bun run dev` only started Next.js, not the daemon. Neither bug was caught because no test or review step exercised the actual running system.

- **Thorne's review scope was code-level, not runtime.** The review checked every spec requirement against the code and passed 21/21. It could not catch that the two-phase chat architecture means emit() during sendMessage() always has zero listeners. This is a structural gap in how reviews are scoped, not a failure of the reviewer.

- **One commission stalled from model ID error.** Commission Dalton-015116 was abandoned because of an invalid model ID in resource_overrides. Had to recreate it immediately as Dalton-015136. The system should validate model IDs before dispatch.

- **One commission hit max_turns.** Octavia-080513 (updating four plans) failed with error_max_turns. Had to recreate with higher maxTurns as Octavia-083622. Updating four plans in one commission was too much scope.

- **The Stage 5 fix commission (Dalton-140935) stalled** and was abandoned. Required Thorne to do a post-stall verification (commission-151603) to determine partial state. Wasted a review cycle.

- **SSE terminal event race condition.** The stream handler called cleanup() synchronously after starting an async writeSSE(), closing the connection before the terminal event flushed. This pattern existed from Stage 5 implementation and survived code review because the race is timing-dependent.

- **Hardcoded stubs survived to production.** The recentActivityHandler returned `discussions: []` as a hardcoded empty array. The function to populate it (`getRecentSessions`) already existed. This was a forgotten wire-up from the migration, not a missing feature.

## Lessons Learned

- **Emit to zero subscribers is silent failure.** In two-phase architectures where POST creates state and SSE observes it, error events emitted during POST never reach anyone. The fix is always: emit for defense-in-depth, but throw for correctness. This is a pattern-level lesson, not specific to this codebase.

- **Dev server commands must start the full stack.** When architecture splits a monolith into daemon + frontend, `bun run dev` must start both. Nobody catches this during automated testing because tests don't use the dev server.

- **Plan update commissions should be scoped to 1-2 plans, not 4.** The first attempt at updating all four plans hit max_turns. Two plans per commission is the right scope.

- **Stalled commissions need a verification step before retry.** When a fix commission stalls, the next step isn't another fix commission. It's a read-only verification to determine what was completed and what's still open. Thorne's post-stall verification (commission-151603) established this pattern.

- **Async write + synchronous cleanup = race condition.** When a callback calls an async write method and then synchronously calls cleanup, the write may not flush before the connection closes. The fix: await the write promise before cleanup on terminal events.

- **Hardcoded placeholder values should have TODO comments with the function name they need.** `discussions: []` would have been caught if it said `// TODO: wire up getRecentSessions`. Grep for TODO catches it; grep for `[]` doesn't.

## Artifacts

- Spec: `.lore/specs/daemon-application-boundary.md`
- Brainstorm: `.lore/brainstorm/daemon-migration-stages.md`
- Plans (archived): `.lore/_archive/daemon-skeleton-shared-package.md`, `daemon-vault-foundation.md`, `daemon-stateless-file-operations.md`, `daemon-background-schedulers.md`, `daemon-session-lifecycle-chat.md`, `daemon-web-app-conversion.md`, `daemon-cli-client.md`
- Ephemeral sessions spec: `.lore/specs/ephemeral-sdk-sessions.md`
- Ephemeral sessions plan: `.lore/plans/ephemeral-sdk-sessions.md`
- Ephemeral sessions review: `.lore/reviews/ephemeral-sdk-sessions-review.md`
- Prior retro (detailed): `.lore/retros/ephemeral-sdk-sessions.md`
