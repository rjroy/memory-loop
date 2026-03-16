---
title: "Commission: Test: Ephemeral SDK Sessions Step 6 (full test suite)"
date: 2026-03-16
status: blocked
type: one-shot
tags: [commission]
worker: Sable
workerDisplayTitle: "Guild Breaker"
prompt: "## Task\n\nImplement Step 6 of the ephemeral SDK sessions plan (`.lore/plans/ephemeral-sdk-sessions.md`). Read the full plan before starting. Steps 1-5 are complete; your job is to write comprehensive tests and fix anything that breaks.\n\n## Context\n\nThe daemon's SDK session handling was refactored: a new event translator separates SDK events from domain events, `prepareTurnOptions()` consolidates option assembly, resume failures are loud instead of silent, the controller now owns the streaming loop (session-streamer.ts was deleted), and abort/crash during pending prompts are handled distinctly.\n\n## What to Test\n\n### Unit Tests\n\n1. **event-translator.test.ts** (new file in `daemon/src/streaming/__tests__/`):\n   - `system` init → `session` event with session ID\n   - `stream_event` text_delta → `text_delta` event\n   - `stream_event` content_block_start (tool_use) + deltas + stop → `tool_use` then `tool_input`\n   - `result` success → `turn_end` with cost\n   - `result` error → `error` event\n   - `assistant` message → empty (ignored)\n   - Unknown message type → empty\n   - `isSessionExpiryError()` matches known SDK error strings\n   - `compact_boundary` → correct intermediate event\n\n2. **session-manager.test.ts** (update existing):\n   - `prepareTurnOptions()`: given vault path and optional resume ID, returns correct options\n   - `prepareTurnOptions()` with different vault configs (different models)\n   - Resume failure mode 1: SDK throws session expiry → `RESUME_FAILED` error code\n   - Resume failure mode 2: SDK returns different session ID → `RESUME_FAILED` error code, `queryResult.close()` called\n\n3. **active-session-controller.test.ts** (update existing):\n   - Abort during pending prompt → `aborted` event emitted (not `error`)\n   - Subprocess crash during pending prompt → `error` event, pending prompts cleared\n   - Between-turns state: after processing, only sessionId/vaultId/tokens held\n   - Intermediate event processing: each `SdkRunnerEvent` type correctly maps to `SessionEvent`\n\n### Integration Tests\n\n4. **Multi-turn resume**: Send message, get response, send follow-up with resume, verify same session ID. Verify resume failure emits `RESUME_FAILED`.\n\n5. **Abort during prompt**: Trigger tool permission request (mock SDK that invokes `canUseTool`), abort while pending, verify `aborted` event and session remains resumable.\n\n6. **Subprocess cleanup**: Send message, wait for completion, verify `queryResult` is null and no subprocess references remain.\n\n## Testing Constraints\n\n- Use `bun test` (not jest)\n- **Do not use `mock.module()`** - use dependency injection\n- Use `configureDaemonFetchForTesting` for daemon client mocks\n- Use fake timers where appropriate (see CLAUDE.md for pattern)\n- Tests cannot run in parallel (filesystem contention)\n\n## Quality Gates\n\n- All new tests pass\n- All existing tests still pass: `bun run --cwd daemon test` (excluding sandbox)\n- `bun run typecheck` passes\n- `bun run lint` passes\n- If you find bugs during testing, fix them. That's your job.\n"
dependencies:
  - commission-Dalton-20260315-200741
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T03:07:57.508Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T03:07:57.510Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: memory-loop
---
