---
title: "Commission: Fix: Stage 5 review findings (build failure, test failures, cleanup)"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix all five findings from Thorne's Stage 5 review.\n\n## Findings to fix\n\n### Blockers (quality gates don't pass)\n\n1. **Next.js build fails**: `nextjs/lib/session-client.ts` line 36 casts Error to `Record<string, unknown>`, which strict build rejects. Fix the type cast to satisfy strict mode.\n\n2. **Daemon tests fail**: `zod` is not declared in `daemon/package.json` dependencies, blocking all route-dependent tests. Add zod as a dependency.\n\n### Additional fixes\n\n3. **Wrong field in test assertion**: `daemon/src/__tests__/chat-routes.test.ts` asserts `body.isProcessing` but the `getState()` endpoint returns `isStreaming`. Fix the assertion to match the actual response field.\n\n4. **Duplicate singleton management**: `daemon/src/streaming/active-session-controller.ts` retains its own `getActiveSessionController`/`resetActiveSessionController` alongside `daemon/src/session-controller.ts`. Consolidate to a single singleton pattern. Remove the duplicate.\n\n5. **Two planned tests missing**: Write the SSE event ordering test (`sse-proxy.test.ts`) and mock-mode end-to-end test (`mock-mode.test.ts`) that were specified in the plan but not implemented.\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-135330.md`\n- Dalton's Stage 5 implementation: `.lore/commissions/commission-Dalton-20260315-131244.md`\n- Plan: `.lore/plans/daemon-session-lifecycle-chat.md`\n\n## Quality gates\n\nAll must pass before declaring complete:\n- `bun run typecheck`\n- `bun run lint`\n- `bun run test` (ALL packages, run sequentially)\n- `bun run --cwd nextjs build`"
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T21:09:35.439Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T21:09:35.441Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
