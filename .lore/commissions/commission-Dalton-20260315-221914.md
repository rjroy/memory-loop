---
title: "Commission: Fix streaming indicator not clearing when agent finishes"
date: 2026-03-16
status: completed
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Bug: Streaming animated image stays after agent finishes responding\n\n### Symptom\nOn the Think tab, when the user sends a message, an animated image shows as a thinking indicator and the send button becomes cancel. When the agent finishes, the cancel button reverts to send but the animated image stays permanently.\n\nThe animated image is rendered in `nextjs/components/discussion/MessageBubble.tsx:162-167` when `message.isStreaming` is true. The button is controlled by `isSubmitting` state in `nextjs/components/discussion/Discussion.tsx`. The button resets because `onStreamEnd` fires when the SSE connection closes, but `message.isStreaming` stays true because `response_end` never reaches the client reducer.\n\n### Root Cause\n\nIn `daemon/src/routes/session/stream.ts:52-72`, the subscriber callback has a race condition:\n\n```typescript\nconst unsubscribe = controller.subscribe((event) => {\n  if (cleaned) return;\n\n  stream.writeSSE({                    // ← async, returns Promise\n    data: JSON.stringify(event),\n  }).catch(() => {\n    cleanup();\n  });\n\n  // Close stream on terminal events\n  if (\n    event.type === \"response_end\" ||   // ← terminal\n    event.type === \"error\" ||\n    event.type === \"aborted\" ||\n    event.type === \"session_cleared\"\n  ) {\n    cleanup();                          // ← called synchronously BEFORE write completes\n  }\n});\n```\n\n`stream.writeSSE()` starts an async write but `cleanup()` is called synchronously immediately after. `cleanup()` resolves the wait promise at line 93-97, which causes the `streamSSE` callback to return. Hono closes the SSE connection before the terminal event data is flushed to the client.\n\nAdditionally, `aborted` is a terminal event (line 67). In `daemon/src/streaming/active-session-controller.ts`, when the SDK emits an `aborted` event during the for-of loop (line 473-474), it's emitted to subscribers. The stream handler receives it, starts writing, calls cleanup. Then after the for-of loop exits, `response_end` is emitted at line 483, but the subscriber's `cleaned` flag is already true (line 54), so `response_end` is silently dropped.\n\n### Required Changes\n\n#### Fix 1: Daemon stream handler (root cause)\n\nIn `daemon/src/routes/session/stream.ts`, for terminal events, ensure the write completes before calling cleanup:\n\n```typescript\nconst unsubscribe = controller.subscribe((event) => {\n  if (cleaned) return;\n\n  const isTerminal =\n    event.type === \"response_end\" ||\n    event.type === \"error\" ||\n    event.type === \"aborted\" ||\n    event.type === \"session_cleared\";\n\n  const writePromise = stream.writeSSE({\n    data: JSON.stringify(event),\n  });\n\n  if (isTerminal) {\n    // Await the write so the client receives the terminal event before the stream closes\n    writePromise.then(() => cleanup()).catch(() => cleanup());\n  } else {\n    writePromise.catch(() => cleanup());\n  }\n});\n```\n\n#### Fix 2: Client safety net (defensive)\n\nEven with Fix 1, network issues or other edge cases could cause `response_end` to be lost. Add a safety net that clears `isStreaming` when the SSE stream ends.\n\n1. **Add `FINALIZE_STREAMING` action to the reducer** in `nextjs/contexts/session/reducer.ts`:\n   - Add to `SessionAction` union: `| { type: \"FINALIZE_STREAMING\" }`\n   - Add handler function that finds any message with `isStreaming: true` and sets it to `false`\n   - Add case in the switch\n\n2. **Add `finalizeStreaming` callback** in `nextjs/contexts/SessionContext.tsx`:\n   - Add `const finalizeStreaming = useCallback(() => { dispatch({ type: \"FINALIZE_STREAMING\" }); }, []);`\n   - Export it from the context\n\n3. **Call `finalizeStreaming` from Discussion's `onStreamEnd`** in `nextjs/components/discussion/Discussion.tsx`:\n   - Get `finalizeStreaming` from `useSession()`\n   - Change `onStreamEnd: () => setIsSubmitting(false)` to also call `finalizeStreaming()`\n\n### Testing\n\n- The existing test file `nextjs/contexts/session/__tests__/reducer-streaming.test.ts` covers streaming reducer actions. Add tests for FINALIZE_STREAMING there.\n- Update `nextjs/components/discussion/__tests__/Discussion.test.tsx` if it tests the onStreamEnd behavior.\n- The daemon stream handler test (if it exists) should verify terminal events are written before cleanup.\n\n### Files to modify\n- `daemon/src/routes/session/stream.ts` (Fix 1)\n- `nextjs/contexts/session/reducer.ts` (Fix 2: action type, handler, case)\n- `nextjs/contexts/SessionContext.tsx` (Fix 2: finalizeStreaming callback + export)\n- `nextjs/components/discussion/Discussion.tsx` (Fix 2: call finalizeStreaming in onStreamEnd)\n- `nextjs/contexts/session/__tests__/reducer-streaming.test.ts` (tests for FINALIZE_STREAMING)\n"
dependencies: []
linked_artifacts:
  - daemon/src/routes/session/stream.ts

  - nextjs/contexts/session/reducer.ts
  - nextjs/contexts/session/types.ts
  - nextjs/contexts/SessionContext.tsx
  - nextjs/components/discussion/Discussion.tsx
  - nextjs/contexts/session/__tests__/reducer-streaming.test.ts
  - nextjs/contexts/session/reducer.ts
  - nextjs/contexts/session/types.ts
  - nextjs/contexts/SessionContext.tsx
  - nextjs/components/discussion/Discussion.tsx
  - nextjs/contexts/session/__tests__/reducer-streaming.test.ts
