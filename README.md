# Memory Loop

A personal workspace with four stable destinations: Ground, Capture,
Think, and Recall. **Recall is built:** browse one configured vault and read
Markdown without changing it. **Capture is built:** save thoughts to the same
configured vault. **Think now has a working conversation UI in the isolated local
fixture** below. Ground remains an honest placeholder.
The user-approved character board is now applied: inspiring Ground, quiet Capture,
curious Think and reflective Recall. The previous top-navigation implementation
earned visual **SHIP**, technical **Accept** and independent checks.
The native Next App Router migration (`memory-loop-1l0.2`) is accepted. Next
presents the UI and proxies Recall's read-only API and Capture's write route to
the authenticated Bun/Hono daemon. Capture has been verified with a disposable
vault; a running deployment needs the updated build and restarted tiers before it
serves this version. Think command/stream/content foundations are
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
The daemon reads the JSON-configured vault
when started. The private Tailscale deployment now uses the selected real vault;
independent real-deployment verification passed and final review accepted it.

## Operator guide

### Install and build

Use Bun 1.4.3 and Node 26.13.0 (Next requires Node >=20.9). Bun manages packages
and runs the daemon. Next build, development and production run under **Node**,
not Bun's experimental Next adapter or a custom HTTP server.

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file run build
```

Build uses the supported default Turbopack and writes `.next/`, not `dist/`.
Never rebuild an artifact while a live Next process is serving it: use a separate
copy, as the Think fixture does, or stop the source-owned web process first.
It needs neither transport/vault configuration nor a running daemon. Native
`src/app/` pages/layout and explicit Route Handlers are the sole application
path; there is no React Router, Vite application, static export or `preview` command.
Vitest retains Vite only as its transitive test engine, with env-file loading off.

### Separate vault and transport configuration

Three ignored files have separate responsibilities:

| File | Purpose |
| --- | --- |
| `.memory-loop/config.json` | The single selected vault, read only by the daemon at startup. |
| `.memory-loop/transport.json` | Daemon origin and web request policy, read by both server tiers. |
| `.memory-loop/service.token` | Shared server-only bearer credential; never sent to the browser. |

Vault configuration is JSON, not environment-based discovery:

```json
{ "vaultDirectory": "/absolute/path/to/your/vault" }
```

The path is a placeholder. The user's local JSON selection already exists; do
not read or overwrite it to test the UI. Configuration and private cache metadata
stay outside the vault; a transcript's small frontmatter is intentional note content.
Missing/invalid vault configuration and an unavailable vault produce distinct API
errors, not an empty tree. There is no config editor or vault picker in the UI.

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

Omit `transcriptDirectory` to use **`Conversations/Memory Loop`** (including the
space). An override is vault-relative: slash-separated visible names, with no
empty/dot-prefixed components, absolute path, backslash or NUL. All runs append
to `think-<conversation UUID>.md`; an empty New chat creates no transcript file.
Settings load at daemon startup. Restart does not move files, recover accepted
work or adopt transcripts from an earlier daemon.

Transcripts contain full original user and AI text in literal fenced blocks,
plus conservative tool/lifecycle summaries—not reasoning or raw tool payloads.
They are sensitive vault notes covered by the vault's normal sync/backups;
secrets deliberately written in user/AI text are not redacted. Newly created
files are owner-only `0600`. Existing, linked, moved or externally edited targets
are conflicts: the writer never overwrites, merges or adopts them. It can resume
only when the original owned namespace/bytes pass its safety checks again.

Vault logging never gates chat/tools. It retries automatically, backing off from
about one second to a maximum one-minute delay while the daemon lives. There is
no Retry logging route/button. Snapshot/watch health stays quiet for short
storage failures; `warning` becomes true after one minute from the first failure,
or immediately for a conflict, content gap or invalid logging configuration.
It clears only after catch-up and synchronization. Other conversations' warnings
remain in `otherTranscriptWarnings`. Think shows these meaningful warnings quietly
beside the composer; healthy writes and brief retries have no routine status line.

The **private original-body capture before native dispatch is different**: failure
there rejects the Send as a resource failure, because the original bytes could
not be retained. A later vault write/sync failure or invalid transcript location
only degrades logging; valid Recall/native chat remain available.

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
  "daemonOrigin": "http://127.0.0.1:3001",
  "web": { "mode": "loopback", "origin": "http://127.0.0.1:3000" }
}
```

