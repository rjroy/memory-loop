---
specification: ./../specs/2026-01-07-recall-search.md
status: Approved
version: 1.0.0
created: 2026-01-07
last_updated: 2026-01-07
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Recall Tab Search - Technical Plan

## Overview

This plan describes how to implement search functionality for the Recall tab (BrowseMode). The architecture adds a search index service on the backend that maintains per-vault indexes, extends the WebSocket protocol with search message types, and adds search UI components to the frontend that replace the FileTree header when active.

Key technical choices:
- **Custom fuzzy matcher** for file names (no external dependencies) to keep bundle small and control scoring behavior
- **MiniSearch** library for content indexing (inverted index with configurable tokenization)
- **Disk-based JSON persistence** for index storage in the vault's metadata folder
- **Debounced client-side requests** to reduce server load during as-you-type search

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend                                   │
├─────────────────────────────────────────────────────────────────────┤
│  BrowseMode.tsx                                                     │
│  ├── SearchHeader (new) - toggles between Files/Content modes      │
│  │   └── SearchInput - debounced input, clear button               │
│  ├── SearchResults (new) - replaces FileTree when searching        │
│  │   ├── FileNameResult - highlighted matches                      │
│  │   └── ContentResult - expandable context snippets               │
│  ├── FileTree (existing) - shown when not searching                │
│  └── MarkdownViewer (existing)                                     │
│                                                                     │
│  SessionContext.tsx                                                 │
│  └── browser.search - new search state slice                       │
└──────────────────────────────────────────────────────────────────────
                              │
                              │ WebSocket
                              │ search_files, search_content
                              │ search_results
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Backend                                    │
├─────────────────────────────────────────────────────────────────────┤
│  websocket-handler.ts                                               │
│  └── handleSearchFiles(), handleSearchContent()                     │
│                                                                     │
│  search-index.ts (new)                                              │
│  ├── SearchIndexManager - per-vault index lifecycle                 │
│  ├── FileNameIndex - fuzzy subsequence matcher                      │
│  └── ContentIndex - MiniSearch wrapper                              │
│                                                                     │
│  Index Persistence                                                  │
│  └── {vault}/06_Metadata/memory-loop/search-index.json              │
└─────────────────────────────────────────────────────────────────────┘
```

## Technical Decisions

### TD-1: Custom Fuzzy Matcher for File Names

**Choice**: Implement custom fuzzy subsequence matching algorithm rather than using an external library.

**Requirements**: REQ-F-6, REQ-F-7, REQ-F-8, REQ-F-9, REQ-F-10, REQ-NF-1

**Rationale**:
- No existing dependency in the project for fuzzy matching; adding fuse.js (~10KB) or fzf-for-js (~15KB) would increase bundle size significantly vs ~100 lines of custom code
- Custom implementation gives full control over scoring factors (consecutive matches, start position, word boundaries) to meet the specific ranking requirements in REQ-F-7
- Performance requirement (REQ-NF-1: <100ms) is achievable with simple O(n) scan since file list fits in memory
- Matching file name only (REQ-F-10) while displaying full path is straightforward with custom code

**Algorithm outline**:
1. Normalize both query and file name to lowercase
2. Find all subsequence matches using greedy left-to-right scan
3. Score based on:
   - Consecutive character bonus: +3 per consecutive match
   - Start position penalty: -0.1 per character from start
   - Word boundary bonus: +2 when match starts at word boundary (after `/`, `-`, `_`, space)
4. Return top 50 results sorted by score descending
5. Results include `matchPositions` array for highlighting (REQ-F-8)

### TD-2: MiniSearch for Content Indexing

**Choice**: Use MiniSearch library for full-text content search.

**Requirements**: REQ-F-11, REQ-F-14, REQ-NF-2, REQ-NF-3, REQ-NF-4

**Rationale**:
- MiniSearch is a lightweight (~7KB gzipped), zero-dependency library designed for in-memory full-text search
- Supports prefix search, fuzzy matching, and field boosting out of the box
- Index can be serialized/deserialized for persistence (native JSON support)
- Fits the performance requirement: designed for sub-100ms searches on 100K+ documents
- Alternatives considered:
  - **lunr.js**: Larger bundle, index serialization requires extra work
  - **FlexSearch**: More complex API, overkill for our use case
  - **SQLite FTS**: Would require native module, complicates deployment

**Configuration**:
```typescript
new MiniSearch({
  fields: ['content'],
  storeFields: ['path'],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
  }
})
```

### TD-3: JSON-Based Index Persistence

**Choice**: Persist index as JSON file in vault's metadata folder.

**Requirements**: REQ-F-18, REQ-F-19, REQ-F-20, REQ-F-21, REQ-NF-4, REQ-NF-5

**Rationale**:
- MiniSearch supports native JSON serialization/deserialization
- JSON is human-readable for debugging and compatible with the existing vault structure
- File-based storage requires no additional dependencies (no SQLite, no separate index service)
- Metadata folder (`06_Metadata/memory-loop/`) already used for other Memory Loop data
- Version field in index allows for schema migrations when format changes

**Index structure**:
```json
{
  "version": 1,
  "lastUpdated": "2026-01-07T12:00:00Z",
  "fileHashes": { "path": "contentHash" },
  "contentIndex": { /* MiniSearch serialized state */ },
  "fileList": [ { "name": "...", "path": "...", "mtime": 123 } ]
}
```

**Incremental updates**:
- On startup, compare file mtimes with stored index
- Re-index only files that changed (mtime differs) or are new
- Remove entries for deleted files
- Save index after batch update completes

### TD-4: Debounced Client-Side Requests

**Choice**: Debounce search input on frontend (250ms) rather than rate-limiting on backend.

**Requirements**: REQ-F-25, REQ-NF-1

**Rationale**:
- Reduces WebSocket message volume during rapid typing
- Simpler implementation than server-side rate limiting per connection
- 250ms debounce provides responsive feel while preventing excessive requests
- Backend still processes requests immediately (no queue), keeping latency predictable
- If user types "test", they trigger 1 request instead of 4

### TD-5: Search State and Result Interaction

**Choice**: Add search state to existing `BrowserState` interface in SessionContext.

**Requirements**: REQ-F-1, REQ-F-2, REQ-F-3, REQ-F-4, REQ-F-5, REQ-F-12, REQ-F-13, REQ-F-15

**Rationale**:
- Follows existing pattern (BrowserState already tracks currentPath, expandedDirs, etc.)
- Search state is UI-local, doesn't need persistence across sessions
- Keeps search results in React state for efficient re-rendering
- Allows FileTree and SearchResults to share file selection behavior via existing `handleFileSelect` (REQ-F-5, REQ-F-15)
- `expandedPaths` set tracks which content results are expanded to show snippets (REQ-F-13)
- Results display as file list initially (REQ-F-12), expand on click to show context

**New state shape**:
```typescript
interface BrowserState {
  // ... existing fields ...
  search: {
    isActive: boolean;
    mode: 'files' | 'content';
    query: string;
    results: SearchResult[];
    isLoading: boolean;
    expandedPaths: Set<string>; // for content results (REQ-F-13)
  };
}
```

**Result interaction flow**:
1. User clicks result row → if content mode, toggle expansion and fetch snippets
2. User clicks file name/path → navigate to file (reuses FileTree's selection logic)
3. Snippets loaded on demand via `get_snippets` message when row expanded

### TD-6: Search Scope Enforcement

**Choice**: Use existing `isPathWithinVault()` for search scope validation, with vault's `contentRoot`.

**Requirements**: REQ-F-16, REQ-F-17

**Rationale**:
- Security is enforced at index build time, not search time, preventing any path outside content root from entering the index
- `contentRoot` already respects vault configuration (handles cases where vault root differs from content root)
- `isPathWithinVault()` in `file-browser.ts` handles symlink resolution and path traversal protection
- Index builder filters to `.md` files only during crawl phase, excluding system folders like `.obsidian`
- No additional scope validation needed at search time since index only contains valid paths
- This approach ensures users cannot search into system folders even if they craft malicious queries

### TD-7: WebSocket Protocol Extension

**Choice**: Add new message types following existing discriminated union pattern.

**Requirements**: REQ-F-22, REQ-F-23, REQ-F-24

**Rationale**:
- Existing protocol uses Zod discriminated unions (`ClientMessage`, `ServerMessage`) for type-safe message routing
- Adding `search_files`, `search_content`, `search_results` follows same pattern
- `get_snippets` / `snippets` messages enable lazy loading of context without bloating initial results
- Query echoed back in `search_results` allows client to correlate responses with requests (handles out-of-order delivery)

### TD-8: Mobile and Accessibility Compliance

**Choice**: Apply existing Memory Loop mobile-first patterns to search UI components.

**Requirements**: REQ-NF-6, REQ-NF-7, REQ-NF-8

**Rationale**:
- SearchHeader and SearchResults components will use 44px minimum height for touch targets (consistent with existing FileTree rows)
- Search input will be focusable with keyboard, results navigable with arrow keys
- Clear button will have sufficient tap target size and visible focus state
- Visual styling will match existing BrowseMode header/list patterns for consistency
- Loading states will use existing spinner patterns from DiscussionMode

## Data Model

### SearchResult (shared/protocol.ts)

```typescript
// File name search result
interface FileSearchResult {
  path: string;           // Relative to content root
  name: string;           // File name only
  score: number;          // Match quality (higher = better)
  matchPositions: number[]; // Character positions that matched
}

