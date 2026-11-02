---
title: Phase 1 — frontend shell implementation plan
date: 2026-10-29
status: completed
---

# Phase-1 shell implementation plan

## Completion record — 2026-10-29

The bounded frontend shell is implemented, independently validated, reviewed, and documented. The execution plan below is retained as history, not a pending dispatch queue.

- Independent GREEN: unit **10/10**, routing/browser **10/10**, accessibility/boundary **8/8** after the landmark correction, plus successful typecheck and production build. `/tmp/opencode/memory-loop-landmark-confirmation.log` records the final eight checks and production build/preview; prior routing/unit results and completed post-axe boundary assertions were confirmed by the parent. No tests were rerun in the final documentation pass.
- The setup author resolved the missing-favicon resource error. Designer changed only the scope text's paragraph to a footer/contentinfo landmark; DOM evidence confirmed unchanged geometry/styles at all four inspected viewports. The independent failed-file rerun then passed.
- Fresh read-only technical Oracle using `bun-typescript-reviewer`: **Accept**, no material findings (parent-reported verdict). Fresh Impeccable finish review: **ship**, with no material fixes; [persisted review](../../../.impeccable/review/finish-review.md). The approved navigation-marker detector exception was retained, not broadened into a card/callout rule.
- Two bounded screenshot batches and the existing 15 opened captures supplied visual evidence; no new screenshots or UI polish accompanied documentation. Actual font/OFL copy hashes are in the brand snapshot. Solid-color contrast measured 17.59:1 for Night/Parchment and 10.47:1 for Lantern/Night.
- [DESIGN.md](../../../DESIGN.md) and the [schema-v2 sidecar](../../../.impeccable/design.json) now record the actual reviewed CSS/components. The surface contract's finish gate is closed. No generated imagery, paid rendering, domain implementation, or commits were performed in this documentation handoff.

Remaining limits are not hidden implementation tasks: manual assistive-technology use and physical-device safe-area behavior were not established; LAN exposure/authentication and production static hosting remain unselected. This completed phase still cannot enter/save notes, access vaults, run AI, or manage dashboard panels. The later daemon and disconnect-safe operations remain future work.

## Authorization and acceptance target

The user authorized **“create a plan document then implement it.”** The completed work follows the [personal-brand shell design](../design/phase-1-shell.md), [PRODUCT.md](../../../PRODUCT.md), and the [brand snapshot](../design/personal-brand-snapshot.md). The original planning assignment was documentation only; implementation subsequently proceeded through separate parent-dispatched lanes. Do not infer authorization for later product phases.

Ship four independently replaceable, truthful placeholder pages, in order: **Ground `/ground`, Capture `/capture`, Think `/think`, Recall `/recall`**. `/` replaces itself with `/ground`; unknown paths show the specified not-found view. Preserve real links, direct entry/refresh, browser history, title/focus behavior, keyboard access, the desktop rail/mobile bottom navigation, and the exact reviewed placeholder copy. Capture's route is independent of Ground content.

Night `#031315`, Parchment `#FEF6E1`, Lantern `#EFB83F`, reserved Horizon `#5E8BD6`, and Source Sans 3/Source Sans 3 Semibold are binding. No hero art, logos, taglines, decorative motifs, image generation, or paid rendering. Actual measured contrast and remaining validation limits are recorded in the completion record above.

**No daemon, domain APIs, vault access, AI, note entry/saving, fake content/data, settings, panel configuration, service state, persistence, reconnect handling, or asynchronous business operations.** Do not add backend scaffolding to anticipate them. Authentication/LAN exposure remains a separate deployment decision; local development and validation bind to loopback only.

## Repository findings and protection boundaries — planning snapshot