An absolute server-only `MEMORY_LOOP_TRANSPORT_FILE` selects another
`transport.json`; its credential is always the sibling `service.token`.
`--project-root` selects the daemon's vault-config root, independently of that
transport selector. Restart both tiers after transport/credential changes and
the daemon after a vault-config change. Setup always targets its `--project-root`.

No `.env` file is required. `VAULTS_DIR`, `PORT` and `HOSTNAME` are not application
configuration; bind/port come from explicit launcher arguments and transport.
Use the outer Bun `--no-env-file` flag for launches; it does not scrub inherited
variables or disable Next's own dotenv loading. Never put credentials in `NEXT_PUBLIC_*`, Next
config `env` mappings, CLI arguments or URLs. The launcher resolves and passes the
absolute non-secret transport-file selector to Node; application builds and page
rendering never read transport credentials or the vault. Vault reads begin
through the authenticated API.

### Start both tiers

**Bare daemon startup reads the existing selected vault.** For the current
private deployment, start from the project root in separate terminals:

```sh
# Terminal 1: API-only Bun/Hono, default 127.0.0.1:3001; no frontend build needed.
bun --no-env-file run daemon
# Terminal 2: transport preflight, then standard Node next start on 127.0.0.1:3000.
bun --no-env-file run server
# Terminal 3: authenticated tree status/shape, without printing notes or tokens.
bun --no-env-file run check:daemon
```

Open **https://gsai.raptor-piranha.ts.net:9443/recall** on a device connected to
the tailnet. To stop, press Ctrl-C in each terminal; to restart, run the daemon
and server commands again. Build with `bun --no-env-file run build` after source
changes before restarting the production server. No OS autostart is configured;
the background Tailscale Serve mapping alone does not start either process.

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

Open `http://127.0.0.1:3000/recall` for loopback mode. Both launchers accept
`--port <port>`; the daemon port must match `daemonOrigin`, and the web port must
match the loopback web origin. In tailscale and reverse-proxy modes the public HTTPS origin is
distinct from the private web listen port. Occupied ports fail without fallback
or eviction. Missing/invalid transport or credentials fail before serving vault
data; correct the private files/permissions rather than weakening validation.

`bun --no-env-file run dev` launches standard Node `next dev`, also on loopback.
It requires the same transport preflight and fixed BFF routes, not a dev proxy.
Framework development access logging is disabled to keep note IDs out of logs;
application attempt/outcome/error logs remain visible. Bun configuration suppresses
only its command echo. Ctrl-C stops the owned web child; stop the daemon separately.
A missing daemon leaves the shell usable with an honest service-unavailable state;
missing/invalid vault config remains a distinct read error after daemon startup.

### Browser and private deployment boundary

The browser uses same-origin Next APIs. Recall uses `GET /api/vault/tree` and
`GET /api/vault/note`; Capture uses `POST /api/capture`; the internal Think layer
adds fixed command, snapshot, watch, content and decision routes under the same web request policy, not a
generic OpenCode proxy. The BFF creates fresh service headers
for the authenticated daemon. Browser credentials, cookies and forwarding headers
are not forwarded. The daemon rejects browser Origin/Fetch Metadata and has no
frontend assets, SPA fallback or generic filesystem route. APIs are uncached;
errors and application logs omit credentials, note identifiers and note text.

Use a **current, updated browser with the Navigation API**. Presentation snapshots
use the public `navigation.currentEntry.key`; unsupported browsers show “Browser
update required” rather than a URL-identity fallback. Chromium fixture checks do
not establish actual phone support: the physical phone browser remains unverified.

