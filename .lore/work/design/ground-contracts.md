---
title: Ground technical contracts
date: 2026-10-31
status: draft
tags: [ground, contracts, resources, think, sqlite, scheduling]
related: [.lore/work/intents/ground.md, .lore/work/design/ground-dashboard.md, .lore/work/design/think-execution-reconnect.md, .lore/work/design/think-transcript-persistence.md, .lore/work/research/opencode-2.2.2-restricted-generation.md]
---

# Ground technical contracts

Implementation contracts authored for `memory-loop-9ya.1`, alongside the [UX handoff](ground-dashboard.md) and approved local Ground implementation plan. The original inspection was checkout `4d51bbf`. Resource cards/prefill, durable recovery, the `memory-loop-3ry` list/Resume/selection leases, `memory-loop-9ya.6` paired deletion and `memory-loop-9ya.7` resident scheduler/daily questions are implemented and independently accepted in source/fixtures; [README](../../../README.md#what-ground-does) describes the current boundary. Weekly quotes/evidence (`memory-loop-9ya.8`) and final activation/deployment handoff (`memory-loop-9ya.9`) remain planned. This document's draft metadata is unchanged; implementation acceptance does not approve every later interface, enable jobs against personal data or publish the live app.

Keep Next presentation/BFF → the existing Bun/Hono daemon → the operator-managed OpenCode 2.2.2 service. Six separate cards consume typed data; the host owns composition and a Ground-visit lifecycle, not business rules. No card plugin system, additional service, CLI execution, proxy change or replacement AI SDK.

## 1. Configuration, paths and bounds

Extend the existing project-root `.memory-loop/config.json` with optional `ground`. Omission supplies resource-read defaults and leaves generation disabled until the real handoff deliberately enables it. This activation step does not reopen the user's authorization for automatic generation. Existing `vaultDirectory` and `think` meanings stay unchanged.

```json
{
  "ground": {
    "resources": {
      "quickActions": "03_Resources/Memory-Loop/quick-actions.md",
      "inspiration": "03_Resources/Memory-Loop/inspiration.md",
      "prompts": "03_Resources/Memory-Loop/prompts.md",
      "goals": "03_Resources/Memory-Loop/goals.md"
    },
    "generation": {
      "enabled": false,
      "timeZone": "server",
      "questions": { "schedule": "0 6 * * *", "count": 5 },
      "quotes": { "schedule": "15 6 * * 1", "count": 5 },
      "context": {
        "lookbackDays": 7,
        "maxNotes": 20,
        "maxNoteBytes": 8192,
        "maxTotalBytes": 65536
      }
    }
  }
}
```

All fields have the shown defaults; supplying `generation.enabled: true` activates questions after daemon restart, only at the explicitly authorized handoff. The `quotes` object is validated/reserved but does not yet start a quote job. Reject unknown keys and invalid types within these new objects. Resolve `server` to a named IANA timezone at startup and persist that effective zone with occurrences; never use the browser's zone to schedule. Other IANA zones and valid five-field cron schedules are supported configuration. Counts are integers 1–50. Context values are positive integers with safety ceilings of 365 days, 200 notes, 64 KiB per note and 1 MiB total; require per-note ≤ total bytes. Validate before any model call. Configuration is startup-only, not watched or edited by Ground. Validate resource paths independently: one invalid path degrades that card/job, not its siblings, Capture, Recall or valid Think. Invalid generation settings disable jobs, not resource reads or otherwise healthy Think.

Resource values are distinct vault-relative `.md` paths beneath the exact `03_Resources/Memory-Loop/` prefix. Validate components using the visible vault namespace: no absolute paths, dot-prefixed/empty components, separators inside components, backslash, NUL or traversal. Convert to existing `VaultId` arrays server-side. Pin/validate root and descendant directories with the existing Linux descriptor/no-follow approach; a safe reader is not automatically a safe writer.

Each resource is at most **64 KiB UTF-8 source**, read with a byte bound and fatal UTF-8 decoding. Accept LF/CRLF, normalize line endings for parsing and accept a leading UTF-8 BOM; retain a hash of the actual source bytes as its revision. A missing file is never a request to initialize it. A generation job may exclusively create its missing designated output and necessary validated resource directories; it must not replace an existing malformed/unsafe file. Never initialize Quick Actions or Goals automatically.

Fixed collection caps are 50 actions, 50 quotes and 50 questions. Parser field bounds below are in UTF-8 bytes. An over-cap hand-edited file is malformed, not silently truncated by a reader. Generation appends valid unique entries and retains the last 50. The resource byte limit still applies to the resulting serialization: an oversized question publication fails without changing the existing file, rather than truncating the candidate batch or evicting extra retained entries merely to fit bytes. Limits are explicit parser inputs in unit tests, not imports from mutable operator settings.

## 2. Small Markdown formats

These are deliberately narrow line-oriented formats, not general Markdown interpretation. Files may begin with one optional H1 title and blank lines. The title is descriptive only. Outside entries, accept blank lines; reject unexplained content, frontmatter, HTML/comments, code fences and unsupported structures rather than silently losing authored text. Blank/title-only files are empty. Plain fields are displayed as text, never reparsed as HTML/Markdown. Errors identify a safe rule and optional line number, not source excerpts.

### Quick Actions

```markdown
# Quick Actions

## @intent
Clarify what this work is for.

## @write-lyrics
Begin a lyric with room to explore.
```

Each H2 is exactly one skill reference matching `@[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. References must be unique. Each has one nonempty descriptive paragraph, at most 1,024 bytes; soft line breaks join with a single space. No second paragraph or nested structure. The reference is the stable action identity and the **entire** prefill; the description is button content, not input to the agent. Syntax validity is not a claim that a skill is installed.

### Inspiration

The following is a **parser fixture**, not a real quotation, production seed or attribution evidence:

```markdown
# Inspiration

## Quote
> Example quotation for a parser fixture only.
> A second line of that fixture quotation.

Attribution: Fixture author
Source: Fixture publication, fixture page
```

Each entry starts with literal `## Quote`. One contiguous block of `> ` lines supplies nonempty quote text, at most 4,096 bytes; `>` alone represents a blank line within it. Strip only the quote prefix and preserve internal newlines. Follow with exactly one `Attribution: ` plain-text line (1–256 bytes) and one `Source: ` line. Source is either a plain bibliographic reference (1–512 bytes) or exactly `[title](https://host/path)` / `[title](http://host/path)`, with a 512-byte plain title and 2,048-byte URL bound. Credentials, control characters and non-HTTP(S) schemes are invalid; a public-network source URL is required for generated entries. Blank separators between these fields are allowed; extra fields/paragraphs are not.

The reader requires attribution and a source reference, but does not certify hand-authored historical claims. It projects `source: { title, url? }`; bibliographic-only sources have no link. Generated entries additionally require the verified evidence described in §7. No browser inference or model-generated author/URL alone establishes attribution.

### Prompts

```markdown
# Prompts

## Question
What decision would benefit from a smaller first step?

## Question
Which recent idea deserves another look?
```

Literal `## Question` starts each entry. Its one nonempty plain-text paragraph is the complete question/prefill, at most 2,048 bytes; soft breaks join with a space. Do not impose an English question-mark rule. No description, extra paragraph or nested structure.

For quotes/questions, identity is a SHA-256 digest of the canonical typed entry, independent of heading occurrence or file order. Exact canonical duplicates are malformed in hand-authored collections. Question generation uses NFKC, collapsed whitespace and locale-independent lowercasing for comparison keys, separately from retained author text/case and canonical entry identities; candidate text uses NFC normalization. A duplicate-only batch does not rewrite the resource. Planned quote deduplication uses normalized text plus attribution, not a source URL alone. Preserve entry order; oldest/newest means collection position, not an invented creation date.

### Goals

Goals is ordinary CommonMark/GFM, not the narrow collection grammar. Whitespace-only content is empty; unconventional Markdown is not malformed. Reuse `MarkdownDocument` safety policy: no live raw HTML, no fetched images, HTTP(S)-only external links with existing new-tab labeling, disabled task boxes. Parameterize heading depth locally so source H1 becomes H3 beneath the card H2, capped at H6; do not change Recall/Think output. Malformed here means encoding/size failure.

## 3. Reads, card data and weighted selection

Add independent `GET` routes at `/api/ground/quick-actions`, `/inspiration`, `/prompts`, `/goals`, `/recent-captures` and, only when its real operations exist, `/recent-conversations`. These suffixes share the `/api/ground` prefix. No arbitrary resource path/query or all-or-nothing dashboard endpoint.

Resource routes use this small shared envelope; each route validates its own `data`, not a generic card registry:

```ts
type ResourceRead<T> =
  | { state: 'ready'; noteId: string[]; revision: string; data: T }
  | { state: 'empty' | 'missing'; noteId: string[] }
  | { state: 'malformed'; noteId: string[];
      issue: { code: 'invalid_utf8' | 'too_large' | 'invalid_format' | 'too_many_entries'; line?: number } }
  | { state: 'unavailable'; reason: 'configuration' | 'io'; noteId?: string[] };

type QuickActionsData = { actions: Array<{ id: string; skill: string; description: string }> };
type InspirationData = { quote: { id: string; text: string; attribution: string;
  source: { title: string; url?: string } } };
type PromptsData = { question: { id: string; text: string } };
type GoalsData = { markdown: string };
```

Use HTTP 200 for ready/empty/missing/malformed; HTTP 503 with the typed unavailable envelope when the service cannot read. Authentication/method/request failures retain controlled `{ error: { code, message } }` envelopes and appropriate 400/403/405 status. An absent/unsafe configuration supplies no invented note path. The UI maps issue codes to concise authoring guidance and the UX's wording; do not return raw exceptions. Revisions are SHA-256 hex, not filesystem timestamps.

Every new browser route preserves `allowsWebRequest` Host/Origin/Fetch-Metadata and current proxy identity policy. Next reads the existing private transport/token, forwards only fixed daemon targets with a fresh service authorization header, validates bounded responses and never opens the vault/database. Preserve no-store, nosniff, no-referrer and the existing short request deadlines. Add explicit route/method/status handling: the current Think BFF assumes POST → 202, so immediate lease responses below cannot be squeezed into that assumption. Responses allow at most 64 KiB JSON except Goals and Quick Actions, whose escaped source can require a 512-KiB envelope bound. Reject extra request fields and unexpected query parameters.

Weighted selection is daemon-owned for both quote and question: for N entries, total `W=N(N+1)/2`; draw a uniform integer `r` in `[0,W)`, choose the first cumulative weight strictly greater than `r`, where file positions have weights 1…N. Inject the draw in tests; verify all boundary intervals, not a stochastic frequency assertion. Empty files make no draw.

A persistent-shell Ground visit begins on entry from another route or explicit page refresh. Each card read is independently keyed to that visit; keep its successful selected item in memory and do not refetch/reshuffle it on rerenders, list refresh, focus, confirmations or sibling retries. A failed-read retry may finish that card's pending selection. Leaving/reentering starts fresh selections. No shuffle control, durable selection cache or browser storage of resource content. Fence obsolete visit responses. Retain prior validated content only on a transient refresh failure with the UX's stale notice; confirmed missing/empty/malformed replaces it honestly.

### Recent captures

```ts
type CaptureItem = { id: string; localDateTime: string; timeBasis: 'recorded-local';
  excerpt: string; noteId: string[] };
type CapturesRead =
  | { state: 'ready'; coverage: 'complete' | 'partial'; items: CaptureItem[] }
  | { state: 'empty' | 'missing' }
  | { state: 'malformed'; issue: { code: 'source_coverage' } }
  | { state: 'unavailable'; reason: 'configuration' | 'io' };
```

Read regular no-follow `00_Inbox/YYYY-MM-DD.md` files with valid Gregorian dates. A capture begins at a top-level `- [HH:mm] ` bullet with valid 24-hour time. Consume following lines indented by at least two spaces, stripping the writer's first two spaces, including indented empty lines. A new top-level line ends it. Ordinary unrelated prose is not a capture. Timestamp-shaped invalid bullets and unreadable/over-budget source coverage produce a safe partial notice, not silent absence.

Order by filename date descending, recorded minute descending, then entry start byte offset descending within the same note; never by mtime. Return five entries, with excerpts bounded to 400 Unicode code points and normalized line breaks. Identity hashes the note ID, start byte offset and exact entry digest; it is stable for unchanged source, not a promise of capture UUIDs after manual edits. Record `localDateTime` as `YYYY-MM-DDTHH:mm` without an invented UTC offset: the existing capture format stores no timezone. Browser formatting must preserve that recorded date/time.

Use streaming/byte-bounded reads, a default 8-MiB per-read scan budget and no whole-note DTO. Inspect relevant dates until older dates cannot enter the top five. Exceeding budget or losing a source yields `coverage: 'partial'` for any returned entries; if none can be established, return malformed/unavailable, not empty. Missing Inbox is missing; a completely inspected Inbox with no captures is empty. Do not call a partial subset an authoritative latest-five result.

`noteId` always passes existing `isVaultId`; create the Recall link with `noteLocation(noteId)` (`/recall?file=<encoded JSON array>`), not a new path concatenation convention. Same-minute/same-note rows remain distinct by identity/position. Source timestamps and the full safe relative path remain available to accessibility text.

## 4. Shell-owned unsent handoff

Add one intentional Think-session action for `{ kind: 'fresh-prefill', text }` or `{ kind: 'resume', conversationId }`, with a subscribable local pending state for the initiating card. It is not an HTTP prompt operation. Follow the UX's inline Cancel/Start new chat/Open conversation safeguard for any nonempty draft, including whitespace. Repeated activations cannot replace a pending target. Resume of the current identity skips the other-chat draft confirmation but still verifies the target snapshot/epoch and selection before returning to Think.

Capture the action, origin conversation, draft version and shell navigation generation. Preserve the old keyed draft. Allocate one target conversation/create-command ID and initialize its separate draft with prefill **once**, without changing the active pointer. Call the existing real create path and reconcile that same receipt/identity until creation is ready. Keep source identity/text intact on definitive or uncertain failure; Check chat reads the existing command, never creates another target. A prepared but unselected chat is not silently deleted.

Before committing navigation, check the captured origin/version/generation and target draft version again. New typing wins, whether in the origin or a pending target; never reapply prefill after acknowledgements, reconnect or retry. A stale completion preserves both keyed drafts, but does not redirect, change selection or overwrite newer text; re-confirm when required. Only a valid commit updates the current pointer, navigates to `/think?conversation=<UUID>` and focuses Message once ready. No prompt text in URLs. No Send/Stop, and earlier native work continues.

The existing Think New chat **Keep writing / Discard & start** behavior is unchanged. In particular, do not call `startNew()`'s draft-deleting branch (`src/think/session.ts:597–613`) from Ground. Drafts remain volatile; this is not persisted-draft scope.

**Phase compatibility:** Phase 2 uses the existing create/command/snapshot APIs with their actual daemon-lifetime guarantees. Implement no pretend durable registry, resume or selection lease then, and omit Recent conversations entirely. Phase 3 changes production admission/recovery beneath the handoff; Phase 4 adds the selection commit below. The handoff is intentionally shell-owned now so those later semantics do not require replacing card-local chat ownership.

## 5. SQLite ownership and restart boundary

Use `bun:sqlite` at **`<projectRoot>/.memory-loop/application.sqlite`**, distinct from configuration. Project root is the same explicit/default daemon root already used by `loadConfig`, not cwd or the vault. `MEMORY_LOOP_TRANSPORT_FILE` still selects transport metadata only; it does not relocate durable application state. Validate the private directory and database/sidecars, keep owner-only permissions, reject symlinks/unsafe files, and ensure the location is outside the resolved vault before opening. Do not infer a new state directory from a deployment artifact. Startup diagnostics/handoff must name the effective state/config locations without returning absolute paths to browsers.

One daemon owns the writer. Use explicit parameterized SQL, foreign keys, small schema-version migrations and durability settings that acknowledge a transaction only after durable commit. Current schema **v8** adds validated publication plans/ownership to v7 preflight budgets and v6 generation attempts, preserving v5 deletion/cache facts, v4 leases/activity, v3 command order and older original BLOB/transcript facts. Do not use weakened sync to make admission look faster. Unsupported/newer/corrupt state fails closed for affected mutable capabilities; do not replace the database or disable unrelated resource reads/Capture/Recall. Acquire the single-daemon startup boundary before running mutable recovery/jobs; a second preparation must not dispatch work before discovering the listener is occupied. No ORM, general repository layer or cross-file application journal.

The schema needs these bounded responsibilities, not a full native event mirror:

| Records | Required facts |
| --- | --- |
| Application metadata | Schema version, stable random installation ID. |
| Conversations | UUID, purpose `think`, native ID/expected owner marker/creation epoch, pinned vault/location, creation selections, created/activity times, row version and live/deleting state. |
| Commands/originals | Unique client command ID, conversation/kind, immutable payload digest, exact original Send bytes or canonical form-answer bytes as BLOB, run/native message IDs, registered time, dispatch-attempt/admission/terminal facts. |
| Transcript state | Mapped note ID and file identity, confirmed offset/prefix digest, confirmed stable entry identities, exact pending append identity/bytes and serialization metadata. Large pending bytes can be chunk rows; never require one unbounded RAM value. |
| View leases | Authenticated access scope, token hash, selected conversation, selection revision, expiry. |
| Deletions/cache ownership | Target/command ID, fencing version, native-attempt/acknowledgement and transcript-removal facts, verified private cache namespaces and safe pending reason. |
| Two jobs/attempts | Effective schedule/zone, occurrence and attempt/native IDs, admission state, baseline, validated candidate bytes/output hash, publication progress and last settled occurrence. |

Short transactions coordinate these facts. No transaction spans network, model, file writes or waiting for a browser. Do not store native assistant history, reasoning, raw tools, whole source pages or excerpt histories as general tables. Original Send admission remains bounded by the current 1-MiB UTF-8 service limit; canonical form payload validation remains the daemon's current 32,768-byte limit, not the browser client's larger transport allowance.

Only **new** registry records authorize durable resume. Create the registry ownership intent before native creation; retain native creation epoch in its expected marker and add the installation identity for newly created sessions. Verify readback before ready. Native service PID/version is a live connection fence, not durable ownership. Retain location/explicit creation selections per conversation so new-chat configuration changes cannot silently migrate old chats. Do not scan native sessions or transcript filenames to import legacy chats; keep those untouched.

For Send/form admission, commit original bytes, immutable digest, identities and registered state together before returning registered/dispatching. Commit the dispatch-attempt fact before crossing the native boundary. Recover facts from native readback/inbox/ordinary paginated history; an absent active entry or lost acknowledgement is not proof of success/failure/non-admission. Never blindly replay an uncertain prompt/form or rely on native ID deduplication as a permanent application tombstone. Stop remains best effort, never an exactly-once tool guarantee.

Hydration joins native history with stored original input, preserving chronological boundaries and not substituting plugin-prepared user text. Native history/status remains authoritative for assistant content and execution. Startup reconciles outstanding commands and pending transcripts without waiting for browser selection; deletion startup restores pending facts/fences only, never destructive effects (§6). Completed old histories can hydrate lazily on resume rather than being continually polled. Never reconstruct unobserved transient events. Reissue snapshots and body references in the new daemon transport epoch; durable command IDs/facts survive, transport revisions/cursors/nonces do not. Existing receipt/snapshot `epoch` fields identify current serving authority; retain the original registration/ownership epoch privately. Explicit verified Resume can adopt a fresh epoch and clear only obsolete transport observations; same-epoch Resume preserves pending command ownership and recoverable text, while old-epoch late callbacks remain fenced. Do not simply remove `service-changed` checks. A transient initial snapshot failure, before any epoch is installed, receives at most five generation-fenced additional reads with backoff; this is read recovery, never command replay.

Transcript continuation is part of restart resume, not a later convenience. Before each append persist its exact bytes/identity and baseline checkpoint. Record exclusive-creation intent and acquired file identity before appending; an initial-create crash without verifiable ownership is a conflict, not permission to adopt a filename collision. After file/directory sync, atomically advance the checkpoint/confirmed entry identity and remove that pending payload. A restart verifies the mapped namespace/file and confirmed prefix; only a tail matching the pending bytes can be completed/confirmed. Otherwise preserve the file and report conflict/content gap. Reopening a file owned by a new registry record is not legacy adoption.

Canonical AI entry IDs derive from native message ID, text ordinal, canonical byte length/digest and kind—not `BodyRef.generation`. Persist timestamps/serialization choices for uncertain appends. Existing safe literal text framing, original-versus-prepared distinction, conservative tool summaries, nonblocking logging failures and automatic transcript retries remain. These retries do not apply to deletion. Ephemeral body cache references are never the sole durable source of original/pending bytes.

New cache files use conversation-scoped directories beneath verified private epoch namespaces, with durable ownership locators recorded before publishing bodies. Retain those locators until verified cleanup succeeds. Unknown legacy cache directories are not scanned, adopted or swept. This is derivative-cache cleanup, not another durable original-body store.

## 6. Conversations, leases and paired deletion

The list, Resume and view/selection operations are implemented in `memory-loop-3ry`; paired deletion, its guarded control and application/BFF routes are implemented in `memory-loop-9ya.6`. Daily question generation is a separate implemented capability (§7), not a Think conversation or list entry.

The list includes only new registry-owned Think chats with at least one registered Send; an unused fresh/prefilled chat creates no transcript or list clutter. Meaningful recency advances on newly registered Send/form input or newly confirmed canonical assistant content, not list reads, polling, selection or mere resume. Use the fact's retained timestamp, not recovery time; retries of the same fact cannot bump it again. Sort activity descending, then conversation UUID for ties; limit ten without retention. Derive an optional plain title from the first original input's first nonempty line, collapsed and capped at 120 code points; no model title call. Null becomes the UX's Untitled conversation.

```ts
type RecentConversation = {
  conversationId: string; title: string | null; lastActivityAt: string;
  transcriptNoteId?: string[];
  state: 'ready' | 'recovering' | 'unavailable' | 'deleting';
  resume: { available: boolean; reason?: 'recovering' | 'unavailable' | 'deleting' };
  delete: { available: boolean; reason?: 'current' | 'selected_elsewhere' |
    'running' | 'status_unknown' | 'deleting' };
};
// List: { state: 'ready', items: RecentConversation[] }; empty uses items: [].
// Shared registry outage: HTTP 503 { state: 'unavailable' }.
```

Availability is an observation, never mutation authorization. Delete is enabled only for a ready, certain, unselected owned row whose bounded native ownership/activity/inbox/form/permission/child checks succeed. Selected, running, queued, uncertain, unavailable, deleting or child-unsafe rows stay disabled with a safe contract reason. The server independently rechecks on POST; stale observations cannot authorize removal. Listing neither hydrates commands nor advances recency or performs native mutations. Accepted/partial deletion rows are content-minimized: remove title/transcript text from DTO/cache and use only operation identity, safe time and progress. Never include original/pending content in deletion diagnostics.

Add the following application routes through the same BFF policy, with existing UUID validation:

| Route | Contract |
| --- | --- |
| `POST /api/think/views` | Empty JSON object → HTTP 201 `{ viewToken, selectionRevision: 0, conversationId: null, expiresAt }`. Daemon creates an opaque high-entropy token; no caller-chosen view identity. |
| `GET /api/think/selection` | Token in `X-Memory-Loop-View` → HTTP 200 `{ selectionRevision, conversationId, expiresAt }` for that live view only. Read without renewal or mutation; unknown/expired tokens return controlled 403 `lease_unavailable`. |
| `POST /api/think/selection` | `{ viewToken, expectedRevision, conversationId: UUID \| null }` → HTTP 200 `{ selectionRevision, conversationId, expiresAt }`. Compare-and-set protects both renewals and changes; same target extends expiry without advancing selection revision, changed target advances it. |
| `POST /api/think/conversations/:id/resume` | `{ clientCommandId }` → HTTP 202 target-bound resume receipt. Hydrates/verifies that exact registered conversation; does not Send, recreate it or change a view's selection. |
| `POST /api/think/conversations/:id/delete` | `{ clientCommandId, viewToken }` → HTTP 202 target-bound deletion receipt: acceptance is intent, not completion. A valid repeat returns the same operation's receipt without another attempt. No generic DELETE proxy. |
| `GET /api/think/conversations/:id/commands/:commandId` | Read the same target-bound command receipt, including Resume/delete. A deletion lookup has no destructive side effects. Never allocate a second command to learn the first outcome. |

Receipt kinds are `resume` with states `registered | ready | upstream-unconfirmed | rejected`, and `delete` with `accepted | pending | completed`. Both carry `conversationId`, `clientCommandId`, current `epoch`; rejected resume carries a controlled failure code `ownership_mismatch | service_unavailable`. Deletion additionally carries optional `reason: io_unavailable | conflict | status_unknown`. Pending means deletion isn't complete, not rejection, undo or a promise of eventual completion. Existing receipt kinds/states remain intact across service/BFF/browser validation. Guard responses use `{ error: { code, message, reason? } }`: malformed requests are 400 `invalid_request`, unknown/expired caller leases are 403 `lease_unavailable`, unknown/unregistered targets are 404 `not_found`, reused command IDs with a different target/kind are 409 `command_conflict`, and version/selection races are 409 `selection_conflict`. Protection is 409 `delete_blocked` with `current | selected_elsewhere | running | status_unknown | deleting`, including unavailable native status as `status_unknown`. Private-state unavailability is controlled 503 `think_unavailable`. No raw native errors or content appear in these responses.

Scope tokens to this personal application and the authenticated access admitted by existing web policy, not a browser-supplied username; the service-authenticated BFF does not invent a new per-user identity header. Keep tokens in shell memory, store hashes, never log or put them in URLs/list DTOs. An optional allowlisted `X-Memory-Loop-View` token header on list reads lets the daemon distinguish current versus elsewhere; it grants no identity beyond existing access. Selection operations affect **only** the supplied owned token; no endpoint accepts another client's token hash/row ID or clears all leases. Minting a new token does not release another view's protection. No multiuser/device-management system.

After an uncertain selection POST, inspect the same token through the fixed GET
route before deciding whether that selection committed. Retain strict POST
compare-and-set, including stale same-target renewals. Inspection must not extend
the lease, silently retry a mutation, or overwrite a newer binding. An expired
view must register again; creating a new view cannot clear another live lease.

The persistent shell renews every 30 seconds, expiry two minutes, while Ground or any other tab is displayed—not only during a Think watch. Update on selection; retain the selected identity across navigation. Persist expiry so a quick daemon restart has no artificial guard gap. An expired/disconnected/suspended view eventually stops protecting its old selection. It must renew/re-register before interaction; failed renewal blocks mutations. Renewal or registration cannot select a deleting/deleted target. Per-browser current-chat pointers are unchanged.

Selection/Send/deletion share per-conversation mutation fencing and database row-version checks. Resume prepares the target first; only an unchanged shell handoff performs selection compare-and-set, then navigation. Recheck local draft/navigation versions after that asynchronous commit too. A stale completion conditionally restores its own lease binding only if the revision is still its own; it cannot overwrite a newer selection. Preserve drafts and do not redirect on that stale completion. Lease expiry and stale-cache availability never authorize bypassing current native execution checks.

### Delete workflow and completion

Delete requires explicit confirmation; HTTP 202 accepts an irrevocable intent, not a completed deletion. The daemon rechecks registry/native ownership, all unexpired selections, outstanding admission and native status. Any child blocks deletion, including idle or cross-directory children: OpenCode 2.2.2 removal cascades even onto active children and does not provide an activity safety guard. Running, queued/uncertain work or unavailable status also blocks deletion; no implicit Stop, interrupt or cancel. Obtain external facts outside a transaction, then recheck the lease revision and fenced application version before durably marking deleting. New selection/admission cannot race past that mark. Quiesce existing observers/writers and drain in-flight filesystem work before removal.

Use the public **`client.session.remove({ sessionID }, { signal })`** for at most one removal attempt per accepted intent. Persist the attempted fact before the call. The SDK client factory injects DELETE-only `keepalive: false` and `redirect: 'error'` to prevent Bun pooled-socket replay and destructive redirect following; other SDK requests retain their transport behavior. Never expand the target to unrelated/TUI sessions. A lost acknowledgement leaves the native effect unconfirmed, not safe to retry or assume successful. Removal is not proof that provider-side work stopped.

Persist concrete progress through native acknowledgement, mapped transcript unlink plus directory sync, and private cleanup; each is separately fallible. Verify the mapped namespace/file identity, confirmed prefix and any sealed pending suffix before unlinking. Only an already-absent **mapped** transcript may count as removed; a changed/replaced/symlink/hardlink or unowned target is conflict, not permission to unlink arbitrary content. Do not locate transcripts by title or current config. A chat that never started logging may legitimately have no created transcript; its stored creation/checkpoint state must establish that fact.

Acceptance sets a deletion fence checked by async observers, rehydration, queued tasks, writers and content responses before publication. Revoke transfer nonces and new body reads; abort/drain existing readers, close watches, invalidate projection/body caches and discard late results. Only after native and transcript effects are confirmed proceed with verified owned-cache cleanup and the final transaction purging original/form BLOBs, pending append chunks, recovery payloads and derived title/content metadata. Physical cache-file cleanup failure is still incomplete deletion; pending private records are not discarded to hide it. A response already delivered to a browser cannot be recalled, but no subsequent service read may address fenced content and the UI drops its stale cache.

Failure or uncertainty stops the attempt and leaves an honest, fenced pending outcome. Command GET, repeated same-command POST and daemon restart never retry destructive effects or cleanup. After listener ownership, startup restores pending facts/fences for status reads only; there is no eventual-completion promise. Only after all effects and the private purge are confirmed report completed and remove the row/refill the latest ten. Retain content-free deletion receipt/progress metadata and ID tombstones to reject command reuse/resurrection, not payload digests, text, source paths, titles or native dumps. File checks assume a trusted root namespace, not transactional protection against arbitrary hostile filesystem races. Logical deletion is not forensic erasure of database free pages/WAL, remote provider history, browser history, external backups or vault sync copies. No distributed-atomicity, Undo or age-based retention claim.

## 7. Persisted generation: daily questions and planned weekly quotes

**Questions are implemented; weekly quotes/evidence remain `memory-loop-9ya.8`.** The existing daemon uses pinned **Croner 11.0.0**, not hand-rolled cron or an experimental native schedule service. Only the questions timer runs today; accepting quote configuration does not implement that job. Start scheduling/recovery only after startup ownership/listener succeeds, never from browser reads or server preparation. Stop new attempts during shutdown, persist facts and do not imply daemon shutdown stopped native work. There is no job-control UI or additional operator service.

Occurrence identity is `(job, effective zone, scheduled UTC instant)` calculated by the library. On startup reconcile an unfinished attempt first, then process **only the latest due occurrence**, including first enablement; do not enumerate a downtime backlog. Honor the library's timezone/DST behavior. Safely abandoning an older undispatched attempt must not prevent that same startup from checking the latest due occurrence. Coalesce schedule events while a job is active; newer missed occurrences do not create overlap/floods. Preflight has at most three automatic attempts per occurrence, with 30-second then 60-second backoff and budget/deadline facts preserved across restart. Unknown native admission is read-reconciled using its existing IDs, never automatically redispatched. Conflicts/invalid configuration wait for correction or a later occurrence rather than spinning. An empty or duplicate-only valid batch settles without creating/rewriting a resource.

Persist attempt/native/prompt identities and immutable input digest before dispatch. Occurrence state (`preparing | uncertain | admitted | failed | settled`), creation/dispatch-attempt bits and publication phase (`validated | publishing | settled | conflict | rejected`) distinguish progress; these are concrete job records, not a generic queue or raw native-history mirror. Keep validated serialized candidates, exact proposed resource output and baseline/output hashes for publication recovery. Successful publication or a deliberate no-op records the settled occurrence; invalid completed output records failure, not false settlement. Safe failure categories remain diagnostics, not dashboard job controls.

### Context and native capability boundary

Read modified Markdown notes within the configured lookback, newest mtime first with note-ID ties, up to the configured 20-note/8-KiB-per-note/64-KiB-total defaults. Metadata traversal is bounded to 10,000 visited entries and depth 32. Exclude hidden paths, designated resources/the resource subtree, configured transcript directory and registry-mapped transcript locations **before** applying the newest-note cap. Do not follow symlinks. Take valid UTF-8 excerpts without splitting a code point; include source note IDs and modification times as data, not instructions. Revalidate changed reads or skip them. No recent notes is valid empty context, not permission to widen the search. Do not retain excerpt history in application database/logs; native/provider prompt retention is a separate boundary.

Generation sessions have a distinct `ground-generation` owner purpose, never Recent conversations or user transcript records/files. Think may independently prepare its empty transcript directory at startup; directory existence is not a job transcript. Use the configured Think agent/model selection/native defaults, not a fabricated model. Do not reuse/change Think's wildcard-allow creator. Create generation sessions with public `SessionCreateInput.permissions: [{ action: '*', resource: '*', effect: 'deny' }]` and verify exact rules, ownership, location and native identity before prompting. Supply permitted excerpts/evidence explicitly; quote research remains **daemon-mediated**, not arbitrary model filesystem/shell/delegation/gateway access.

Controlled 2.2.2 allow-versus-deny probes now cover built-in read/write/shell, child delegation and Code Mode `execute` fetching an owned HTTP sentinel. The lasting native question case proves forced Code Mode denial, publication and daemon restart without prompt replay. These are representative ordinary permission checks, **not direct-MCP denial certification or a process sandbox for privileged hooks/plugins**. Preserve the [restricted-generation evidence and API rules](../research/opencode-2.2.2-restricted-generation.md); revalidate changed boundaries rather than repeat broad discovery. A conflicting setup fails closed: do not alter personal configuration, weaken Think, autoapprove asks or substitute CLI execution. No unverified `tools: []`, tool-allowlist or native structured-output field is assumed; the daemon validates JSON itself.

Initial model verification alone accounts for 2.2.2's omitted requested variant becoming `default`, using `requested.variant ?? 'default'`, never truthiness fallback. Provider/model IDs remain exact; omitting the whole model still delegates. Persist exact native effective readback and keep subsequent session/history comparisons strict. History starts with explicit order/limit; continuation sends the opaque cursor and limit **without order**. Retain page/message bounds, exact persisted input ID/digest and ownership/process rechecks before accepting canonical completion.

Candidate questions have `{ text }`; quote candidates have `{ text, attribution, sourceUrl }`. Arrays contain at most the configured requested count; extra fields, invalid/oversized text or non-JSON surrounding prose are rejected. This is generation validation, not a request to truncate arbitrary model output into plausible content. Valid partial batches are allowed; fewer than five is not failure.

### Implemented question publication and recovery

Parse the actual configured Prompts resource using the ordinary H2/paragraph grammar, append unique valid candidates at the bottom, keep the latest 50 and reparse canonical output. A missing target has a recorded absence baseline; empty files are valid. Malformed, symlinked, unowned or otherwise unsafe targets stop without replacement. Seal baseline namespace/file identity/hash, exact validated candidates/output and output hash in SQLite before file effects. No-op batches preserve bytes, inode and mtime and do not create a missing file.

Create a same-directory exclusive no-follow temp with a pre-recorded random hard-link witness intent. Recovery of an unbound inode requires matching empty private regular-file temp/witness identities, not a filename guess. Commit the proven inode **before** retiring the witness, including cleanup of terminal publications; a failed persistence retains both links. Recheck bound namespace, file identity and expected bytes before writes/cleanup; do not adopt substitutions or sweep unrelated names. A crash before a verifiable witness exists remains an ambiguous artifact and fails closed, not a universal-recovery promise.

Sync the completed temp, recheck baseline identity/hash, then atomically rename over an unchanged existing target. For an absence baseline, use exclusive no-replace hard-link publication so a newly created manual file cannot be overwritten. Remove verified owned temporary links and sync directories before recording settlement. After publish-before-database-confirmation, matching actual output hash confirms without append or another native prompt; other bytes are conflict. A hash check followed by rename is **not** filesystem/distributed compare-and-swap: an independent editor can race the final syscall in this trusted personal namespace. Never silently merge/force overwrite.

### Planned weekly quote evidence (`memory-loop-9ya.8`)

Daemon-mediated research uses a narrowly bounded search/fetch adapter; the model can propose a query/source but does not control unrestricted HTTP or tools. Verify against retrieved primary or reputable documented sources: quote passage and attribution must actually be present and applicable, with enough bibliographic context to distinguish the author from somebody quoting them. Permit conservative whitespace/typographic-quote normalization, not fabricated paraphrase or author inference. A URL, page title, search snippet or matching text alone is not proof of attribution. Reject uncertainty rather than fill a quota.

Fetch only public HTTP(S) targets with no credentials; reject loopback, private/link-local/reserved addresses, unsafe ports and redirects at every hop. Validate resolved/connected addresses, not merely hostname text, to avoid DNS-rebinding bypass. Bound searches, redirects, response bytes and time; no cookies/service credentials or whole-page retention. Persist concise evidence facts (final source URL/title, retrieved time, passage/attribution reference or digest) with the pending validated candidate; publish the source reference in Markdown. The fixture owns its research adapter responses; production must not be silently wired to fixture evidence. Precise provider/HTTP-library binding and safe network enforcement are Phase 6 implementation/fixture evidence, not certification of any source/provider by this draft.

The later quote publisher must preserve the same bounded validation, ownership, no-op, conflict and durable publication requirements; the working question path is not evidence that quote research/attribution is implemented.

## 8. Author consistency check and implementation gates

This draft uses existing `VaultId`/Recall URL encoding, the actual `ConversationState`/receipt epoch and transcript health names, current Send/form service bounds, `session.remove` spelling, and the existing safe renderer policy. Resource routes, durable SQLite recovery, Resume/selection/deletion and the scheduler/daily-question path are implemented and independently accepted. Weekly quote evidence/publication and the final normal-checkout handoff remain gates. Current source/fixture acceptance is recorded in README, not evidence of live deployment or completion of the Ground plan.

Implementation evidence belongs with each planned Bead: parser and exact weight boundaries; capture continuation/order/partial coverage; shell prefill/typing/cancellation races without Send; durable original admission and changed-epoch hydration; partial append/checkpoint recovery; leased selection and busy deletion races; paired removal plus BLOB/cache/transfer revocation and late-callback fencing; timezone/single-catch-up/uncertain job admission; evidence rejection, safe fetching and manual-edit/publication crash recovery. Use test-owned inputs, injected boundaries and owned native fixtures through the real Next → daemon path, never personal data. Preserve existing Think, Capture and Recall behavior.

No further product decision is required to author these defaults. Native removal/children behavior, the paired browser flow and representative restricted question generation have controlled owned-fixture proof with the limits above. Quote research and direct-MCP/hook compatibility are not thereby certified. Real configuration, generation activation, private-vault use, operator-service restarts and deployment validation occur only at the explicitly authorized handoff. This documentation update does not rerun tests/builds or activate the live application.
