# Memory Loop shell

With Bun 1.4.3:

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file run dev
```

Development is loopback-only at `http://127.0.0.1:5173`. `bun --no-env-file run build`
produces static files in `dist/`; `bun --no-env-file run preview` serves them at
`http://127.0.0.1:4173`.
The eventual static host must fall back to `index.html` for direct routes.

Use `bun run typecheck`, `bun run test`, and `bun run test:e2e` for checks.
The browser suite builds and starts its own preview server on port 4173 and
requires an installed Playwright-compatible Chromium; set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing executable.

This phase is a navigation preview, not a vault, capture, or AI service. Vite
does not load env files. The legacy `.env.example` is not used. Bun itself may
automatically load `.env` when invoked; use `bun --no-env-file run <script>` or
`bun --no-env-file install --frozen-lockfile` to prevent that behavior. Do not
place secrets in variables exposed to client code.

## What works

Ground (`/ground`), Capture (`/capture`), Think (`/think`), and Recall (`/recall`)
are independently replaceable placeholder views. Navigation, direct links,
refresh, browser history, keyboard focus, and the responsive shell are
implemented. `/` replaces its history entry with `/ground`; unknown addresses
offer a link back to Ground. The interface deliberately cannot enter/save notes,
send messages, browse files, or display real dashboard information.

The desktop rail becomes four persistent bottom links below 56rem. The shell
defaults to Night backgrounds and Parchment text, with a Lantern selection marker
and no theme switch. It uses locally served Source Sans
3 regular/semibold. Font files and their SIL Open Font License are in
`public/fonts/source-sans-3/`; see the [local provenance record](.lore/work/design/personal-brand-snapshot.md).
The fonts retain their OFL license independently of this repository's MIT license.

The original phase-1 shell passed independent unit 10/10, routing 10/10, accessibility/boundary 8/8,
typecheck/build, technical review (**Accept**) and visual finish review (**ship**).
The subsequent user-requested dark-default refinement has a successful production
build and focused visual/contrast checks; its independent regression/review pass
is pending. Routes, copy, typography, layout and behavior are unchanged.
The actual interface system is recorded in [DESIGN.md](DESIGN.md); the
[completed plan](.lore/work/plans/phase-1-shell.md) distinguishes evidence from
remaining limits. Developer evidence is under `.impeccable/review/` (ignored).
Manual assistive-technology use and physical-device safe areas were not verified;
production hosting, LAN exposure and authentication remain separate decisions.
