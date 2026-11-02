---
title: Legacy Recall search research
date: 2026-11-02
status: completed
tags: [recall, search, legacy, research]
related: [.lore/work/design/recall-fuzzy-search.md]
---

# Legacy Recall search research

## Key Findings

- The pinned legacy search has a hand-written **greedy subsequence filename matcher**, distinct from the token/prefix/fuzzy content index. Running the exact filename function from main confirms both positive `sdk` examples and also a match across the newline in the prohibited negative example. Line-by-line scanning is therefore a required semantic change, not a behavior to inherit.
- The legacy design spent considerable work on fast repeated searches: lazy per-vault search manager, persisted MiniSearch full-text index, mtime refresh, per-vault LRU/TTL cache, and 10,000-file performance tests. This is the most plausible source of the user's “pretty snappy” recollection, but test thresholds and source comments are not measured latency evidence for their actual vault/runtime.
- Its filename matcher and full-text content search are materially different algorithms and semantics. Reusing the old filename scoring intuition (consecutive/boundary/start preference) is possible; reusing MiniSearch would not implement the requested ordered-character line matching.
- Main's file inventory/index is path-string based and performs `lstat` then later `stat`/read by path; current `backend/vault.ts` uses pinned root descriptors and no-follow opens. The latter is a materially stronger existing safety boundary and should remain authoritative; do not transplant the old path-based crawler/index as-is.
- The old client has 250 ms input debounce, but the shown `useSearch` API has no abort signal or stale-generation guard. Retain the useful immediate-input/debounced-request interaction, not its concurrency behavior. Current design's generation fencing/cancellation is a deliberate improvement.

## Scope and evidence

Inspected main by immutable commit `570005f79e0860291cfa422f85f061d737a9af9f` using `git show`/`git ls-tree`; did not checkout/switch branches, run the old application, load its dependencies/config, or access a vault/service. The working branch remained `feat/restart`; no project source was changed. Source mechanisms below are direct inspection; benchmark numbers are only what legacy test code asserts, **not executed measurements**.

### Matching behavior

`daemon/src/files/search/fuzzy-matcher.ts:74-103,118-169,200-229` lowercases input and greedily finds each query code unit left-to-right in filename. It assigns base points, consecutive bonus, start offset penalty, and a word-boundary bonus, sorts score-descending, then returns top 50 by default. Positions are offsets into the JS string (UTF-16 code units). It considers only `name`, despite carrying a relative `path`; therefore there is no path-only matching. It has no accent-folding or Unicode normalization. Whitespace is not removed: the literal query space has to occur in order in the filename.

I extracted that exact committed matcher to `/tmp/opencode/2ku-fuzzy-probe/legacy-fuzzy-matcher.ts` and ran its unchanged function in an isolated Bun script with test-owned strings. It matched both `software development kit` and `I should know better`; it also matched the forbidden two-line string when passed as one filename-like target (positions `[2,7,24]`). `SDK` worked case-insensitively. `cafe` did not match `Café`; the decomposed target matched because its combining mark follows `Cafe`, not because accents were folded. Query `foo bar` matched `foo bar`, but not `bar foo`. This is filename-matcher evidence only, not execution of the content API.

`daemon/src/files/search/search-index.ts:175-209` uses MiniSearch for content with prefix matching, fuzzy tolerance `0.2`, and AND token combination—not the custom subsequence matcher. The same class's `getSnippets` at `:272-331` reads the file again, splits only on LF, finds **literal case-insensitive regex** matches (special characters escaped), and returns first 10 matching lines per file with two context lines each. Therefore indexed search acceptance and displayed snippet matching can disagree: the index may return fuzzy/prefix candidates that literal snippet extraction cannot explain. LF splitting also leaves CR in CRLF line text and does not treat bare CR as a separator.

### Indexing, cache, and freshness

`daemon/src/files/search/search-index.ts:121-135,603-692,733-776` lazily builds on first search. It crawls only `.md` files, excluding dot entries and symlinks; reads all text into a MiniSearch index in batches of 50; the full document text is indexed. `:505-589` provides mtime-based incremental add/update/delete scans. Persistence writes serialized index and file list into `<vault>/06_Metadata/memory-loop/search-index.json` (`:79-86,374-394`); load checks schema version and malformed data (`:405-491`).

