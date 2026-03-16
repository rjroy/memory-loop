---
title: "Commission: Review: Ephemeral SDK Sessions Step 7 (spec validation)"
date: 2026-03-16
status: dispatched
type: one-shot
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "## Task\n\nPerform Step 7 of the ephemeral SDK sessions plan (`.lore/plans/ephemeral-sdk-sessions.md`). This is a spec validation review. All implementation and tests are complete.\n\n## What to Validate\n\nRead `.lore/specs/ephemeral-sdk-sessions.md` and verify every REQ-ESS requirement is met in the implementation. Specific checks:\n\n- **REQ-ESS-1**: Per-turn subprocess (no long-lived SDK session)\n- **REQ-ESS-2**: Resume via SDK session ID\n- **REQ-ESS-3**: Resume failure emits `RESUME_FAILED`, not generic error\n- **REQ-ESS-4**: SDK events go through intermediate schema before SSE\n- **REQ-ESS-5**: Intermediate event types match spec\n- **REQ-ESS-6**: `input_json_delta` chunks accumulated, single `tool_input` emitted\n- **REQ-ESS-7/8/9**: Pending prompts work within per-turn subprocess, appear in snapshot, resolution continues processing\n- **REQ-ESS-10**: Subprocess crash during pending prompt → error event + prompt cleared\n- **REQ-ESS-11**: Controller state matches spec\n- **REQ-ESS-12**: Between-turns state is minimal (sessionId, vaultId, cumulative tokens)\n- **REQ-ESS-13**: Cumulative token tracking preserved\n- **REQ-ESS-14/15/16**: Two-phase chat, snapshot-on-connect, fire-and-forget all preserved\n- **REQ-ESS-17/18**: Session metadata persistence unchanged\n- **REQ-ESS-19**: Abort during pending prompt → `aborted` event (not `error`)\n- **REQ-ESS-20/21**: Single `prepareTurnOptions()` function used by both create and resume\n\nAlso verify all server-driven-chat guarantees (`.lore/specs/server-driven-chat.md`, REQ-SDC-1 through REQ-SDC-18) are preserved unchanged.\n\n## Key Files to Examine\n\n- `daemon/src/streaming/event-translator.ts` (new)\n- `daemon/src/streaming/types.ts` (updated)\n- `daemon/src/session-manager.ts` (updated)\n- `daemon/src/streaming/active-session-controller.ts` (refactored)\n- `packages/shared/src/session-types.ts` (new `aborted` event type)\n- Verify `session-streamer.ts` is deleted\n\n## Also Check\n\n- No silent error swallowing (use `silent-failure-hunter` approach)\n- ESLint overrides applied correctly for SDK `.mjs` types\n- Test coverage on new code\n- No orphaned imports to deleted `session-streamer.ts`\n\n## Output\n\nWrite findings to `.lore/reviews/ephemeral-sdk-sessions-review.md` with:\n- Per-requirement pass/fail with evidence (file:line)\n- Any findings ranked by severity\n- Explicit statement of whether the implementation is ready to ship\n"
dependencies:
  - commission-Sable-20260315-200757
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T03:08:14.684Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T03:08:14.685Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-03-16T03:29:12.249Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-03-16T03:29:12.252Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
