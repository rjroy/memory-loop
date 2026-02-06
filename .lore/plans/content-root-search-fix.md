---
title: Fix file search with non-empty contentRoot
date: 2026-02-06
status: draft
tags: [bug, search, content-root, api-routes]
modules: [search-handlers, search-routes]
related: [.lore/reference/_infrastructure/configuration.md, .lore/reference/recall.md]
---

# Plan: Fix file search with non-empty contentRoot

## Goal

When a vault has a non-empty `contentRoot` (e.g., `"content"` for Quartz-style vaults), file search and content search fail because the search index is built against the vault root instead of the content root. The frontend receives paths like `content/A/B/C.md` instead of `A/B/C.md`, which don't match what the file browser expects.

**Issue**: [#449](https://github.com/rjroy/memory-loop/issues/449)

The fix: three search API routes pass `vault.path` to the search handlers, but should pass `vault.contentRoot`. Every other vault-scoped route (files, directories, tasks) already uses `vault.contentRoot`.

## Codebase Context

**The bug** is in three search route files that pass `vault.path` instead of `vault.contentRoot`:
- `nextjs/app/api/vaults/[vaultId]/search/files/route.ts:47`
- `nextjs/app/api/vaults/[vaultId]/search/content/route.ts:47`
- `nextjs/app/api/vaults/[vaultId]/search/snippets/route.ts:42`

**Correct pattern** (used by all other routes):
- `nextjs/app/api/vaults/[vaultId]/files/route.ts:35` uses `vault.contentRoot`
- `nextjs/app/api/vaults/[vaultId]/directories/[...path]/route.ts:34` uses `vault.contentRoot`
- `nextjs/app/api/vaults/[vaultId]/tasks/route.ts:37` uses `vault.contentRoot`

**Data flow**: Route → `searchFilesRest(vaultId, vaultPath, ...)` → `getOrCreateIndex(vaultId, vaultPath)` → `new SearchIndexManager(vaultPath)`. The `SearchIndexManager` uses whatever path it receives as its content root for crawling and indexing. Passing the wrong root means wrong relative paths in results.

**No existing handler/route tests** exist for the search layer. Tests exist for `SearchIndexManager` and the search cache, but not for the route-to-handler wiring.

## Implementation Steps

### Step 1: Fix the three search routes

**Files**: `nextjs/app/api/vaults/[vaultId]/search/files/route.ts`, `nextjs/app/api/vaults/[vaultId]/search/content/route.ts`, `nextjs/app/api/vaults/[vaultId]/search/snippets/route.ts`
**Delegation**: inline

Change `vault.path` to `vault.contentRoot` in each route's handler call:
- `search/files/route.ts:47`: `searchFilesRest(vault.id, vault.path, ...)` → `searchFilesRest(vault.id, vault.contentRoot, ...)`
- `search/content/route.ts:47`: `searchContentRest(vault.id, vault.path, ...)` → `searchContentRest(vault.id, vault.contentRoot, ...)`
- `search/snippets/route.ts:42`: `getSnippetsRest(vault.id, vault.path, ...)` → `getSnippetsRest(vault.id, vault.contentRoot, ...)`

### Step 2: Add a search handler test with contentRoot

**Files**: `nextjs/lib/handlers/__tests__/search-handlers.test.ts` (new file)
**Delegation**: inline

Write a test that verifies the search handlers receive and use the content root path (not the vault root). The test should:
1. Create a temp directory structure: `vault-root/content/A/B/C.md`
2. Call `searchFilesRest` with the content root path (`vault-root/content`)
3. Verify results use paths relative to content root (`A/B/C.md`, not `content/A/B/C.md`)
4. Repeat for `searchContentRest` and `getSnippetsRest`

This tests the handler layer directly, which is the integration point where the bug manifests.

### Step 3: Run tests and verify

**Delegation**: inline

Run the full test suite to confirm the fix doesn't break existing tests, and the new test passes.

### Step 4: Validate against goal

**Delegation**: fresh-context sub-agent (required)

Launch a sub-agent that reads the Goal section above, reviews the implementation, and flags anything that doesn't match. Specifically verify:
- All three search routes now use `vault.contentRoot`
- New test covers the contentRoot scenario
- No other search-related code still uses `vault.path` where it should use `vault.contentRoot`

## Delegation Guide

Steps safe to run inline:
- Steps 1-3: Small, focused changes. Step 1 is three one-word edits. Step 2 is a single test file. No context pressure.

Steps that benefit from fresh-context sub-agents:
- Step 4: Fresh eyes to scan for any remaining instances of the same bug pattern elsewhere.

## Open Questions

None. The fix is well-understood and localized.