- Current branch: `feat/restart`; HEAD at final planning check: `58a78ef` (`phase 1 design documentation`). It advanced from `5e348e0` during this assignment; the planner performed no staging or commits. Stay on the dedicated branch; no default-branch work, commits, pushes, or staging as part of this planning assignment.
- Root has documentation, license, `.env.example`, ignored `.env`, `.gitignore`, Beads metadata/skill, and design artifacts. No `src/`, package manifest, lockfile, TypeScript/Vite config, or existing test suite was found. No application implementation needs deletion or migration.
- `PRODUCT.md`, the three design documents, and the restart intent were staged on entry and subsequently became the committed design baseline at `58a78ef`. This plan and its authorization-wording updates remain unstaged at final check. Do not reset/restage unrelated edits or change the intent. The legacy changelog is historical, not a requirement to restore its old features or Next.js stack.
- No root/nested `AGENTS.md`, ancestor `AGENTS.md` in the checked project-parent chain, or `.lore/lore-agents.md` exists. No project-specific reviewer or tester roles are selected. Follow the provided common instructions and assigned roles below; do not create a role registry/tracker for this task.
- `.env.example` still describes vault discovery, port 3000, and `HOSTNAME=0.0.0.0` for Next.js. Leave it and the ignored `.env` untouched; do not read/copy secrets or reuse these defaults. The new shell requires no environment file. Document this in README and disable Vite env-file loading.
- Available at inspection: Bun **1.4.3**, Node **v26.12.1**, Chromium **`/usr/bin/chromium`**. No dependencies were installed or suites run during planning. Availability is not proof that future dependency versions or browser automation are compatible.

## Stack and implementation choices

Use a single root **Bun-managed React + TypeScript + Vite SPA**. React Router (`react-router-dom`, declarative browser routing) handles real route links and history; do not build a general router or add Next.js, Hono, a daemon, SSR, or an application server. Vite is only development/build/preview tooling. Production output is static `dist/`; its eventual host must provide SPA fallback for direct routes. Validate that contract with Vite preview, without claiming LAN deployment is settled.

Use ordinary CSS in `src/styles.css`: the layout/token set is small, and no Tailwind/component library is installed. Do not add a UI framework solely for four placeholders. Use explicit brand variables, native links, semantic landmarks, one route H1, and an H2 for each unavailable-feature explanation. Keep text visible without JavaScript animation dependencies. No external font service.

Keep `App` as the default export of `src/App.tsx`, containing the router. `src/main.tsx` only mounts it; Designer adds the style import after RED when `src/styles.css` exists. Static navigation metadata belongs in `src/navigation.ts`; views are separate default-export modules and own their H1/content. `AppShell` owns navigation/outlet/landmarks; `RouteEffects` owns route title and presentation-only focus/scroll handling. No view registry/plugin API or domain store. Ground alone may later gain panel seams.

Use narrowly scoped **in-memory**, per-history-entry focus/scroll bookkeeping if needed for the design's Back/Forward contract; no localStorage/sessionStorage. On normal internal navigation focus the new H1; on hard entry do not steal focus. On POP restore originating focus where available, otherwise H1 with scroll preserved. Use `preventScroll` when restoring focus, and do not override browser history restoration with unconditional scroll-to-top. Native modified-click/new-tab behavior and Back leaving the app must survive.

### Dependencies and scripts to establish

Runtime: `react`, `react-dom`, `react-router-dom`.

Development: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@playwright/test`, `@axe-core/playwright`.

Choose mutually compatible published versions during setup; record exact installed resolutions in `bun.lock`, and `packageManager: "bun@1.4.3"` in package metadata. Do not invent version pins, bypass peer failures, or install a browser automatically. Bun manages dependencies/scripts; use Vitest for component tests, **not `bun test`**. No Bun runtime APIs or Bun ambient types are needed in browser source.

| Script | Definition |
|---|---|
| `dev` | `vite --host 127.0.0.1 --port 5173 --strictPort` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `build` | `tsc --noEmit && vite build` |
| `preview` | `vite preview --host 127.0.0.1 --port 4173 --strictPort` |
| `test:e2e` | `playwright test` |

Vite config: React plugin, `envDir: false`, an explicit unused public prefix such as `MEMORY_LOOP_PUBLIC_`, no backend proxy, and jsdom Vitest configuration restricted to `tests/unit/**/*.test.tsx`. Never serialize process environment into `define` or client code. Typecheck source, config, and tests under strict TypeScript. Playwright uses only `tests/e2e/`, loopback `http://127.0.0.1:4173`, `reuseExistingServer: false`, and a webServer command of `bun run build && bun run preview`. An occupied port is a failure to report, not permission to kill another service.

