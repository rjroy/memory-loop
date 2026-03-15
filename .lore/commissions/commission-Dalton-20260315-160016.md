---
title: "Commission: Fix: Stage 6 asset route boundary violation and stale import"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Fix two findings from Thorne's Stage 6 review.\n\n## Findings to fix\n\n### 1. Asset route bypasses daemon boundary (boundary violation)\n\n`nextjs/app/vault/[vaultId]/assets/[...path]/route.ts` reads files directly from the filesystem via `node:fs/promises` instead of proxying to the daemon. This is the only route that bypasses the daemon boundary.\n\nFix: Create a daemon route for serving vault assets, then convert the Next.js asset route to proxy through the daemon like all other routes. Also remove `isPathWithinVault` and `validatePath` from `lib/daemon/files.ts` if they're only consumed by this route (move the validation logic to the daemon side).\n\n### 2. Stale import path in test-daemon-helpers.ts\n\n`nextjs/test-daemon-helpers.ts` has a stale import path. Fix it.\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-154154.md`\n- Spec boundary requirements: `.lore/specs/daemon-application-boundary.md` (REQ-DAB-4: no nextjs direct filesystem access)\n\n## Quality gates\n\nAll must pass before declaring complete:\n- `bun run typecheck`\n- `bun run lint`\n- `bun run test` (ALL packages, run sequentially)\n- `bun run --cwd nextjs build`"
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T23:00:16.969Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T23:00:16.970Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
