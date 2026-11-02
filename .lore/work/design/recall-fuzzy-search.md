---
title: Recall filename and content search
date: 2026-11-02
status: draft
tags: [recall, search, fuzzy-matching, design]
related: [.lore/work/design/recall-media-and-attachments.md]
---

# Recall filename and content search

## Decision

Add two search modes inside Recall's Files pane: **Filename** and **Content**.
Use **fuzzysort 4.0.2** behind an explicit ordered-subsequence contract. Search
content one physical source line at a time. Start with cancellable, on-demand
daemon scans, not a persistent content index or a search service.

This is the proposed solution for **memory-loop-2ku**, not implementation
authorization. Existing Markdown editing, media viewing, uploads and file actions
remain intact.

## Matching contract

Query characters must occur in order, with gaps allowed. Matching is
case-insensitive and uses the matcher's supported accent normalization. This is
neither semantic search nor typo correction: absent or reordered letters do not
become matches through meaning or edit distance.

- Ignore query whitespace, retaining the order of the remaining characters.
  Thus `foo bar` searches as `foobar`, not as two reorderable terms. Whitespace
  does not introduce an advanced query language.
- An empty or whitespace-only query restores the tree and starts no search.
- Content targets are individual physical lines, split on LF, CRLF or CR. Visual
  wrapping does not introduce boundaries, and characters never bridge lines.
- Match the whole eligible line, not merely a preview or an 80-character window.
  Snippet clipping affects presentation only.
- Accept every ordered match returned by the matcher. Do not add a score cutoff
  that drops weak but valid matches. Scores rank results; they are not confidence
  percentages.
- Filename mode searches file basenames and vault-relative paths, separately.
  A basename hit ranks above a path-only hit. Folders provide path context but
  are not additional result rows. All visible file kinds are eligible.

Required examples for `sdk`:

| Target | Result |
| --- | --- |
| `software development kit` | Match |
| `I should know better` | Match: `s`, the `d` in `should`, then `k` |
| `I should've been there.` followed by a newline and `Knowing what I know now I would've.` | No match: neither line independently contains the sequence |

Content search covers saved files, not an unsaved editor draft. It includes
Markdown and other valid UTF-8 text, including `.json`, `.ts` and `LICENSE`.
Known media/binary files are excluded from content search but remain searchable
by filename. Do not render search snippets as Markdown or execute source text.

## Library and ranking

Choose the focused MIT-licensed `fuzzysort` rather than an edit-distance matcher
such as Fuse. Actual probes verified the required positive matches, case/accent
handling, ranking and character positions under Bun 1.4.3.

The adapter is important:

1. Normalize query whitespace before calling the library. Its default spaced
   query behavior can match `foo bar` against `bar foo`, which is not this
   feature's ordered-character contract.
2. Split content into lines before matching. Calling the library on an entire
   file would permit the prohibited cross-line match.
3. Use explicit prepared targets for transient content lines, rather than
   allowing `single(query, string)` to accumulate the library's string-target
   cache across an entire vault. Retain only the bounded best results and the
   small filename inventory, not every prepared content line.
4. Consume returned positions as UTF-16 offsets into the original target.
   Highlight safely using text nodes and `<mark>`; expand ranges to whole
   graphemes where necessary rather than splitting combining characters or
   surrogate pairs. Never construct highlighted HTML strings.

Within each filename category, order by matcher score, then a deterministic
vault-relative path tie-break. For content, retain the best matching lines
globally, group the retained hits by file, order groups by their best line score,
and show each group's lines in source order. One physical line appears once even
if more than one alignment matches. Initial display limits are 50 filename hits
or 100 matching lines. Keep ranking separate from the decision to accept a match.

## Files-pane experience

Keep the current Files title, root menu and collapse control. Put one native
search input below that header and compact **Filename / Content** mode controls
beneath it. Default to Filename; switching mode retains the query. No new global
toolbar or separate search destination is needed.

