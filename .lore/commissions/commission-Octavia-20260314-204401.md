---
title: "Commission: Plan: Stage 4 - Background Schedulers"
date: 2026-03-15
status: blocked
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Create a detailed implementation plan for Stage 4 of the daemon migration: Background Schedulers.\n\nReference documents:\n- `.lore/specs/daemon-application-boundary.md` (the full spec)\n- `.lore/brainstorm/daemon-migration-stages.md` (see \"Stage 4\" section)\n- `.lore/research/daemon-rest-api.md` (API conventions)\n- `.lore/research/claude-agent-sdk.md` (SDK capabilities, concurrency behavior)\n- The Stage 1 and Stage 2 plans — read them for established patterns. Stage 3 plan is also available for context.\n\nStage 4 scope:\n- Move extraction pipeline (~5 files) and card discovery system (~9 files) into the daemon\n- Move scheduler-bootstrap.ts (dissolves into daemon startup)\n- Move sdk-provider.ts into daemon (single shared provider, confirmed concurrent-safe)\n- Dissolve config-handlers.ts into daemon routes\n- Remove instrumentation.ts scheduler bootstrap (eliminates documented bundler bug source)\n- Create daemon API endpoints for extraction trigger/status, card CRUD/review, and config endpoints\n\nThe brainstorm notes this is independent of Stage 3 (could theoretically run in parallel). The plan should cover: file moves, sdk-provider initialization strategy, scheduler startup in daemon, all new daemon routes (including the /config/* endpoints), test migration, and acceptance criteria.\n\nUse `/lore-development:prep-plan` to produce the plan artifact."
dependencies:
  - commission-Octavia-20260314-204352
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T03:44:01.299Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T03:44:01.301Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: memory-loop
---
