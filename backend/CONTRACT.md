# Recall daemon contract

The daemon loads `.memory-loop/config.json` relative to the project root once at startup. Its JSON object has a `vaultDirectory` string containing a nonempty absolute directory path. Changes require restart; configuration lives outside the vault and is not returned to clients. Missing and malformed configuration, and an unavailable vault, remain distinct from an empty tree.

The daemon endpoints are private and authenticated; browser requests go through the Next server boundary. The daemon serves no frontend assets or SPA fallback and needs no frontend build. `GET /api/vault/tree` returns `VaultTreeResponse`; `GET /api/vault/note?id=...` returns `VaultNoteResponse`. `POST /api/vault/note` saves an existing Markdown note with its expected revision. `GET /api/vault/file?id=...` describes a regular file for read-only viewing, and `GET|HEAD /api/vault/content?id=...` serves its original bytes as described below. `POST /api/vault/actions` creates, moves or deletes an entry as described below. Types and public error codes are in `contract.ts`. The `id` parameter is the URL-encoded JSON representation of a nonempty array of filename components, e.g. `id=%5B%22folder%22%2C%22note.md%22%5D`. Use normal URL query encoding exactly once; reject duplicate `id` parameters, malformed JSON, and non-string or empty components. Reject `.`, `..`, slash, backslash, NUL, absolute paths, and dot-prefixed components individually, not separators between components. IDs returned in tree entries can be passed back unchanged after query encoding; clients must not construct host paths. The note endpoint accepts only regular `.md` files.

On failure return `{ "error": { "code": "...", "message": "..." } }`, with no host path or note content. Use 400 for `invalid_request`, 404 for `note_unavailable` or `entry_unavailable`, and 503 for `config_missing`, `config_invalid`, or `vault_unavailable`. Action errors and their statuses are defined in `contract.ts`; an unsatisfiable content range instead uses 416 as described below. Do not silently substitute an empty tree. An empty configured vault returns an empty `entries` array and a `rootIdentity`. API responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The daemon requires the configured bearer credential and exact daemon Host, and rejects any Origin or Fetch Metadata headers. Missing or invalid private transport is fatal before vault access. It binds only to numeric loopback; no browser credential injection or remote exposure is provided.

The nested tree includes directories, Markdown notes and other visible regular files; generic files use `kind: 'file'` with the same opaque identity and version fields as notes. It excludes dot entries, symlinks and nonregular files, and sorts deterministically. Listing does not classify file contents. Unreadable directories must surface an error rather than claim a complete tree. Paths and note content must not enter logs.

`GET /api/vault/directory?id=...` lists only the requested directory, with `[]` selecting the root. It returns `{ rootIdentity, directoryIdentity, id, entries }`; directory entries have identity and version but no `children` field, so an unloaded directory is not represented as empty. The same filtering, sorting and descriptor-relative no-follow rules apply as for the tree. The two identities are scoped to the opened reader and change on daemon restart; `rootIdentity` matches the recursive tree's root identity. Reads are uncached and observe later external changes. This private daemon endpoint is not yet exposed by the browser boundary.

## File previews and original content

`GET /api/vault/file` returns exactly one flat shape: `{ name, kind: 'text', text }`, `{ name, kind: 'image' | 'video', contentType }`, or `{ name, kind: 'unsupported' }`. A text preview is read-only, complete valid UTF-8 of at most 2 MiB; it is never silently truncated. Larger, invalid or binary files may be unsupported for preview, but their originals remain downloadable. Markdown reading and saving keep the existing note contract.

`GET /api/vault/content?id=...` streams original bytes. A single satisfiable byte range returns 206 with `Content-Range`; an unsatisfiable range returns 416 with `Content-Range: bytes */<size>`, and a malformed or multiple range returns 400. `HEAD` ignores Range, returns full-content headers with no body, and closes its descriptor. `download=1` requests attachment disposition. The daemon sniffs and streams the same pinned, no-follow regular-file descriptor, in bounded chunks; completion or cancellation closes it.

Only content-detected passive raster images and video are eligible for inline delivery. Unknown or active content, including HTML and SVG, is delivered as an `application/octet-stream` attachment; explicit downloads are attachments regardless of detected type. Raw content uses `Content-Security-Policy: sandbox`, `nosniff`, `no-store`, and a safe Unicode-aware filename disposition. Detection does not guarantee that the browser supports an image format or video codec: originals are not converted or transcoded.