`daemon/src/files/search/search-cache.ts:22-39,45-62,103-138,150-155,219-233` caches manager instances per vault with default max 10 and 5-minute TTL/LRU. It exposes explicit cache invalidation. File changes are not inherently fresh on each query: updateIndex/rebuild/invalidation must happen, and TTL expiry creates a new manager whose next query rebuilds/loads. Mtime-only detection can miss edits that preserve mtime; it is not equivalent to current design's per-read stability checks.

Useful idea to retain: amortize repeated filename searches with a small in-memory inventory, if enumeration measurements and invalidation paths support it. Risky to inherit: persisted content index in user vault metadata and freshness rules as currently written. The new feature's match contract and supported content scope differ, so old serialized/index data cannot be reused as a compatible search index.

### API, debounce, rendering, navigation

`daemon/src/routes/search.ts:22-50,52-80,82-103` exposes separate files/content/snippets GET endpoints; response includes result count and `searchTimeMs`. `nextjs/app/api/vaults/[vaultId]/search/files/route.ts:26-39` and corresponding content/snippets routes proxy to the daemon. `nextjs/hooks/useSearch.ts:80-95,100-189` issues requests, manages loading/error and returns results; no request AbortSignal or generation fencing appears in these search methods.

`nextjs/components/browse/SearchHeader.tsx:19-20,52-91` debounces query changes 250 ms and gives immediate local input feedback; it auto-focuses input on mount. Search mode is toggled through a dropdown. `SearchResults.tsx:55-105,107-175` provides result selection, keyboard up/down/Enter and loading/empty states. File results highlight fuzzy positions (`:181-215,352-403`); content result is an expandable file row with count, while snippets load separately. Snippet highlighting is a literal escaped regex of the query (`:408-441`), not the subsequence alignment from fuzzy filename matching nor MiniSearch match positions. Content activation selects a file; the inspected component alone does not establish a source-line jump.

Useful UX precedent: debounce, retain current input responsiveness, provide explicit loading/empty states, keyboard navigation, lazy snippet expansion, and 1-based line numbers. Mismatches with current request/design: flat line-level result hits and exact fuzzy alignment highlighting are new; current design’s Recall-specific draft guards and excerpt navigation must use current app behavior, not inferred legacy behavior.

### Tests and what they establish

`daemon/src/files/__tests__/fuzzy-matcher.test.ts:38-114,116-236,347-371,407-497` covers subsequence matching, case, scattered positions, scoring order, empty/special-character/Unicode cases, result limits and result positions. It does **not** cover the `sdk` sample pair or cross-line semantics. Index tests at `daemon/src/files/__tests__/search-index.test.ts` exercise lazy build, `.md`-only inclusion, hidden/symlink exclusion, limits, snippets and index persistence/incremental refresh; they use controlled fixtures.

`daemon/src/files/__tests__/search-index.perf.test.ts:28-115,130-201,208-267` constructs 10,000 synthetic small Markdown files. It asserts index build under 30 seconds, warmed filename search under 100 ms, warmed content search under 500 ms, and bounds serialized index size. Source proves those assertions were defined; **I did not run them and cannot claim they passed at this pinned commit**. Even a passing test would measure its generator and machine, not the user's actual vault.

## Recommendation for the current design

Do not change the core design direction because legacy search was indexed. Keep current requirements: physical-line ordered-subsequence content matching, no cross-line hit, exact matched-character positions, all eligible saved text, bounded best-result retention with honest coverage, and cooperative cancellable scans. Legacy MiniSearch is for word/token search and would change the product semantics.

The new design should make one modest adjustment: explicitly recognize **small in-memory filename inventory caching** as a candidate optimization, borrowing the legacy lazy inventory and eviction/invalidation concepts—not its persisted full-text index, path-only file traversal, 5-minute stale-cache contract, or assumptions about old mode routes. Avoid promising or freezing such a cache until first/full enumeration cost and invalidation boundaries are measured on owned synthetic fixtures.

If repeated content scanning proves too slow, do not leap directly to copying MiniSearch or the old persisted index. First compare cancellable batched scans against a disposable, versioned index designed for the new physical-line/character-offset contract; measure index build/read, memory/disk size, external edits, crash recovery and invalidation. Current tree's descriptor/no-follow reader and UTF-8/media eligibility boundary must be used for either strategy.
