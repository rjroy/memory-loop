---
title: "Implementation notes: pi-agent migration"
date: 2026-05-19
status: complete
tags: [implementation, notes, pi-agent, sdk-migration]
source: .lore/plans/pi-agent-migration.md
modules: [daemon, session-manager, event-translator, fact-extractor, vault-transfer, active-session-controller]
related: [.lore/plans/pi-agent-migration.md, .lore/research/pi-agent-sdk.md, .lore/retros/ephemeral-sdk-sessions.md]
---

# Implementation Notes: Pi-Agent Migration

## Progress
- [x] Phase 1: Swap dependencies
- [x] Phase 2: Add piSessionPath to shared SessionMetadata
- [x] Phase 3: Create pi-session-factory.ts; delete sdk-provider.ts
- [x] Phase 4: Rewrite event-translator.ts for pi-agent subscribe API
- [x] Phase 5: Rewrite vault-transfer.ts tool wrappers
- [x] Phase 6: Rewrite session-manager.ts (createSession/resumeSession)
- [x] Phase 7: Update active-session-controller.ts — replace generator loop
- [x] Phase 8: Rewrite fact-extractor.ts
- [x] Phase 9: Remove sdk-provider.ts and clean up
- [x] Phase 10: Validate against goal

## Log

### Summary
10 phases, all green. Migrated all 6 planned SDK touch points plus 4 unplanned files discovered in Phase 9 (inspiration-manager, vault-setup, card-generator, card-dedup). Final state: 4104 tests pass, 0 typecheck errors, 0 lint errors, 0 claude-agent-sdk references in daemon/. HTTP routes and SSE event types unchanged. Architecture invariants (emit+throw, RESUME_FAILED, subscription cleanup) verified by silent-failure-hunter at each critical phase.

### Phase 10: Validate against goal
- Fresh-context audit: all 10 checks pass
- Confirmed: sdk-provider deleted, RESUME_FAILED throws, sendMessage catch emits+throws, event-translator uses createPiEventAdapter, routes unchanged

### Phase 9: Remove sdk-provider.ts and clean up
- Dispatched: delete sdk-provider.ts, grep for remaining claude-agent-sdk references, run full suite
- Surprise: 4 files missed in plan's scope (inspiration-manager, vault-setup, card-generator, card-dedup) — all migrated to createPiSession + inMemory pattern
- Lint fixes: pre-existing unused params and `as any` casts across migrated files
- Result: 4104 tests pass, 0 typecheck errors, 0 lint errors, 0 claude-agent-sdk references anywhere in daemon/

### Phase 8: Rewrite fact-extractor.ts
- Dispatched: replace query() with inMemory createPiSession, add finalText(), add createSessionFn injection, rewrite tests
- Result: 25 tests pass; tools: ["read", "grep", "bash"] (no glob/edit/write — not confirmed built-ins)
- Test review: found 2 gaps — systemPrompt not asserted, multi-message ordering not verified
- Fix: exported _finalText, added 6 direct unit tests covering ordering/joining/edge cases; added systemPrompt toBeTruthy assertion

### Phase 7: Update active-session-controller.ts
- Dispatched: replace generator loop with subscribe+prompt chain, remove AbortController, rewrite 11 old tests
- Result: 15 controller tests pass, 1960 total daemon tests pass; typecheck clean
- Previous messages: uses SessionMetadata.messages (our own ConversationMessage[]) not AgentSession.messages — no lossy mapping needed
- Silent-failure-hunter: "emit AND throw" correctly in synchronous setup phase (createSession/resumeSession); fire-and-forget runStreaming correctly emit-only on error (POST already returned); cleanup via finally block with generation guard; state machine cannot get stuck
- Observation: error event emitted before response_end in error path — non-breaking with current client but worth watching

### Phase 6: Rewrite session-manager.ts
- Dispatched: createSession/resumeSession rewrite, SessionQueryResult type change, delete querySession/prepareTurnOptions/extractSessionId, add permission extension + AskUserQuestion tool
- Result: 14 session-manager tests pass; Phase 6 agent also minimally updated active-session-controller to fix typecheck (Phase 7 will do the full rewrite)
- Silent-failure-hunter: `pi.on("tool_call", async ...)` risk — pi-agent does await handlers internally (unlike bare EventEmitter), but added try/catch anyway for explicit logging on callback failures
- Code-reviewer: no non-conformances; DISCUSSION_MODEL_MAP covers all 3 enum values (opus/sonnet/haiku)
- Key discovery: DISCUSSION_MODEL_MAP maps vault config strings to anthropic provider modelIds

### Phase 5: Rewrite vault-transfer.ts
- Dispatched: createVaultTransferServer → createVaultTransferTools, Zod → TypeBox, defineTool wrappers
- Result: tests pass; session-manager import updated as side effect
- Surprises: package is `typebox` not `@sinclair/typebox`; `ToolDefinition` requires `label` field (plan omitted it); `AgentToolResult` requires `details` field alongside `content`; execute takes 5 args `(toolCallId, params, signal, onUpdate, ctx)`

### Phase 4: Rewrite event-translator.ts
- Dispatched: replace SDKMessage translator with createPiEventAdapter for pi-agent SessionEvent
- Result: 22/22 pass; compaction_start/end live in pi-coding-agent AgentSessionEvent not pi-agent-core (import corrected); text_delta is a plain string not nested
- Silent-failure-hunter: found tool_execution_update emitted `output: ""` when partialResult was null/malformed (silent data substitution)
- Fix: skip emit + log.warn when no text content found; 2 new tests added
- Divergence: `compact_boundary` `preTokens` field always 0 (pi-agent `compaction_start` has no token count) — accepted regression per plan

### Phase 3: Create pi-session-factory.ts
- Dispatched: create factory with PiSessionOptions/PiSessionResult, mandatory init sequence, test injection exports, 14 unit tests
- Result: 1962 pass across full suite; all tests green
- Key decision: model lookup accepts `model?: { provider, modelId }` directly on options — mapping from vault config left to callers (session-manager in Phase 6) since VaultConfig has `discussionModel?: string` enum form, not provider/modelId shape
- Review: all 6 requirements pass; error propagation clean; double-null model case throws explicitly

### Phase 2: Add piSessionPath to shared SessionMetadata
- Dispatched: add optional `piSessionPath?: string` to SessionMetadata interface in packages/shared/src/schemas/types.ts
- Result: field added as optional TypeScript property; no Zod schema involved (sessions use JSON.parse cast)
- Review: no issues — all 3 construction sites omit field without error; no Zod parse rejection risk

### Phase 1: Swap dependencies
- Dispatched: bun remove old SDK, bun add pi-agent-core + pi-coding-agent
- Result: Both packages installed at 0.75.3; typecheck passes clean (old imports are present but don't cause errors yet)
- 7 files have old SDK imports that subsequent phases will rewrite

