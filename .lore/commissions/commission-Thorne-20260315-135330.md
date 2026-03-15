---
title: "Commission: Review: Stage 5 (Session Lifecycle & Chat Migration)"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the implementation of Stage 5 of the daemon migration: Session Lifecycle & Chat.\n\n## Plan to review against\n\n- `.lore/plans/daemon-session-lifecycle-chat.md` (the updated plan incorporating all prior review findings)\n\n## Spec\n\n- `.lore/specs/daemon-application-boundary.md` (governing spec with REQ-DAB-* requirements)\n\n## What to check\n\n### Stage 5 acceptance criteria (from the plan)\n\nVerify each acceptance criterion is met. Pay special attention to:\n\n1. **session-client**: Does `nextjs/lib/session-client.ts` exist and use daemon-fetch? Does it follow the same provider pattern as vault-client and file-client?\n\n2. **Session management routes**: Are session create/resume/save/delete migrated to daemon routes?\n\n3. **SSE streaming via Hono**: Does the chat stream endpoint use Hono's SSE API (`hono/streaming`)? Is the two-phase chat pattern preserved (POST submit → GET stream)?\n\n4. **SDK orchestration in daemon**: Is the active-session-controller and session-streamer moved to daemon? Does the daemon own SDK initialization for chat?\n\n5. **Vault setup and inspiration**: Are these endpoints migrated to daemon?\n\n6. **Import boundaries**: No nextjs file imports directly from daemon internals. session-client uses daemon-fetch, not direct HTTP.\n\n7. **Test coverage**: Are daemon session/chat route tests thorough? Do they cover SSE streaming, error cases, abort, permission, and answer flows?\n\n8. **Latency tests**: Do SSE tests use ordering + reasonable thresholds (not 100ms)?\n\n### Review focus areas\n\n- **SSE correctness**: This is the most critical piece. Does the Hono SSE implementation correctly stream session events? Does it handle client disconnect? Does it send snapshot-first?\n- **Two-phase chat integrity**: POST returns sessionId, GET streams events. No mixing of concerns.\n- **Boundary enforcement**: Same as prior reviews. No nextjs importing daemon internals.\n- **Error handling**: What happens when SDK calls fail mid-stream? Does the SSE connection close cleanly? Does session-client surface DaemonUnavailableError?\n- **Security**: Any new endpoints accepting user paths need vault boundary validation. Session IDs should be validated.\n\n### Quality gates\n\nRun `bun run typecheck && bun run lint && bun run test` and `bun run --cwd nextjs build` to verify the current state passes all gates.\n\n### What NOT to do\n\nDo not modify any code. Review only. Present findings with their actual impact.\n\n## Reference\n\n- Dalton's Stage 5 commission: `.lore/commissions/commission-Dalton-20260315-131244.md`\n- Prior Stage 4 review: `.lore/commissions/commission-Thorne-20260315-130712.md`\n- Plan update commission: `.lore/commissions/commission-Octavia-20260315-083622.md`"
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T20:53:30.976Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T20:53:30.978Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
