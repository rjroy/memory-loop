---
title: "Commission: Fix: sendMessage swallows SDK creation errors (emit to zero subscribers)"
date: 2026-03-16
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Task\n\nFix a critical bug in `daemon/src/streaming/active-session-controller.ts` where SDK creation/resume errors are swallowed and never reach the user.\n\n## The Bug\n\nIn `sendMessage()` (line ~630-641), when `sdkCreateSession()` or `sdkResumeSession()` throws, the catch block:\n1. Emits an error event to subscribers\n2. Does NOT rethrow\n\nThe problem: there are **never** subscribers at this point. The two-phase chat architecture is sequential: POST creates the session, then SSE observes it. The SSE hasn't connected when `sendMessage` runs. So the emit goes to zero listeners and the error is lost.\n\nThe POST handler (`daemon/src/routes/session/send.ts`) sees no error, returns `{ sessionId: null }` as 200 OK. The frontend connects to SSE, gets a snapshot with `isProcessing: false`, and the stream closes immediately. The user sees nothing.\n\n## The Fix\n\nIn `sendMessage()`'s catch block, **rethrow the error** after emitting (keep the emit for defense-in-depth in case there are ever subscribers, but the rethrow is what makes the POST return an HTTP error).\n\n```typescript\n} catch (err) {\n    log.error(\"sendMessage failed\", err);\n    const code =\n      err instanceof SessionError && err.code === \"RESUME_FAILED\"\n        ? \"RESUME_FAILED\"\n        : \"SDK_ERROR\";\n    emit({\n      type: \"error\",\n      code,\n      message: err instanceof Error ? err.message : \"Failed to send message\",\n    });\n    throw err; // Re-throw so POST handler returns HTTP error\n}\n```\n\nThe `chatSendHandler` already has error handling at lines 68-85 that returns appropriate HTTP status codes. The `AlreadyProcessingError` check runs before `sendMessage`'s try block, so it won't interfere. The generic catch at line 76 will handle SDK errors and return 500.\n\n## Also Check\n\n- Verify `chatSendHandler`'s existing catch block handles the rethrown error correctly (it should - SessionError extends Error)\n- Verify the frontend's `useChat.ts` handles non-200 POST responses (it does, at line 342-354)\n- Update any tests in `active-session-controller.test.ts` that mock `sendMessage` errors - they may need to expect throws now instead of just emitted events\n\n## Quality Gates\n\n- `bun run typecheck` passes\n- `bun run lint` passes\n- `bun run --cwd daemon test` passes (excluding sandbox)\n- `bun run --cwd nextjs build` succeeds\n"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T04:19:49.092Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T04:19:49.094Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
