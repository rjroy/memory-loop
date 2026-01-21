---
version: 1.0.0
status: Approved
created: 2026-01-07
last_updated: 2026-01-07
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
issue: https://github.com/rjroy/memory-loop/issues/183
---

# Recall Tab Search Specification

## Executive Summary

Add search functionality to the Recall tab (BrowseMode) to help users find files in large Obsidian vaults. The feature supports two search modes: file name search using fuzzy subsequence matching, and file content search using full-text search. Vaults may contain years of notes and thousands of files, so the system must use indexing to achieve sub-100ms response times for as-you-type search.

The search UI replaces the FileTree header when active, providing a focused search experience while maintaining the existing Files/Tasks toggle. Results display in place of the file tree, with content search results expandable to show context snippets.

## User Story

As a Memory Loop user with a large Obsidian vault, I want to search for files by name or content so that I can quickly find relevant notes without manually browsing the file tree.

## Stakeholders

- **Primary**: Memory Loop users with established Obsidian vaults (1000+ files)
- **Secondary**: Mobile users who need efficient navigation on smaller screens
- **Tertiary**: Backend maintainers (indexing system), contributors (protocol changes)

## Success Criteria

1. File name search returns results in <100ms for vaults with 10,000+ files
2. Content search returns results in <500ms for vaults with 10,000+ files
3. Fuzzy file name matching finds "Performance EOS SDK Testing" when searching "perftst"
4. Index persists across server restarts, rebuilding only when vault contents change

## Functional Requirements

### Search UI

- **REQ-F-1**: Search input replaces the FileTree header ("Files"/"Tasks" toggle area) when search is active
- **REQ-F-2**: User can toggle between "Files" (file name) and "Content" search modes
- **REQ-F-3**: Search input includes a clear button to dismiss search and return to normal file tree
- **REQ-F-4**: Search results replace the file tree content area while search is active
- **REQ-F-5**: Clicking a search result navigates to and opens that file (same as FileTree selection)

### File Name Search

- **REQ-F-6**: File name search uses fuzzy subsequence matching (case-insensitive)
- **REQ-F-7**: Matching prioritizes: consecutive character matches, match start position, word boundary matches
- **REQ-F-8**: Results display file name with matched characters highlighted
- **REQ-F-9**: Results are sorted by match quality score (best matches first)
- **REQ-F-10**: Search matches against file name only (not full path), but results display relative path

### Content Search

- **REQ-F-11**: Content search performs full-text search across .md file contents
- **REQ-F-12**: Results initially display as file list with match count per file
- **REQ-F-13**: Each result row is expandable to show context snippets (matched line with surrounding context)
- **REQ-F-14**: Content search is case-insensitive by default
- **REQ-F-15**: Clicking a content result opens the file (same as file name results)

### Search Scope

- **REQ-F-16**: Search operates within the vault's content root only (excludes system folders like .obsidian)
- **REQ-F-17**: Search includes all .md files within content root (no hidden file filtering beyond content root boundary)

### Indexing

- **REQ-F-18**: Backend builds and maintains a search index for each vault
- **REQ-F-19**: Index is stored persistently in the vault's metadata folder
- **REQ-F-20**: Index rebuilds incrementally when files change (add/modify/delete)
- **REQ-F-21**: Index version is tracked to handle schema migrations

### WebSocket Protocol

- **REQ-F-22**: New `search_files` message type for file name search requests
- **REQ-F-23**: New `search_content` message type for content search requests
- **REQ-F-24**: New `search_results` message type for streaming search results to client
- **REQ-F-25**: Search requests include query string and are debounced client-side

### Error Handling

- **REQ-F-26**: Empty search query returns to normal file tree view (no results state)
- **REQ-F-27**: Missing or corrupted index triggers automatic rebuild with progress indicator
- **REQ-F-28**: Deleted files are excluded from search results without error (graceful handling)

## Non-Functional Requirements

- **REQ-NF-1** (Performance): File name search results return in <100ms for as-you-type responsiveness
- **REQ-NF-2** (Performance): Content search results return in <500ms for reasonable UX
- **REQ-NF-3** (Scalability): System must handle vaults with 10,000+ files without degradation
- **REQ-NF-4** (Storage): Index size must not exceed 10% of vault content size
- **REQ-NF-5** (Startup): Initial index build for a 10,000-file vault completes in <30 seconds
- **REQ-NF-6** (Mobile): Search UI maintains 44px minimum touch targets
- **REQ-NF-7** (Accessibility): Search input and results are keyboard navigable
- **REQ-NF-8** (Consistency): Search UI follows existing Memory Loop visual patterns
- **REQ-NF-9** (Resilience): When search exceeds latency target, system returns available results rather than timing out

## Explicit Constraints (DO NOT)

- Do NOT search outside the content root boundary (security constraint)
- Do NOT index non-.md files (scope limitation)
- Do NOT implement regex search (complexity constraint for v1)
- Do NOT search within code blocks or frontmatter separately (v1 treats all content uniformly)
- Do NOT persist search history or recent searches (privacy consideration)
- Do NOT add search to other modes (Home, Note, Discussion)

## Technical Context

- **Existing Stack**: Hono backend, React 19 frontend, WebSocket communication via Zod-validated protocol
- **Integration Points**:
  - `file-browser.ts` for vault path validation
  - `shared/protocol.ts` for new message schemas
  - `BrowseMode.tsx` for UI integration
  - `SessionContext.tsx` for state management
- **Patterns to Respect**:
  - Security: All paths validated via `isPathWithinVault()`
  - Protocol: Zod schemas for all WebSocket messages
  - State: useReducer pattern in SessionContext
  - Mobile-first: 44px touch targets, responsive design

## Acceptance Tests

1. **Fuzzy Name Match**: Search "perftst" finds "Performance EOS SDK Testing.md"
2. **Consecutive Preference**: Search "foo" ranks "foobar.md" above "f_o_o.md"
3. **Word Boundary Match**: Search "PT" finds "Performance Testing.md" (P-erformance T-esting)
4. **Content Search Basic**: Search "TODO" finds all files containing "TODO"
5. **Content Context**: Expanding a content result shows the matched line with 2 lines of context
6. **Scope Boundary**: Files in `.obsidian/` folder are not searchable
7. **Index Persistence**: Restarting server does not require full re-index (uses cached index)
8. **Latency Target**: File name search with 10,000 indexed files returns in <100ms
9. **Mode Toggle**: Switching between Files/Content mode clears results and re-searches
10. **Clear Search**: Clicking clear button returns to normal file tree view
11. **Mobile Touch**: Search input and result rows meet 44px height minimum
12. **Empty Query**: Clearing search input returns to file tree view
13. **Index Recovery**: Deleting index file triggers automatic rebuild on next search

## Open Questions

- [x] Search UI placement: Replaces FileTree header when active
- [x] Search scope: Content root only
- [x] Result display: Expandable context for content search
- [x] Latency target: <100ms for file names (as-you-type)
- [x] Index persistence: Disk-based, survives restart
- [x] Match ranking: All three factors (consecutive, start position, word boundary)
- [x] Mode switching: Separate toggle between Files and Content modes

## Out of Scope

- Full regex search support
- Search within specific file sections (frontmatter, code blocks)
- Search history or saved searches
- Search in non-.md files (images, PDFs, etc.)
- Cross-vault search
- Boolean operators (AND, OR, NOT)
- Search filters (by date, by folder, by tag)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
