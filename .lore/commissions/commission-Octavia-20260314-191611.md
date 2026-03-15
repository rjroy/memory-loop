---
title: "Commission: Spec: Memory Loop daemon application boundary"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/example/daemon-application-boundary.md`. This is a spec from another project (Guild Hall) that established a daemon as the application boundary for all writes. Your job is to **rework this spec so it represents Memory Loop's architecture**.\n\n**The concept:**\n- Memory Loop's Next.js web app currently contains all domain logic directly in `lib/` (session manager, vault manager, note capture, file browser, scheduler)\n- The goal is a daemon process that owns domain logic, with the web app as a client\n- A CLI can also exist as a second client to the daemon\n- An AI agent could be given run directions for the CLI (similar to how Guild Hall has skills, but this is a separate system, not Guild Hall)\n\n**What to produce:**\n- A proper spec in `.lore/specs/daemon-application-boundary.md` written for Memory Loop\n- Study the existing Memory Loop codebase (CLAUDE.md, key modules in `nextjs/lib/`, API routes) to understand what domain logic exists today\n- Identify what moves into the daemon vs. what stays in the web app\n- The two-phase chat pattern (POST submit, SSE viewport) is a natural fit for daemon API surface\n- Address the CLI angle: what commands would exist, how the agent would discover and use them\n- The agent-runs-CLI concept is NOT Guild Hall skills. Think of it more like MCP tool definitions that invoke a CLI.\n\n**What NOT to do:**\n- Don't copy Guild Hall terminology or patterns wholesale. Adapt the architectural idea to Memory Loop's domain.\n- Don't plan implementation. This is a spec, not a plan.\n- This is a major refactor concept. The spec should be thorough but the goal is capturing the vision, not scheduling work.\n\nUse `/lore-development:specify` to produce this."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T02:16:11.750Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T02:16:11.752Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
