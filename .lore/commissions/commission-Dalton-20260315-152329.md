---
title: "Commission: Implement Stage 6: Web App Conversion"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 6 of the daemon migration: Web App Conversion.\n\n## Plan\n\nFollow `.lore/plans/daemon-web-app-conversion.md` exactly. This plan has been updated with all findings from Thorne's reviews across Stages 1-5.\n\n## Context\n\nStages 1-5 are complete and reviewed:\n- Stage 1: Daemon skeleton + shared package\n- Stage 2: Vault foundation\n- Stage 3: Stateless file operations (daemon-fetch, file-client, all file routes)\n- Stage 4: Background schedulers (extraction, card discovery migrated to daemon)\n- Stage 5: Session lifecycle & chat (session management, SDK orchestration, SSE streaming via Hono)\n\nThis is the final stage. The Next.js app should now be a pure frontend: all domain logic, SDK calls, and filesystem access happen through the daemon. Next.js becomes a thin proxy layer and React UI.\n\n## Key references\n\n- Plan: `.lore/plans/daemon-web-app-conversion.md`\n- Spec: `.lore/specs/daemon-application-boundary.md`\n- Current daemon code: `daemon/src/`\n- Current nextjs code: `nextjs/`\n- Client facades: `nextjs/lib/vault-client.ts`, `nextjs/lib/file-client.ts`, `nextjs/lib/session-client.ts`\n- daemon-fetch: `nextjs/lib/daemon-fetch.ts`\n- Prior Stage 5 commission: `.lore/commissions/commission-Dalton-20260315-131244.md`\n\n## Quality gates\n\nAll must pass before declaring complete:\n- `bun run typecheck`\n- `bun run lint`\n- `bun run test` (ALL packages, run sequentially)\n- `bun run --cwd nextjs build`\n\n## Constraints\n\n- Do not skip tests. Every new module needs tests.\n- Follow the step ordering in the plan. Don't skip ahead.\n- If something in the plan doesn't match reality, note it and adapt (reality wins over plan), but document what diverged.\n- Run quality gates at each major step boundary, not just at the end."
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T22:23:29.122Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T22:23:29.123Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
