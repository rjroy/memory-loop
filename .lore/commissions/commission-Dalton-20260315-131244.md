---
title: "Commission: Implement Stage 5: Session Lifecycle & Chat Migration"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 5 of the daemon migration: Session Lifecycle & Chat.\n\n## Plan\n\nFollow `.lore/plans/daemon-session-lifecycle-chat.md` exactly. This plan has been updated with all findings from Thorne's reviews across Stages 1-4.\n\n## Context\n\nStages 1-4 are complete and reviewed:\n- Stage 1: Daemon skeleton + shared package\n- Stage 2: Vault foundation\n- Stage 3: Stateless file operations (daemon-fetch, file-client, all file routes)\n- Stage 4: Background schedulers (extraction, card discovery migrated to daemon)\n\nThis is the most complex stage. It migrates session management, the Claude Agent SDK orchestration, and SSE streaming to the daemon. The key technical challenge is Hono's SSE API for the chat stream.\n\n## Key references\n\n- Plan: `.lore/plans/daemon-session-lifecycle-chat.md`\n- Spec: `.lore/specs/daemon-application-boundary.md`\n- Current daemon code: `daemon/src/`\n- Current session modules: `nextjs/lib/session-manager.ts`, `nextjs/lib/streaming/`, `nextjs/lib/controller.ts`\n- daemon-fetch pattern: `nextjs/lib/daemon-fetch.ts`\n- Hono SSE docs: Use Hono's built-in SSE helper (`hono/streaming`) for the chat stream endpoint\n- Prior Stage 4 commission: `.lore/commissions/commission-Dalton-20260315-120825.md`\n\n## Critical points from plan updates\n\n- session-client must use daemon-fetch (not invent DAEMON_URL)\n- SSE streaming must use Hono's SSE API (this was the original reason for the Hono conversion)\n- Latency tests should use ordering + 1s threshold (not 100ms)\n- The two-phase chat pattern (POST submit, GET stream) must be preserved\n\n## Quality gates\n\nAll must pass before declaring complete:\n- `bun run typecheck`\n- `bun run lint`\n- `bun run test` (ALL packages, run sequentially)\n- `bun run --cwd nextjs build`\n\n## Constraints\n\n- Do not skip tests. Every new module needs tests.\n- Follow the step ordering in the plan. Don't skip ahead.\n- If something in the plan doesn't match reality, note it and adapt (reality wins over plan), but document what diverged.\n- Run quality gates at each major step boundary, not just at the end."
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T20:12:44.332Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T20:12:44.335Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
