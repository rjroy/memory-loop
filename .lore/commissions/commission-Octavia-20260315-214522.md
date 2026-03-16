---
title: "Commission: Retro: Ephemeral SDK sessions implementation and testing gaps"
date: 2026-03-16
status: completed
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "## Task\n\nWrite a retrospective for the ephemeral SDK sessions implementation. The code passed all automated tests and a thorough code review (21/21 spec requirements, 18/18 server-driven-chat guarantees), but failed immediately when a human tested it. Two root causes were found; two more bugs remain undiagnosed.\n\n## What Happened\n\n### Timeline\n\n1. Four commissions dispatched in sequence: Dalton (Steps 1-3), Dalton (Steps 4-5), Sable (Step 6 tests), Thorne (Step 7 spec review). All completed successfully.\n\n2. Thorne's review (`.lore/reviews/ephemeral-sdk-sessions-review.md`): \"Ready to ship. All 21 REQ-ESS requirements satisfied. All 18 REQ-SDC guarantees preserved. No blocking findings.\" Two trivial findings (stale activeModel on clear, outdated comment).\n\n3. User tested: opened Think tab, typed \"test\", hit enter. SSE closed instantly with no data. No error visible anywhere.\n\n4. Root cause #1: `active-session-controller.ts` `sendMessage()` catch block emitted error events to zero subscribers (SSE not connected yet in the two-phase architecture) and did NOT rethrow. POST returned 200 OK with `{ sessionId: null }`. Frontend connected to SSE, got `isProcessing: false` snapshot, closed immediately. Error completely lost. Fix: added `throw err` after the emit.\n\n5. Root cause #2: `bun run dev` only started Next.js, not the daemon. The daemon (which handles all SDK calls, vault operations, etc.) was never running. The `/api/vaults` endpoint returned 500 in 8ms because it couldn't reach the daemon. Fix: added `concurrently` package to run both daemon and Next.js from a single `bun run dev` command.\n\n6. After both fixes, user reports \"Better\" but two more bugs remain (undiagnosed at time of retro).\n\n### Key Observations\n\n- The emit-to-zero-subscribers bug existed in the controller's `sendMessage` since it was written (not introduced by the refactor). The refactor preserved a pre-existing flaw.\n- The `bun run dev` issue existed since the daemon was extracted (Stage 1 of the daemon migration). Nobody caught it because automated tests don't start the dev server.\n- Thorne's code review was thorough and accurate for what it checked (code-level spec compliance). It could not catch runtime integration issues.\n- Sable's tests used mock SDK functions and never made real HTTP requests through the full stack.\n- The spec (`.lore/specs/ephemeral-sdk-sessions.md`) didn't require end-to-end testing through the actual HTTP stack.\n\n## Artifacts to Reference\n\n- `.lore/specs/ephemeral-sdk-sessions.md` - the spec\n- `.lore/plans/ephemeral-sdk-sessions.md` - the plan\n- `.lore/reviews/ephemeral-sdk-sessions-review.md` - Thorne's review\n- `daemon/src/streaming/active-session-controller.ts` - the controller (site of bug #1)\n- `daemon/src/routes/session/send.ts` - the POST handler\n- `daemon/src/routes/session/stream.ts` - the SSE handler\n- `nextjs/hooks/useChat.ts` - the frontend two-phase client\n- `package.json` - root package.json (site of bug #2)\n- `.lore/retros/discussion-multi-turn-resume.md` - previous retro that motivated this work\n- CLAUDE.md lesson: \"Error events that aren't rendered to the user are the same as no error handling\"\n\n## Retro Structure\n\nWrite to `.lore/retros/ephemeral-sdk-sessions.md`. Cover:\n\n1. **What went well** - the plan structure, commission chain, Thorne's thorough review\n2. **What went wrong** - the two bugs and why they survived the full pipeline\n3. **Lessons learned** - what should change in how we plan, test, and review\n4. **Process improvements** - concrete changes to prevent this class of failure\n\nFocus on the systemic issue: our entire quality pipeline (unit tests, integration tests, code review, spec validation) passed a fundamentally broken implementation. The gap is between \"code correctness\" and \"system works.\" Name it clearly and propose what fills it.\n"
dependencies: []
linked_artifacts:
  - .lore/retros/ephemeral-sdk-sessions.md

  - CLAUDE.md
  - CLAUDE.md
activity_timeline:
  - timestamp: 2026-03-16T04:45:22.276Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T04:45:22.278Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-16T04:45:22.326Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-16T04:45:38.251Z
    event: progress_report
    reason: "Starting retro: reading referenced artifacts (spec, plan, review, previous retro, controller code, package.json)"
  - timestamp: 2026-03-16T04:46:07.164Z
    event: progress_report
    reason: "All artifacts read. Drafting the retrospective now."
  - timestamp: 2026-03-16T04:48:11.853Z
    event: result_submitted
    reason: "Wrote retrospective for the ephemeral SDK sessions implementation at `.lore/retros/ephemeral-sdk-sessions.md`.\n\nThe retro covers:\n1. **What went well**: Plan structure, commission chain execution, Thorne's thorough review, clean event translator design\n2. **What went wrong**: Two bugs (emit-to-zero-subscribers in sendMessage catch block, `bun run dev` not starting daemon) and why each survived unit tests, integration tests, and code review\n3. **Lessons learned**: Named the gap as \"system integration testing\" (verifying assembly, not just correctness). Pre-existing bugs survive refactors by design. Dev environment is part of the product. Error handling without an audience is not error handling.\n4. **Process improvements**: Five concrete changes: smoke test requirements in specs, throw-after-emit rule for two-phase catch blocks, dev startup validation in plans, \"wiring test\" category for cross-boundary integration, integration-level reviewer in delegation guides\n\nAlso added two new critical lessons to CLAUDE.md:\n- Two-phase emit-then-throw rule\n- Spec validation verifies correctness not assembly; plans need smoke tests"
  - timestamp: 2026-03-16T04:48:17.495Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All artifacts read. Drafting the retrospective now."
projectName: memory-loop
---
Wrote retrospective for the ephemeral SDK sessions implementation at `.lore/retros/ephemeral-sdk-sessions.md`.

The retro covers:
1. **What went well**: Plan structure, commission chain execution, Thorne's thorough review, clean event translator design
2. **What went wrong**: Two bugs (emit-to-zero-subscribers in sendMessage catch block, `bun run dev` not starting daemon) and why each survived unit tests, integration tests, and code review
3. **Lessons learned**: Named the gap as "system integration testing" (verifying assembly, not just correctness). Pre-existing bugs survive refactors by design. Dev environment is part of the product. Error handling without an audience is not error handling.
4. **Process improvements**: Five concrete changes: smoke test requirements in specs, throw-after-emit rule for two-phase catch blocks, dev startup validation in plans, "wiring test" category for cross-boundary integration, integration-level reviewer in delegation guides

Also added two new critical lessons to CLAUDE.md:
- Two-phase emit-then-throw rule
- Spec validation verifies correctness not assembly; plans need smoke tests