## Proposed file scope and ownership

These paths are new unless marked update. Do not delete existing files or run a bulk project generator over the repository.

| Lane | Files / responsibilities |
|---|---|
| **Fixer: setup and test author** | `package.json`, `bun.lock`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `src/vite-env.d.ts`, `src/main.tsx`; `tests/unit/setup.ts`, `tests/unit/navigation.test.tsx`, `tests/unit/view-replacement.test.tsx`, `tests/e2e/shell.spec.ts`, `tests/e2e/accessibility.spec.ts`. Update `.gitignore` only to ignore `test-results/`, `playwright-report/`, and generated `.impeccable/review/` evidence if necessary. |
| **Temporary compile-only seam, setup lane** | `src/App.tsx` and `src/views/{GroundView,CaptureView,ThinkView,RecallView}.tsx`: default-export components returning `null`, no navigation/copy/styles/domain behavior. `main.tsx` mounts App. This makes RED a behavior failure, not a missing-import/build failure. These files transfer to Designer after RED; do not edit them concurrently. |
| **Designer: UI implementation after RED** | Replace the compile-only components; add `src/navigation.ts`, `src/shell/AppShell.tsx`, `src/shell/RouteEffects.tsx`, `src/views/NotFoundView.tsx`, `src/components/PlaceholderNotice.tsx`, `src/styles.css`; update `src/main.tsx` only to import the new styles. Shared notice styling is optional for future views, not a mandatory layout wrapper. Designer may request bounded config/test repairs through their owner, not silently weaken assertions. |
| **Designer: existing font integration** | Copy only `public/fonts/source-sans-3/SourceSans3-Regular.ttf`, `public/fonts/source-sans-3/SourceSans3-SemiBold.ttf`, and `public/fonts/source-sans-3/OFL.txt` from the brand repository's matching `brand/assets/fonts/Source_Sans_3/static/` files and parent `OFL.txt`. Keep binaries unmodified; no conversion/new artwork. Inspect source status/revision before copying; record source→destination paths and SHA-256 hashes in the local brand snapshot. Do not copy the rest of the brand kit. |
| **Documentation/finish** | Add `README.md` with scripts, localhost-only behavior, SPA-host fallback requirement, shell limitations, font attribution/license location, and warning that old `.env.example` is not used. Update `PRODUCT.md`, the shell/direction design records, and brand snapshot only for actual implementation/provenance outcomes. At Impeccable finish, add `DESIGN.md` and `.impeccable/design.json` from the reviewed built system, not invented tokens. Any required tool-managed surface-brief metadata stays under `.impeccable/`; resolve/report the tool's exact paths before writing them. No standing build-path preference is inferred. |

The existing Source Sans 3 regular/semibold files and SIL OFL 1.1 license were located and the license read during planning, not copied. The fonts retain their license; do not imply the repository MIT license replaces it. No source-repository path or development-only contract belongs in shipped HTML/JS or public provenance files.

## Execution sequence and gates

The following is the executed plan. Current results are summarized above; commands below are not a request to rerun completed validation.

### 1. Setup and tests first — Fixer writing lane

Read this plan and the design's exact-copy table. Create only the setup/test files and inert seams listed above. Install dependencies **in this later lane**, not as part of planning, using:

```sh
bun add react react-dom react-router-dom
bun add -d vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test @axe-core/playwright
```

