---
title: "Commission: Review: Stage 4 (Background Schedulers Migration)"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the implementation of Stage 4 of the daemon migration: Background Schedulers.\n\n## Plan to review against\n\n- `.lore/plans/daemon-background-schedulers.md` (the updated plan incorporating all prior review findings)\n\n## Spec\n\n- `.lore/specs/daemon-application-boundary.md` (governing spec with REQ-DAB-* requirements)\n\n## What to check\n\n### Stage 4 acceptance criteria (from the plan)\n\nVerify each acceptance criterion in the plan is met. Pay special attention to:\n\n1. **sdk-provider in daemon**: Was a daemon-local sdk-provider created? Does it initialize independently from nextjs?\n\n2. **Extraction migration**: Are extraction modules (extraction-manager, fact-extractor, memory-writer, transcript-manager) moved to daemon? Do they work with daemon's sdk-provider?\n\n3. **Card discovery migration**: Are spaced-repetition modules (card-discovery-scheduler, card-generator, card-storage, card-manager) moved to daemon? Do they work with daemon's sdk-provider?\n\n4. **Scheduler routes**: Are there daemon routes to trigger/monitor extraction and card discovery? Does health endpoint report scheduler status?\n\n5. **nextjs instrumentation cleanup**: Is `nextjs/instrumentation.ts` updated to no longer start schedulers directly? Does it delegate to daemon or remove scheduler bootstrap entirely?\n\n6. **Import boundaries**: No nextjs file imports directly from daemon internals. No circular dependencies between packages.\n\n7. **Test coverage**: Are daemon scheduler tests thorough? Do they cover error cases? Are existing nextjs scheduler tests updated or removed as appropriate?\n\n### Review focus areas\n\n- **Boundary enforcement**: Same as prior reviews. No nextjs importing daemon internals.\n- **SDK initialization**: Daemon must have its own sdk-provider that doesn't depend on nextjs initialization.\n- **Scheduler lifecycle**: How are schedulers started/stopped? What happens on daemon restart?\n- **Error handling**: What happens when extraction or card discovery fails mid-run? Silent failure? Logged? Retried?\n- **Security**: Same scrutiny as Stage 3. Any new endpoints accepting user paths need vault boundary validation.\n\n### Quality gates\n\nRun `bun run typecheck && bun run lint && bun run test` and `bun run --cwd nextjs build` to verify the current state passes all gates.\n\n### What NOT to do\n\nDo not modify any code. Review only. Present findings with their actual impact. Do not silently triage findings into categories or dismiss anything as \"pre-existing.\"\n\n## Reference\n\n- Dalton's Stage 4 commission: `.lore/commissions/commission-Dalton-20260315-120825.md`\n- Prior Stage 3 review: `.lore/commissions/commission-Thorne-20260315-102452.md`\n- Stage 3 fix commission: `.lore/commissions/commission-Dalton-20260315-104346.md`\n- Plan update commission: `.lore/commissions/commission-Octavia-20260315-083622.md`"
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T20:07:12.153Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T20:07:12.154Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