activity_timeline:
  - timestamp: 2026-03-16T05:19:14.320Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T05:19:14.322Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-16T05:19:14.369Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-16T05:19:30.317Z
    event: progress_report
    reason: "Starting bug fix for streaming animated image persistence. Reading all files to modify."
  - timestamp: 2026-03-16T05:20:11.338Z
    event: progress_report
    reason: "Read all target files. Implementing Fix 1 (daemon stream handler) and Fix 2 (client safety net) now."
  - timestamp: 2026-03-16T05:24:04.867Z
    event: result_submitted
    reason: "Fixed streaming animated image persistence bug. Two changes:\n\n**Fix 1 - Daemon stream handler** (`daemon/src/routes/session/stream.ts`): The subscriber callback called `cleanup()` synchronously after starting an async `writeSSE()` for terminal events. This closed the SSE connection before the terminal event (especially `response_end`) was flushed to the client. Now terminal events chain cleanup after the write promise resolves: `writePromise.then(() => cleanup()).catch(() => cleanup())`.\n\n**Fix 2 - Client safety net** (3 files): Added `FINALIZE_STREAMING` reducer action as a defensive fallback. When the SSE stream closes (`onStreamEnd`), it clears `isStreaming` on any message that still has it set. This handles edge cases where `response_end` is lost due to network issues.\n\n- `nextjs/contexts/session/reducer.ts`: Added `FINALIZE_STREAMING` action type, `handleFinalizeStreaming` handler, and switch case\n- `nextjs/contexts/session/types.ts`: Added `finalizeStreaming` to `SessionContextValue` interface\n- `nextjs/contexts/SessionContext.tsx`: Added `finalizeStreaming` callback and exported it in value\n- `nextjs/components/discussion/Discussion.tsx`: Calls `finalizeStreaming()` alongside `setIsSubmitting(false)` in `onStreamEnd`\n\n**Tests**: 4 new tests in `reducer-streaming.test.ts` covering FINALIZE_STREAMING: clears streaming flag, no-ops when nothing is streaming, no-ops on empty messages, handles empty-content streaming messages.\n\n**Verification**: 1977 nextjs tests pass (0 fail), typecheck clean across all 4 packages, build passes. Daemon integration tests fail pre-existing (sandbox `/tmp/claude` read-only filesystem issue, unrelated to changes)."
  - timestamp: 2026-03-16T05:24:08.262Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read all target files. Implementing Fix 1 (daemon stream handler) and Fix 2 (client safety net) now."
projectName: memory-loop
---
Fixed streaming animated image persistence bug. Two changes:

**Fix 1 - Daemon stream handler** (`daemon/src/routes/session/stream.ts`): The subscriber callback called `cleanup()` synchronously after starting an async `writeSSE()` for terminal events. This closed the SSE connection before the terminal event (especially `response_end`) was flushed to the client. Now terminal events chain cleanup after the write promise resolves: `writePromise.then(() => cleanup()).catch(() => cleanup())`.

**Fix 2 - Client safety net** (3 files): Added `FINALIZE_STREAMING` reducer action as a defensive fallback. When the SSE stream closes (`onStreamEnd`), it clears `isStreaming` on any message that still has it set. This handles edge cases where `response_end` is lost due to network issues.

- `nextjs/contexts/session/reducer.ts`: Added `FINALIZE_STREAMING` action type, `handleFinalizeStreaming` handler, and switch case
- `nextjs/contexts/session/types.ts`: Added `finalizeStreaming` to `SessionContextValue` interface
- `nextjs/contexts/SessionContext.tsx`: Added `finalizeStreaming` callback and exported it in value
- `nextjs/components/discussion/Discussion.tsx`: Calls `finalizeStreaming()` alongside `setIsSubmitting(false)` in `onStreamEnd`

**Tests**: 4 new tests in `reducer-streaming.test.ts` covering FINALIZE_STREAMING: clears streaming flag, no-ops when nothing is streaming, no-ops on empty messages, handles empty-content streaming messages.

**Verification**: 1977 nextjs tests pass (0 fail), typecheck clean across all 4 packages, build passes. Daemon integration tests fail pre-existing (sandbox `/tmp/claude` read-only filesystem issue, unrelated to changes).
