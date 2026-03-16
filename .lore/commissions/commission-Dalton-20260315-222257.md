---
title: "Commission: Wire up recent discussions in recentActivityHandler"
date: 2026-03-16
status: dispatched
type: one-shot
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "## Bug: Ground tab shows no recent sessions\n\n### Symptom\nThe Ground (home) tab shows no recent discussions. The section is always empty.\n\n### Root Cause\n\nIn `daemon/src/routes/capture.ts:100-112`, the `recentActivityHandler` returns a hardcoded empty array for discussions:\n\n```typescript\nexport async function recentActivityHandler(c: Context): Promise<Response> {\n  const vaultId = c.req.param(\"id\") ?? \"\";\n  const vault = await getCachedVaultById(vaultId);\n  if (!vault) {\n    return jsonError(c, \"Vault not found\", \"VAULT_NOT_FOUND\", 404);\n  }\n\n  const notes = await getRecentNotes(vault, 5);\n  return c.json({\n    captures: notes,\n    discussions: [],   // ← hardcoded empty, never wired up\n  });\n}\n```\n\nThe function `getRecentSessions` already exists in `daemon/src/session-manager.ts:346` and does exactly what's needed: reads session files, sorts by last activity, formats for UI.\n\n### Required Changes\n\nIn `daemon/src/routes/capture.ts`:\n\n1. Import `getRecentSessions` from `../session-manager`\n2. In `recentActivityHandler`, call `getRecentSessions(vault.path, vault.config?.recentDiscussions ?? 5)` (check the vault object shape for exact config access)\n3. Return the result as `discussions` instead of `[]`\n\nThe vault object from `getCachedVaultById` has a `path` property. Check the vault type and config structure to get the `recentDiscussions` limit (default 5).\n\n### Testing\n\n- Check if there are existing tests for `recentActivityHandler` in `daemon/src/routes/__tests__/` or similar\n- If not, add a basic test that verifies discussions are returned (mock `getRecentSessions`)\n- Verify `getRecentSessions` itself has tests in `daemon/src/__tests__/session-manager.test.ts` or similar\n\n### Files to modify\n- `daemon/src/routes/capture.ts` (the only change needed)\n"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-03-16T05:22:57.601Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-03-16T05:22:57.603Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: memory-loop
---
