---
title: "Commission: Plan: Stage 6 - Web App Conversion"
date: 2026-03-15
status: completed
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Create a detailed implementation plan for Stage 6 of the daemon migration: Web App Conversion.\n\nReference documents:\n- `.lore/specs/daemon-application-boundary.md` (the full spec, especially REQ-DAB-22, REQ-DAB-23)\n- `.lore/brainstorm/daemon-migration-stages.md` (see \"Stage 6\" section)\n- All previous stage plans — read them to know exactly what daemon API endpoints exist\n\nStage 6 scope:\n- Convert all ~40 Next.js API routes from direct lib/ imports to daemon API proxies\n- Delete or reduce nextjs/lib/ to web-only modules (lib/api/client.ts, lib/api/types.ts, possibly lib/sse.ts)\n- Enumerate which routes stay web-local vs proxy to daemon\n- Handle latency implications of the extra proxy hop (especially SSE streaming buffering)\n- Enforce REQ-DAB-22: no domain logic in Next.js, only UI presentation and daemon API calls\n\nThe plan should include: a complete inventory of all API routes and their disposition (proxy vs stay), the proxy implementation pattern, lib/ cleanup strategy, test conversion (route tests now test proxying), and acceptance criteria. Note the subtle risk around lib/api/client.ts — it still calls Next.js routes which now proxy to daemon.\n\nUse `/lore-development:prep-plan` to produce the plan artifact."
dependencies:
  - commission-Octavia-20260314-204413
linked_artifacts:
  - .lore/plans/daemon-web-app-conversion.md

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
  - timestamp: 2026-03-15T04:51:32.879Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-03-15T04:51:40.840Z
    event: progress_report
    reason: "Starting Stage 6 plan. Reading spec, brainstorm, and all previous stage plans to understand daemon API surface and migration context."
  - timestamp: 2026-03-15T04:52:17.724Z
    event: progress_report
    reason: "Finished reading all reference material. Have complete inventory of 41 API routes, all 5 previous stage plans, the spec, and the brainstorm. Now have the full daemon endpoint catalog from Stages 1-5. Invoking prep-plan skill to produce the artifact."
  - timestamp: 2026-03-15T04:55:43.539Z
    event: progress_report
    reason: "Drafting the Stage 6 plan document. All context gathered: 41 routes inventoried, all 5 previous stage plans analyzed. Key finding: most routes were already converted to proxies in Stages 3-5, making Stage 6 primarily a cleanup/verification/deletion stage."
  - timestamp: 2026-03-15T05:02:36.013Z
    event: result_submitted
    reason: "Created `.lore/plans/daemon-web-app-conversion.md` -- the Stage 6 implementation plan for converting Next.js from domain-logic host to pure UI proxy layer.\n\nKey finding: Stages 3-5 already converted all 40 of 41 API routes to daemon proxies. Stage 6 is therefore a cleanup/verification/deletion stage, not a bulk conversion. The plan has 10 steps: audit proxy routes for completeness, fix any stragglers, promote transitional client facades to a permanent `lib/daemon/` layer, delete ~30 domain modules from `nextjs/lib/`, update schema imports, clean up instrumentation.ts, convert tests to verify proxy behavior, integration smoke test, build verification, and spec validation.\n\nThe plan includes a complete inventory table mapping all 41 routes to their daemon endpoints with stage attribution, an explicit \"modules to keep\" vs \"modules to delete\" classification, and 7 acceptance criteria.\n\nFresh-eyes review by plan-reviewer agent surfaced 3 critical findings, all addressed: Step 3 title corrected from \"Delete\" to \"Promote\", module filenames verified against disk (daily-prep.ts -> daily-prep-manager.ts, goal-tracker.ts removed, image-converter.ts path corrected), and lib/utils/file-types.ts added to the keep list (used by 6 React components)."
  - timestamp: 2026-03-15T05:02:39.521Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Drafting the Stage 6 plan document. All context gathered: 41 routes inventoried, all 5 previous stage plans analyzed. Key finding: most routes were already converted to proxies in Stages 3-5, making Stage 6 primarily a cleanup/verification/deletion stage."
projectName: memory-loop
---
Created `.lore/plans/daemon-web-app-conversion.md` -- the Stage 6 implementation plan for converting Next.js from domain-logic host to pure UI proxy layer.

Key finding: Stages 3-5 already converted all 40 of 41 API routes to daemon proxies. Stage 6 is therefore a cleanup/verification/deletion stage, not a bulk conversion. The plan has 10 steps: audit proxy routes for completeness, fix any stragglers, promote transitional client facades to a permanent `lib/daemon/` layer, delete ~30 domain modules from `nextjs/lib/`, update schema imports, clean up instrumentation.ts, convert tests to verify proxy behavior, integration smoke test, build verification, and spec validation.

The plan includes a complete inventory table mapping all 41 routes to their daemon endpoints with stage attribution, an explicit "modules to keep" vs "modules to delete" classification, and 7 acceptance criteria.

Fresh-eyes review by plan-reviewer agent surfaced 3 critical findings, all addressed: Step 3 title corrected from "Delete" to "Promote", module filenames verified against disk (daily-prep.ts -> daily-prep-manager.ts, goal-tracker.ts removed, image-converter.ts path corrected), and lib/utils/file-types.ts added to the keep list (used by 6 React components).