// Content search result
interface ContentSearchResult {
  path: string;           // Relative to content root
  name: string;           // File name only
  matchCount: number;     // Number of matches in file
  snippets?: ContextSnippet[]; // Populated on expand
}

interface ContextSnippet {
  lineNumber: number;     // 1-indexed
  line: string;           // The matched line
  contextBefore: string[]; // Up to 2 lines before
  contextAfter: string[]; // Up to 2 lines after
}
```

### IndexedFile (backend internal)

```typescript
interface IndexedFile {
  path: string;           // Relative path from content root
  name: string;           // File name without extension
  mtime: number;          // Last modified timestamp
  contentHash?: string;   // MD5 hash for change detection (content index only)
}
```

## API Design

### WebSocket Protocol Extensions

**Client → Server**:

```typescript
// File name search request
interface SearchFilesMessage {
  type: 'search_files';
  query: string;           // User input
  limit?: number;          // Max results (default 50)
}

// Content search request
interface SearchContentMessage {
  type: 'search_content';
  query: string;           // User input
  limit?: number;          // Max results (default 50)
}

// Request snippets for a specific file
interface GetSnippetsMessage {
  type: 'get_snippets';
  path: string;            // File path
  query: string;           // Original search query
}
```

**Server → Client**:

```typescript
// Search results
interface SearchResultsMessage {
  type: 'search_results';
  mode: 'files' | 'content';
  query: string;           // Echo back query for client correlation
  results: FileSearchResult[] | ContentSearchResult[];
  totalMatches: number;    // Total before limit
  searchTimeMs: number;    // For debugging/monitoring
}

