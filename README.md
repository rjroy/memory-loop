# Memory Loop

A personal workspace with four stable destinations: Ground, Capture,
Think, and Recall. **Recall is built:** browse one configured vault and read
Markdown without changing it. The other three views remain honest placeholders.
The user-approved character board is now applied: inspiring Ground, quiet Capture,
curious Think and reflective Recall. The corrected top-navigation application has
fresh visual **SHIP**, technical **Accept** and independent current-build checks.
The daemon reads the locally configured vault when started; remote exposure is
not configured.

## Operator guide

### Start the daemon

With Bun 1.4.3 and an existing `.memory-loop/config.json` as described below,
build the frontend and initialize the private transport once before starting the daemon:

```sh
bun --no-env-file run build
bun --no-env-file run setup:transport
```

Start the daemon in one terminal and leave it running:

```sh
bun --no-env-file run daemon
```

In a second terminal, check the authenticated service:

```sh
bun --no-env-file run check:daemon
```

`bun run daemon` is the canonical entrypoint; the outer `--no-env-file` also
prevents Bun from loading env files before it runs the script. Project Bun
configuration suppresses the launcher's command echo, not application output or
errors. The daemon reads
the configured vault and temporarily serves the built frontend and authenticated
service API at `http://127.0.0.1:3001`. The existing browser UI cannot call the
private API directly; the Next web tier is not implemented yet. `check:daemon`
reports API status without printing notes or the credential. Stop with Ctrl-C.
This is not the static Vite preview or the future separate web-server tier.

Arguments are forwarded directly, for example:

```sh
bun --no-env-file run daemon --port 3001
```

### UI-only preview — no vault activation

With Bun 1.4.3, from this repository:

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file run build
bun --no-env-file run preview
```

Preview binds to `http://127.0.0.1:4173` with a strict port and serves **static
files only**. If that service is already running, do not start another or stop an
unrelated process. The existing private Tailscale static preview now serves the
built Recall interface, **not** its API. Recall can show **Vault service
unavailable** there: that is expected, not evidence of an empty vault or invalid
configuration. Preview does not proxy `/api` to the daemon.

### Configuration — already local and ignored

`.memory-loop/config.json` is already set locally and ignored by Git. Do not
overwrite it to view the static interface. Its contract is:

```json
{ "vaultDirectory": "/absolute/path/to/your/vault" }
```

The example is a placeholder, not the user's path. This documentation pass did
not read the configuration contents or any notes. The single directory is the
vault root; metadata stays outside it. The daemon loads config once at startup,
independently of the shell's working directory; restart after an approved change.
Missing/invalid configuration leaves the shell available with a distinct API
error. There is no config editor or vault picker in the interface.

### Local vault reads

Starting the daemon uses the configured vault. After the one-time transport setup,
start it locally:

```sh
bun --no-env-file run build
bun --no-env-file run daemon
```

The daemon binds to loopback, **not the LAN**. `--port <port>` must match the
configured daemon origin; `--project-root <absolute-directory>` selects config
and default build location; `--dist <absolute-directory>` selects another build
directory. Use Ctrl-C to stop a daemon you started.

Loopback is not authentication against other local processes. **Remote access to
real notes requires a separate approved, reviewed authenticated private
transport.** Do not proxy the daemon through Tailscale, bind to `0.0.0.0`, or infer
authorization from the existing static preview. No real-vault daemon or remote
transport was activated in this work.

### Transitional development boundary

The old Vite UI is not connected to the authenticated daemon; its proxy does not
inject credentials and browser Origin/Fetch Metadata requests are denied by the
daemon. Do not put the service token in browser code. The Next web tier will
provide the authenticated server-side boundary in the next migration phase.

Transport lives separately from vault config in ignored `.memory-loop/transport.json`
and `.memory-loop/service.token`; setup creates private files and refuses to
replace existing credentials. Restart after changes. An absolute server-only
`MEMORY_LOOP_TRANSPORT_FILE` can select another transport file; its token is the
sibling `service.token`. Bun's `--no-env-file` prevents Bun env-file loading;
it does not remove values inherited from the parent process.

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
not the future Next UI or phone access. The existing static preview remains
API-isolated; transitional daemon static serving is scheduled for removal in
the Next phase.

```sh
bun --no-env-file run typecheck
bun --no-env-file run test
bun --no-env-file run test:backend
bun --no-env-file run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun --no-env-file run test:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun --no-env-file x playwright test --config playwright.recall.config.ts
```

Use an existing compatible Chromium executable; the path above is this
environment's example. The legacy browser suite owns a strict, isolated static
preview on **47173**, not the user's 4173 service. The separate Recall config
owns disposable test vaults and loopback daemons; it needs a current build and
never uses personal configuration or a live vault. No browser download is
required by these commands.

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
This is implementation acceptance, not real-vault activation:
the static Tailscale preview remains API-isolated and phone access to real notes
is not enabled.

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