The fixed same-origin Next routes enforce the existing browser request policy and use the server-only bearer credential for the private daemon; they do not forward browser credentials or Origin. Content is streamed rather than buffered through the short JSON-request timeout. Content detection uses the pinned `file-type` dependency, currently 22.3.0, which requires Node 22 or later when run under Node.

## Filename and saved-content search

Search is a read-only daemon capability exposed through fixed same-origin Next routes. These APIs are runnable independently of the Recall search interface; the Filename/Content controls and source-excerpt UI are not implemented by this API layer. Search does not save drafts, change file selection, edit files or invoke a model, shell command or external search service. It scans on demand without a persistent index or content cache.

Both routes accept only JSON objects with the exact fields below, with `Content-Type: application/json` (optionally `charset=utf-8`) and no URL query parameters. The UTF-8 JSON body limit is 16 KiB at both boundaries. Types and parsers are exported from `contract.ts`.

### Search request and results

`POST /api/vault/search` accepts `{ "mode": "filename" | "content", "query": string }`. The raw query is limited to 4096 UTF-16 code units and must round-trip through UTF-8 without replacement. Remove JavaScript `\s` whitespace before matching; the normalized query is limited to 128 UTF-16 code units. Empty or whitespace-only queries return zero counts, no hits, `limited: false` and complete coverage with zero files searched, without traversing the vault. Empty normalized queries are not valid for the context route.

Matching uses pinned `fuzzysort` 4.0.2 with explicitly prepared targets, case-insensitive ordered characters, gaps allowed, and the library's supported accent normalization. There is no acceptance-score cutoff: scores rank matches, not confidence or eligibility. Thus `foo bar` searches as `foobar`, not as reorderable terms. There is no regex, typo-correction, semantic or other query language.

A successful response is a flat discriminated result, not pre-grouped by file:

```ts
{
  mode: 'filename' | 'content';
  hits: VaultFilenameHit[] | VaultContentHit[]; // matches the mode
  counts: { matches: number; files: number };
  limited: boolean;
  coverage: {
    complete: boolean;
    filesSearched: number;
    skippedFiles: { binary: number; invalidEncoding: number; unreadable: number; changed: number };
    skippedLines: number;
    timedOut: boolean;
  };
}
```

Filename hits are `{ id, name, path, field: 'name' | 'path', positions, score }`. `id` is the component array; `name` is the basename; `path` is the full vault-relative display string joined with `/`, not a host path. Basename and path are matched separately. Any basename match outranks every path-only match; within each category sort by descending score, then deterministic relative-path order. `positions` contains zero-based UTF-16 offsets into the field identified by `field`. Visible regular files of all kinds, including binary/media files, are eligible; folders are path context, not separate hits.

Content hits are `{ id, name, path, line, version, score, snippets }`. `line` is the 1-based physical source line. Match saved valid UTF-8 text, including Markdown, JSON, TypeScript and extensionless files; do not search unsaved editor drafts. Split LF, CRLF and CR before matching, so characters never bridge lines. For example, `sdk` matches both `software development kit` and `I should know better`, but cannot combine characters from separate lines. Search streams beyond the ordinary reader's 2 MiB preview limit; there is no whole-file search size cutoff. A physical line of at most 256 KiB of source bytes, excluding its terminator, is eligible. Skip longer lines, count them and continue through subsequent lines. Detected binary formats or NUL-containing content are excluded; fatal UTF-8 decoding errors discard the file's provisional matches.

Each snippet is `{ text, start, end, positions }`. `start` and `end` are zero-based, end-exclusive UTF-16 offsets into the original line, and `text` is its literal `slice(start, end)`. `positions` are offsets relative to that snippet's text. Windows retain all matched positions, expand their edges to grapheme boundaries and merge overlaps; omitted source and ellipses are not part of `text`. Render literal escaped text, not Markdown or highlighted HTML. Match positions identify UTF-16 character offsets, not grapheme ranges; presentation should expand highlights to whole graphemes where needed. Clipping does not reduce the line's matching scope. Retain one alignment per matching physical line, ranked globally by descending score, then path, then line number. Clients may group the retained flat hits afterward.

