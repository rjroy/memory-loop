---
specification: ./../specs/2026-01-07-recall-search.md
plan: ./../plans/2026-01-07-recall-search-plan.md
status: Ready for Implementation
version: 1.0.0
created: 2026-01-07
last_updated: 2026-01-07
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Recall Tab Search - Task Breakdown

## Task Summary
Total: 14 tasks | Complexity Distribution: 4×S, 7×M, 3×L

## Foundation

### TASK-001: Define Search Protocol Types
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add search-related message types to the shared protocol schema using Zod discriminated unions.

**Acceptance Criteria**:
- [ ] `search_files` ClientMessage type with query and limit fields
- [ ] `search_content` ClientMessage type with query and limit fields
- [ ] `get_snippets` ClientMessage type with path and query fields
- [ ] `search_results` ServerMessage type with mode, query, results, totalMatches, searchTimeMs
- [ ] `snippets` ServerMessage type with path and snippets array
- [ ] `index_progress` ServerMessage type with stage, filesProcessed, totalFiles
- [ ] `FileSearchResult` and `ContentSearchResult` interfaces defined
- [ ] `ContextSnippet` interface with lineNumber, line, contextBefore, contextAfter

**Files**: Modify: `shared/src/protocol.ts`

**Testing**: TypeScript compilation validates schema correctness

---

### TASK-002: Implement Fuzzy File Name Matcher
**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create custom fuzzy subsequence matching algorithm for file name search per TD-1.

**Acceptance Criteria**:
- [ ] Subsequence matching (case-insensitive) that finds all character positions
- [ ] Scoring algorithm: +3 per consecutive match, -0.1 per char from start, +2 for word boundary
- [ ] Returns top results sorted by score descending (configurable limit)
- [ ] Results include `matchPositions` array for highlighting
- [ ] Handles empty query (returns empty results)
- [ ] Handles special characters in query without regex issues

**Files**: Create: `backend/src/search/fuzzy-matcher.ts`

**Testing**: Unit tests for consecutive preference, word boundary detection, empty query

---

### TASK-003: Add MiniSearch Dependency
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add MiniSearch library to backend for content indexing.

**Acceptance Criteria**:
- [ ] MiniSearch added to backend/package.json dependencies
- [ ] Package installs successfully with `bun install`
- [ ] TypeScript types available (MiniSearch includes types)

**Files**: Modify: `backend/package.json`

**Testing**: `bun install` succeeds, import compiles

---

## Backend Services

### TASK-004: Implement Search Index Manager
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-002, TASK-003

**Description**: Create SearchIndexManager service per TD-2 and TD-3 for per-vault index lifecycle.

**Acceptance Criteria**:
- [ ] `SearchIndexManager` class manages index per vault
- [ ] Lazy loading: index loads on first search, not vault select
- [ ] `buildIndex()` crawls .md files within contentRoot only
- [ ] Excludes .obsidian and other hidden/system folders
- [ ] Uses MiniSearch with prefix:true, fuzzy:0.2, combineWith:'AND'
- [ ] Maintains file list with path, name, mtime for incremental updates
- [ ] `searchFiles(query, limit)` returns FileSearchResult[]
- [ ] `searchContent(query, limit)` returns ContentSearchResult[]
- [ ] `getSnippets(path, query)` extracts matching lines with context

**Files**: Create: `backend/src/search/search-index.ts`

**Testing**: Unit tests with temp vault fixture

---

### TASK-005: Implement Index Persistence
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Add JSON persistence for search index per TD-3.

**Acceptance Criteria**:
- [ ] Index saves to `{contentRoot}/06_Metadata/memory-loop/search-index.json`
- [ ] Creates metadata directory if missing
- [ ] Stores version, lastUpdated, fileHashes, contentIndex (MiniSearch state), fileList
- [ ] Loads existing index on startup
- [ ] Detects index version mismatch and triggers rebuild
- [ ] `updateIndex()` only re-indexes changed files (mtime comparison)
- [ ] Removes entries for deleted files

**Files**: Modify: `backend/src/search/search-index.ts`

