# Memory Loop

A personal workspace with four stable destinations: Ground, Capture,
Think, and Recall. **Recall is built:** browse one configured vault, read and
edit Markdown, view supported files, and manage notes, files and folders. **Capture is built:** save thoughts to the same
configured vault. **Think has a working conversation UI in the isolated local
fixture** below. Ground now presents six independent cards, including recent
registered conversations with Resume and Delete, and can prepare an unsent Think
draft. Opt-in daemon-resident daily questions and weekly model-attributed quotes
publish to its Prompts and Inspiration resources.
After source updates, rebuild and restart the configured tiers before testing the
updated version. The Ground roadmap is not complete.
The user-approved character board is now applied: inspiring Ground, quiet Capture,
curious Think and reflective Recall. The previous top-navigation implementation
earned visual **SHIP**, technical **Accept** and independent checks.
The native Next App Router migration (`memory-loop-1l0.2`) is accepted. Next
presents the UI and proxies Recall's vault API and Capture's write route to
the authenticated Bun/Hono daemon. Capture has been verified with a disposable
vault. Think command/stream/content foundations are
available in the isolated fixture below, with conversation controls, reconnect,
vault transcripts and automatic logging recovery. Phase 4 is independently
accepted; Phase 5 is independently verified and accepted for fixture use.
The local scripted-provider fixture has been tested. A separate local app at
`http://127.0.0.1:40987/think` has also reached the existing OpenCode service and
selected vault: a real reply, reload recovery and transcript/Recall read were
verified. An initial check incorrectly expected Send to be enabled with an empty
draft; independent verification confirmed it is disabled when empty and enabled
after entering an unsent draft. This does not measure token-by-token streaming or
exact native terminal latency. The address is ephemeral. Network deployment is
user-managed and is not a prerequisite.
The daemon reads the JSON-configured vault when started.

## Operator guide

### Install and build

Use Bun 1.4.3 and Node 26.13.0. The pinned `file-type` 22.3.0 dependency requires
Node >=22 when run under Node (Next itself requires Node >=20.9). Bun manages packages
and runs the daemon. Next build, development and production run under **Node**,
not Bun's experimental Next adapter or a custom HTTP server.

