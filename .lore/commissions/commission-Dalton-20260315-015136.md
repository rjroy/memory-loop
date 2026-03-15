---
title: "Commission: Stage 2: Daemon Vault Foundation"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Stage 2 of the daemon migration: Vault Foundation.\n\n**Plan**: `.lore/plans/daemon-vault-foundation.md` — follow this plan step by step (Steps 1-9). Step 10 (spec validation) will be done separately.\n\n**Spec**: `.lore/specs/daemon-application-boundary.md`\n**Stage 1 plan** (already executed): `.lore/plans/daemon-skeleton-shared-package.md`\n\n## What you're building\n\nMove vault-manager.ts and vault-config.ts from nextjs/lib/ to daemon/src/vault/, extracting shared types and utilities to @memory-loop/shared along the way. Create daemon REST endpoints for vault operations. Create a transitional vault-client in nextjs that calls the daemon API.\n\n## Execution order\n\nFollow the plan's 10 steps in sequence. Each step has explicit file lists, verification commands, and acceptance criteria.\n\nKey points:\n- Step 1: Extract fileExists/directoryExists to @memory-loop/shared (breaks circular dependency)\n- Step 2: Extract VaultConfig types, resolvers, path helpers to @memory-loop/shared\n- Step 3: Move vault I/O modules to daemon/src/vault/\n- Step 4: Move tests to daemon\n- Step 5: Create daemon vault API routes (Hono handlers) + vault cache\n- Step 6: Wire health endpoint to real vault count\n- Step 7: Create transitional vault-client in nextjs (HTTP calls to daemon over Unix socket)\n- Step 8: Rewrite all downstream imports across nextjs (~25 files)\n- Step 9: Integration test for vault API\n\n## Important details from the plan\n\n- D1: Three-way split for vault-config content (types→shared, I/O→daemon, helpers→daemon)\n- D2: fileExists/directoryExists are infrastructure, belong in shared\n- D4: vault-client is explicitly transitional (REQ-DAB-23), deleted in Stage 6\n- D5: vault-helpers.ts stays in nextjs, rewritten to use vault-client\n- D6: Daemon caches vault list on startup with invalidation\n- D7: getProjectRoot() replaced with DAEMON_ROOT or env-based resolution\n- D8: Slash commands are sub-resource of vault config\n\n- Error classes (VaultsDirError, VaultCreationError) stay daemon-internal. config-handlers.ts handles HTTP error responses instead of catching exception types.\n- getVaultGoals in vault-client uses direct filesystem read for now (marked TODO for Stage 3)\n- getVaultsDir in vault-client reads VAULTS_DIR env var directly (no daemon call needed)\n\n## Verification\n\nAfter each step, run the verification command listed in the plan. After all steps:\n```bash\nbun run typecheck && bun run lint && bun run test && bun run --cwd nextjs build\n```\n\nAll quality gates must pass. Do not skip tests or typecheck verification between steps."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T08:51:36.180Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T08:51:36.182Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
