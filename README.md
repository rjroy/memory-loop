# Memory Loop

A personal workspace with four stable destinations: Ground, Capture,
Think, and Recall. **Recall is built:** browse one configured vault and read
Markdown without changing it. The other three views remain honest placeholders.
The user-approved character board is now applied: inspiring Ground, quiet Capture,
curious Think and reflective Recall. The previous top-navigation implementation
earned visual **SHIP**, technical **Accept** and independent checks.
The native Next App Router migration (`memory-loop-1l0.2`) is accepted. Next presents the UI and proxies two read-only API routes to
the authenticated Bun/Hono daemon. The daemon reads the JSON-configured vault
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
It needs neither transport/vault configuration nor a running daemon. Native
`src/app/` pages/layout and two explicit Route Handlers are the sole application
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
not read or overwrite it to test the UI. Metadata must stay outside the vault.
Missing/invalid vault configuration and an unavailable vault produce distinct API
errors, not an empty tree. There is no config editor or vault picker in the UI.

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

During phase-two verification, use only controlled fixture data and an explicit
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
match the loopback web origin. In tailscale mode the public HTTPS origin is
distinct from the private web listen port. Occupied ports fail without fallback
or eviction. Missing/invalid transport or credentials fail before serving vault
data; correct the private files/permissions rather than weakening validation.

`bun --no-env-file run dev` launches standard Node `next dev`, also on loopback.
It requires the same transport preflight and two BFF endpoints, not a dev proxy.
Framework development access logging is disabled to keep note IDs out of logs;
application attempt/outcome/error logs remain visible. Bun configuration suppresses
only its command echo. Ctrl-C stops the owned web child; stop the daemon separately.
A missing daemon leaves the shell usable with an honest service-unavailable state;
missing/invalid vault config remains a distinct read error after daemon startup.

### Browser and private deployment boundary

The browser uses same-origin Next APIs. Only `GET /api/vault/tree` and
`GET /api/vault/note` reach the server-only BFF; it creates fresh service headers
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
Never expose the daemon, bind to LAN/all interfaces, or create a public Funnel.

The **127.0.0.1:4173** static preview and its `dist/` remain the retained rollback.
It has no vault API and is not the supported runtime. The current private mapping
is 9443 → 3000; if rollback is needed, change only that mapping with
`tailscale serve --bg --https=9443 http://127.0.0.1:4173`. Preserve the preview
and unrelated mappings. A separate unauthorized tailnet principal has not been
tested end-to-end; fixture identity-policy and actual proxy-header checks passed.

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

There is no search, editing, saving, media viewer, AI, dashboard data, or vault
write action. Dot entries, symlinks and non-`.md` files are omitted. Empty trees,
empty notes, config failures, unavailable notes/vaults and transport failures
are distinct states. See the [approved Recall design](.lore/work/design/recall-read-only.md)
and [daemon contract](backend/CONTRACT.md).

The reader requires Linux procfs/no-follow descriptor access. It trusts the
configured root and ancestors, local OS and personal namespace, not hostile
local filesystem processes. Eligible hardlinked files have no provenance
guarantee; relocation/rename/delete can affect in-flight reads. Browsing is not a
transactional snapshot.

## Checks and current acceptance

The Hono daemon phase (`memory-loop-1l0.1`) passed independent fixture-based
backend checks (**130 tests**) and typecheck. Fresh technical verification
accepted the HN1-R1 readiness correction. This verifies the private daemon API,
not physical-phone acceptance. Native Next and the API-only daemon are implemented;
the migration was accepted after its checks and technical/visual review. Real-vault
deployment has been activated and independently verified; final review accepted it.
Historical results below do not substitute for the real-deployment verification.

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
locations and dark-context focus; light-context focus is Night. Ground/Capture/Think
remain unavailable-feature previews without fake forms, conversations or data.
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