Return at most 50 filename hits or 100 content-line hits. Retention also uses a 2 MiB serialized-result budget with a 1 KiB metadata reserve, dropping the lower-ranked suffix when needed. `counts.matches` counts verified matching files in filename mode and verified matching physical lines in content mode; `counts.files` counts distinct matching file IDs. These are coverage totals, not the number retained. `limited` is true exactly when fewer hits are returned than `counts.matches`, including byte-budget truncation; it does not describe coverage completeness.

`coverage.filesSearched` counts successfully completed, version-verified regular files, including valid text files with skipped overlong lines. Binary, invalid-encoding, unreadable and changed files do not contribute to it. The latter three skip reasons, overlong lines and deadline expiry make `complete: false`; expected binary exclusions alone do not. Hidden entries, symlinks and nonregular entries are omitted from the visible namespace, not counted as binary skips. `unreadable` also records failed directory traversals: one such failure cannot enumerate or count all unknown descendants. `skippedLines` counts overlong lines only in otherwise verified text files. On timeout the unfinished file's provisional hits, counts and skipped-line count are discarded; it is represented by `timedOut: true`, not an additional skipped-file reason. Neither totals nor `complete` imply a transactional snapshot across files. Incomplete coverage with zero hits is not a definitive no-results answer, and a complete scan can still have `limited: true`.

### Version-checked source context

`POST /api/vault/search/context` accepts exactly `{ id, version, line, query }`. Use the `id`, `version` and `line` from a content hit and the corresponding query. `id` must have 1–64 safe components, each at most 255 UTF-16 code units; `version` is a nonempty opaque string of at most 128 code units; `line` is a positive safe integer. Query validation is the same as search except that its normalized value must be nonempty. A successful response is:

```ts
{
  id: string[];
  name: string;
  version: string;
  targetLine: number;
  startLine: number;
  lines: Array<{ number: number; text: string; positions: number[] }>;
  truncated: boolean;
}
```

Return the target and up to three physical lines on either side, with contiguous 1-based line numbers; `startLine` is the first returned number. Only the target line has match positions, relative to its literal text in UTF-16 units. Return the target line in full within the 256 KiB physical-line limit; do not silently clip target evidence. Surrounding lines are bounded to at most 4096 UTF-16 code units each, clipping long prefixes at a grapheme boundary. `truncated` reports clipped context, including overlong surrounding source lines; fewer neighbors at the beginning/end of a file alone do not set it. Context is bounded by these per-line limits rather than the search hit-retention budget. The Next private transport and response reader reject search or context response bodies exceeding 4 MiB.

Versions use the existing opened reader's secret-scoped file-stat token (identity, size and modification/change times), not the Markdown save revision or a public content hash. Both search and context verify descriptor versions before/after reads and reopen the current vault-relative path to check that it still names that version. Tokens from a different reader/daemon lifetime are stale. Context checks that the requested target still matches the supplied normalized query; it never returns an unverified excerpt after a deadline. It may stop reading after the needed excerpt, rather than decoding the entire remainder of a large file. As with other vault operations, this is not filesystem compare-and-swap against hostile local writers.

Search-specific failures use the fixed sanitized envelope `{ "error": { "code": "...", "message": "..." } }`:

| Status | Code | Message / conditions |
| --- | --- | --- |
| 400 | `invalid_request` | `Invalid note identifier` — malformed, oversized or otherwise invalid input, including extra fields/query parameters and an empty context query. |
| 409 | `search_context_changed` | `This file changed. Search again.` — context version mismatch/replacement, missing or initially unopenable source, missing/nonmatching/overlong target, or binary/invalid UTF-8 encountered while reading context. A disappeared source is not a context 404. |
| 503 | `search_unavailable` | `Search is unavailable` — unavailable vault/transport, admission refusal, request cancellation, context deadline, or other context/search IO failure that cannot produce verified results. |

Ordinary request-policy/authentication errors remain separate. A search scan reaching its own deadline instead returns **200** with only already verified results, `coverage.complete: false` and `coverage.timedOut: true`. Context deadlines return **503**, never a partial excerpt. A later context IO failure is not necessarily the same as the initial-open 409 described above.

### Budgets, boundaries and an owned-fixture example

