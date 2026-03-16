---
title: "Commission: Implement: Ephemeral SDK Sessions Steps 1-3 (translator, prep extraction, resume failure)"
date: 2026-03-16
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Task\n\nImplement Steps 1-3 of the ephemeral SDK sessions plan (`.lore/plans/ephemeral-sdk-sessions.md`). Read the full plan before starting.\n\n## Context\n\nThe Think tab is broken due to session management issues. This plan hardens the daemon's SDK session handling. Steps 1-3 are foundational work that the core refactor (Step 4, separate commission) depends on.\n\n## What to Build\n\n### Step 1: Create intermediate event translator\n\n- Define `SdkRunnerEvent` discriminated union in `daemon/src/streaming/types.ts` (see plan for exact types including `compact_boundary`)\n- Create `daemon/src/streaming/event-translator.ts` by porting Guild Hall's `createStreamTranslator()` pattern\n- The translator is a closure: takes `SDKMessage`, returns `SdkRunnerEvent[]`\n- Internal state: `blockToolIds` map and `blockInputChunks` map\n- Follow translation rules in the plan exactly\n- Add `isSessionExpiryError()` to this module\n- Apply ESLint overrides for SDK `.mjs` type declarations (see `.lore/bugs/agent-sdk-mjs-type-declarations.md`)\n\n### Step 2: Extract `prepareTurnOptions()` in session-manager.ts\n\n- Extract the duplicated option assembly from `createSession()` and `resumeSession()` into a single `prepareTurnOptions()` function\n- Interface and implementation shown in plan\n- Export for testing\n- Both callers should use this function after extraction\n\n### Step 3: Improve resume failure detection in session-manager.ts\n\n- Add `RESUME_FAILED` to `SessionError`'s code union\n- Mode 1: SDK exception on resume → detect via `isSessionExpiryError()`, throw `SessionError` with `RESUME_FAILED`\n- Mode 2: Silent session ID mismatch → call `queryResult.close()` then throw `SessionError` with `RESUME_FAILED` (instead of silently adapting)\n- In `active-session-controller.ts`: remove the now-redundant mismatch check in `sendMessage()`, update catch handler to check for `RESUME_FAILED`\n\n## Reference\n\n- `.lore/specs/ephemeral-sdk-sessions.md` - the spec\n- `.lore/plans/ephemeral-sdk-sessions.md` - the full plan with code examples\n- `.lore/retros/discussion-multi-turn-resume.md` - why we don't adapt to mismatched IDs\n- `.lore/bugs/agent-sdk-mjs-type-declarations.md` - ESLint workaround\n\n## Quality Gates\n\n- `bun run typecheck` passes\n- `bun run lint` passes\n- Existing tests pass: `bun run --cwd daemon test` (excluding sandbox tests)\n- `bun run --cwd nextjs build` succeeds\n- No behavioral changes to existing passing tests (these steps are additive/refactor, not behavior-changing except for the resume failure throw in Step 3)\n"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T03:07:20.084Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T03:07:20.085Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
