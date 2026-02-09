---
title: Fire-and-forget exposes timing assumptions hidden by await
date: 2026-02-08
status: complete
tags: [architecture, concurrency, fire-and-forget, sse, streaming, review-process]
modules: [active-session-controller, session-streamer, chat-route, useChat]
related:
  - .lore/specs/server-driven-chat.md
  - .lore/plans/server-driven-chat.md
  - .lore/notes/server-driven-chat.md
  - .lore/notes/server-driven-chat-validation.md
---

# Retro: Server-Driven Chat Processing

## Summary

Refactored the chat system from "SSE drives processing" to "server processes to completion, SSE is a viewport." 22 files changed, 2651 insertions, 492 deletions. All 18 spec requirements implemented. Three critical bugs found and fixed during review. Three critical integration tests added. Reconnection with exponential backoff and tool invocation bulk restore deferred.

## What Went Well

- **Spec-first paid off.** The spec (18 requirements, 9 success criteria) and plan (13 steps with delegation guide) meant implementation was almost entirely mechanical. Each phase had clear inputs and outputs. No mid-course design changes.
- **Parallel review agents caught real bugs.** Three reviewers running simultaneously (code-reviewer, silent-failure-hunter, spec-validator) found 3 critical code bugs and 3 critical test gaps. The session ID race condition would have been a production bug: the POST response would return null instead of the session ID.
- **Generation guard pattern worked cleanly.** The `currentGeneration` counter with capture-and-compare in the finally block is simple and correct. No complex locking or semaphores needed. The pattern is reusable for any fire-and-forget with async cleanup.
- **Incremental testing.** Each phase ran tests before moving to the next. Every phase passed on first attempt. Final count: 4164 tests across 107 files.
- **Implementation notes tracked divergence.** The notes file captured each phase's actual outcome vs plan, making the retro straightforward. Three documented divergences, all intentional.

## What Could Improve

- **Fire-and-forget timing assumptions were invisible until review.** The session ID race (`currentSessionId` set in `runStreaming` but read via `getState()` before `runStreaming` had a chance to execute) was a direct consequence of changing `await runStreaming()` to `void runStreaming()`. The code that read `currentSessionId` was written assuming synchronous availability. Removing the `await` broke that assumption silently, with no compile error or test failure. The code reviewer caught it; the existing tests didn't, because they tested the hook (which doesn't read the POST response's sessionId) rather than the route handler.
- **Review deferred too many error handling findings.** The silent-failure-hunter found 14 issues, but only 1 was fixed (the `void interrupt()` unhandled rejection). The rest were classified as "improvements to pre-existing patterns." Some of those (permission resolution failures hanging the conversation forever, SSE serialization errors silently killing streams) are user-facing bugs, not just code quality issues. They're now tracked as deferred but should have been triaged more carefully.
- **No route-level integration tests.** The spec validator flagged this: no tests exercise the actual HTTP route handlers. The controller and hook have good coverage, but the route layer (JSON parsing, HTTP status codes, SSE stream lifecycle) is tested only by implication. The route split (Phase 4) passed because the existing test suite didn't test routes directly.
- **Lint issues caught at commit time.** Two ESLint errors (`async` function without `await`, floating promise) slipped through 7 phases of implementation. Should have run lint earlier, not just at commit.

## Lessons Learned

- When converting `await fn()` to `void fn()`, audit every caller that reads state set inside `fn()`. The `await` was hiding a timing dependency: code after the call assumed state was already updated. `void` breaks that contract silently.
- Parallel review agents with different specializations (code correctness, error handling, spec compliance) catch different classes of bugs. Run all three for architectural changes.
- The generation guard pattern (increment a counter, capture it, check in finally) is the right primitive for fire-and-forget with async cleanup. Simpler than AbortController for protecting shared mutable state from stale cleanup.
- Run lint alongside tests after each phase, not just at commit time. Pre-commit hooks are the safety net, not the first check.

## Artifacts

- Spec: `.lore/specs/server-driven-chat.md`
- Plan: `.lore/plans/server-driven-chat.md`
- Implementation notes: `.lore/notes/server-driven-chat.md`
- Spec validation: `.lore/notes/server-driven-chat-validation.md`
- PR: #474