**Testing**: Unit tests for save/load round-trip, incremental update logic

---

### TASK-006: Add Search WebSocket Handlers
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001, TASK-004

**Description**: Add message handlers for search operations to websocket-handler.ts.

**Acceptance Criteria**:
- [ ] `handleSearchFiles()` routes to SearchIndexManager.searchFiles()
- [ ] `handleSearchContent()` routes to SearchIndexManager.searchContent()
- [ ] `handleGetSnippets()` routes to SearchIndexManager.getSnippets()
- [ ] All handlers require currentVault to be set (same guard as handleListDirectory)
- [ ] Query echoed back in search_results for client correlation
- [ ] searchTimeMs measured and included in response
- [ ] Sends index_progress messages during index build

**Files**: Modify: `backend/src/websocket-handler.ts`

**Testing**: Integration test with mock vault

---

## Frontend State

### TASK-007: Add Search State to SessionContext
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Extend BrowserState with search state slice per TD-5.

**Acceptance Criteria**:
- [ ] BrowserState.search with isActive, mode, query, results, isLoading, expandedPaths
- [ ] `SET_SEARCH_ACTIVE` action toggles search mode
- [ ] `SET_SEARCH_MODE` action switches files/content
- [ ] `SET_SEARCH_QUERY` action updates query string
- [ ] `SET_SEARCH_RESULTS` action stores results from server
- [ ] `SET_SEARCH_LOADING` action for loading state
- [ ] `TOGGLE_RESULT_EXPANDED` action for content result expansion
- [ ] `CLEAR_SEARCH` action returns to file tree

**Files**: Modify: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Reducer unit tests for each action

---

### TASK-008: Implement Search WebSocket Client
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001, TASK-007

**Description**: Add search message sending and receiving to WebSocket hook.

**Acceptance Criteria**:
- [ ] `sendSearchFiles(query, limit)` sends search_files message
- [ ] `sendSearchContent(query, limit)` sends search_content message
- [ ] `sendGetSnippets(path, query)` sends get_snippets message
- [ ] Handler for search_results updates SessionContext
- [ ] Handler for snippets updates expanded result with context
- [ ] Handler for index_progress shows loading indicator

**Files**: Modify: `frontend/src/hooks/useWebSocket.ts`

**Testing**: Mock WebSocket message flow tests

---

## Frontend Components

### TASK-009: Create SearchHeader Component
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-007

**Description**: Create search header component that replaces FileTree header when search active.

**Acceptance Criteria**:
- [ ] Search icon/button to activate search mode
- [ ] Debounced input (250ms) per TD-4
- [ ] Files/Content mode toggle
- [ ] Clear button to dismiss search
- [ ] 44px minimum height for touch targets (REQ-NF-6)
- [ ] Keyboard accessible (focus, clear with Escape)
- [ ] Matches existing Memory Loop visual patterns

**Files**: Create: `frontend/src/components/SearchHeader.tsx`

**Testing**: Component tests for debounce, mode toggle, clear action

---

### TASK-010: Create SearchResults Component
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-007, TASK-008

**Description**: Create search results component that replaces FileTree when searching.

**Acceptance Criteria**:
- [ ] Displays FileSearchResult[] with highlighted match positions
- [ ] Displays ContentSearchResult[] with match count
- [ ] Content results expandable to show ContextSnippet[]
- [ ] Clicking result triggers handleFileSelect (reuses FileTree behavior)
- [ ] Loading state while search in progress
- [ ] Empty state when no results
- [ ] 44px row height for touch targets
- [ ] Keyboard navigable (arrow keys, Enter to select)

**Files**: Create: `frontend/src/components/SearchResults.tsx`

**Testing**: Component tests for file/content modes, expansion, selection

---

### TASK-011: Integrate Search into BrowseMode
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-009, TASK-010

**Description**: Wire SearchHeader and SearchResults into BrowseMode.tsx.

