---
title: "Commission: Brainstorm: daemon boundary migration stages"
date: 2026-03-15
status: completed
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/specs/daemon-application-boundary.md` thoroughly. This spec describes a major architectural refactor for Memory Loop: extracting domain logic from Next.js into a standalone daemon, with web app and CLI as clients.\n\n**Your task:** Brainstorm how to break this migration into discrete stages that can each become their own plan. Use `/lore-development:brainstorm` for this.\n\n**Key constraints:**\n- The full migration is too large for a single plan. We need stages that are each a reasonably scoped unit of work.\n- Stages do NOT need to produce a runnable system between them. The goal is containment: knowing exactly what each stage touches and why.\n- Each stage should be plannable on its own. Someone should be able to read one stage description and produce a plan without needing to hold the full migration in their head.\n- Think about natural seams in the work: what can be extracted independently, what has ordering dependencies, where are the risk concentrations.\n\n**What to produce:**\n- A brainstorm artifact (`.lore/brainstorm/daemon-migration-stages.md`) that identifies the stages, describes what each one covers, and notes dependencies between them.\n- For each stage: what moves, what it depends on, what it enables, and roughly how big it is relative to the others.\n- Flag any areas where the staging order isn't obvious and there are tradeoffs to consider.\n\nAlso study the existing codebase (CLAUDE.md, `nextjs/lib/`, API routes) so the stages are grounded in what actually exists, not just what the spec describes abstractly."
dependencies: []
linked_artifacts:
  - .lore/brainstorm/daemon-migration-stages.md

activity_timeline:
  - timestamp: 2026-03-15T02:28:12.086Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T02:28:12.088Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-03-15T02:28:12.139Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-15T02:28:18.975Z
    event: progress_report
    reason: "Reading the daemon-application-boundary spec and studying codebase structure before brainstorming migration stages."
  - timestamp: 2026-03-15T02:31:12.439Z
    event: progress_report
    reason: "Finished studying spec and codebase. Have full dependency map of 80+ lib/ modules and 40+ API routes. Now invoking brainstorm skill to produce migration stages artifact."
  - timestamp: 2026-03-15T02:34:16.318Z
    event: progress_report
    reason: "Brainstorm artifact written to .lore/brainstorm/daemon-migration-stages.md. Seven stages identified with dependency map, relative sizing, ordering tradeoffs, and open questions. Verifying artifact quality before submitting."
  - timestamp: 2026-03-15T02:37:47.704Z
    event: result_submitted
    reason: "Produced `.lore/brainstorm/daemon-migration-stages.md` with seven discrete migration stages, grounded in actual codebase dependency analysis.\n\n**Stages identified:**\n1. **Daemon Skeleton + Shared Package** (small) - process container, schema extraction, monorepo structure\n2. **Vault Foundation** (small) - vault-manager, vault-config into daemon\n3. **Stateless File Operations** (large) - ~12 modules, ~15 API endpoints, repetitive low-risk work\n4. **Background Schedulers** (medium) - extraction + card discovery, eliminates instrumentation.ts bundler pain\n5. **Session Lifecycle and Chat** (medium, highest difficulty) - the stateful heart, SSE proxying challenge\n6. **Web App Conversion** (medium) - convert ~40 routes to daemon proxies\n7. **CLI Client** (medium) - new code, progressive discovery, MCP tool generation\n\n**Key findings:**\n- Stages 3 and 4 are independent (can run in parallel or either order)\n- Stage 5 has a hard dependency on Stage 3 (session-manager imports note-capture, transcript-manager; vault-transfer imports file-browser)\n- Stages 6 and 7 can run in parallel\n- SSE proxying (Stage 5) is the highest-risk architectural decision and may warrant its own design doc\n- The `app/api/config/*` routes (5 routes) were initially missing from staging and have been added to Stage 4\n\nFresh-context review caught and corrected: missing modules (vault-transfer, mock-sdk, utils/*), a hard dependency mislabeled as soft, and uncovered API routes."
  - timestamp: 2026-03-15T02:37:52.077Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Brainstorm artifact written to .lore/brainstorm/daemon-migration-stages.md. Seven stages identified with dependency map, relative sizing, ordering tradeoffs, and open questions. Verifying artifact quality before submitting."
projectName: memory-loop
---
Produced `.lore/brainstorm/daemon-migration-stages.md` with seven discrete migration stages, grounded in actual codebase dependency analysis.

**Stages identified:**
1. **Daemon Skeleton + Shared Package** (small) - process container, schema extraction, monorepo structure
2. **Vault Foundation** (small) - vault-manager, vault-config into daemon
3. **Stateless File Operations** (large) - ~12 modules, ~15 API endpoints, repetitive low-risk work
4. **Background Schedulers** (medium) - extraction + card discovery, eliminates instrumentation.ts bundler pain
5. **Session Lifecycle and Chat** (medium, highest difficulty) - the stateful heart, SSE proxying challenge
6. **Web App Conversion** (medium) - convert ~40 routes to daemon proxies
7. **CLI Client** (medium) - new code, progressive discovery, MCP tool generation

**Key findings:**
- Stages 3 and 4 are independent (can run in parallel or either order)
- Stage 5 has a hard dependency on Stage 3 (session-manager imports note-capture, transcript-manager; vault-transfer imports file-browser)
- Stages 6 and 7 can run in parallel
- SSE proxying (Stage 5) is the highest-risk architectural decision and may warrant its own design doc
- The `app/api/config/*` routes (5 routes) were initially missing from staging and have been added to Stage 4

Fresh-context review caught and corrected: missing modules (vault-transfer, mock-sdk, utils/*), a hard dependency mislabeled as soft, and uncovered API routes.
