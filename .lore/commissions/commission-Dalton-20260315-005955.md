---
title: "Commission: Implement: Stage 1 - Daemon Skeleton and Shared Package"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 1 of the daemon migration following the plan at `.lore/plans/daemon-skeleton-shared-package.md`.\n\nThis is the bootstrap stage. You are creating the monorepo workspace structure, extracting schemas and logger into a shared package, and building the daemon process skeleton.\n\nRead the plan thoroughly before starting. It has 8 steps with specific file moves, decisions, and verification criteria. Follow them in order.\n\nKey references:\n- `.lore/plans/daemon-skeleton-shared-package.md` (the plan, follow it exactly)\n- `.lore/specs/daemon-application-boundary.md` (the spec, for requirement context)\n- `.lore/research/daemon-rest-api.md` (API conventions to adapt for the daemon)\n- `.lore/retros/collapse-workspaces.md` (lessons from the last workspace restructure)\n\nImportant notes:\n- Use `git mv` to preserve file history when moving schemas and logger\n- Run the grep-first approach before bulk import rewrites (Step 3)\n- Test both `bun run --cwd nextjs dev` AND `bun run --cwd nextjs build` after import rewrites (turbopack vs webpack)\n- The health endpoint response shape is the contract, placeholder values are fine\n- Verify Bun.serve() + Hono + Unix socket works early in Step 5\n\nAcceptance criteria from the plan:\n1. Three packages: packages/shared, nextjs, daemon\n2. @memory-loop/shared contains all Zod schemas and the logger\n3. No file in nextjs/ imports from @/lib/schemas or @/lib/logger\n4. Daemon listens on Unix socket, responds to GET /health and GET /help\n5. All existing tests pass from new locations\n6. Root-level typecheck, lint, test, and build scripts cover all packages\n7. bun run --cwd nextjs dev works (turbopack verified)"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T07:59:55.718Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T07:59:55.722Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
