---
title: Perfect review, broken product
date: 2026-03-15
status: complete
tags: [process, testing, integration, quality-pipeline, daemon, sdk, commission]
modules: [active-session-controller, session-manager, package.json]
related:
  - .lore/specs/ephemeral-sdk-sessions.md
  - .lore/plans/ephemeral-sdk-sessions.md
  - .lore/reviews/ephemeral-sdk-sessions-review.md
  - .lore/retros/discussion-multi-turn-resume.md
  - .lore/retros/server-driven-chat.md
---

# Retro: Ephemeral SDK Sessions

## Summary

Rewrote the SDK subprocess model from long-lived to ephemeral per-turn. Four commissions executed in sequence (two implementation, one test, one review). All passed. 21/21 spec requirements satisfied. 18/18 server-driven-chat guarantees preserved. The reviewer declared it ready to ship. A human opened the app, typed "test," and nothing happened.

Two root causes identified and fixed. Two more bugs remain undiagnosed. The quality pipeline worked exactly as designed and still shipped a broken product.

## What Went Well

**The plan structure was sound.** Seven steps with clear dependencies, a delegation guide assigning reviewers to risk areas, three documented risks with mitigations, and a requirement-to-step mapping. Every commission knew what to build, what to test, and what to verify. No mid-course design changes.

**The commission chain executed cleanly.** Dalton (Steps 1-3), Dalton (Steps 4-5), Sable (Step 6 tests), Thorne (Step 7 review). Sequential handoff worked. Each commission received the prior work intact and built on it correctly.

**Thorne's review was thorough.** Line-by-line verification of all 21 REQ-ESS requirements with file paths and line numbers. All 18 REQ-SDC guarantees checked against the actual code. Two non-blocking findings surfaced (stale `activeModel` on clear, outdated comment). The review format is a model for future spec validation. What it checked, it checked well.

**The event translator design was clean.** Porting Guild Hall's `createStreamTranslator()` pattern gave the refactor a proven reference. The intermediate event schema separated SDK-specific parsing from domain logic. No regression in event handling.

## What Went Wrong

### Bug 1: Error emitted to zero subscribers

`active-session-controller.ts` `sendMessage()` calls `createSession()` or `resumeSession()`, which can throw (e.g., daemon unreachable). The catch block called `emit()` to send an error event, then returned. No rethrow.

The problem: `emit()` pushes events to the subscriber list. In the two-phase architecture, subscribers connect via SSE *after* the POST returns. At the moment `sendMessage()` catches the error, the subscriber list is empty. The error goes nowhere. The POST returns 200 OK with `{ sessionId: null }`. The frontend connects SSE, gets `isProcessing: false` in the snapshot, and closes. The user sees nothing.

This bug predates the ephemeral refactor. It existed in the controller's `sendMessage` since the server-driven-chat implementation. The refactor preserved it faithfully. Thorne's review verified that the catch block checked for `RESUME_FAILED` and emitted the right error code. The code was correct in isolation. It just couldn't reach anyone.

**Fix:** Added `throw err` after the emit so the POST handler receives the exception and returns an HTTP error. The frontend's POST handler already shows errors from non-200 responses.

### Bug 2: `bun run dev` didn't start the daemon

The root `package.json` `dev` script ran `bun run --cwd nextjs dev`, starting only Next.js. The daemon (which handles all SDK calls, vault operations, file access) wasn't running. Every API call from Next.js to the daemon returned 500 with connection refused.

This bug existed since the daemon was extracted (Stage 1 of the daemon migration). It never surfaced because nobody ran `bun run dev` from the root and tested manually. Automated tests don't start the dev server. The daemon has its own `daemon:dev` script, and developers who knew the architecture ran both processes separately.

**Fix:** Added `concurrently` to run both daemon and Next.js from `bun run dev`.

### Why both bugs survived

Both bugs are invisible to unit tests, integration tests, and code review. Here's why:

**Unit tests** mock the SDK and daemon client. They test that `sendMessage()` calls `emit()` with the right event shape. They don't test whether anyone is listening. They test that API client functions construct the right requests. They don't test whether the daemon is running to receive them.

**Integration tests** operate within a single package boundary. The controller tests create a controller, call `sendMessage()`, and verify events. The tests subscribe *before* calling `sendMessage()` because that's how you write a test. The real client subscribes *after*. The test proves the code works in a scenario that never occurs in production.

**Code review** checks code against requirements. Thorne verified that `sendMessage()` catches errors and emits the right event type. The catch block is correct. The problem is architectural: emitting to subscribers that don't exist yet isn't a code error, it's a protocol error between components that only manifests when the components are actually wired together and running.

**Spec validation** checks that requirements are implemented. The spec says "fire-and-forget sendMessage" (REQ-ESS-16) and "snapshot-on-connect" (REQ-ESS-15). Both are implemented correctly. The spec doesn't say "errors during sendMessage must propagate as HTTP errors," because that's not a session lifecycle requirement. It's a system integration property.