Loopback is not user authentication against local processes. The selected
phase-three topology is **private Tailscale Serve → loopback Node Next → loopback
Bun/Hono → vault**. Only Next may be exposed. Tailscale transport replaces `web`
with `{ "mode": "tailscale", "origin": "https://<self-DNS>:9443", "allowedLogin":
"<exact-personal-login>" }`; the exact public Host/origin and Serve-injected human
login are required, with no wildcard or simultaneous loopback API bypass. A
tailnet connection alone is not authorization. Verify actual proxy header
replacement and denied-principal behavior with fixtures before real notes.
Never expose the daemon or bind either tier to LAN/all interfaces. Tailscale mode
rejects Funnel requests.

For a separately secured, operator-managed authenticated reverse proxy, replace
`web` with, for example:

```json
{ "mode": "reverse-proxy", "origin": "https://proxy.example.test:10000", "externalAuth": "operator-managed" }
```

The origin must be a canonical HTTPS DNS origin, including any non-default public
port and without credentials, path, query or fragment. The explicit assertion is
an operator declaration, **not** application authentication: the proxy must enforce
authentication for every request, including all API routes and static assets, and
preserve the actual public Host. Next and the daemon must remain bound to loopback;
local processes able to reach Next are trusted and can bypass proxy authentication.
The app checks actual Host, any supplied Origin and Fetch Metadata; it neither
trusts forwarded authority nor expects Tailscale identity in this mode. The daemon
service token stays server-side. Do not expose this mode through a public Funnel
unless the existing proxy independently enforces the required authentication.
Verify the complete proxy path and unauthorized access with disposable fixtures
before using private data; selecting the mode does not configure or verify a proxy.

The **127.0.0.1:4173** static preview and its `dist/` remain the retained rollback.
It has no vault API and is not the supported runtime. The current private mapping
is 9443 → 3000; if rollback is needed, change only that mapping with
`tailscale serve --bg --https=9443 http://127.0.0.1:4173`. Preserve the preview
and unrelated mappings. A separate unauthorized tailnet principal has not been
tested end-to-end; fixture identity-policy and actual proxy-header checks passed.

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
  and no image/embed requests. HTTP(S) links open in a new tab; note, heading,
  wiki and unsafe links remain text. Frontmatter is ordinary Markdown, not
  interpreted metadata. Source H1–H5 shift down one level beneath Recall H1;
  source H6 stays H6. Skipped source levels are not repaired.

Recall has no search, editing, saving, media viewer, AI action or vault write
control. Dot entries, symlinks and non-`.md` files are omitted. Empty trees,
empty notes, config failures, unavailable notes/vaults and transport failures
are distinct states. See the [approved Recall design](.lore/work/design/recall-read-only.md)
and [daemon contract](backend/CONTRACT.md).

The reader requires Linux procfs/no-follow descriptor access. It trusts the
configured root and ancestors, local OS and personal namespace, not hostile
local filesystem processes. Eligible hardlinked files have no provenance
guarantee; relocation/rename/delete can affect in-flight reads. Browsing is not a
transactional snapshot.

## Checks and current acceptance

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
  with an inline discard choice. There is no previous-chat list or Ground resume
  interface in this layer.
- Reload/reconnect recovers the **current** chat from its URL (or one per-tab
  opaque-ID pointer), while the daemon/service live. Drafts survive ordinary
  app navigation/reconnect, but **not hard reload**. No messages, drafts or outbox
  are stored in browser storage, and reconnect never auto-sends a draft.
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
Canonical restoration uses public `session.message.get`, completed text identity,
length and SHA-256; mismatches remain content errors. Originals, form replies,
unfinished previews and pinned readers are retained for this daemon epoch. This
is not daemon-restart recovery or constant-memory native JSON decoding. There is
no application conversation-turn cap; current Send validation permits up to
1 MiB UTF-8 per input, and native/provider limits still apply.

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
accepted Phase 4; this does not activate Think on the live Tailscale path. The retained case is:

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