// Snippet response
interface SnippetsMessage {
  type: 'snippets';
  path: string;
  snippets: ContextSnippet[];
}

// Index building progress (optional, for large vaults)
interface IndexProgressMessage {
  type: 'index_progress';
  stage: 'scanning' | 'indexing' | 'complete';
  filesProcessed: number;
  totalFiles: number;
}
```

## Integration Points

### websocket-handler.ts

Add two new message handlers following existing pattern:
- `handleSearchFiles()` - routes to `SearchIndexManager.searchFiles()`
- `handleSearchContent()` - routes to `SearchIndexManager.searchContent()`

Both require `currentVault` to be set (same guard as `handleListDirectory()`).

### SessionContext.tsx

Add new actions following existing reducer pattern:
- `SET_SEARCH_ACTIVE` - toggle search mode
- `SET_SEARCH_MODE` - switch between files/content
- `SET_SEARCH_QUERY` - update query string
- `SET_SEARCH_RESULTS` - store results from server
- `SET_SEARCH_LOADING` - loading state
- `TOGGLE_RESULT_EXPANDED` - for content result expansion
- `CLEAR_SEARCH` - return to file tree

### BrowseMode.tsx

Conditional rendering based on `browser.search.isActive`:
- When active: render `SearchHeader` + `SearchResults`
- When inactive: render existing header + `FileTree`

File selection (`handleFileSelect`) shared between FileTree and SearchResults.

## Error Handling, Performance, Security

### Error Strategy

- **Empty query** (REQ-F-26): Return to normal file tree view immediately, no server request
- **Index missing/corrupted** (REQ-F-27): Detect on load, trigger background rebuild, show progress indicator via `index_progress` messages
- **File deleted during search** (REQ-F-28): Filter out from results gracefully (file not found is not an error)
- **Search timeout**: Return partial results if search exceeds 500ms (REQ-NF-9)
- **WebSocket disconnect**: Search state cleared, user re-searches on reconnect

### Performance Targets

| Metric | Target | Approach |
|--------|--------|----------|
| File name search | <100ms | In-memory file list, O(n) fuzzy match |
| Content search | <500ms | MiniSearch inverted index |
| Index build (10K files) | <30s | Batch file reading, streaming parse |
| Index size | <10% of content | Store paths and tokens, not full content |

**Optimization techniques**:
- Lazy load index on first search (not on vault select)
- Debounce client requests (250ms)
- Limit results to 50 (configurable)
- Stream snippets on demand (not in initial results)

### Security Measures

- All search paths validated via `isPathWithinVault()` before returning results
- Index only includes files within `contentRoot` (excludes .obsidian, etc.)
- No regex support in v1 to prevent ReDoS
- Index file stored in vault metadata, not exposed via API

## Testing Strategy

### Unit Tests

- **Fuzzy matcher**: Test scoring algorithm edge cases
  - Consecutive vs scattered matches
  - Word boundary detection
  - Empty query, single character, special characters
- **Index manager**: Test persistence round-trip
  - Serialize/deserialize index
  - Incremental update logic
  - Deleted file handling

### Integration Tests

- **WebSocket protocol**: Test message flow
  - Search request → results response
  - Snippet request → snippet response
  - Error responses for invalid queries
- **End-to-end search**: Test with fixture vault
  - File name fuzzy matching accuracy
  - Content search relevance
  - Result limit enforcement

### Performance Tests

- Create 10K file fixture vault
- Measure cold start index build time
- Measure search latency under load

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MiniSearch index too large for 10K files | Low | Medium | Monitor index size, consider token compression if needed |
| Fuzzy matching too slow on large file lists | Low | Medium | Profile and optimize hot path, consider prefix filtering |
| Index persistence causes startup delay | Medium | Low | Lazy load index on first search, not vault select |
| Content snippets slow for files with many matches | Low | Low | Limit snippets per file to 10, paginate if needed |
| Mobile UI constraints not met | Low | Medium | Test on mobile devices during development, verify 44px touch targets with browser dev tools |

## Dependencies

### Technical

- **MiniSearch** (~7KB): Add to backend/package.json
  ```bash
  cd backend && bun add minisearch
  ```

### Team

- No approvals needed (feature scoped to Recall tab)
- No infrastructure changes (file-based storage)

## Open Questions

- [x] Index location: Use existing metadata path (`06_Metadata/memory-loop/`)
- [x] Snippet context lines: 2 lines before/after per spec acceptance test
- [ ] Should search persist across mode switches (home → recall → home → recall)?
  - Current plan: Clear search when leaving BrowseMode for simplicity

---

**Next Phase**: Once approved, use `/spiral-grove:task-breakdown` to decompose into implementable tasks.