The Next boundary allows up to five seconds to receive/parse the bounded JSON request, then uses a separate 35-second daemon-response budget for both search and context. Daemon work has a 30-second deadline from admission; metadata helpers and global startup deadlines are unchanged. At most two nonempty search/context operations run concurrently across the process, with no waiting queue; excess requests fail with `503 search_unavailable`. Each scan processes files sequentially in bounded read chunks with real event-loop yields. There is no 10,000-entry vault rejection. Cancellation/disconnect propagates through the private HTTP transport and closes request-owned file/directory resources; reader shutdown also cancels its searches. Repeat or cancel a search without authorizing any file mutation.

The daemon owns namespace safety, matching, ranking, eligibility, versions and coverage. Next validates/projects bounded results and holds the private credential; browsers send neither a daemon URL nor daemon credentials. Existing same-origin Host/Origin/Fetch-Metadata policy applies at Next. The private daemon still rejects browser Origin/Fetch-Metadata headers and requires its exact Host and bearer authentication. Log attempts/outcomes with operation, query length, duration, counts/coverage or sanitized status as applicable; never log raw queries, snippets, source text, IDs/paths or credentials. Responses are `no-store`/`nosniff`; Next also sets `Referrer-Policy: no-referrer`.

For an isolated instance configured with an **operator-owned fixture vault**, these calls can be made from that instance's own browser origin without prescribing a public origin, port or credential. They exercise APIs, not an available search UI:

```js
const response = await fetch('/api/vault/search', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'content', query: 'sdk' }),
});
if (!response.ok) throw new Error('Fixture search failed');
const result = await response.json();
const hit = result.hits[0]; // No match is valid; do not invent a file/version.
if (hit) {
  const excerpt = await fetch('/api/vault/search/context', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: hit.id, version: hit.version, line: hit.line, query: 'sdk' }),
  });
  // Check excerpt.status before using its JSON; 409 requires a fresh search.
}
```

## Attachment uploads

Uploads are available by default without an enable flag. `GET /api/vault/attachments` returns `{ "maxFileBytes": number }` without creating a directory or writing a file. `POST /api/vault/attachments?name=...` accepts one nonempty raw `application/octet-stream` body and a once-query-encoded basename; it returns `{ "id": ["06_Attachments", name], "name": name, "size": number }` only after confirmed publication. Empty files, duplicate or extra query parameters and unsafe basenames are invalid. The API sends the selected original bytes without app-side HEIC conversion or transcoding; native picker integration does not guarantee device or browser codec support.

The default limit is 100 MiB per file. The optional JSON setting `recall.uploads.maxFileBytes` must be an integer from 1 through 1073741824 (1 GiB). The daemon reads it at startup; configuration changes require a daemon restart. Next obtains the daemon limit before forwarding an upload, and both boundaries count actual bytes rather than trusting `Content-Length`. The fixed server-only transport streams the request with backpressure and does not forward browser credentials or Origin. Its limit-fetch deadline is 15 seconds; the upload uses a 60-second idle deadline reset by byte progress. The daemon also bounds upload-body idle time. Next retains Node's five-minute absolute request-receive timeout, so progressing uploads can still time out.

The destination is exactly `06_Attachments/` under the canonical configured vault root; it is created when missing and checked without following descendant links. A complete upload is written to an exclusively created hidden temporary file, flushed and published through the vault mutation queue after checking the destination. Observed collisions preserve both files using `name (2).ext`, `name (3).ext`, and so on; the external-writer race limit below applies. While an upload is active, Memory Loop refuses moves or deletions of its attachment directory with `entry_conflict`, through setup, publication and cleanup. Unrelated mutations can proceed. Interrupted partial uploads are cleaned up when their checked namespace remains available. An external directory relocation or replacement can leave a hidden temporary file behind rather than authorize deletion through an untrusted path. That residue alone does not mean publication happened. After publication may have happened, an acknowledgement loss or post-publication flush failure is uncertain: reconcile with a fresh vault read and do not automatically retry.

Upload errors include `invalid_request` (400), `upload_too_large` (413), `upload_unavailable` (503), and `upload_uncertain` (503), in addition to the existing configuration and request-policy errors. The limits and upload routes are backend capabilities; the native picker UI is being integrated separately.

## Saves and file actions

The tree supplies an opaque root identity and an identity and version for each entry. Note reads supply a revision bound to the physical file and its bytes. These tokens are scoped to the opened vault reader and are invalidated by daemon restart. After a conflict or restart, refresh the relevant tree or note and reconcile the user's work before attempting another change.