An empty query shows the existing tree. A nonempty query replaces the tree with a
flat results list, preserving tree expansion/scroll separately from result
scroll. Clear search returns to that tree state. Keep query, mode and result
position in volatile Recall session state; do not persist note contents in
browser storage.

- Filename results show name and relative folder path. Highlight the field that
  matched, including a path-only match rather than unexplained name emphasis.
- Content results show the file path and independently selectable lines with
  1-based line numbers. Snippets are literal escaped source with exact match
  highlighting. Use ellipsized context windows if dispersed matches do not fit;
  preserve all matched positions rather than clipping away the explanation.
- Results are native links/lists, not a combobox. Do not auto-open the first hit.
  Modified-click/new-tab behavior remains native.
- Escape clears a nonempty query before applying existing pane-collapse
  behavior; innermost menus/dialogs keep their current Escape priority.
- Keep controls touch-sized and usable at narrow widths and enlarged text.
  Preserve the dark brand and document area; add no artwork or decorative motion.

Debounce edits initially by about 200 ms, but do not confuse debounce with
resource control. Show Searching while a new query is pending. Fence responses
by query, mode and generation; old results must not become actionable under the
new query. Announce settled counts politely, not whole snippets.

## Opening a content hit

Route activation through existing Recall draft/navigation guards before changing
selection, reader presentation, scroll or mobile Files visibility. A hit in the
currently edited file must also respect the guard. Keep editing preserves the
draft, selection and editor scroll; search never implicitly saves a draft.

Open a **read-only source excerpt** at the hit, not automatically in Edit. Reuse
the raw-text reader's literal text and wrapping treatment. Show the matching line
and up to three surrounding lines on each side, with physical line numbers and a
clear label such as **Source excerpt · lines 24–30**. Distinguish the target line
and matched characters without relying on color alone. Bound excerpt bytes;
clip unusually long context explicitly rather than pretending it is a full file.

For Markdown, offer **Read formatted**; for other text, **Open full file**. These
return to the ordinary reader, restoring its prior position if available or
starting at the top. Do not promise an exact formatted-line jump or introduce
Markdown AST scroll mapping in this slice. Ordinary filename results continue to
open the normal reader.

Return a file-version token with each content result. The daemon must verify that
token against the source opened for the excerpt. Changed/replaced content must
produce **This file changed. Search again.**, not a highlight on an unrelated line.
Use the same selection for a successful same-file line jump, but explicitly
update the excerpt; do not lose the action through a same-path navigation shortcut.

Successful ordinary activation closes phone Files as today. Preserve query and
result scroll so returning to Files does not replace the search with a tree reveal.
New-tab links carry the result location/version so they can open the same context,
subject to the same freshness validation.

## Daemon architecture and performance

All matching, scanning, eligibility and result ranking live in the daemon.
Next exposes a fixed, validated same-origin search boundary with server-held
daemon credentials. The frontend supplies query/mode and presents bounded results.
No model calls, shell search commands or new external service are involved.

Use the existing pinned-root, no-follow vault boundary. Reuse its visible
namespace: omit dot entries, symlinks and nonregular files. A filename query can
reuse a short-lived validated inventory, invalidated by confirmed application
mutations and explicit refresh; it must not become a permanently stale index.
Content searches read saved bytes and validate file stability around each read.
Use streaming UTF-8 decoding for content, rather than searching only the reader's
2 MiB preview. If a file changes or fails decoding, discard its provisional hits
and count it as unsearched/changed.

Bound concurrent reads and retained results. Process matching in small,
time-budgeted batches with cooperative yields and prompt abort checks. A single
large synchronous `go()` over the entire vault is not acceptable: it can delay
chat/event handling even if the search input is debounced. Measure actual read,
matching and scheduling behavior; move work to a worker only if cooperative
execution fails that responsiveness check.

