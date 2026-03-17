---
title: "Next.js test coverage to 80%+"
date: 2026-02-05
status: executed
tags: [testing, coverage, next-js, dom-environment, websocket-cleanup]
modules: [nextjs]
---

# Plan: Next.js Test Coverage to 80%+

## Current State

- **Backend**: 82.52% lines (OK)
- **Shared**: 100% lines (OK)
- **Next.js**: 1718/1939 tests failing, many files at 0% coverage

## Root Cause Analysis

Three distinct failure categories, in order of impact:

### 1. Missing DOM Environment (ALL 1718 failures)

`@happy-dom/global-registrator` is installed but never configured. No `bunfig.toml` exists in the nextjs workspace. Every test using `@testing-library/react` fails with `ReferenceError: document is not defined`.

### 2. Stale WebSocket Mocks (~10 test files)

Production code migrated from WebSocket to SSE. 10 test files still mock WebSocket:
- **Passive** (7 files): Mock WebSocket defensively but don't depend on it. Tests will pass once DOM works. Just dead code to clean up.
- **Active** (3 files): Tests await `wsInstances`, call `ws.simulateMessage()`. Will fail after DOM fix because components no longer create WebSocket connections.

### 3. Missing Test Files (39 API routes, 4 hooks, reducer gaps, utilities)

Files with no test coverage at all. These are the long tail.

---

## Execution Plan

### Phase 1: DOM Environment Setup

**Create 2 files:**

1. `nextjs/test-setup.ts`
   ```typescript
   import { GlobalRegistrator } from "@happy-dom/global-registrator";
   GlobalRegistrator.register();
   ```

2. `nextjs/bunfig.toml`
   ```toml
   [test]
   preload = ["./test-setup.ts"]
   ```

**Verify**: Run `bun run --cwd nextjs test` and count passing tests. Expect ~1500+ to pass.

**Estimated coverage after**: ~75-80% (depends on how many WebSocket-dependent tests fail)

### Phase 2: Clean Stale WebSocket Mocks (7 files)

Remove dead MockWebSocket class, `globalThis.WebSocket` overrides, and beforeEach/afterEach WebSocket setup from files that don't depend on it:

1. `components/shared/__tests__/ModeToggle.test.tsx`
2. `components/shared/__tests__/MoveDialog.test.tsx`
3. `components/browse/__tests__/FileTree.test.tsx`
4. `components/browse/viewers/__tests__/CsvViewer.test.tsx`
5. `components/browse/viewers/__tests__/JsonViewer.test.tsx`
6. `components/browse/viewers/__tests__/MarkdownViewer.test.tsx`
7. `components/browse/viewers/__tests__/TxtViewer.test.tsx`

**Pattern**: These files all have the same ~20-line MockWebSocket boilerplate + beforeEach/afterEach globalThis swap. Remove all of it. Tests should already pass from Phase 1; this is cleanup.

**Verify**: Tests still pass after cleanup.

### Phase 3: Rewrite WebSocket-Dependent Tests for SSE (3 files)

These tests actively wait for WebSocket instances and simulate messages. They need substantive rewrites:

1. **`components/discussion/__tests__/Discussion.test.tsx`** (1352 lines)
   - Discussion now uses `useChat` hook (SSE via fetch)
   - Replace MockWebSocket + wsInstances + simulateMessage with mock fetch returning SSE streams
   - Reference `hooks/__tests__/useChat.test.ts` for SSE mock patterns (createSSEResponse helper already exists there)
   - Focus areas: message display, streaming, tool/permission/question dialogs, draft persistence, slash commands

2. **`components/browse/__tests__/BrowseMode.test.tsx`** (1177 lines)
   - BrowseMode uses REST API hooks (useFileBrowser, useSearch)
   - No SSE needed. Just remove WebSocket mocks and fix any assertions about wsInstances
   - The test already has `createMockFetch()`. Remove WebSocket infrastructure, keep fetch mocking

