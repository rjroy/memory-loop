---
title: Next.js migration exposed hidden coupling between transport and state
date: 2026-02-05
status: complete
tags: [architecture, refactor, next-js, sse, websocket, state-management, race-condition]
modules: [session-context, discussion, pair-writing, active-session-controller, useChat]
related: [.lore/brainstorm/next-js-migration.md, .lore/plans/vectorized-hopping-pinwheel.md]
---

# Retro: Next.js Migration

## Summary

Migrated Memory Loop from Vite SPA + Hono backend to Next.js 15 App Router. Replaced WebSocket transport with SSE for AI chat streaming. Deleted ~16,700 lines of dead code. Net result: single-process deployment, simpler architecture, 4109 tests passing across all workspaces.

## What Went Well

- **The brainstorm was right.** The original brainstorm identified WebSocket as unnecessary and SSE + REST as the correct pattern. That analysis held up through implementation. No mid-course architecture changes.
- **Strangler fig worked.** Building Next.js alongside the old system, then switching, avoided a big-bang rewrite. Components migrated one at a time. The old Hono code became provably dead (no imports) before deletion.
- **Test suite caught real bugs.** The 1944 existing tests (before this session) survived the migration intact, proving the domain logic was truly decoupled from the transport layer. New tests caught the bugs fixed in this session.
- **Backend-as-library was the right call.** Making the backend a pure library (no HTTP server) with Next.js API routes importing directly from it kept the domain logic clean. No duplication between old and new servers.
- **Deletion was massive and painless.** 25+ files deleted from backend alone. Every deletion was safe because grep confirmed zero imports. The old WebSocket handler (1413 lines) and Hono server disappeared without a single test failure.

## What Could Improve

- **Dual useChat instances weren't caught during migration.** PairWritingMode kept its own `useChat(vault)` call when Discussion already had one. The migration focused on "does each component render" but didn't verify that actions from one component appeared in another's conversation. Integration-level testing (component A triggers action, component B shows result) would have caught this during migration rather than in production.
- **session_ready race condition was a design flaw, not a migration artifact.** The pattern of "backend sends history, then appends user message" creates an inherent race. This existed conceptually in the WebSocket version too, it just wasn't triggered because WebSocket message ordering was different. The fix (only apply server history when local state is empty) is correct but brittle. The real fix would be for the backend to not send stale history on a message-bearing request.
- **Plan file got reused for a different purpose.** `concurrent-imagining-flurry.md` was originally the Hono removal plan, then got overwritten with the PairWriting fix plan. Plan files should be immutable records of what was planned. New plans need new files.

## Lessons Learned

- When two components share a session, verify that actions in one appear in the other. Rendering tests pass even when the pipeline is completely broken between components.
- `session_ready` with message history is only safe when the client has no local state yet. Any time a server event replaces client state wholesale, guard it with an emptiness check.
- SSE + REST POST for mid-stream interactions (permissions, abort, answers) is simpler than WebSocket and works natively with Next.js. The brainstorm's analysis was validated by implementation.
- Backend modules that are pure libraries (no HTTP/transport concerns) survive framework migrations without changes. The entire backend domain layer transferred to Next.js with zero modifications.

## Artifacts

- `.lore/brainstorm/next-js-migration.md` - Original architecture analysis
- `.lore/plans/vectorized-hopping-pinwheel.md` - Migration execution plan
- PR #458 - The complete migration PR
