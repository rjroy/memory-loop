---
title: "Simplification notes: pi-agent-migration"
date: 2026-05-19
status: shipped
tags: [simplify, cleanup, code-quality, pi-agent, sdk-migration]
modules: [daemon, session-manager, event-translator, fact-extractor, vault-transfer, active-session-controller]
related: [.lore/work/notes/pi-agent-migration.md, .lore/plans/pi-agent-migration.md]
---

# Simplification Notes: Pi-Agent Migration

## Files Processed

- packages/shared/src/schemas/types.ts
- daemon/src/pi-session-factory.ts
- daemon/src/__tests__/pi-session-factory.test.ts
- daemon/src/streaming/event-translator.ts
- daemon/src/streaming/__tests__/event-translator.test.ts
- daemon/src/vault-transfer.ts
- daemon/src/session-manager.ts
- daemon/src/__tests__/session-manager.test.ts
- daemon/src/streaming/active-session-controller.ts
- daemon/src/streaming/__tests__/active-session-controller.test.ts
- daemon/src/extraction/fact-extractor.ts
- daemon/src/extraction/__tests__/fact-extractor.test.ts
- daemon/src/inspiration-manager.ts
- daemon/src/vault-setup.ts
- daemon/src/spaced-repetition/card-generator.ts
- daemon/src/spaced-repetition/card-dedup.ts

## Cleanup Agents Run

- code-simplifier:code-simplifier (Group 1: schema + factory + event-translator)
- code-simplifier:code-simplifier (Group 2: vault-transfer + session-manager + controller)
- code-simplifier:code-simplifier (Group 3: extraction + inspiration + spaced-repetition)

## Results

### Simplification

- Agent: code-simplifier:code-simplifier (Group 1 — schema, factory, event-translator)
  Changes: Removed `_createPiSessionImpl` indirection; consolidated 3 test helpers into `setupHarness`; extracted shared `messageUpdate()` builder in event-translator tests; merged duplicate `toolExecutionUpdate*` builders

- Agent: code-simplifier:code-simplifier (Group 2 — vault-transfer, session-manager, controller)
  Changes: Extracted `toolErrorResult()` helper; added `PiAgentModel` type, converted `mapSdkError` to table, extracted `loadSessionsSortedByActivity()` collapsing 3 near-identical loops, extracted `openPiSessionForVault()` deduplicating create/resume setup, extracted `wrapSdkFailure()`; unified `buildAssistantMessage` usage and simplified `discardPendingPrompts`/`collectPendingPrompts`/`respondToPrompt`

- Agent: code-simplifier:code-simplifier (Group 3 — extraction, inspiration, spaced-repetition)
  Changes: Extracted canonical `CreateSessionFn` type to pi-session-factory (removed 4 local duplicate definitions); extracted `writeInspirationFile()` in inspiration-manager; extracted `buildCountSummary()` in vault-setup

### Testing

- Command: `bun run typecheck && bun run lint && bun run test`
  Result: Pass
  Total: 4,104 tests across 127 files, 0 failures; typecheck and lint clean across all packages

### Review

- Agent: general-purpose (code review)
  Result: No issues
  All four critical invariants confirmed: RESUME_FAILED throw before try block; sendMessage catch emits+throws; permission extension try/catch intact; factory init sequence order preserved

## Failures