Initial safety limits: 128 non-whitespace query characters, a 256 KiB physical-line
buffer and a 30-second search deadline. Oversized lines are skipped and counted
while scanning continues through subsequent lines. There is no 10,000-entry
vault rejection or silent whole-file preview cutoff. These limits bound work,
not claims of complete coverage. Use a dedicated search request budget rather
than inheriting the five-second metadata request timeout or altering global
Next startup. Finite slow-search timeouts are expected.

Return coverage and completeness separately from result limits:

- A finished scan can report totals even if only the best 50/100 hits are shown.
- A deadline, unreadable/changed file, invalid encoding or oversized line must
  mark coverage incomplete with reason/count information. Zero retained hits
  under incomplete coverage is not a definitive no-results statement.
- Explicitly say when only a bounded subset is shown; do not present the
  retained count as the full match count.

Search is read-only and safely repeatable. Cancel obsolete queries and release
their request-owned resources on replacement/disconnect; retain the query in the
UI for retry. No durable search-job/session framework is needed. This is distinct
from an admitted chat/tool operation or file publication, whose effects cannot
be replayed merely because a subscriber disconnected.

Confirmed save/create/move/delete/upload and explicit refresh invalidate active
results and rerun the current query without moving the reader, stealing input
focus or auto-selecting a hit. Fence late completions during navigation. Log one
attempt/outcome per search with mode, query length, duration and counts, not raw
queries, source text or per-line chatter.

## Research evidence and its limits

Research compared fuzzysort 4.0.2, fzf-for-js 0.5.2 and Fuse 7.5.0. Only fuzzysort
was executed in the owned probe; no project dependency was added.

The Bun 1.4.3 synthetic probe measured approximately 15 ms for 10,000 filenames,
152 ms for 100,000 ordinary lines, and 2.7 ms for one 100,000-character line.
Opening/statting/closing 10,000 tiny fixture files took about 125 ms. Those files
totalled only about 569 KB: these are not production-vault latency guarantees or
proof of full-size I/O throughput. A synchronous scan delayed a timer by about
49 ms, supporting cooperative scheduling rather than debounce alone.

Probe: `/tmp/opencode/2ku-fuzzy-probe/probe.mjs`, results: `result.json` beside it.
The exact package tarball SHA-256 was
`edc853244ae05611448e56134cf41b9e8c407b8f8defb30bbf29bf202b6e146c`.
Additional direct probes confirmed that whitespace normalization preserves order
and that explicit prepared targets accept both required positive examples.

Sources:
- [fuzzysort source and API](https://github.com/farzher/fuzzysort)
- [Published fuzzysort 4.0.2 package](https://registry.npmjs.org/fuzzysort/-/fuzzysort-4.0.2.tgz)
- [fzf-for-js](https://github.com/ajitid/fzf-for-js)
- [Fuse documentation](https://www.fusejs.io/)

## Implementation acceptance

Use controlled files and inputs, not the personal vault. Test the required three
examples, ordering/whitespace, case/accents, UTF-16/grapheme highlights, CRLF/CR/LF,
literal special characters, long lines and no cross-line matches. Assert ranking
properties and deterministic ties without freezing incidental floating scores.

Exercise saved Markdown, JSON, TypeScript, LICENSE, unsupported binary, large text,
invalid UTF-8, file replacement and unsafe paths. Verify declared coverage,
bounded retained results, cancellation/descriptor release, query fencing, source
excerpt freshness and same-file/different-file draft guards through the real
Next-to-daemon route. Check native modified clicks and mobile result return state.

Benchmark realistic synthetic full-size reads separately from matcher throughput,
including a 10,000-plus-entry corpus, while another owned stream stays responsive.
Inspect desktop/mobile/enlarged-text rendering. If measured interactive cost is
unacceptable after batching/cancellation, revisit caching or an incremental index
with that evidence; a watcher/indexing platform is not part of the initial design.
