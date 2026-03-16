---
title: "Commission: Implement: Ephemeral SDK Sessions Steps 4-5 (controller refactor, abort/crash handling)"
date: 2026-03-16
status: blocked
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Task\n\nImplement Steps 4-5 of the ephemeral SDK sessions plan (`.lore/plans/ephemeral-sdk-sessions.md`). Read the full plan before starting. This depends on Steps 1-3 being complete (event translator, prepareTurnOptions, resume failure detection).\n\n## Context\n\nSteps 1-3 created the event translator and foundational pieces. This commission is the core refactor: make the controller consume intermediate events instead of raw SDK events, and handle abort/crash during pending prompts correctly.\n\n## What to Build\n\n### Step 4: Refactor controller to use intermediate events\n\n- In `active-session-controller.ts`, replace the `startStreamSdkEvents()` call with an inline loop that uses `createStreamTranslator()`\n- The controller owns the `for await` loop over `result.events`, translates each SDK message, and processes the resulting `SdkRunnerEvent[]`\n- Map each intermediate event type to the appropriate `SessionEvent` emission (see plan for full mapping)\n- Move snapshot accumulation (content chunks, tool invocations, context usage) from session-streamer into the controller's streaming scope\n- **Delete `session-streamer.ts` entirely** - no external consumers, all logic subsumed by translator + controller\n- Remove from barrel exports if present\n- Between-turns state: after `runStreaming()` completes, only hold sessionId, vaultId, vaultPath, streamerState (cumulative tokens), slashCommands, subscribers\n- Pending prompts (REQ-ESS-7/8/9): unchanged, `canUseTool` blocking pattern works the same\n\n**Important note on event flow:** `result.events` was already advanced once by `extractSessionId()` in session-manager.ts, then re-wrapped via `wrapGenerator()`. The translator will produce a `session` event for the first message; the controller can ignore it since sessionId is already known.\n\n### Step 5: Handle abort and crash during pending prompts\n\n- Add `{ type: \"aborted\" }` to `SessionEvent` union in `packages/shared/src/session-types.ts`\n- **Abort during pending prompt (REQ-ESS-19):** When `abortProcessing()` is called with pending prompts, emit `aborted` (not `error`). See plan for implementation.\n- **Subprocess crash during pending prompt (REQ-ESS-10):** In the `catch` block of `runStreaming()`, detect pending prompts, clear them, emit `error` with descriptive message so user doesn't see a hung form.\n- Update `useChat.ts` SSE handler to recognize `aborted` as a terminal event (same as `response_end`, not an error)\n- Update SSE stream route to close on `aborted`\n\n## Reference\n\n- `.lore/plans/ephemeral-sdk-sessions.md` - full plan with code examples for Steps 4 and 5\n- `.lore/specs/ephemeral-sdk-sessions.md` - spec with all REQ-ESS requirements\n- `.lore/specs/server-driven-chat.md` - two-phase chat contract (must be preserved)\n- Guild Hall's `event-translator.ts` for the proven pattern\n\n## Quality Gates\n\n- `bun run typecheck` passes\n- `bun run lint` passes  \n- Existing tests pass: `bun run --cwd daemon test` (excluding sandbox tests)\n- `bun run --cwd nextjs build` succeeds\n- `session-streamer.ts` is deleted and no imports reference it\n- Snapshot-on-connect still works (controller's `getSnapshot()` returns accumulated state)\n"
dependencies:
  - commission-Dalton-20260315-200720
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T03:07:41.482Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T03:07:41.484Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: memory-loop
---
