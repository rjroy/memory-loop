---
title: "Commission: Plan: Stage 7 - CLI Client"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Create a detailed implementation plan for Stage 7 of the daemon migration: CLI Client.\n\nReference documents:\n- `.lore/specs/daemon-application-boundary.md` (the full spec, especially REQ-DAB-8 through REQ-DAB-15)\n- `.lore/brainstorm/daemon-migration-stages.md` (see \"Stage 7\" section)\n- All previous stage plans — read them to know the complete daemon API surface\n\nStage 7 scope:\n- Build the CLI as a second client of the daemon API (new code, nothing moves)\n- Implement progressive discovery (REQ-DAB-8): commands reveal themselves based on context\n- Machine-readable output (REQ-DAB-10): JSON output mode for all commands\n- MCP tool definition generation (REQ-DAB-13): CLI command metadata as canonical source, MCP definitions projected from it\n- Human-agent parity (REQ-DAB-15): same operations available to both\n- ~18 commands from the command table in REQ-DAB-9\n\nThe plan should cover: CLI framework choice, command structure, progressive discovery UX design, the MCP projection mechanism, output formatting strategy, test approach for CLI commands, and acceptance criteria. The brainstorm notes there's a stub exit point for progressive discovery design ([STUB: cli-progressive-discovery]).\n\nUse `/lore-development:prep-plan` to produce the plan artifact."
dependencies:
  - commission-Octavia-20260314-204424
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T03:44:34.998Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T03:44:35.000Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-03-15T05:02:39.755Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-03-15T05:02:39.758Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
