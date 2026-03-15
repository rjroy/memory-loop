---
title: "Commission: Fix: Stage 3 security vulnerability and dead code"
date: 2026-03-15
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Two fixes from Thorne's Stage 3 review.\n\n## 1. SECURITY: Transcript append path traversal\n\n`daemon/src/routes/transcripts.ts:64-94` — The POST /vaults/:id/transcripts/append handler writes to any path without vault boundary validation. An attacker could write to arbitrary filesystem locations.\n\nFix: Validate that the resolved file path is within the vault's content root before writing. Use the same boundary validation pattern used elsewhere in the daemon (e.g., file browser security checks). Reject requests that attempt to escape the vault directory.\n\nAdd tests covering:\n- Normal transcript append (should work)\n- Path traversal attempt (e.g., `../../etc/passwd`) — should be rejected\n- Absolute path outside vault — should be rejected\n\n## 2. Dead code: getVaultGoals\n\n`nextjs/lib/vault-client.ts` contains a `getVaultGoals` function that is uncalled dead code with a stale TODO. The goals route now correctly proxies to the daemon. Delete the function.\n\n## Verification\n\n- `bun run typecheck` passes\n- `bun run lint` passes\n- `bun run test` passes (ALL packages)\n- `bun run --cwd nextjs build` passes\n- Grep confirms no callers of `getVaultGoals`\n\n## Reference\n\n- Thorne's review: `.lore/commissions/commission-Thorne-20260315-102452.md`"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-15T17:43:46.433Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-15T17:43:46.435Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
