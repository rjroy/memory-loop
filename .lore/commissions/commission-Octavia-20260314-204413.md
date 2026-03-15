---
title: "Commission: Plan: Stage 5 - Session Lifecycle and Chat"
date: 2026-03-15
status: blocked
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Create a detailed implementation plan for Stage 5 of the daemon migration: Session Lifecycle and Chat.\n\nReference documents:\n- `.lore/specs/daemon-application-boundary.md` (the full spec)\n- `.lore/brainstorm/daemon-migration-stages.md` (see \"Stage 5\" section)\n- `.lore/research/daemon-rest-api.md` (API conventions, SSE wire format)\n- `.lore/research/claude-agent-sdk.md` (SDK session lifecycle)\n- `.lore/research/claude-agent-sdk-ref-typescript.md` (TypeScript API reference)\n- All previous stage plans — read them for established patterns and decisions\n\nStage 5 scope:\n- Move session-manager.ts, active-session-controller.ts, session-streamer.ts, controller.ts into daemon\n- Move pair-writing-prompts.ts, vault-transfer.ts, vault-setup.ts, inspiration-manager.ts, mock-sdk.ts\n- Handle the globalThis singleton pattern (not needed in daemon, no HMR)\n- Implement SSE proxying: daemon produces SSE, Next.js proxies it to browser (byte-transparent, test buffering behavior)\n- MCP server registration must work from daemon context\n- Single-session constraint (REQ-DAB-25) enforced at daemon level across all clients\n- Two-phase chat pattern (POST submit, GET SSE viewport) maps to daemon API\n\nThis is the highest-difficulty stage. The plan should address: the statefulness challenge, SSE proxy architecture (resolved as byte-transparent pipe in brainstorm), MCP server registration, session ID management, the mock-sdk strategy for daemon tests, and acceptance criteria. Call out specific risks and mitigation strategies.\n\nUse `/lore-development:prep-plan` to produce the plan artifact."
dependencies:
  - commission-Octavia-20260314-204401
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T03:44:13.452Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T03:44:13.453Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: memory-loop
---
