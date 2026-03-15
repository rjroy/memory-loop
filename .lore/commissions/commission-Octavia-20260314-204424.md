---
title: "Commission: Plan: Stage 6 - Web App Conversion"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Create a detailed implementation plan for Stage 6 of the daemon migration: Web App Conversion.\n\nReference documents:\n- `.lore/specs/daemon-application-boundary.md` (the full spec, especially REQ-DAB-22, REQ-DAB-23)\n- `.lore/brainstorm/daemon-migration-stages.md` (see \"Stage 6\" section)\n- All previous stage plans — read them to know exactly what daemon API endpoints exist\n\nStage 6 scope:\n- Convert all ~40 Next.js API routes from direct lib/ imports to daemon API proxies\n- Delete or reduce nextjs/lib/ to web-only modules (lib/api/client.ts, lib/api/types.ts, possibly lib/sse.ts)\n- Enumerate which routes stay web-local vs proxy to daemon\n- Handle latency implications of the extra proxy hop (especially SSE streaming buffering)\n- Enforce REQ-DAB-22: no domain logic in Next.js, only UI presentation and daemon API calls\n\nThe plan should include: a complete inventory of all API routes and their disposition (proxy vs stay), the proxy implementation pattern, lib/ cleanup strategy, test conversion (route tests now test proxying), and acceptance criteria. Note the subtle risk around lib/api/client.ts — it still calls Next.js routes which now proxy to daemon.\n\nUse `/lore-development:prep-plan` to produce the plan artifact."
dependencies:
  - commission-Octavia-20260314-204413
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T03:44:24.739Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T03:44:24.740Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-03-15T04:51:32.826Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-03-15T04:51:32.829Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
