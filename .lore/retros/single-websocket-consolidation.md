---
title: WebSocket consolidation revealed hidden coupling in test setup
date: 2026-02-04
status: complete
tags: [websocket, rest-api, testing, refactor, architecture]
modules: [websocket-handler, health-panel, vault-select, app]
related: [.lore/design/single-websocket-consolidation.md]
---

# Retro: Single WebSocket Consolidation

## Summary

Migrated non-streaming operations from WebSocket to REST API, leaving only Discussion owning a WebSocket connection. Added `POST /api/vaults` for vault creation, `GET /api/vaults/:vaultId/health` for health issues, and a new `useHealth` hook for REST-based health polling.

## What Went Well

- **Design document proved accurate**: The migration order and interface contracts matched implementation exactly. No surprises.
- **Test patterns were reusable**: Following existing `useCapture`, `useHome` patterns made creating `useHealth` straightforward.
- **Scope was right-sized**: Focusing on vault creation and health endpoints (not extraction prompt or card generator) kept the PR digestible.
- **Pre-commit hooks caught issues early**: Lint errors and type issues surfaced immediately, not in CI.

## What Could Improve

- **Test environment limitations**: happy-dom's `about:blank` URL breaks relative URL construction in the API client. Had to acknowledge this in test comments rather than solving it. VaultSelect REST API tests were descoped to UI interactions only.
- **Sync effects can silently overwrite initial state**: The `useEffect` in HealthPanel that syncs fetched issues to context was overwriting test-provided `initialHealthIssues`. Fixed by guarding with `if (vault)`, but this pattern could bite again.

## Lessons Learned

- **Guard sync effects with their trigger conditions**: When a hook fetches data and syncs it to context, the sync effect should only run when the fetch trigger (e.g., vaultId) is present. Otherwise initial/test state gets clobbered by empty fetch results.
- **happy-dom relative URL limitation is structural**: Tests that need REST API calls with relative URLs either need global fetch mocking or dependency injection. Component tests that create internal API clients can't easily mock fetch. Accept this and write hook-level tests instead.
- **Design documents that specify migration order reduce decision fatigue**: The design doc's "Migration Order" section let implementation proceed mechanically without re-litigating sequencing.

## Artifacts

- Design: `.lore/design/single-websocket-consolidation.md`
- PR: #452
- Commits: `befb0c0` (implementation), `dc8ba6d` (tests)