Create package metadata before these commands. Handoff the resulting lockfile and commands; avoid depending on a developer's global packages. Do not add app behavior to make assertions pass. Ensure the starter mounts and compiles without missing-module/runtime errors, then freeze the lane for independent RED. Tests must contain their own inputs and expected contracts, not import production navigation arrays/copy as their expected values.

**Test responsibilities, without redundant full-surface snapshots:**

- **Component integration (Vitest + Testing Library):** four accessible links in fixed order and correct hrefs, current-page semantics after normal activation, H1/title update and focus on client navigation, no tab-widget semantics, skip link, exact placeholder contract, absence of form/domain controls, unknown-route recovery. Reset location/history/DOM between tests; assert no unhandled errors.
- **Replacement seam (Vitest):** mock each view module in isolation with a test-owned H1; prove the selected replacement appears while the shell and other destinations still work. In particular, replace Ground without affecting `/capture`. No production test-only switch or plugin registry.
- **Browser routing (Playwright):** a test named **`root resolves without adding a history hop`** uses a test-controlled preceding history entry, enters `/`, expects `/ground`, and confirms Back returns to that entry rather than `/`. Also cover direct load/refresh of each path, ordinary route history, current-link no-op, Back/Forward title/current-link restoration, modified click/new-tab, and unknown-path recovery. These are browser boundaries, not simulated jsdom history claims.
- **Browser focus/scroll:** hard entry does not autofocus H1; internal activation does; Back/Forward restores location and sensible focus without forcibly resetting scroll. Use controlled viewport/scroll and test-owned temporary tall content for the scroll assertion, not invented production notes. Verify Back may leave the app and no leave guard appears.
- **Accessibility/boundary (Playwright + axe):** inspect all four routes at desktop and phone sizes, landmarks/headings/current link/accessible names, keyboard focus/skip link, no obstruction by bottom navigation. Check requests and storage: no external services, domain API/polling, storage writes, credential exposure, or console/page errors; local static asset requests are expected. Never access a live vault or mutable user data.

### 2. Independent read-only RED tester

Parent dispatches a **different agent from the test author and UI implementer**, in a fresh context; a separate Fixer or Explorer may perform this read-only testing role. Source/test/config/lockfile editing is forbidden. Normal runner-generated reports are allowed. Do not install/repair dependencies or change expected results. Missing infrastructure is a blocker, not a successful RED.

Run and report command, exit code, relevant assertion failures, and evidence paths:

```sh
bun run typecheck
bun run test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun run test:e2e --grep 'root resolves without adding a history hop'
```

Configure Playwright's Chromium `launchOptions.executablePath` from that environment variable; do not hardcode this machine's path as a portable project requirement. If no usable browser exists, stop for environment provisioning rather than downloading one. RED passes its gate only when the inert starter compiles and route/navigation assertions fail for absent behavior. Freeze those tests before UI implementation. The RED report is evidence, not a suite pass.

### 3. Implement the shell — Designer writing lane

After parent accepts RED, implement only the approved shell, replacing the inert seams. Use the exact routes/copy and modular view boundaries. Load Impeccable `craft-floor.md` immediately before UI edits; establish its development-only direction contract/surface mapping using the existing approved direction, without rerolling. This is a code-led, no-generated-image task; do not infer a standing workflow setting or start a paid comp round.

Integrate only the two local font weights and license with updated provenance. Preserve native anchor affordances and focus/scroll semantics; do not add controls for unavailable tasks or log user content. Use the given 56rem breakpoint, ~13rem desktop rail, mobile safe-area padding, and a single document scroll. No route input field or keyboard popup. Designer owns visual implementation; do not delegate the look to the test author.

### 4. Independent read-only GREEN tester

Use the same independent tester role and frozen tests, after UI handoff. Run:

```sh
bun run typecheck
bun run test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun run test:e2e
bun run build
```

Report exact results, relevant browser/version information, unexpected requests/errors, and output paths. `test:e2e` also builds/serves preview intentionally to exercise production assets and direct routing; the final explicit build is the release-artifact check. Do not edit failing tests to reflect the implementation. Parent routes failures to the appropriate writer, then requests targeted read-only confirmation. Fix inadequate test isolation or a real contract error through test-author review, not by weakening coverage to turn GREEN.

