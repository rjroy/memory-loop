---
title: "Commission: Implement Stage 4: Background Schedulers Migration"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 4 of the daemon migration: Background Schedulers.\n\n## Plan\n\nFollow `.lore/plans/daemon-background-schedulers.md` exactly. This plan has been updated with all findings from Thorne's reviews.\n\n## Context\n\nStages 1-3 are complete and reviewed:\n- Stage 1: Daemon skeleton + shared package\n- Stage 2: Vault foundation\n- Stage 3: Stateless file operations (includes daemon-fetch, file-client, all file routes)\n- Stage 3 fixes: Path traversal security fix, dead code removal\n\nThe daemon-fetch pattern in `nextjs/lib/daemon-fetch.ts` is the established connection layer. Use it for any new client facades.\n\n## Key references\n\n- Plan: `.lore/plans/daemon-background-schedulers.md`\n- Spec: `.lore/specs/daemon-application-boundary.md`\n- Current daemon code: `daemon/src/`\n- Current nextjs schedulers: `nextjs/lib/extraction/`, `nextjs/lib/spaced-repetition/`\n- Prior commissions for patterns: `.lore/commissions/commission-Dalton-20260315-090142.md` (Stage 3)\n\n## Quality gates\n\nAll must pass before declaring complete:\n- `bun run typecheck`\n- `bun run lint`\n- `bun run test` (ALL packages, run sequentially)\n- `bun run --cwd nextjs build`\n\n## Constraints\n\n- Do not skip tests. Every new module needs tests.\n- Follow the step ordering in the plan. Don't skip ahead.\n- If something in the plan doesn't match reality, note it and adapt (reality wins over plan), but document what diverged.\n- Run quality gates at each major step boundary, not just at the end."
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T19:08:25.031Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T19:08:25.034Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