## Lessons Learned

### The gap has a name: system integration testing

The quality pipeline checks three things: does the code satisfy the spec (review), does the code behave correctly in isolation (unit tests), and do the components interact correctly within a package (integration tests). None of these check whether the system works when a human uses it.

The gap is between "all components are correct" and "the product works." We verified correctness at every layer and never verified assembly. A car where every part passes inspection but the engine isn't connected to the wheels.

### Pre-existing bugs survive refactors by design

The emit-to-zero-subscribers bug was invisible to the refactor because the refactor's job was to change subprocess lifecycle, not audit error propagation. Thorne's review compared the new code against the spec. The spec doesn't cover "what happens when sendMessage throws before any SSE client connects." The bug predates the spec.

Refactors that preserve behavior also preserve bugs. The only thing that surfaces pre-existing bugs in changed code is running the system end-to-end, because end-to-end doesn't care when the bug was introduced.

### Dev environment is part of the product

`bun run dev` is the first thing a developer runs. If it doesn't start the whole system, the system doesn't work. The daemon extraction changed the dev startup requirements, but nobody updated the entry point. The spec didn't mention it because it was "out of scope" (daemon-internal rewrite). But the user doesn't care about scope boundaries; they care whether the app starts.

### Error handling without an audience is not error handling

This is the second time we've learned this lesson. The previous retro (discussion-multi-turn-resume) found that `useChat` captured errors in `lastError` but the Discussion component never rendered them. This time, the controller emitted errors to an empty subscriber list. Same pattern: error is captured, error goes nowhere, user sees nothing.

The CLAUDE.md lesson already says: "Error events that aren't rendered to the user are the same as no error handling." The lesson is correct. We just didn't apply it to the emit-to-zero-subscribers case because the error *was* rendered (to subscribers), it just had no audience at that point in the lifecycle.

Refined lesson: error handling must be verified end-to-end, from the point of failure to the user's screen. Every link in the chain (throw, catch, emit, subscribe, render) must exist and be connected at the moment the error occurs.

## Process Improvements

### 1. Add a smoke test to the spec's AI Validation section

Every spec that changes user-facing behavior should include a "smoke test" requirement: a manual verification step that exercises the golden path through the actual running system. Not "unit test that mocks the SDK" but "start the system, open the browser, do the thing."

For this spec, the smoke test would have been: "Start the app with `bun run dev`. Open the browser. Go to Think tab. Type a message. Verify streaming response appears."

This should be a checklist item that the final commission (or the plan's delegation guide) assigns explicitly. The reviewer can't do it (no browser), so it needs to be called out as a human verification step.

### 2. Require `throw` after `emit` in catch blocks that run before subscribers exist

The two-phase architecture creates a structural hazard: any error in the POST phase (before SSE connects) must propagate as an HTTP error, not just an emitted event. Add this to CLAUDE.md as a critical lesson:

"In two-phase architectures (POST then SSE), errors during the POST phase must be thrown, not just emitted. Emitting to zero subscribers is silent failure. The POST handler converts exceptions to HTTP error responses, which the frontend already handles."

### 3. Validate dev startup in the plan

Any plan that changes runtime architecture (adding a daemon, splitting a monolith, extracting a service) should include a step that verifies `bun run dev` starts the complete system. This is an implicit requirement that's easy to miss because it's not about code correctness, it's about developer experience.

### 4. Add a "wiring test" category to integration tests

Integration tests within a package boundary prove component behavior. A "wiring test" proves components are connected across boundaries. For the two-phase chat architecture, a wiring test would:

1. Start a real HTTP server (or use Bun's test server)
2. POST to `/session/chat/send`
3. Connect to `/session/chat/stream`
4. Verify at least one SSE event arrives

This doesn't need a real SDK. It needs a real HTTP stack with real connection timing. The test proves the POST-then-SSE sequence works, including the case where POST fails (verify the error reaches the client, not just the subscriber list).

### 5. Review delegation should include an integration-level reviewer

The plan's delegation guide assigned specialized reviewers to specific steps (type-design-analyzer for Step 1, silent-failure-hunter for Step 4, code-reviewer for Step 5). All operate at the code level. Add a step that runs after implementation and review: a fresh-context agent that reads the spec, reads the route handlers, reads the frontend client, and asks "if this call fails, does the user see the error?" That's the question none of the existing reviewers asked.

## Unresolved

Two bugs remain after the fixes above. The user reported "Better" but the system is not fully working. These bugs are undiagnosed at the time of this retro and will need their own investigation.

## Artifacts

- Spec: `.lore/specs/ephemeral-sdk-sessions.md`
- Plan: `.lore/plans/ephemeral-sdk-sessions.md`
- Review: `.lore/reviews/ephemeral-sdk-sessions-review.md`
- Previous retro (motivated this work): `.lore/retros/discussion-multi-turn-resume.md`
- Previous retro (same architecture): `.lore/retros/server-driven-chat.md`
