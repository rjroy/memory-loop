# Recall daemon API reference

This describes the current interface and observable behavior, not an immutable product specification. See [architecture and work boundaries](../ARCHITECTURE.md) and [implementation notes](IMPLEMENTATION.md). Types and parsers in `contract.ts` are the code-level reference. Link handling below describes current behavior, not a settled policy.

The daemon loads `.memory-loop/config.json` relative to the project root once at startup. Its JSON object has a `vaultDirectory` string containing a nonempty absolute directory path. Changes require restart; configuration lives outside the vault and is not returned to clients. Missing and malformed configuration, and an unavailable vault, remain distinct from an empty tree.

The daemon endpoints are private and authenticated; browser requests go through the Next server boundary. The daemon serves no frontend assets or SPA fallback and needs no frontend build. `GET /api/vault/tree` returns `VaultTreeResponse`; `GET /api/vault/note?id=...` returns `VaultNoteResponse`. `POST /api/vault/note` saves an existing Markdown note with its expected revision. `GET /api/vault/file?id=...` describes a regular file for read-only viewing, and `GET|HEAD /api/vault/content?id=...` serves its original bytes as described below. `POST /api/vault/actions` creates, moves or deletes an entry as described below. Types and public error codes are in `contract.ts`. The `id` parameter is the URL-encoded JSON representation of a nonempty array of filename components, e.g. `id=%5B%22folder%22%2C%22note.md%22%5D`. Clients use normal URL query encoding exactly once. The endpoint rejects duplicate `id` parameters, malformed JSON, non-string or empty components, components equal to `.` or `..`, and components containing slash, backslash or NUL, absolute paths, or dot-prefixed components. Separators between components are not rejected. IDs returned in tree entries can be passed back unchanged after query encoding; clients must not construct host paths. The note endpoint accepts only regular `.md` files.

On failure the response contains `{ "error": { "code": "...", "message": "..." } }`, with no host path or note content. Statuses are 400 for `invalid_request`, 404 for `note_unavailable` or `entry_unavailable`, and 503 for `config_missing`, `config_invalid`, or `vault_unavailable`. Action errors and their statuses are defined in `contract.ts`; an unsatisfiable content range instead uses 416 as described below. Failures are not represented as an empty tree. An empty configured vault returns an empty `entries` array and a `rootIdentity`. API responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The daemon requires the configured bearer credential and exact daemon Host, and rejects any Origin or Fetch Metadata headers. Missing or invalid private transport is fatal before vault access. It binds only to numeric loopback; no browser credential injection or remote exposure is provided.

The nested tree includes directories, Markdown notes and other visible regular files; generic files use `kind: 'file'` with the same opaque identity and version fields as notes. It excludes dot entries, symlinks and nonregular files, and sorts deterministically. Listing does not classify file contents. An unreadable directory produces an error rather than a supposedly complete tree.

`GET /api/vault/directory?id=...` lists only the requested directory, with `[]` selecting the root. It returns `{ rootIdentity, directoryIdentity, id, entries }`; directory entries have identity and version but no `children` field, so an unloaded directory is not represented as empty. The same filtering, sorting and path checks apply as for the tree. The two identities are scoped to the opened reader and change on daemon restart; `rootIdentity` matches the recursive tree's root identity. Reads are uncached and observe later external changes. This private daemon endpoint is not yet exposed by the browser boundary.

## File previews and original content

`GET /api/vault/file` returns exactly one flat shape: `{ name, kind: 'text', text }`, `{ name, kind: 'image' | 'video', contentType }`, or `{ name, kind: 'unsupported' }`. A text preview is read-only, complete valid UTF-8 of at most 2 MiB; it is never silently truncated. Larger, invalid or binary files may be unsupported for preview, but their originals remain downloadable. Markdown reading and saving keep the existing note contract.

`GET /api/vault/content?id=...` streams original bytes. A single satisfiable byte range returns 206 with `Content-Range`; an unsatisfiable range returns 416 with `Content-Range: bytes */<size>`, and a malformed or multiple range returns 400. `HEAD` ignores Range, returns full-content headers with no body, and closes its descriptor. `download=1` requests attachment disposition. The daemon sniffs and streams the same opened regular-file handle; completion or cancellation closes it. See [implementation notes](IMPLEMENTATION.md) for pathname race limits.

Only content-detected passive raster images and video are eligible for inline delivery. Unknown or active content, including HTML and SVG, is delivered as an `application/octet-stream` attachment; explicit downloads are attachments regardless of detected type. Raw content uses `Content-Security-Policy: sandbox`, `nosniff`, `no-store`, and a safe Unicode-aware filename disposition. Detection does not guarantee that the browser supports an image format or video codec: originals are not converted or transcoded.