3. **`components/vault/__tests__/VaultSelect.test.tsx`** (1096 lines)
   - VaultSelect uses REST (vault listing via fetch)
   - Remove WebSocket mocks. Fix assertions about wsInstances and ws.simulateMessage for vault_list
   - Replace WebSocket vault_list simulation with mock fetch responses

**Test helpers to add to `nextjs/test-helpers.ts`:**
- `createSSEResponse(events)` (extract from useChat.test.ts pattern)
- `TestWrapper` component with SessionProvider for common wrapping

**Verify**: All 3 test files pass. Run full suite, check coverage.

**Estimated coverage after Phase 3**: ~80-85%

### Phase 4: Session Reducer Tests (if needed for 80%)

`contexts/session/reducer.ts` is 709 lines with only config update actions tested (81 lines in `reducer-update-config.test.ts`).

**Create**: `contexts/session/__tests__/reducer.test.ts` covering major action types:
- Vault actions: SELECT_VAULT, CLEAR_VAULT
- Session actions: SET_SESSION_ID, SET_MODE, START_NEW_SESSION
- Message actions: ADD_MESSAGE, UPDATE_LAST_MESSAGE, CLEAR_MESSAGES
- Browser actions: SET_CURRENT_PATH, SET_FILE_CONTENT, SET_VIEW_MODE
- Tool actions: ADD_TOOL_TO_LAST_MESSAGE, COMPLETE_TOOL_INVOCATION
- Task/meeting/home actions

These are pure reducer tests (no DOM, no rendering). Fast and high value.

**Estimated coverage after Phase 4**: ~85%

### Phase 5: Remaining Gaps (only if still below 80%)

Prioritized by coverage impact:

1. **Untested hooks** (4 new test files):
   - `hooks/__tests__/useConfig.test.ts`
   - `hooks/__tests__/useMeetings.test.ts`
   - `hooks/__tests__/useMemory.test.ts`
   - `hooks/__tests__/useSessions.test.ts`

2. **Session utilities** (2 new test files):
   - `contexts/session/__tests__/storage.test.ts`
   - `contexts/session/__tests__/initial-state.test.ts`

3. **Library utilities** (3 new test files):
   - `lib/__tests__/sse.test.ts`
   - `lib/__tests__/vault-helpers.test.ts`
   - `lib/__tests__/controller.test.ts`

4. **Untested components** (4 new test files):
   - `components/__tests__/App.test.tsx`
   - `components/home/__tests__/SessionActionsCard.test.tsx`
   - `components/home/__tests__/VaultInfoCard.test.tsx`
   - `components/pair-writing/__tests__/ViCursor.test.tsx`

5. **API route tests** (last resort, probably not needed):
   - 39 routes, all thin wrappers around backend functions already tested at 82.52%
   - Low ROI, skip unless needed

### Cleanup (alongside any phase)

- Remove duplicate test file: `lib/utils/file-types.test.ts` (keep `lib/utils/__tests__/file-types.test.ts`)
- Remove stale `./health-collector` export from `backend/package.json` line 13

---

## Verification

After each phase:
1. `bun run --cwd nextjs test` (all tests pass)
2. `bun run --cwd nextjs test:coverage` (check line coverage)
3. `bun run typecheck` (no type errors)

Final verification:
1. `bun run test` (all workspaces pass)
2. Coverage >= 80% across all workspaces
3. `bun run build` (Next.js build succeeds)

---

## Milestone Targets

| Phase | Effort | Expected Coverage |
|-------|--------|-------------------|
| 1: DOM setup | 15 min | ~75-80% |
| 2: Clean WS mocks | 30 min | ~75-80% (cleanup only) |
| 3: Rewrite WS tests | 3-4 hours | ~80-85% |
| 4: Reducer tests | 1-2 hours | ~85% |
| 5: Remaining gaps | As needed | ~88-90% |

**Target 80% should be achievable by end of Phase 3, with Phase 4 as insurance.**