Actions create a blank `.md` note or empty directory under an identified parent, move a note, generic file or whole directory to an identified parent with the same basename, or delete a note, generic file or verified-empty directory. Root parent IDs are empty arrays; source IDs are nonempty. Requests include the expected parent identity or source version. The backend does not add a missing `.md` extension. Moves refuse observed destination collisions and never fall back to copying and deleting; deletion of directories is nonrecursive and refuses hidden or non-Markdown contents too. The daemon serializes saves and actions through the vault queue. This coordinates Memory Loop's mutations, not concurrent external writers.

A known failure does not authorize a destructive retry. If an acknowledgement is lost or a post-mutation flush fails, the outcome is uncertain: do not automatically repeat the request. Reconcile with a fresh read instead.

Moves use checked source/destination paths and ordinary filesystem rename. The destination-existence check and rename are not atomic against external writers. Cross-device moves are refused rather than copied. Recall no longer uses the Linux/glibc Bun FFI rename adapter.

## Approved portable filesystem policy

Approved on 2026-11-05 in `memory-loop-68l.1`. Transport, Recall and Capture now use the shared portable foundation; remaining feature migrations are tracked in `memory-loop-68l`. This policy is not a claim that native Windows execution has been verified or that the entire app runs there yet.

- Support native Windows and Linux using a small shared filesystem foundation, ordinary Node filesystem APIs and platform-aware path handling. Do not require procfs, glibc FFI or POSIX ownership/mode checks.
- Filesystem access permissions belong to the operating environment. The service does not enforce owner-only storage, inspect Windows ACLs or repair filesystem permissions. Application state remains outside the vault. This policy does not redesign transport authentication or network boundaries.
- Trust the configured root and its ancestors, the OS/account and the personal vault namespace. Memory Loop manages the vault; concurrent external writers are not part of the supported coordination model. This is not a sandbox against hostile local processes.
- Canonicalize the configured root, validate descendant components and confirm component-aware containment. Reject descendant symbolic links and Windows directory junctions even when their targets are inside the vault. Do not use raw string prefixes or unconditional case folding as proof of containment. Detected root replacement must not silently redirect operations into another directory.
- Serialize Memory Loop's mutations and refuse observed destination collisions. Use exclusive creates for new files. A destination check followed by ordinary rename is acceptable for file and directory moves: it is not an atomic no-overwrite guarantee against external writers. Preserve the refusal of cross-device moves rather than falling back to copy/delete. Apply the same explicit collision/race policy to upload publication.
- Require Windows-compatible new file and directory names on both platforms, including uploads and generated relative names. Reject reserved characters, device names and trailing dots/spaces. Do not automatically rename or silently hide existing host-valid entries solely because their names are not portable.
- Preserve stale-save revision conflicts, including conflicts between browser tabs. Preserve append/checkpoint recovery, ownership records and detection of changed transcript content; removing filesystem permission enforcement does not authorize adopting or overwriting unrelated files. Regular-file and hard-link checks that protect write integrity are distinct from access control.
- Write replacement content to an exclusively created temporary file, flush the file and publish it using the agreed save/conflict rules. Flush directory metadata where supported; Windows need not support POSIX directory fsync. Preserve definite versus uncertain outcomes and safe cleanup. Do not claim atomic filesystem compare-and-swap or identical power-loss durability across platforms.
- Use controlled disposable fixtures for validation. Linux checks run locally; the user will run the final native Windows disposable-vault check. Do not use the reported real vault or alter any legacy state inside it without separate permission.

## Recall namespace and handle lifetime

The configured root and its ancestors may canonicalize through links. Descendant symlinks and junctions are rejected, and detected replacement of the canonical root makes subsequent access unavailable rather than continuing through a pinned directory. Checked paths are not filesystem reservations. A directory tree is not a transactional snapshot, and external namespace changes can produce unavailable/conflict results.

Hardlinked regular files remain eligible for reads. Saving replaces the selected pathname with a new inode and leaves other aliases on the original bytes; direct write/append handles reject hardlinked files. File and media streams own ordinary file handles and close them on completion or cancellation. The daemon remains loopback-only; browser access uses the Next boundary. Native Windows behavior still requires the agreed disposable-vault verification.