The fixed same-origin Next routes enforce the existing browser request policy and use the server-only bearer credential for the private daemon; they do not forward browser credentials or Origin. Content is streamed rather than buffered through the short JSON-request timeout.

## Filename and saved-content search

Search is a read-only daemon capability exposed through fixed same-origin Next routes. These APIs can be used independently of the Recall search interface. Search does not save drafts, change file selection, edit files or invoke a model, shell command or external search service. It scans on demand without a persistent index or content cache.

Both routes accept only JSON objects with the exact fields below, with `Content-Type: application/json` (optionally `charset=utf-8`) and no URL query parameters. The UTF-8 JSON body limit is 16 KiB at both boundaries. Types and parsers are exported from `contract.ts`.

### Search request and results

`POST /api/vault/search` accepts `{ "mode": "filename" | "content", "query": string }`. The raw query is limited to 4096 UTF-16 code units and must round-trip through UTF-8 without replacement. The matcher removes JavaScript `\s` whitespace before matching; the normalized query is limited to 128 UTF-16 code units. Empty or whitespace-only queries return zero counts, no hits, `limited: false` and complete coverage with zero files searched, without traversing the vault. Empty normalized queries are not valid for the context route.

Matching currently uses fuzzy matching with prepared targets, case-insensitive ordered characters, gaps allowed, and the library's supported accent normalization. There is no acceptance-score cutoff: scores rank matches, not confidence or eligibility. Thus `foo bar` searches as `foobar`, not as reorderable terms. There is no regex, typo-correction, semantic or other query language.

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

Filename hits are `{ id, name, path, field: 'name' | 'path', positions, score }`. `id` is the component array; `name` is the basename; `path` is the full vault-relative display string joined with `/`, not a host path. Basename and path are matched separately. Any basename match outranks every path-only match; within each category results are sorted by descending score, then deterministic relative-path order. `positions` contains zero-based UTF-16 offsets into the field identified by `field`. Visible regular files of all kinds, including binary/media files, are eligible; folders are path context, not separate hits.

Content hits are `{ id, name, path, line, version, score, snippets }`. `line` is the 1-based physical source line. Search matches saved valid UTF-8 text, including Markdown, JSON, TypeScript and extensionless files, not unsaved editor drafts. It splits LF, CRLF and CR before matching, so characters never bridge lines. For example, `sdk` matches both `software development kit` and `I should know better`, but cannot combine characters from separate lines. Search streams beyond the ordinary reader's 2 MiB preview limit; there is no whole-file search size cutoff. A physical line of at most 256 KiB of source bytes, excluding its terminator, is eligible. Longer lines are skipped and counted; scanning continues through subsequent lines. Detected binary formats or NUL-containing content are excluded; fatal UTF-8 decoding errors discard the file's provisional matches.

Each snippet is `{ text, start, end, positions }`. `start` and `end` are zero-based, end-exclusive UTF-16 offsets into the original line, and `text` is its literal `slice(start, end)`. `positions` are offsets relative to that snippet's text. Windows retain all matched positions, expand their edges to grapheme boundaries and merge overlaps; omitted source and ellipses are not part of `text`. Clients can render the literal text escaped rather than treating it as Markdown or highlighted HTML. Match positions identify UTF-16 character offsets, not grapheme ranges; presentation should expand highlights to whole graphemes where needed. Clipping does not reduce the line's matching scope. The response retains one alignment per matching physical line, ranked globally by descending score, then path, then line number. Clients may group the retained flat hits afterward.

The response contains at most 50 filename hits or 100 content-line hits. Retention also uses a 2 MiB serialized-result budget with a 1 KiB metadata reserve, dropping the lower-ranked suffix when needed. `counts.matches` counts verified matching files in filename mode and verified matching physical lines in content mode; `counts.files` counts distinct matching file IDs. These are coverage totals, not the number retained. `limited` is true exactly when fewer hits are returned than `counts.matches`, including byte-budget truncation; it does not describe coverage completeness.

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

The response contains the target and up to three physical lines on either side, with contiguous 1-based line numbers; `startLine` is the first returned number. Only the target line has match positions, relative to its literal text in UTF-16 units. The target line is returned in full within the 256 KiB physical-line limit, without silently clipping target evidence. Surrounding lines are bounded to at most 4096 UTF-16 code units each, clipping long prefixes at a grapheme boundary. `truncated` reports clipped context, including overlong surrounding source lines; fewer neighbors at the beginning/end of a file alone do not set it. Context is bounded by these per-line limits rather than the search hit-retention budget. The Next private transport and response reader reject search or context response bodies exceeding 4 MiB.