For an existing live checkout, do not run the build below until **all** web
processes serving its `.next` have stopped. Follow the authorized stop/build/start
sequence in the [safe publication handoff](#safe-publication-handoff).

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file run build
```

Build uses the supported default Turbopack and writes `.next/`, not `dist/`.
Never rebuild an artifact while a live Next process is serving it: use a separate
copy, as the Think fixture does, or stop **every** web process serving that artifact.
It needs neither transport/vault configuration nor a running daemon. Native
`src/app/` pages/layout and explicit Route Handlers are the sole application
path; there is no React Router, Vite application, static export or `preview` command.
Vitest retains Vite only as its transitive test engine, with env-file loading off.

### Separate vault and transport configuration

Ignored configuration and private state have separate responsibilities:

| File | Purpose |
| --- | --- |
| `.memory-loop/config.json` | The single selected vault, read only by the daemon at startup. |
| `.memory-loop/transport.json` | Private daemon origin, read by both server tiers. |
| `.memory-loop/service.token` | Shared server-only bearer credential; never sent to the browser. |
| `.memory-loop/application.sqlite` | Private Think ownership, originals, command/activity facts, leases, transcript checkpoints/pending appends, deletion progress and generation/publication facts; not configuration or a chat-history mirror. |

Vault configuration is JSON, not environment-based discovery:

```json
{ "vaultDirectory": "/absolute/path/to/your/vault" }
```

The path is a placeholder. The user's local JSON selection already exists; do
not read or overwrite it to test the UI. Configuration and private cache metadata
stay outside the vault; a transcript's small frontmatter is intentional note content.
Missing/invalid vault configuration and an unavailable vault produce distinct API
errors, not an empty tree. There is no config editor or vault picker in the UI.

#### Recall upload limit

The upload API is available by default, without an enable flag. It accepts one
nonempty file per request, up to **100 MiB** by default; empty files are rejected.
To choose a different per-file
limit, add the optional `recall.uploads.maxFileBytes` integer to the existing
vault configuration; the valid range is 1 byte through **1 GiB** (1073741824
bytes). For example, the following placeholder sets a 50 MiB limit:

```json
{
  "vaultDirectory": "/absolute/path/to/your/vault",
  "recall": { "uploads": { "maxFileBytes": 52428800 } }
}
```

The daemon reads this setting at startup; changing it requires a daemon restart
to take effect. Do not replace an existing configuration with the example or
restart a running instance without authorization.

#### Think transcripts: fixture/staged configuration

The daemon also accepts the following Think configuration. Paths are examples;
the local fixture uses a scripted provider and throwaway vault. Real vault and
native-service selection are separate user configuration, not required for it:

```json
{
  "vaultDirectory": "/absolute/fixture-vault",
  "think": {
    "service": {
      "registrationFile": "/absolute/fixture/service-discovery.json",
      "requiredVersion": "2.2.2"
    },
    "location": { "kind": "vault" },
    "permissionMode": "full",
    "transcriptDirectory": "Conversations/Memory Loop"
  }
}
```

The selected OpenCode service must already exist; the application does not start
or replace it or discover a personal default. Version `2.2.2` and `full` are the
current defaults/only supported choices. Optional `agent`/`model` overrides stay
daemon-owned; omission uses native defaults. The vault is the native working
directory, **not a tool sandbox**.
These settings select new chats. Restoring a registered chat verifies its stored
creation selections, not today's new-chat defaults, and does not reset native
permissions or model choices.

Omit `transcriptDirectory` to use **`Conversations/Memory Loop`** (including the
space). An override is vault-relative: slash-separated visible names, with no
empty/dot-prefixed components, absolute path, backslash or NUL. All runs append
to `think-<conversation UUID>.md`; an empty New chat creates no transcript file.
Settings load at daemon startup; changing them does not move mapped files.
Registered, verified transcript files can reopen after restart, but this does not
by itself restore a chat. Registry-owned chat restoration is described below;
neither restoration nor transcript recovery replays accepted work.

Transcripts contain full original user and AI text in literal fenced blocks,
plus conservative tool/lifecycle summaries—not reasoning or raw tool payloads.
They are sensitive vault notes covered by the vault's normal sync/backups;
secrets deliberately written in user/AI text are not redacted. Newly created
files are owner-only `0600`. Only a private-registry mapping with a verified
checkpoint permits reopening an existing file. Unregistered legacy files and
registry entries without a checkpoint are not adopted by filename. Linked,
replaced, moved or externally edited targets are conflicts: their bytes are
preserved, never overwritten, truncated or merged. Continuation requires the
original owned namespace, file identity and confirmed bytes to pass verification.

Stable transcript entry identities survive body-cache generations. Before an
append, the database seals its exact serialized pending bytes; after file and
directory synchronization, it confirms the offset, digest and entry identity.
A fresh writer can finish a matching partial pending tail exactly once, or
confirm an already-written tail without appending it again. This recovery uses
registered facts, not a scan of arbitrary Markdown or reconstructed native events.
The transcript remains ordinary Markdown in the same format.

Vault logging never gates chat/tools. It retries automatically, backing off from
about one second to a maximum one-minute delay while the daemon lives. There is
no Retry logging route/button. Snapshot/watch health stays quiet for short
storage failures. For accepted input awaiting logging, `warning` becomes true
after one minute from the first failure, even if the initial checkpoint load
failed; unused chats stay quiet. Conflicts, content gaps and invalid logging
configuration warn immediately. An unresolved source conflict stays unhealthy
across retries; correcting it permits successful revalidation and catch-up to
clear the warning. Other conversations' warnings remain in
`otherTranscriptWarnings`. Think shows these meaningful warnings quietly beside
the composer; healthy writes and brief retries have no routine status line.

#### Private Think application state

The existing Bun/Hono daemon uses Bun's built-in SQLite at
**`<projectRoot>/.memory-loop/application.sqlite`**. The effective root is the
daemon's `--project-root`, or the source project root when omitted—not the shell's
working directory or the directory selected by `MEMORY_LOOP_TRANSPORT_FILE`.
JSON remains configuration. No additional service or startup command is needed;
Think still attaches to the operator-selected OpenCode service.

For newly created chats, the database commits native/vault ownership and command
identity, bounded original Send/form-answer BLOBs, digests and dispatch-attempt
facts before native effects. Observed outcomes are recorded afterward; lost
acknowledgements remain uncertain and are never automatically replayed. Native
OpenCode remains authoritative for assistant history and execution. The body
cache is disposable, not the durable original-input store.

The current schema is **v10**. V10 links new attempts to local freshness periods;
legacy attempts retain their original identities and pending work is reconciled on
the next relevant card read. V9 extends preflight budgets to both jobs while
preserving v8 question identities, budgets, publication bytes/hashes and temp/witness
ownership; existing question plans need no rewrite. Its additive migrations preserve
prior originals, ownership, command ordering/timestamps, leases, deletion facts and transcript
checkpoints/pending work. V6 adds generation occurrences/attempt identities, v7
adds persistent preflight budgets and v8 seals validated publication plans,
baseline/output hashes and temporary-file ownership. V5 introduced paired-deletion
and private-cache ownership facts; v4 added conversation activity, Resume receipts
and per-view selection leases. V3 added an explicit durable command-registration
sequence to the transcript mappings/checkpoints, stable-entry facts and bounded pending-append chunks
introduced in v2. The additive v1/v2-to-v3 migrations freeze existing command
insertion order without changing original bytes or timestamps, ownership or
transcript checkpoints/pending work. Pending bytes are cleared after confirmation;
confirmed assistant history is not mirrored in the database.

The state directory must be outside the real vault and owner-only `0700`; the
database and any SQLite sidecars must be owner-only `0600` regular files with one
hard link and no symlinks.
Treat originals, pending transcript text, validated generation candidates/proposed
resource output and ownership/checkpoint metadata as
sensitive private data. Keep them out of vault sync and version control;
restrict backups to the same owner and preserve permissions.
For a consistent file-copy backup, stop the daemon first. No raw database access
is exposed to the browser.

Unsafe or unavailable private state fails Think mutations closed, before native
dispatch when admission cannot be persisted. It does not disable otherwise valid
Ground, Capture or Recall. A storage failure after native acceptance cannot undo
that work or truthfully report it as rejected. Vault transcript failures remain
separate, nonblocking logging failures.

For **new registry-owned conversations**, a fresh reload of the same
`/think?conversation=<id>` URL can restore the chat after a daemon restart. The
daemon verifies the stored vault/native ownership and creation selections before
publishing history. The attached operator-managed native service is separate;
restarting the app daemon does not restart it. Restored content gets a new serving
epoch and fresh body references; old references and stale responses remain invalid.

User/form text comes from exact immutable original BLOBs and command/decision
facts. Delivered user entries associate by persisted native-message IDs, never
native plugin-prepared text or guessed text/time matches. Canonical assistant text
comes from verified native history. Busy native work remains busy; an uncertain
attempt stays reserved without automatic replay.
Later exact message-ID evidence can confirm admission and permit explicit,
best-effort Stop without resending. Retained cancelled-before-delivery originals
keep their ledger-established position relative to delivered turns, including tied
registration times; verified transcripts continue without duplicate old entries.

Unregistered legacy transcripts/native chats are not scanned or adopted. Durable
history is not durable browser draft storage: unsent drafts still do not survive
a hard reload or browser closure. Ground's Recent conversations card provides
explicit Resume for eligible registered chats; it does not import legacy chats.

#### On-demand questions and quotes: daemon configuration

To enable both jobs, merge this example into the daemon's private configuration:

```json
{
  "ground": {
    "generation": {
      "enabled": true,
      "timeZone": "server",
      "questions": { "count": 5 },
      "quotes": { "count": 5 },
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

The example opts in explicitly: omission or `enabled: false` leaves generation disabled
to avoid sending vault excerpts to a provider without configuration. The single
`enabled` flag controls both jobs. The daemon reads `<project-root>/.memory-loop/config.json`;
`--project-root` selects that root and defaults to the source checkout root. Development
and production are isolated only when launched with different project roots and vaults.
`MEMORY_LOOP_TRANSPORT_FILE` selects transport separately and does not select the vault
configuration; no environment-specific configuration overlay is loaded automatically.
Restart the daemon after editing its configuration. Quotes use model training knowledge
plus recent vault context for personally relevant themes, with accurate attribution
requested from the model, **not independently verified**. Both counts default to
five and are configurable from 1–50; valid partial and empty batches are accepted.
External search, source fetching and evidence/API-key workflows are removed from
the quote scope, not deferred.
With `enabled: true`, Ground uses the existing configured OpenCode service and Think
agent/model selection/native defaults. Reading the question or quote card requests
freshness for that card in the background; the saved card is returned without waiting.
There is no extra service or job-control UI. Invalid
generation settings or a failed job do not disable otherwise healthy Ground
reads, Capture, Recall or Think. Think's full-permissive sessions are unchanged;
generation uses separate verified deny-all sessions, not resumable Think chats or
user transcripts. Supplied excerpts reach the configured native service/provider;
its own history/retention is outside the application's private-state guarantee.

The configured IANA timezone defines a local calendar day for questions and a
Monday-starting local week for quotes; `server` resolves the daemon's named timezone
at startup, not the browser's. Legacy `schedule` fields remain accepted and validated
for compatibility but no longer control generation. A completed period is remembered
across restarts; missed periods are not backfilled. A read reconciles unfinished work
before starting the current period. Jobs are independent and concurrent reads coalesce.
Pre-admission preflight uses bursts of at most three automatic attempts with 30-second
then 60-second backoff; another read can retry after a burst is exhausted. Invalid model
output can be retried on a later read in the same period. Unsafe targets and publication
conflicts fail closed. Unknown native admission is reconciled by the same persisted IDs,
never automatically resent.
Shutdown stops new attempts, not necessarily already-running native/provider work.

Context is bounded recent Markdown, newest modification time first with note-ID
ties. Hidden paths, the resource subtree, configured transcripts and historical
registry-mapped transcripts are excluded before the note cap. Reads do not follow
symlinks; changed/invalid reads are skipped or fail safely, never widen the search.
The application retains input digests and job/publication facts, not excerpt-history
tables or raw native/tool dumps.

Only a completed response from the verified owned native session is accepted:
strict JSON arrays of `{ "text": "…" }` questions or
`{ "text": "…", "attribution": "…" }` quotes. Extra fields, surrounding prose,
over-count or invalid/oversized fields reject the whole batch. Validation is
structural, not a factual-attribution check. The daemon parses the actual configured
resource, appends unique entries at the bottom and retains the latest 50. Questions
use `## Question` paragraphs; quotes use `## Quote`, blockquote text and a nonempty
`Attribution:` line in `03_Resources/Memory-Loop/inspiration.md` by default.
Quote deduplication compares normalized text plus attribution, without changing
retained author text/case or legacy `Source:` metadata. New quotes omit `Source:`
rather than inventing it. Empty/duplicate-only batches do not rewrite or create a
file; malformed/unsafe files or an oversized final resource remain unchanged.
Selection separately uses existing file-order weights 1…N, with no model call;
Ground-visit selection stability is unchanged.

Publication seals exact candidates/output and baseline/output hashes in SQLite
before file effects. Verified temporary-file ownership, file/directory sync,
atomic replacement and exclusive no-replace creation protect the configured
resource. Manual changes become conflicts; after publication but before database
confirmation, matching output bytes can confirm success without appending or
prompting again. A crash before the temporary creation witness exists can leave an
ambiguous artifact: it fails closed, without blind adoption or directory sweeping.
This is trusted-local-namespace recovery, **not** filesystem/distributed
compare-and-swap or universal crash recovery. See the [restricted-generation
compatibility evidence](.lore/work/research/opencode-2.2.2-restricted-generation.md)
for the tested native boundary and its limits.

#### Initialize transport

For a **new operator-owned root**, initialize transport once:

```sh
bun --no-env-file run setup:transport --project-root /absolute/scratch/app
```

The root must already exist. Setup never creates/reads vault configuration and
refuses to replace existing credentials. It creates a 0700 `.memory-loop/`
directory and owner-only 0600 regular transport/token files; symlinks, unsafe
permissions and a different owner are rejected. The generated transport defaults to:

```json
{
  "daemonOrigin": "http://127.0.0.1:3001"
}
```

An absolute server-only `MEMORY_LOOP_TRANSPORT_FILE` selects another
`transport.json`; its credential is always the sibling `service.token`.
`--project-root` selects the daemon's vault-config root, independently of that
transport selector. Existing transport files may contain obsolete `web` fields;
they are ignored and need no migration. Restart both tiers after transport/credential changes and
the daemon after a vault-config change. Setup always targets its `--project-root`.

No `.env` file is required. `VAULTS_DIR` is not application configuration.
The web launcher passes standard Next arguments through; Next also accepts `PORT`.
Use the outer Bun `--no-env-file` flag for launches; it does not scrub inherited
variables or disable Next's own dotenv loading. Never put credentials in `NEXT_PUBLIC_*`, Next
config `env` mappings, CLI arguments or URLs. The launcher resolves and passes the
absolute non-secret transport-file selector to Node; application builds and page
rendering never read transport credentials or the vault. Vault reads begin
through the authenticated API.

### Start both tiers

**Bare daemon startup reads the existing selected vault.** Start from the project
root in separate terminals, retaining the existing transport selector and daemon
project root where one is used. These examples are not a replacement for the
existing instance's known selectors or an authorization to interrupt it:

```sh
# Terminal 1: API-only Bun/Hono; no frontend build needed.
bun --no-env-file run daemon
# Terminal 2: transport preflight, then standard Node next start.
bun --no-env-file run server
# Terminal 3: authenticated tree status/shape, without printing notes or tokens.
bun --no-env-file run check:daemon
```

For an already managed deployment, `bun run restart` stops its recorded web
processes, builds once, then restarts its recorded daemons and webs. Recorded working
directories, executables, arguments, transport selectors and process identities are
kept in the ignored `.memory-loop/restart.json`. Other environment variables come
from the shell running the command; they are not restored from a snapshot. The command
refuses stale or unrelated PIDs rather than stopping a process by port. It does not
change generation settings or restart the native service. If a stop, build or
startup fails, it exits with an error; inspect the managed services and metadata
before attempting recovery. Use this command only when interruption is acceptable.

Open `/ground` or `/recall` at the address chosen for the deployment. The browser
uses relative API paths; no browser hostname, port or protocol is configured in
Memory Loop. Optional standard Next `--hostname` and `--port` arguments or `PORT`
select the web listener. The daemon's listener must match its private
`daemonOrigin`; the web listener need not match it.

#### Safe publication handoff

Before any in-place publication, wait for and save active Think work and obtain permission
for interruption. Identify the intended daemon root, selector and owned processes;
do not silently substitute or migrate private configuration or state. Stop the
app daemon and **every** web process serving the shared `.next`, confirm they have
exited, then build once and restart only the authorized instances with their own
selectors. Do not interrupt the separate native service or change network access
settings as an incidental part of publication. Existing unregistered native
sessions are not automatically adopted into Recent or Resume.

An earlier app-tier publication occurred; its prior active Think work could not be
established. A later read-only check found generation disabled, but that is not a
permanent state guarantee. Publication and generation are separate decisions:
confirm jobs remain off before a jobs-off startup. Enabling them requires separate
authorization; recent vault excerpts can reach the selected model/provider, may
incur charges and can write the designated resources. This documentation enables
nothing and authorizes no restart or model call.

During Think development, use only controlled fixture data and an explicit
scratch root/transport instead (separate terminals, after creating fixture vault
config and transport):

```sh
MEMORY_LOOP_TRANSPORT_FILE=/absolute/scratch/app/.memory-loop/transport.json \
  bun --no-env-file run daemon --project-root /absolute/scratch/app
MEMORY_LOOP_TRANSPORT_FILE=/absolute/scratch/app/.memory-loop/transport.json \
  bun --no-env-file run server
MEMORY_LOOP_TRANSPORT_FILE=/absolute/scratch/app/.memory-loop/transport.json \
  bun --no-env-file run check:daemon --project-root /absolute/scratch/app
```

Occupied ports fail without fallback or eviction. Missing/invalid transport or credentials fail before serving vault
data; correct the private files/permissions rather than weakening validation.

`bun --no-env-file run dev` launches standard Node `next dev`.
It requires the same transport preflight and fixed BFF routes, not a dev proxy.
Framework development access logging is disabled to keep note IDs out of logs;
application attempt/outcome/error logs remain visible. Bun configuration suppresses
only its command echo. Ctrl-C stops the owned web child; stop the daemon separately.
A missing daemon leaves the shell usable with an honest service-unavailable state;
missing/invalid vault config remains a distinct read error after daemon startup.

### Browser and private deployment boundary

The browser uses same-origin Next APIs. Recall uses `GET /api/vault/tree`,
`GET` and `POST /api/vault/note`, `GET /api/vault/file`, `GET|HEAD /api/vault/content`,
`GET` and `POST /api/vault/attachments`, and `POST /api/vault/actions`; Capture uses `POST /api/capture`; Ground uses six fixed
read routes under `/api/ground`; the internal Think layer
adds fixed command, snapshot, watch, content and decision routes under the same web request policy, not a
generic OpenCode proxy. The BFF creates fresh service headers
for the authenticated daemon. Browser credentials, cookies and forwarding headers
are not forwarded. The daemon rejects browser Origin/Fetch Metadata and has no
frontend assets, SPA fallback or generic filesystem route. File content streams through
the fixed Next boundary rather than being buffered or subject to its short JSON timeout.
For uploads, Next fetches the limit before streaming: that limit request has a
15-second deadline, and the upload has a 60-second idle deadline reset by byte
progress. The Next server also retains Node's five-minute absolute request-receive
timeout, so even progressing uploads can time out. Both Next and the daemon count
actual bytes independently.
APIs are uncached;
errors and application logs omit credentials, note identifiers and note text.

Use a **current, updated browser with the Navigation API**. Presentation snapshots
use the public `navigation.currentEntry.key`; unsupported browsers show “Browser
update required” rather than a URL-identity fallback. Chromium fixture checks do
not establish actual phone support: the physical phone browser remains unverified.

The application checks the actual incoming Host, any supplied Origin and Fetch
Metadata for request integrity; these checks are **not end-user authentication**.
Direct access or a proxy may use HTTP or HTTPS and any deployment-selected
hostname and port. A proxy must preserve the actual Host; forwarded authority
headers do not override it. The private daemon stays on loopback and requires its
server-only bearer token, exact daemon Host and no browser Origin/Fetch Metadata.

Network exposure, user authentication and encryption are deployment choices and
responsibilities. Access to the web tier can expose private vault data; loopback
alone does not authenticate local processes. If an access-control layer is used,
it must cover pages, APIs and assets and be verified separately with disposable
data. No particular provider, proxy or TLS setup is required by the app.

Think uses cryptographic random bytes for UUIDs and verifies canonical content
with SHA-256 on ordinary HTTP as well as HTTPS. A controlled non-localhost HTTP
Chromium/native fixture exercised new chat, Send and a verified scripted reply;
a unit test rejects a wrong digest. This does not certify every browser or a
particular network deployment, nor make all secure-context APIs available on HTTP.

## What Ground does

Open `/ground` after starting the existing daemon and web tiers above. The daemon
reads resources from the configured vault; the browser uses same-origin APIs and
does not open vault files or receive the server credential. The default resource
paths, relative to the vault, are:

| Card | Default resource |
| --- | --- |
| Quick Actions | `03_Resources/Memory-Loop/quick-actions.md` |
| Inspiration | `03_Resources/Memory-Loop/inspiration.md` |
| Prompts | `03_Resources/Memory-Loop/prompts.md` |
| Current Goals | `03_Resources/Memory-Loop/goals.md` |

Quick Actions uses a skill reference as an H2 and one descriptive paragraph:

```markdown
# Quick Actions

## @intent
Clarify what this work is for.
```

Selecting it prepares **only `@intent`** as an editable, unsent draft in a fresh
Think chat; the description is not sent. A syntactically valid reference does not
guarantee the skill is installed. Prompts similarly prepares the selected question
as an unsent draft. Neither action sends a message or stops existing work. If the
current chat has any nonempty draft, including whitespace, Ground offers a
confirmation and preserves the prior conversation's draft. These per-conversation
drafts are volatile: ordinary app navigation preserves them, but hard reload or
browser closure does not. Think's own **New chat → Discard & start** behavior is
unchanged.

A recorded successful creation from before a daemon restart is not enough to
switch chats. Ground verifies a ready target snapshot in the current serving
epoch before changing selection or navigating. If unavailable, the current chat
and both drafts stay in place; **Check chat** checks the same prepared chat
without creating or sending again.

Inspiration displays a selected quotation with its attribution and optional source.
Source-less entries work through the parser, API/BFF and card; existing Source
metadata/citations remain supported and are preserved on retained entries.
Prompts and Inspiration use narrow Markdown
entry formats; see the [resource format contract](.lore/work/design/ground-contracts.md#2-small-markdown-formats) for
their syntax and limits. Goals accepts ordinary nonblank CommonMark/GFM with
Recall's safe rendering: no live raw HTML or fetched images, and task boxes are
read-only. Missing files are not created or overwritten by Ground reads. Empty,
missing, malformed and unavailable resources are reported per card, so one does
not hide the others. Selection uses file-order weights 1, 2, …, N without calling
a model. A quote or prompt selection stays stable during a Ground visit; leaving
and returning starts a new selection.

Recent captures links up to the five most recent recorded entries to their source
notes in Recall. If source coverage is incomplete, the card says so rather than
claiming a complete latest five.

Recent conversations shows up to ten registered Think chats with at least one
registered user Send. New Send/form input and confirmed assistant content advance
recency; reading, polling, selection and Resume do not. Titles come from the first
original input, not generated summaries. An unused fresh or prefilled chat stays
out of the list. Ten is a display limit, not a retention rule.

**Resume** opens that existing conversation and its verified history, without
creating a chat, sending a prompt or stopping background work. Opening another
chat protects any nonempty current draft, including whitespace, with an inline
confirmation; both keyed drafts are preserved. Resume of the current chat also
verifies its current serving epoch before reopening after a daemon restart.
Pending or failed opening feedback stays beside the chosen row;
**Check chat** checks the same request rather than issuing a second Resume.
Empty lists, individual unavailable chats and card-local failures are distinct.

Each browser view keeps its selection token only in memory. The persistent shell
renews selection every 30 seconds across all four app destinations, independently
of the conversation stream; the daemon protects each live selection for two
minutes, including selections in other browser tabs. A returning view must
reconcile or register again before Think mutations are enabled. The editor stays
editable, and other Ground resources, Capture and Recall remain usable if Think
is unavailable. A transient initial history-read failure gets a bounded automatic
read retry; recovery never replays a native command.

**Delete** stays visible but disabled, with a reason, for the current chat,
selections in other views, running work, unknown status or an incomplete deletion.
The server also blocks any chat with a child session, even an idle child. It
independently rechecks ownership, selection and activity before deleting; there
is no implicit Stop or child-session cascade.

An available Delete opens a compact confirmation beside that row, naming the
chat: **Chat and transcript file. No undo.** Cancel receives focus; Cancel or
Escape closes the confirmation and returns focus without deleting. Only
**Delete conversation** submits the request. Completion removes the owned chat,
its mapped transcript file and conversation-owned private application data—not
unrelated notes or external backups. The row disappears only after confirmed
completion; other chats' drafts remain intact and only the recent list refreshes.

A definite refusal leaves the row and explains why. An accepted but incomplete
deletion, a partial failure or a lost acknowledgement stays unresolved, with
Resume/Delete blocked for that target. **Check status** only reads the same
command; it does not advance or retry deletion. There is no Undo, Retry Delete,
automatic status polling, repeated destructive POST or destructive retry on
restart. Do not restart expecting an incomplete deletion to finish automatically.

Opt-in daily questions and weekly model-attributed inspiration are implemented
and verified as described in the operator guide. Separate authorization is needed
for further interruption or job activation.

## What Capture does

Capture uses the existing selected vault and transport configuration; no new
configuration is required. Start both tiers as above, then open `/capture`. The
daemon creates `00_Inbox/YYYY-MM-DD.md` when needed and appends a Markdown entry
such as `- [14:35] A thought`. The filename and time come from the same instant
in the **daemon server's local timezone**. Continuation lines are indented two
spaces, and existing note bytes are preserved. Each capture accepts up to 1 MiB
of UTF-8 text; meaningful whitespace is retained.

On desktop, **Enter** captures and **Shift+Enter** adds a line. On mobile,
**Enter** adds a line and the **Capture** button submits, including with an
attached keyboard. The editor remains usable while saving; a confirmed save
clears only an unchanged draft. Drafts survive ordinary app navigation but not a
hard reload or browser closure.

A definite failure keeps the draft. **Save unconfirmed** means the write may
have succeeded even though confirmation was lost; the draft stays visible and
the app never retries automatically. Capturing again may create a duplicate.
Physical phone keyboard/IME and assistive-technology behavior remain unverified;
browser emulation does not establish them. Fixture-only manual verification is
tracked as `memory-loop-22s`.

## What Recall does

- Four horizontal app links sit in the shared top identity/header at every size;
  there is no permanent app rail or bottom tab bar. The independent Files tree
  starts visible on desktop, fills the work area on narrow screens, and closes
  on narrow selection. It is not modal.
- A left-chevron icon at the Files header's upper-right collapses the sidebar;
  a right-chevron at the reader's upper-left expands it. Both have accessible
  names and hover/keyboard-focus tooltips, without visible Show/Hide text.
- Native folder disclosures and file links preserve keyboard and modified-click
  behavior. Note URLs are `/recall?file=<query-encoded JSON component array>`.
- Literal filenames/relative paths identify the article. Browser history and
  in-session reading/list positions are presentation memory, not cached notes or
  authoritative daemon state.
- CommonMark/GFM is rendered with escaped raw HTML, named disabled task boxes,
  and local media embeds in Recall only. HTTP(S) links open in a new tab; note, heading,
  wiki and unsafe links remain text. Frontmatter is ordinary Markdown, not
  interpreted metadata. Source H1–H5 shift down one level beneath Recall H1;
  source H6 stays H6. Skipped source levels are not repaired.

Recall can save edits to existing Markdown notes, create blank Markdown notes and
folders, move notes, generic files or whole folders without renaming them, and delete files or
empty folders. Moves do not overwrite destinations; folder deletion is not
recursive, including when hidden or non-Markdown contents are present. Conflicts
require a fresh read before another action. An uncertain outcome is not
automatically retried as a destructive request.

The Files tree also shows visible non-Markdown regular files. Valid UTF-8 text up
to 2 MiB is shown completely and read-only; detected images and videos use the
browser's native viewer or player. A format or codec may not work in a particular
browser; Recall offers the original download rather than silently converting it.
Unknown or active content such as HTML and SVG is served as an attachment, not
executed inline. Oversized or unsupported files can also be downloaded as originals.
Markdown images such as `![Description](../Media/photo.jpg)` resolve relative to
the note; leading `/` starts at the vault root. Obsidian media embeds such as
`![[photo.jpg]]` require a unique filename across the visible tree. Obsidian paths
containing `/` are vault-root-relative unless they explicitly start with `./` or
`../`. Missing, ambiguous and unsupported references show a compact explanation;
remote media is not fetched. Code, escaped syntax and unsupported sizing syntax
remain literal. Think and Ground retain their existing Markdown media suppression.

The attachment API accepts original file bytes one file at a time and places
them under `06_Attachments/`, creating that directory when needed. It keeps both
files on a name collision, adding suffixes such as `photo (2).jpg`. An interrupted
partial upload is cleaned up; a lost acknowledgement or a failure after
publication can instead leave an **uncertain** outcome. Reconcile with the vault
before trying again; the API does not automatically retry.

Choose **Upload files…** from the Files header menu to queue files with the native
file/photo picker, then start the batch explicitly. Uploads run sequentially and
show saving until the server confirms them. Empty selections are rejected; an
uploaded file is opened only when you choose its **Open file** action, through the
existing unsaved-draft guard. Originals are preserved without app-side HEIC
conversion or transcoding. Browser and device format support can still vary;
physical iPhone picker and codec behavior has not been verified by automated tests.

Recall has no search or AI action. Dot entries, symlinks and nonregular files are
omitted from the tree. Empty trees,
empty notes, config failures, unavailable notes/vaults and transport failures
are distinct states. See the [approved Recall design](.lore/work/design/recall-read-only.md)
and [daemon contract](backend/CONTRACT.md).

The reader requires Linux procfs/no-follow descriptor access. It trusts the
configured root and ancestors, local OS and personal namespace, not hostile
local filesystem processes. Eligible hardlinked files have no provenance
guarantee; relocation/rename/delete can affect in-flight reads. Browsing is not a
transactional snapshot.

## Checks and current acceptance

On **2026-11-01**, Ground's reduced weekly-quote slice (`memory-loop-9ya.8`)
passed independent final validation: frontend **144**, backend **745 across 34
files**, Playwright **60**, native integration **7 passed / 3 intentionally
unselected skips**, both direct TypeScript checks and an isolated **Next 16.4.3**
production build. Terminal cross-boundary review accepted the tested source with
no findings and no subsequent code changes. Evidence:
`/tmp/opencode/ground-9ya8-final-validation.log` and
`/tmp/opencode/ground-9ya8-final-validation.json`.
Fresh final six-card visual review at **`a20e932`** returned **SHIP**, with **163
focused browser assertions** across desktop 1440×900, phone 390×844, landscape
844×390 and 320×568 at 200% root text. Evidence:
`/tmp/opencode/ground-9ya9-final-visual-review/report.md`. These controlled
production-component/CSS checks are separate from the 60-test Playwright suite,
not live deployment or physical-device/assistive-technology verification.
The earlier list/Resume/selection (`memory-loop-3ry`) and paired deletion
(`memory-loop-9ya.6`) remain accepted; the unchanged Delete UI's visual evidence is
`/tmp/opencode/ground-9ya6-ui-visual-review/report.md`.
Owned OpenCode 2.2.2/scripted-provider/Chromium fixtures cover paired deletion,
Ground Resume and same-URL reload after restarting only the app daemon, without
native-work replay or duplicate transcript entries. One browserless native case
publishes both question and quote files, verifies deny-all permissions for both
sessions and forces Code Mode denial on the question job. Both stay out of Recent
conversations and Think transcript/command records. Daemon-only restart preserves
both canonical files and their inodes, with one original prompt per job and no
extra native sessions/prompts. Its fictional scripted quote does not test factual
attribution accuracy.
These checks do not certify physical-device, assistive-technology, direct-MCP deny
or arbitrary-hook isolation. They did not deploy this version or enable generation
against personal data. Further publication, interruption or generation activation
requires user authorization; it is not automatic execution or epic closure.

On **2026-10-31**, Ground's Phase 3b registry-bound transcript slice passed
independent validation: frontend **111**, backend **631**, browser **60**, native
UI **3 passed / 3 skipped**, both direct TypeScript checks and an isolated Next
build. Fresh technical review accepted the `GROUNDTRANSCRIPT03/04` corrections;
the earlier conflict/pending-work warning corrections remain covered. Evidence:
`/tmp/opencode/ground-phase3b-final-validation.json`. Owned fixtures exercise fresh
Bun-process recovery, pending-tail completion and conflict preservation. These
checks did not certify physical-device or assistive-technology behavior, activate
the slice against personal data, or by themselves establish chat restoration or
completion of the Ground plan.

Ground's Phase 3a private durable-admission slice passed independent validation:
frontend **111**, backend **602**, browser **60**, native UI **3 passed / 3 skipped**,
both direct TypeScript checks and an isolated build. Fresh technical verification
accepted the `GROUND-DURABLE-01` handoff correction. Evidence is recorded in
`/tmp/opencode/ground-phase3a-final-validation.json`. Those source/fixture
checks alone did not establish publication or completion of the Ground plan.

Ground's Phase 2 resource and prefill slice passed independent validation in
owned fixtures: frontend **108**, backend **581**, browser **59**, native UI
**3 passed / 3 skipped**, both direct TypeScript checks and an isolated build.
After the focused confirmation-focus correction, affected checks passed **63
unit**, **3 browser**, both direct TypeScript checks and an isolated build; fresh
independent visual review reported **25 checks passed / SHIP**, and technical
verification accepted the correction. The earlier full-suite counts predate that
small correction; they are not a claim that every suite was rerun afterward.
Physical-device and assistive-technology coverage is not established by these
fixture checks.

Capture's controlled independent verification passed frontend **90**, backend
**421**, browser **57**, both direct TypeScript programs and an isolated
production build. Technical review accepted the layer and visual review shipped
it; this evidence does not certify a physical phone or assistive technology.
The test results are recorded in `/tmp/opencode/capture-phase4-full-validation.json`
and visual evidence in `/tmp/opencode/capture-final-visual/`.

The Hono daemon phase (`memory-loop-1l0.1`) passed independent fixture-based
backend checks (**130 tests**) and typecheck. Fresh technical verification
accepted the HN1-R1 readiness correction. This verifies the private daemon API,
not physical-phone acceptance. Native Next and the API-only daemon are implemented;
the migration was accepted after its checks and technical/visual review. Real-vault
deployment has been activated and independently verified; final review accepted it.
Historical results below do not substitute for the real-deployment verification.

Think Phase 5 passed independent technical verification and visual review after
TS01–04 and V1–V3 corrections. Later focused verification passed frontend 75,
project/test TypeScript, build, browser 54 and two actual UI/native cases. This
is fixture acceptance, not personal activation. A nonblocking enlarged-text
placeholder issue is tracked in `memory-loop-2sj`; physical phone IME and
assistive-technology behavior remain unverified.

```sh
bun --no-env-file run typecheck
bun --no-env-file run test
bun --no-env-file run test:backend
bun --no-env-file run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun --no-env-file run test:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun --no-env-file x playwright test --config playwright.recall.config.ts
```

Use an existing compatible Chromium executable; the path above is this
environment's example. The production browser fixture owns disposable vaults,
private transport and separate loopback Next/daemon processes, not the user's
4173 service. Both browser configs need a current Next build and
never use personal configuration or a live vault. No browser download is
required by these commands. `typecheck` checks production and test programs
separately under strict TypeScript; the production build also runs its own strict
check and Next's generated-type check. `vitest.config.ts` owns component tests;
`backend/vitest.config.ts` owns daemon/BFF/HTTP integration tests. No lint suite
is configured. Generated `next-env.d.ts` is ignored and regenerated by Next typegen,
dev or build.

### OpenCode characterization tests

The ordinary backend runner includes the pure isolation and readiness guards, but
excludes the native OpenCode characterization. `backend/vitest.opencode.config.ts`
selects that native suite separately. **`bun --no-env-file run test:opencode` is
not part of the ordinary backend suite** and starts owned native fixture processes.

The operator must supply an absolute path to
the previously verified **OpenCode CLI 2.2.2 native executable** explicitly, for
example `OPENCODE_TEST_BINARY=/absolute/path/to/verified/opencode.exe`. This is a
placeholder, not a configured default or a PATH lookup. Native tests also require
their pinned package/platform metadata and executable-identity checks, a trusted
test-owned `/tmp/opencode` anchor, and absence of `/etc/opencode`; they create
isolated temporary data and processes. Do not point the tests at a wrapper,
personal OpenCode configuration, or a real vault.

```sh
OPENCODE_TEST_BINARY=/absolute/path/to/verified/opencode.exe bun --no-env-file run test:opencode
```

The path must be the CLI executable inside its pinned 2.2.2 package installation,
with the matching platform package alongside it. The fixture verifies the native
binary and version before serving, and includes a separate Bun client smoke check.
These tests do not implement or establish acceptance of the Think application.

Read-only Recall and the sidebar correction (`memory-loop-ms4`) were accepted at
baseline `941fff0`: independent frontend unit **25/25**, Recall browser **25/25**,
legacy browser **18/18**, and typecheck/build pass, with fresh technical
**Accept** and visual **SHIP**. Backend **87** remains prior unchanged evidence.
UI-001/002/003 and MS4-R1/R2/R3/V1 are resolved, including sticky-header row
clearance, breakpoint focus transfer, reading-anchor restoration, and visible
focused pane helpers. These are baseline results, not renewed visual-application
acceptance. Baseline evidence is
recorded in `.impeccable/review/recall/handoff.md` (local/ignored); the sidebar's
verification and findings resolution are recorded in Beads `memory-loop-ms4`.
This is historical implementation acceptance; the subsequent private deployment
now uses the real vault and has passed independent real-deployment verification.

The visual application (`memory-loop-44w`) adds unchanged approved A.5/A.1 artwork,
IM Fell English SC identity and Libre Baskerville editorial headings, alongside
the existing Source Sans interface/prose. Compact top navigation frames Parchment
Capture/Recall reading and a cool Think field. Horizon now marks selected
locations and dark-context focus; light-context focus is Night. At that historical
44w checkpoint, Ground/Capture/Think were unavailable-feature previews without
fake forms, conversations or data. Think's current interactive fixture is described below.
Independent current-build typecheck/build, unit **25/25**, Recall browser **26/26**
and legacy browser **20/20** pass, with fresh visual **SHIP** and technical
**Accept**. Backend **87** remains prior unchanged evidence. 44W-T1 is resolved
for initial unfocused pointer targets and natural keyboard operation at
844×390/200% text; existing history/UI-001/002/003 and MS4 regressions remain verified.
The earlier rail/bottom-navigation adaptation is superseded by the user's explicit
top-navigation correction; the shared identity appears once, outside Recall's
toolbar. Enlarged text can reflow the header and scroll a short page without
crushing or covering the Files controls.

The actual system is recorded in [DESIGN.md](DESIGN.md) and
`.impeccable/design.json`; the [phase-1 shell plan](.lore/work/plans/phase-1-shell.md)
is historical shell evidence. Runtime artwork/font rights, exact pinned hashes
and local paths are recorded in [integration provenance](.lore/work/design/character-integration.md).
The historical [guidance snapshot](.lore/work/design/personal-brand-snapshot.md)
is unchanged. No new generated art, dependencies or theme switch were added. Manual
assistive-technology use and physical-device safe areas have not been verified.
## Local Think UI and transport fixture

Phase 2 is checkpointed at `0f45fa1`; Phase 3 transport is independently verified
and accepted at `3ab9a23`. Phase 4 transcript writing/recovery is independently
verified and accepted after filesystem/security corrections. **The fixture now
serves the real interactive Think UI**, backed by the actual Next/Bun/native
path and a local scripted provider. Phase 5 is accepted for fixture use;
Phase 6 provides local testing and configuration handoff. `check:daemon` checks Recall's
tree only, not Think readiness.

Select the already verified OpenCode 2.2.2 native executable explicitly, using
the characterization prerequisites above:

```sh
OPENCODE_TEST_BINARY=/absolute/path/to/opencode.exe bun --no-env-file run think:fixture
```

The command builds a separate Next copy and starts owned Node Next, Bun/Hono,
native OpenCode and a local scripted provider on fixture ports. It creates its
own vault/config/HOME/discovery/credentials; no personal setup or real provider
is used. This is isolation, not an OS sandbox. Only the credential-free loopback
web URL is printed; do not add credentials to URLs, commands or output.

Use trusted, directly installed compatible Bun and Node executables on `PATH`.
If a version-manager shim refuses an untrusted configuration, use your existing
verified executables directly rather than trusting or changing that configuration.

### Try the conversation UI first

Open the printed web URL with **`/think`** appended. First entry starts a chat
automatically and replaces the address with `/think?conversation=<opaque-id>`.
Send **`fixture-read`** to exercise an owned file read and see the reply. In a
fresh **New chat**, send **`fixture-stop`** to hold the scripted response and try
Stop while writing another draft. These trigger words belong only to the local
fixture provider, not normal Think conversations.

- **Enter** sends when eligible; **Shift+Enter** adds a line. Click Send or use
  **Ctrl+Enter / Cmd+Enter** as alternatives; shortcuts never activate Stop. The compact editor grows
  with your text and stays editable while busy, disconnected or unavailable.
- **Stop** is explicit and best effort. Disconnecting, changing app tabs or
  choosing New chat does not stop accepted work; completed effects are not undone.
- **New chat** starts a different conversation and protects a nonempty draft
  with an inline discard choice. Ground's **Recent conversations → Resume** opens
  an existing registered chat instead, preserving both conversations' keyed drafts.
- Reload/reconnect recovers the **current** chat from its URL (or one per-tab
  opaque-ID pointer). For registered chats, a fresh reload of that same URL can
  restore history after the app daemon restarts, provided native ownership/history
  can be verified. Existing epoch fences still reject stale responses. Drafts
  survive ordinary app navigation/reconnect, but **not hard reload**. No messages,
  drafts or outbox are stored in browser storage, and reconnect never auto-sends a draft.
  Transient initial history failures retry reads a bounded number of times;
  established-session epoch changes still require explicit reauthorization.
- Vault transcripts contain full messages and safe activity summaries, appended
  at canonical boundaries rather than every token. Logging retries automatically;
  meaningful warnings do not block chat/tools. There is no **Retry logging** button.

The fixture also supports `fixture-large` in a fresh chat for a large-text reply.
Open `/recall` to browse its **Conversations → Memory Loop** transcripts. Stop the
fixture with Ctrl-C in its launcher terminal; it removes only its owned processes
and private directory. Do not change the live Serve mapping or personal setup to
try this loopback UI.

### Optional HTTP exercise

This lower-level exercise uses a separate fresh conversation. In a second
terminal, substitute the printed URL and create it:

```sh
export FIXTURE_URL='http://127.0.0.1:<printed-port>'
export THINK_ID="$(node -p 'crypto.randomUUID()')"
export THINK_SEND_ID="$(node -p 'crypto.randomUUID()')"
export THINK_BASE="$FIXTURE_URL/api/think/conversations/$THINK_ID"
curl --fail --silent --show-error "$FIXTURE_URL/api/think/conversations" \
  -H 'content-type: application/json' \
  -d "{\"conversationId\":\"$THINK_ID\",\"clientCommandId\":\"$(node -p 'crypto.randomUUID()')\"}"
curl --fail --silent --show-error "$THINK_BASE"
```

In another terminal, set `THINK_BASE` to that same conversation URL and watch:

```sh
curl --fail --no-buffer --silent --show-error --max-time 20 "$THINK_BASE/events"
```

The first event is `snapshot`, followed by monotonic `revision` state signals
and 15-second `heartbeat` events. Read the snapshot again for changed manifests;
follow its opaque `nextCursor` with `?cursor=...` until absent. Cursors belong to
that revision; an invalidated listing can be read afresh. A watch ends after a
five-minute lease; reopen it for fresh authorization and a fresh snapshot, not
event replay. Ending this curl (including expected timeout exit 28) never sends
Stop. Reopen the same URL before or after the following exercise; do not resend.

Back in the second terminal, this Node example waits for creation, sends **one**
scripted large-UTF-8 response request, waits on its receipt, pages the manifest,
verifies the complete canonical body, then waits for transcript synchronization
and reads that note through Recall's HTTP API without printing its text:

```sh
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.THINK_BASE, command = process.env.THINK_SEND_ID;
if (!base || !command) throw new Error('Set fixture variables first');
async function json(url, body) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Fixture HTTP ${response.status}; inspect state, do not resend`);
  return response.json();
}
async function until(url, field, expected) {
  for (let i = 0; i < 300; i++) {
    const value = await json(url);
    if (value[field] === expected) return value;
    if (['rejected', 'failed', 'interrupted', 'monitor-unavailable'].includes(value[field])) throw new Error('Fixture operation did not succeed');
    await delay(200);
  }
  throw new Error('Fixture wait timed out; query receipt, do not resend');
}
await until(base, 'creation', 'ready');
await json(`${base}/messages`, { clientCommandId: command, text: 'fixture-large' });
await until(`${base}/commands/${command}`, 'state', 'completed');
let cursor, ref, epoch;
do {
  const page = await json(base + (cursor ? `?${new URLSearchParams({ cursor })}` : ''));
  epoch = page.epoch;
  const entry = page.entries.find(item => item.kind === 'assistant-text' && item.closure === 'closed' && item.body.kind === 'canonical');
  if (entry) ref = entry.body;
  cursor = page.nextCursor;
} while (cursor);
if (!ref) throw new Error('Canonical assistant body is not available');
let offset = 0, transfer;
const hash = createHash('sha256');
do {
  const query = new URLSearchParams({ generation: ref.generation, through: String(ref.through), offset: String(offset), ...(transfer ? { transfer } : {}) });
  const chunk = await json(`${base}/content/${ref.contentId}?${query}`);
  const bytes = Buffer.from(chunk.bytes, 'base64');
  if (chunk.epoch !== epoch || chunk.generation !== ref.generation || chunk.nextOffset !== offset + bytes.length || chunk.nextOffset > ref.through || (offset < ref.through && !bytes.length)) throw new Error('Invalid content progress');
  hash.update(bytes); offset = chunk.nextOffset; transfer = chunk.transfer;
} while (offset < ref.through);
if (hash.digest('hex') !== ref.sha256) throw new Error('Content digest mismatch');
let logging;
for (let i = 0; i < 300; i++) {
  logging = (await json(base)).transcript;
  if (logging?.state === 'up-to-date' && !logging.warning) break;
  if (logging?.warning) throw new Error('Logging needs attention; chat is separate. Inspect health, do not resend');
  await delay(200);
}
if (logging?.state !== 'up-to-date' || !Array.isArray(logging.noteId)) throw new Error('Logging still pending; do not resend');
const query = new URLSearchParams({ id: JSON.stringify(logging.noteId) });
const note = await json(`${new URL(base).origin}/api/vault/note?${query}`);
if (typeof note.markdown !== 'string' || !note.markdown.includes('memory_loop_transcript: 1')) throw new Error('Fixture transcript unavailable');
console.log(JSON.stringify({ state: 'completed', verifiedAssistantBytes: offset, transcriptBytes: Buffer.byteLength(note.markdown) }));
JS
```

Open the printed fixture URL at `/recall`, then browse **Conversations → Memory
Loop → think-&lt;conversation UUID&gt;.md** to read the ordinary Markdown. This HTTP
exercise does not need the Think UI. For an inert built-in file-read exercise instead of the large-text
response, repeat with fresh conversation/command IDs and replace `fixture-large`
in the Send example with `fixture-read`; the scripted provider reads only its
test-owned sentinel. Never reuse a command ID with changed text.

AI completion alone does not mean the transcript is synchronized. Snapshot
`transcript` includes `state`, `warning`, `liveTextPending`, and when available
`lastSyncedAt`, `reason` and the ordinary Recall `noteId`. `up-to-date` covers
currently eligible entries, not every unfinished preview token. Closing the
watch or creating another conversation does not cancel the writer or force a
retry. For a conflict, preserve the file and fix the underlying namespace/storage
condition; do not delete an owned transcript or restart expecting automatic adoption.

The first chunk pins `generation`/`through` and returns a scoped transfer nonce;
echo it on subsequent chunks. Each response contains at most **64 KiB raw bytes**
within **128 KiB JSON**. Successful chunks renew a **60-second idle lease**;
watch reconnection does not invalidate a progressing transfer. Decode UTF-8
incrementally if displaying text rather than hashing bytes. An expired nonce or
unavailable old prefix returns `content_unavailable`: reread the current manifest
as needed, but do not disconnect the watch, loop resnapshots or resubmit a prompt.
Only an explicit `POST .../runs/:runId/stop` requests best-effort Stop.

Unpinned superseded previews and native-verified finalized bytes can be reclaimed.
Canonical bodies are rebuilt from verified completed native text, message IDs,
text-part ordinals, length and SHA-256; mismatches remain content errors.
Body-cache copies of originals/form replies, unfinished previews and pinned
readers remain scoped to this daemon epoch. After restart, verified registry-owned
history is rebuilt into fresh body references from private originals and native
history, not old cache references or an assistant-history database mirror.
Verified transcript checkpoints prevent duplicate old entries. Native JSON
decoding is not constant-memory. There is no application conversation-turn cap;
current Send validation permits up to 1 MiB UTF-8 per input, and native/provider
limits still apply.

The controlled two-Chromium transport test uses already-installed
`/usr/bin/chromium`; no browser download is implied. The corrected real
response-drop/reconnect/large-UTF-8 scenario passed its focused run; accompanying
TypeScript passed as reported. This followed an initial browser-harness failure
in convergence, not a post-fix rerun of every suite. Measurements and the separate
convergence results are recorded in the validation report below. Fresh review
accepted the Bun idle-timeout correction; affected checks and native fixture passed.
To repeat only this owned fixture case:

```sh
OPENCODE_TEST_BINARY=/absolute/path/to/verified/opencode.exe \
  bun --no-env-file run test:opencode backend/think-full-stack.test.ts -t 'recovers large immutable content'
```

Separate Phase 4 evidence in `/tmp/opencode/think-phase4-native-transcript-acceptance.log`
records **1 selected case passed / 2 unselected skipped** through real Node Next →
Bun → native. A built-in read completed while the transcript namespace was in
conflict; restoring the same directory allowed automatic catch-up through Recall
HTTP without duplicate input/output, adoption, or changes to the prior transcript
or sentinel. Its one sample was **4,059 transcript bytes, 8 entries, 1,012 ms from
fault start through catch-up**—not a benchmark, retry deadline or size limit.
Subsequent independent convergence and filesystem/security correction verification
accepted Phase 4; that fixture result did not activate Think in a live deployment. The retained case is:

```sh
OPENCODE_TEST_BINARY=/absolute/path/to/verified/opencode.exe \
  bun --no-env-file run test:opencode backend/think-full-stack.test.ts -t 'runs the owned Node Next'
```

Use Ctrl-C in the **fixture launcher terminal** to stop only its owned processes
and remove its private directory. `bun --no-env-file run think:fixture --help`
shows usage without starting services. See the [reusable native validation
report](.lore/work/research/opencode-2.2.2-validation.md) for the checkpointed
Phase 1 baseline and separately labeled later integration evidence. These
instructions were source-checked, not executed during this documentation pass.
