# Memory Loop

A personal, dark-default workspace with four stable destinations: Ground, Capture,
Think, and Recall. **Recall is built:** browse one configured vault and read
Markdown without changing it. The other three views remain honest placeholders.
Visual review is **SHIP**; final technical verification is **Accept**. This is
not authorization to activate real-vault reads or expose them remotely.

## Operator guide

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

### Real-vault reads — separate explicit activation gate

**Do not run the following merely to preview the UI.** Starting the daemon uses
the configured real vault. After explicit approval to activate local reads:

```sh
bun --no-env-file run build
bun --no-env-file backend/runtime.ts
```

Then open `http://127.0.0.1:3000/recall`. The daemon serves `dist/`, frontend deep
links, and the read-only API on that same origin. It binds to loopback, **not the
LAN**. `--port <port>` changes the port; `--project-root <absolute-directory>`
selects config and default build location; `--dist <absolute-directory>` selects
another build directory. Use Ctrl-C to stop a daemon you started.

Loopback is not authentication against other local processes. **Remote access to
real notes requires a separate approved, reviewed authenticated private
transport.** Do not proxy the daemon through Tailscale, bind to `0.0.0.0`, or infer
authorization from the existing static preview. No real-vault daemon or remote
transport was activated in this work.

### Development with the API

This also requires approval before using real configuration. Build once so
`dist/` exists, then use separate terminals:

```sh
bun --no-env-file backend/runtime.ts --dev-origin http://127.0.0.1:5173
bun --no-env-file run dev
```

Vite runs on loopback port 5173 and proxies `/api` to the loopback daemon;
browser requests stay same-origin. For a nondefault daemon port, use `--port`
and the server-only `MEMORY_LOOP_DAEMON_URL`, for example
`MEMORY_LOOP_DAEMON_URL=http://127.0.0.1:3001 bun --no-env-file run dev`.
That variable is not vault configuration or client data. Vite env-file loading
is disabled; legacy `.env.example` is unused. Use the documented Bun
`--no-env-file` invocations and never expose secrets in client variables.

## What Recall does

- Desktop Files starts visible and can be hidden; narrow Files fills the area
  above the four persistent app links and closes on selection. It is not modal.
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

Read-only Recall and the sidebar correction (`memory-loop-ms4`) are complete:
current-build independent frontend unit **25/25**, Recall browser **25/25**,
legacy browser **18/18**, and typecheck/build pass, with fresh technical
**Accept** and visual **SHIP**. Backend **87** remains prior unchanged evidence.
UI-001/002/003 and MS4-R1/R2/R3/V1 are resolved, including sticky-header row
clearance, breakpoint focus transfer, reading-anchor restoration, and visible
focused pane helpers. The root production build is current. Baseline evidence is
recorded in `.impeccable/review/recall/handoff.md` (local/ignored); the sidebar's
verification and findings resolution are recorded in Beads `memory-loop-ms4`.
This is implementation acceptance, not real-vault activation:
the static Tailscale preview remains API-isolated and phone access to real notes
is not enabled.

The actual system is recorded in [DESIGN.md](DESIGN.md) and
`.impeccable/design.json`; the [phase-1 shell plan](.lore/work/plans/phase-1-shell.md)
is historical shell evidence. Source Sans 3 regular/semibold and their SIL OFL
are under `public/fonts/source-sans-3/`; [provenance](.lore/work/design/personal-brand-snapshot.md)
remains unchanged. No new colors, art, fonts or theme switch were added. Manual
assistive-technology use and physical-device safe areas have not been verified.
