---
title: "Commission: Review: Stage 1 (Daemon Skeleton) & Stage 2 (Vault Foundation)"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the implementation of Stage 1 and Stage 2 of the daemon migration.\n\n## Plans to review against\n\n- `.lore/plans/daemon-skeleton-shared-package.md` (Stage 1: monorepo workspace, shared package, daemon skeleton)\n- `.lore/plans/daemon-vault-foundation.md` (Stage 2: vault-manager, vault-config migration, daemon vault API, transitional vault-client)\n\n## Spec\n\n- `.lore/specs/daemon-application-boundary.md` (the governing spec with REQ-DAB-* requirements)\n\n## What to check\n\n### Stage 1 acceptance criteria\n1. Root workspace links three packages (shared, nextjs, daemon)\n2. `@memory-loop/shared` exports schemas, logger, and shared types\n3. Daemon listens on Unix socket with Hono\n4. `GET /health` returns status, version, uptime, vault count\n5. `GET /help` returns API discovery\n6. All existing tests still pass\n7. `bun run typecheck`, `bun run lint`, `bun run test`, `bun run --cwd nextjs build` pass\n\n### Stage 2 acceptance criteria\n1. vault-manager.ts and vault-config.ts live in `daemon/src/vault/`, with their tests\n2. `@memory-loop/shared` contains: fileExists, directoryExists, VaultConfig type, all resolve* functions, DEFAULT_* constants, path helpers, string utilities\n3. Daemon serves: GET/POST /vaults, GET /vaults/:id, GET/PUT /vaults/:id/config, GET/PUT /vaults/:id/config/slash-commands, GET /vaults/help\n4. Health endpoint reports real vault count\n5. `nextjs/lib/vault-client.ts` provides transitional interface\n6. `nextjs/lib/vault-helpers.ts` uses vault-client, not vault-manager\n7. No file in nextjs/ imports from the deleted vault-manager or vault-config modules\n8. All existing tests pass from new locations\n9. New tests cover each daemon endpoint and vault cache\n10. All quality gates pass (typecheck, lint, test, build)\n\n### Review focus areas\n\n- **Boundary enforcement**: No nextjs file should import directly from daemon internals. Shared package should contain only pure types/utilities, no I/O.\n- **Import completeness**: Grep for any remaining imports of vault-manager or vault-config from nextjs. Missing one means a runtime crash.\n- **Vault cache correctness**: Cache invalidation on vault creation, TTL-based refresh, startup initialization.\n- **vault-client HTTP pattern**: Verify Bun fetch + Unix socket usage is correct. Check error handling for daemon-down scenarios.\n- **Error handling at boundaries**: config-handlers.ts should handle HTTP error responses from vault-client, not catch JavaScript exception types from the old direct imports.\n- **Test coverage**: Are the daemon route tests thorough? Do they cover error cases (404, invalid input)?\n- **API conventions**: Do vault endpoints follow the error format ({ error, code, detail? }) and help discovery pattern from Stage 1?\n- **Circular dependency resolution**: Confirm the vault-manager ↔ vault-config cycle is actually broken.\n\n### What NOT to do\n\nDo not modify any code. Review only. Present findings with their actual impact. Do not silently triage findings into categories or dismiss anything as \"pre-existing.\"\n\nRun `bun run typecheck && bun run lint && bun run test` to verify the current state passes all gates."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T13:27:12.081Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T13:27:12.083Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
