---
title: "Commission: Implement Stage 7: CLI Client"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 7 of the daemon migration: the CLI client package.\n\n**Plan**: `.lore/plans/daemon-cli-client.md`\n**Spec**: `.lore/specs/daemon-application-boundary.md` (REQ-DAB-7 through REQ-DAB-15)\n\nThis creates a new `cli/` workspace package that is a first-class client of the daemon's REST API. The CLI communicates with the daemon over Unix socket (or TCP fallback) and produces JSON output by default with a `--human` flag for human-readable formatting.\n\nFollow the plan's 10 steps in order:\n\n1. Create CLI package skeleton at `cli/`\n2. Implement daemon HTTP client and output formatter\n3. Define command registry (all 19 commands)\n4. Implement progressive discovery UX\n5a. Implement all stateless commands\n5b. Implement streaming commands (chat stream, chat send --stream)\n6. Implement MCP tool definition projection\n7. Validate human-agent parity (sub-agent review)\n8. Write integration tests\n9. Update build and test infrastructure\n10. Validate against spec\n\nKey constraints:\n- No external CLI framework (hand-rolled arg parsing per D1)\n- JSON output default, `--human` flag for human-readable (D2)\n- Progressive discovery through daemon `/help` endpoints (D3)\n- Command registry as structured metadata for MCP projection (D4, D5)\n- Vault resolution by name or ID (D7)\n- Only dependency is `@memory-loop/shared` — no imports from daemon/ or nextjs/\n- Exit codes: 0 success, 1 app error, 2 usage error, 3 connection error\n\nQuality gates must pass at end:\n- `bun run typecheck` (all packages including cli)\n- `bun run lint`\n- `bun run test` (all packages including cli)\n- `bun run --cwd nextjs build`\n\nRead the full plan before starting. It has detailed interface definitions, examples, and risk notes."
dependencies: []
linked_artifacts: []

resource_overrides:
  maxTurns: 1000

activity_timeline:
  - timestamp: 2026-03-15T23:35:31.917Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T23:35:31.920Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
