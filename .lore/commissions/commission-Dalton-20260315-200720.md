---
title: "Commission: Implement: Ephemeral SDK Sessions Steps 1-3 (translator, prep extraction, resume failure)"
date: 2026-03-16
status: completed
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Task\n\nImplement Steps 1-3 of the ephemeral SDK sessions plan (`.lore/plans/ephemeral-sdk-sessions.md`). Read the full plan before starting.\n\n## Context\n\nThe Think tab is broken due to session management issues. This plan hardens the daemon's SDK session handling. Steps 1-3 are foundational work that the core refactor (Step 4, separate commission) depends on.\n\n## What to Build\n\n### Step 1: Create intermediate event translator\n\n- Define `SdkRunnerEvent` discriminated union in `daemon/src/streaming/types.ts` (see plan for exact types including `compact_boundary`)\n- Create `daemon/src/streaming/event-translator.ts` by porting Guild Hall's `createStreamTranslator()` pattern\n- The translator is a closure: takes `SDKMessage`, returns `SdkRunnerEvent[]`\n- Internal state: `blockToolIds` map and `blockInputChunks` map\n- Follow translation rules in the plan exactly\n- Add `isSessionExpiryError()` to this module\n- Apply ESLint overrides for SDK `.mjs` type declarations (see `.lore/bugs/agent-sdk-mjs-type-declarations.md`)\n\n### Step 2: Extract `prepareTurnOptions()` in session-manager.ts\n\n- Extract the duplicated option assembly from `createSession()` and `resumeSession()` into a single `prepareTurnOptions()` function\n- Interface and implementation shown in plan\n- Export for testing\n- Both callers should use this function after extraction\n\n### Step 3: Improve resume failure detection in session-manager.ts\n\n- Add `RESUME_FAILED` to `SessionError`'s code union\n- Mode 1: SDK exception on resume → detect via `isSessionExpiryError()`, throw `SessionError` with `RESUME_FAILED`\n- Mode 2: Silent session ID mismatch → call `queryResult.close()` then throw `SessionError` with `RESUME_FAILED` (instead of silently adapting)\n- In `active-session-controller.ts`: remove the now-redundant mismatch check in `sendMessage()`, update catch handler to check for `RESUME_FAILED`\n\n## Reference\n\n- `.lore/specs/ephemeral-sdk-sessions.md` - the spec\n- `.lore/plans/ephemeral-sdk-sessions.md` - the full plan with code examples\n- `.lore/retros/discussion-multi-turn-resume.md` - why we don't adapt to mismatched IDs\n- `.lore/bugs/agent-sdk-mjs-type-declarations.md` - ESLint workaround\n\n## Quality Gates\n\n- `bun run typecheck` passes\n- `bun run lint` passes\n- Existing tests pass: `bun run --cwd daemon test` (excluding sandbox tests)\n- `bun run --cwd nextjs build` succeeds\n- No behavioral changes to existing passing tests (these steps are additive/refactor, not behavior-changing except for the resume failure throw in Step 3)\n"
dependencies: []
linked_artifacts:
  - daemon/src/streaming/event-translator.ts

  - daemon/src/streaming/types.ts
  - daemon/src/session-manager.ts
  - daemon/src/streaming/active-session-controller.ts
  - eslint.config.js
  - daemon/src/streaming/types.ts
  - daemon/src/session-manager.ts
  - daemon/src/streaming/active-session-controller.ts
  - eslint.config.js
activity_timeline:
  - timestamp: 2026-03-16T03:07:20.084Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T03:07:20.085Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-16T03:07:20.134Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-16T03:07:29.862Z
    event: progress_report
    reason: "Reading the plan, spec, and referenced documents before starting implementation."
  - timestamp: 2026-03-16T03:08:34.044Z
    event: progress_report
    reason: "Context gathered. Starting Step 1: Create SdkRunnerEvent types and event-translator.ts"
  - timestamp: 2026-03-16T03:11:34.545Z
    event: progress_report
    reason: "All three steps implemented. Running quality gates: typecheck, lint, tests, build."
  - timestamp: 2026-03-16T03:14:33.887Z
    event: result_submitted
    reason: "Implemented Steps 1-3 of the ephemeral SDK sessions plan. All quality gates pass (typecheck, lint, nextjs build, non-sandbox tests).\n\n**Step 1: Intermediate event translator**\n- Added `SdkRunnerEvent` discriminated union and `TurnUsageData` interface to `daemon/src/streaming/types.ts` (9 event types including `compact_boundary`)\n- Created `daemon/src/streaming/event-translator.ts` with `createStreamTranslator()` closure pattern (ported from Guild Hall). Handles all SDK message types: system init, stream_event deltas, content block lifecycle, user tool results, result success/error, compact boundary\n- Added `isSessionExpiryError()` for resume failure detection\n- Added ESLint overrides in root `eslint.config.js` for the SDK `.mjs` type declaration bug\n\n**Step 2: Extract `prepareTurnOptions()`**\n- Created `TurnPrepInput` interface and `prepareTurnOptions()` function in `session-manager.ts`\n- Both `createSession()` and `resumeSession()` now use this single function instead of duplicated ~20 lines of option assembly\n- Exported for testing\n\n**Step 3: Resume failure detection**\n- Added `RESUME_FAILED` to `SessionError`'s code union\n- Mode 1 (SDK exception): catch block in `resumeSession()` now checks `isSessionExpiryError()` and throws `SessionError` with `RESUME_FAILED`\n- Mode 2 (silent mismatch): when SDK returns different session ID, calls `queryResult.close()` then throws `SessionError` with `RESUME_FAILED` instead of silently adapting\n- In `active-session-controller.ts`: removed redundant mismatch check in `sendMessage()`, updated catch handler to detect and propagate `RESUME_FAILED` code"
  - timestamp: 2026-03-16T03:14:40.172Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All three steps implemented. Running quality gates: typecheck, lint, tests, build."
projectName: memory-loop
---
Implemented Steps 1-3 of the ephemeral SDK sessions plan. All quality gates pass (typecheck, lint, nextjs build, non-sandbox tests).

**Step 1: Intermediate event translator**
- Added `SdkRunnerEvent` discriminated union and `TurnUsageData` interface to `daemon/src/streaming/types.ts` (9 event types including `compact_boundary`)
- Created `daemon/src/streaming/event-translator.ts` with `createStreamTranslator()` closure pattern (ported from Guild Hall). Handles all SDK message types: system init, stream_event deltas, content block lifecycle, user tool results, result success/error, compact boundary
- Added `isSessionExpiryError()` for resume failure detection
- Added ESLint overrides in root `eslint.config.js` for the SDK `.mjs` type declaration bug

**Step 2: Extract `prepareTurnOptions()`**
- Created `TurnPrepInput` interface and `prepareTurnOptions()` function in `session-manager.ts`
- Both `createSession()` and `resumeSession()` now use this single function instead of duplicated ~20 lines of option assembly
- Exported for testing

**Step 3: Resume failure detection**
- Added `RESUME_FAILED` to `SessionError`'s code union
- Mode 1 (SDK exception): catch block in `resumeSession()` now checks `isSessionExpiryError()` and throws `SessionError` with `RESUME_FAILED`
- Mode 2 (silent mismatch): when SDK returns different session ID, calls `queryResult.close()` then throws `SessionError` with `RESUME_FAILED` instead of silently adapting
- In `active-session-controller.ts`: removed redundant mismatch check in `sendMessage()`, updated catch handler to detect and propagate `RESUME_FAILED` code