### 5. Bounded visual/accessibility inspection — Designer

Run one batched inspection against the built shell at **1440×900**, **390×844**, **320×568**, and **844×390**. Include all four views; inspect focus both selected and unselected, text wrapping, 200% text resize, 320px reflow, increased text spacing, reduced motion, safe-area behavior, and no horizontal scroll/covered content. Measure actual text and meaningful selection/focus contrast; brand approval is not contrast evidence. Use no real vault data. Keep tested strings in the test harness, never the shipped app.

Save and open evidence under `.impeccable/review/`: `desktop.png` and `mobile.png` for Ground; `{capture,think,recall}-{desktop,mobile}.png`; `narrow.png`, `landscape.png`, and `focus.png`. Confirm each shows the named route/viewport with fonts settled, no blank/broken capture, and no hidden animation state. Batch material corrections, then at most one confirmation batch. No open-ended polish loop. The automated responsive checks are functional evidence; these opened screenshots establish visual judgment.

After the UI is complete, run the Impeccable detector once on the changed UI targets:

```sh
/home/rjroy/.agents/skills/impeccable/scripts/impeccable detect --json src index.html
```

Request its independent finish review with the current request, contract, source paths, **all** required captures, brand guidance, and detector findings; no approved generated comp exists. Keep its findings and verdict at their actual scope. Follow its bounded correction/verification handoff; unresolved material issues go to the parent rather than a self-certified finish.

### 6. Technical review and finish

No project reviewer was selected, so parent dispatches a fresh **Oracle**, read-only, with:

```text
procedure: bun-typescript-reviewer
scope: changed phase-1 shell implementation, tests, build/config, and local-font boundary only; no writes
mode: initial-review
request: implement the approved four-view frontend shell; no daemon/domain functionality
inputs: current user request; PRODUCT/design/plan; exact changed-file list/diff;
        independent RED/GREEN reports; build and accessibility/visual evidence;
        affected browser-history/focus, static-host, package/runtime, and font/license boundaries
```

The receiver must load `/home/rjroy/.agents/plugins/personal/skills/agent-procedures/SKILL.md`, then `references/index.md`, confirm this ID's **read-only review** role, and resolve its procedure from the index. The procedure is available there; it is not a separate installed skill or a command to execute. Review requested React/browser and Bun-tooling behavior proportionately; do not expand into daemon/CLI/protocol concerns that this change does not touch. No recursive delegation or source/test changes by the reviewer.

An adequate result is **`Accept`**. Otherwise retain stable finding IDs, evidence, consequences, and required outcomes. Parent dispatches bounded fixes and read-only tester checks, then sends the same Oracle `mode: verification` with full unresolved findings, correction diff, and targeted evidence. Verification does not restart broad review or add style preferences.

After validation/review, use Impeccable's documenter handoff to record the actual built tokens in `DESIGN.md` and `.impeccable/design.json`, and verify them. Update README and provenance to what actually shipped; preserve the original source-inspection record and append font-copy evidence rather than claiming it happened during planning. Parent receives final diff, results/skips, screenshots, reviewer verdicts, and remaining deployment decisions. No completion claim before verification. No commits in this assignment; later commits/Beads updates require the parent's explicitly scoped workflow.

## Planning validation — historical

Plan checks are limited to documentation links, repository facts, ownership/order, command consistency, and agreement with the approved design. No install, test authoring, suite, build, browser launch, or contrast measurement occurs in this planning assignment.

The original plan identified dependency compatibility, legacy environment settings, port/browser availability, font provenance, history/focus, contrast/reflow, and static-host/LAN security as execution risks. The completed checks/reviews above cover the implemented shell; they do not settle hosting or authentication. Original planning wrote no UI/tests and ran no suite; final documentation likewise changed no production/test/config files.