Versions are opaque and scoped to the opened reader; tokens from a different reader or daemon lifetime are stale. Context verifies that the target still matches the supplied query and does not return an unverified excerpt after a deadline. See [implementation notes](IMPLEMENTATION.md) for the current checks and their limits.

Search-specific failures use the fixed sanitized envelope `{ "error": { "code": "...", "message": "..." } }`:

| Status | Code | Message / conditions |
| --- | --- | --- |
| 400 | `invalid_request` | `Invalid note identifier` — malformed, oversized or otherwise invalid input, including extra fields/query parameters and an empty context query. |
| 409 | `search_context_changed` | `This file changed. Search again.` — context version mismatch/replacement, missing or initially unopenable source, missing/nonmatching/overlong target, or binary/invalid UTF-8 encountered while reading context. A disappeared source is not a context 404. |
| 503 | `search_unavailable` | `Search is unavailable` — unavailable vault/transport, admission refusal, request cancellation, context deadline, or other context/search IO failure that cannot produce verified results. |

Ordinary request-policy/authentication errors remain separate. A search scan reaching its own deadline instead returns **200** with only already verified results, `coverage.complete: false` and `coverage.timedOut: true`. Context deadlines return **503**, never a partial excerpt. A later context IO failure is not necessarily the same as the initial-open 409 described above.

### Budgets, boundaries and an owned-fixture example

Current timeouts, admission and cancellation mechanics are described in [implementation notes](IMPLEMENTATION.md).

The daemon owns namespace safety, matching, ranking, eligibility, versions and coverage. Next validates/projects bounded results and holds the private credential; browsers send neither a daemon URL nor daemon credentials. Existing same-origin Host/Origin/Fetch-Metadata policy applies at Next. The private daemon still rejects browser Origin/Fetch-Metadata headers and requires its exact Host and bearer authentication. Responses are `no-store`/`nosniff`; Next also sets `Referrer-Policy: no-referrer`.

For an isolated instance configured with an **operator-owned fixture vault**, these calls can be made from that instance's own browser origin without prescribing a public origin, port or credential. They exercise the APIs directly, independently of the UI:

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

The default limit is 100 MiB per file. The optional JSON setting `recall.uploads.maxFileBytes` must be an integer from 1 through 1073741824 (1 GiB). The daemon reads it at startup; configuration changes require a daemon restart. Next obtains the daemon limit before forwarding an upload, and both boundaries count actual bytes rather than trusting `Content-Length`. The fixed server-only transport streams the request with backpressure and does not forward browser credentials or Origin. Timeout details are in [implementation notes](IMPLEMENTATION.md).

The destination is `06_Attachments/` under the configured vault root; it is created when missing. Observed collisions preserve both files using `name (2).ext`, `name (3).ext`, and so on; this is not an atomic no-overwrite guarantee against external writers. While an upload is active, Memory Loop refuses moves or deletions of its attachment directory with `entry_conflict`, through setup, publication and cleanup. Unrelated mutations can proceed. An acknowledgement loss or post-publication flush failure can leave the outcome uncertain: clients should reconcile with a fresh vault read rather than retry automatically. See [implementation notes](IMPLEMENTATION.md) for publication and cleanup limits.

Upload errors include `invalid_request` (400), `upload_too_large` (413), `upload_unavailable` (503), and `upload_uncertain` (503), in addition to the existing configuration and request-policy errors. The limits and upload routes are backend capabilities.

## Saves and file actions

The tree supplies an opaque root identity and an identity and version for each entry. Note reads supply a revision bound to the physical file and its bytes. These tokens are scoped to the opened vault reader and are invalidated by daemon restart. After a conflict or restart, refresh the relevant tree or note and reconcile the user's work before attempting another change.

Actions create a blank `.md` note or empty directory under an identified parent, move a note, generic file or whole directory to an identified parent with the same basename, or delete a note, generic file or verified-empty directory. Root parent IDs are empty arrays; source IDs are nonempty. Requests include the expected parent identity or source version. The backend does not add a missing `.md` extension. Moves refuse observed destination collisions and never fall back to copying and deleting; deletion of directories is nonrecursive and refuses hidden or non-Markdown contents too. The daemon serializes saves and actions through the vault queue. This coordinates Memory Loop's mutations, not concurrent external writers.

A known failure does not authorize a destructive retry. If an acknowledgement is lost or a post-mutation flush fails, the outcome is uncertain: do not automatically repeat the request. Reconcile with a fresh read instead.

Cross-device moves are refused rather than copied. The observed-collision check does not guarantee an atomic no-overwrite move against external writers; see [implementation notes](IMPLEMENTATION.md).