**Acceptance Criteria**:
- [ ] Conditional render: SearchHeader when search active, normal header otherwise
- [ ] Conditional render: SearchResults when search active, FileTree otherwise
- [ ] Search results use same handleFileSelect as FileTree
- [ ] Empty query clears search and returns to file tree
- [ ] Mode switch (files/content) triggers new search

**Files**: Modify: `frontend/src/components/BrowseMode.tsx`

**Testing**: Integration test for search → result → file navigation

---

## Quality & Polish

### TASK-012: Add Search Error Handling
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-006, TASK-011

**Description**: Implement error handling per spec requirements.

**Acceptance Criteria**:
- [ ] Empty query returns to file tree view (REQ-F-26)
- [ ] Missing/corrupted index triggers rebuild with progress indicator (REQ-F-27)
- [ ] Deleted files excluded from results gracefully (REQ-F-28)
- [ ] Search timeout (>500ms) returns partial results (REQ-NF-9)
- [ ] WebSocket disconnect clears search state

**Files**: Modify: `backend/src/search/search-index.ts`, `frontend/src/components/SearchResults.tsx`

**Testing**: Error scenario tests

---

### TASK-013: Implement Index Performance Optimizations
**Priority**: Medium | **Complexity**: L | **Dependencies**: TASK-004, TASK-005

**Description**: Ensure search meets performance targets.

**Acceptance Criteria**:
- [ ] File name search <100ms for 10K files (REQ-NF-1)
- [ ] Content search <500ms for 10K files (REQ-NF-2)
- [ ] Index build <30s for 10K files (REQ-NF-5)
- [ ] Index size <10% of content size (REQ-NF-4)
- [ ] Batch file reading during index build
- [ ] Results limited to 50 (configurable)

**Files**: Modify: `backend/src/search/search-index.ts`

**Testing**: Performance tests with 10K file fixture

---

### TASK-014: Write Search Integration Tests
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-011

**Description**: End-to-end tests for search functionality.

**Acceptance Criteria**:
- [ ] Fuzzy name match: "perftst" finds "Performance EOS SDK Testing.md"
- [ ] Consecutive preference: "foo" ranks "foobar.md" above "f_o_o.md"
- [ ] Word boundary match: "PT" finds "Performance Testing.md"
- [ ] Content search basic: "TODO" finds files containing "TODO"
- [ ] Scope boundary: .obsidian files not searchable
- [ ] Index persistence: restart doesn't require full re-index

**Files**: Create: `backend/src/__tests__/search-index.test.ts`, `frontend/src/__tests__/Search.test.tsx`

**Testing**: Acceptance test suite mapped from spec

---

## Dependency Graph
```
TASK-001 (Protocol) ──┬─> TASK-006 (WS Handlers)
                      └─> TASK-007 (State) ──┬─> TASK-008 (WS Client)
                                             └─> TASK-009 (SearchHeader)
                                             └─> TASK-010 (SearchResults)

TASK-002 (Fuzzy) ─────> TASK-004 (Index Manager)
TASK-003 (MiniSearch) ─┘
                        └─> TASK-005 (Persistence)
                        └─> TASK-006 (WS Handlers)
                        └─> TASK-012 (Error Handling)
                        └─> TASK-013 (Performance)

TASK-009 + TASK-010 ──> TASK-011 (BrowseMode Integration)
TASK-011 ─────────────> TASK-012 (Error Handling)
                        TASK-014 (Integration Tests)
```

## Implementation Order

**Phase 1** (Foundation, parallelizable): TASK-001, TASK-002, TASK-003
**Phase 2** (Backend core): TASK-004, TASK-005, TASK-006
**Phase 3** (Frontend state): TASK-007, TASK-008
**Phase 4** (Frontend UI): TASK-009, TASK-010, TASK-011
**Phase 5** (Polish): TASK-012, TASK-013, TASK-014

## Notes

- **Parallelization**: Phase 1 tasks are independent. Phase 3 can start once TASK-001 complete.
- **Critical path**: TASK-001 → TASK-007 → TASK-009/010 → TASK-011 (UI completion)
- **Risk mitigation**: TASK-013 (performance) can be started early if concerns arise during TASK-004
