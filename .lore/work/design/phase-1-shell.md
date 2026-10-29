---
title: Phase 1 — frontend shell shape
date: 2026-10-29
status: dark-refinement-awaiting-independent-review
---

# Phase 1: four places, one dependable shell

**Original shell accepted; dark-default refinement built and awaiting independent review.** This Impeccable `shape` brief began as planning only; the user subsequently authorized implementation and then requested a dark style after trying the phone/Tailscale preview. [The restart intent](../intents/project-restart.md) and current conversation supply product truth; [PRODUCT.md](../../../PRODUCT.md) records it. The original light-workspace shell's independent GREEN, technical **Accept**, and visual **ship** remain historical evidence in the [completed plan](../plans/phase-1-shell.md), not fresh acceptance of the dark refinement. No previous app design is inherited.

## Job, outcome, and limits

**Mode: Operate.** One person opens Memory Loop on a desktop or phone at home to capture a thought, think with AI, or access vault material. Phase 1 proves that these places are easy to reach and clearly identified—not that those jobs work yet.

Success: all four destinations work as links, survive refresh and browser history, fit phone and desktop, and explain their absent functionality without pretending to contain live material. Capture remains a first-class destination regardless of Ground's contents.

Only navigation, route rendering, focus management, and responsive shell behavior work. No daemon, vault reads/writes, AI calls, capture entry, storage, panel configuration, settings, authentication UI, permissions, network monitoring, reconnect handling, or asynchronous operations. No example conversations, filenames, timestamps, counts, charts, quotes, or activity. Do not populate blank space to make the shell look finished.

## Approved personal-brand direction; studio-console structure retained

The useful property of a studio console is **stable controls beside a replaceable working area**. Keep that layout discipline with the user's approved dark default: four plainly named destinations, Night throughout workspace/navigation, readable Parchment text and boundaries, and a Lantern selection marker. [The self-contained brand snapshot](personal-brand-snapshot.md) records the authoritative source and provenance. The former mineral-green/Public Sans proposal and subsequent light workspace are superseded; layout and typography remain intact. No faders, meters, LEDs, waveform graphics, metallic textures, or invented machine state.

- **Usage evidence:** the user viewed the tool on a phone through the temporary Tailscale preview and preferred dark styling. Use a Night canvas by default regardless of operating-system preference, with `color-scheme: dark` for native browser surfaces. This is not a theme-switch, persistence, or deployment redesign.
- **Color strategy:** restrained, using only the approved exact core values. **Night `#031315`** supplies workspace, notice, header, rail, and bottom-navigation backgrounds. **Parchment `#FEF6E1`** supplies ordinary text, content links, notice rules, and focus outlines. **Lantern `#EFB83F`** supplies the selected-navigation edge and the existing text-selection/skip-link highlight, whose text remains Night. **Horizon `#5E8BD6`** remains reserved for purposeful information and is unused by these placeholders. No extra hues, gradients, textures, ramps, or opacity-derived runtime colors. Hierarchy comes from spacing, weight, and a single thin rule rather than new background shades.
- **Selection, hover, and focus:** navigation remains Night with Parchment labels in all states. The current destination gets a Lantern edge mark and semibold label; hover/pressed feedback underlines the label without layout shift. Focus stays separate: a 2px Parchment outline inset 6px on navigation, and Parchment outlines on the Night workspace/links. The selection edge remains separate from the outline. Content links stay persistently underlined. Actual computed solid-color measurements are recorded below; they are not a complete accessibility certification.
- **Type:** Source Sans 3 for interface text and regular-weight navigation; Source Sans 3 Semibold for the current destination, labels, and heading emphasis, including the plain app name. Body 1rem/1.5; H1 1.75rem/1.2; secondary heading 1.125rem; navigation and scope label at least .875rem. Fixed rem sizes, no display typography. No IM Fell hero treatment or Libre Baskerville article styling is needed. The two font weights are now self-hosted with their OFL and [copy provenance](personal-brand-snapshot.md#implementation-font-copy); system-ui remains the fallback. No external font request is made.
- **Geometry:** unchanged 4px spacing rhythm and 16/24/40px working gaps. Navigation rows have modest 4px corners; content boundaries are flat 1px Parchment rules with 6px corners on Night, not floating cards. No shadows, ornamental badges, background effects, logo/hero artwork, taglines, or decorative lantern/path/arch motifs.
- **First viewport:** persistent navigation; small app name and plain `Navigation preview` label; one route H1, one purpose sentence, one modest bounded status region. The status region is content-sized, not a fake editor or full-height loading box. Text measure stays within 65–70 characters. The remaining work surface is deliberately empty.
- **Signature interaction:** selecting a destination moves its persistent selection mark and immediately changes the view. Selection/hover feedback may transition over 150ms; focus outlines appear immediately. No spatial slide, page-load choreography, minimum loading delay, or mandatory animation. Reduced motion makes feedback immediate.
- **Cross-surface reach:** the shell's location and selection stay consistent when Ground grows real panels, Capture gets a composer, Think gets a conversation, or Recall gets file navigation. Their internal layouts need not imitate each other.
- **Risk:** a console metaphor can become a busy control panel, and a personal brand can become promotional decoration. Reject both. In phase 1 its identity comes from the Night/Parchment pairing, restrained Lantern selection, Source Sans 3, and alignment—not simulated activity or brand storytelling.

Raises retained from the concept exercise: **type specimen** → crisp hierarchy without extra chrome; **Labanotation** → fixed navigation order at every size; **Factory catalog** → one unmistakable selected destination; **convention catalog** → four equally discoverable destinations; **center-rail reference setting** → bounded text measure and apparatus outside content. These borrow discipline, not visual motifs. [The direction record](phase-1-directions.md) preserves the original seed and clearly superseded alternatives; they are not competing canonical palette/type instructions.

## Responsive navigation and layout

Routes are **pages**, despite the product term “tabs.” Use a labeled navigation landmark and real links, not ARIA tab widgets or arrow-key-only controls. Order is always **Ground · Capture · Think · Recall**; visible text is sufficient, so icons are unnecessary in this phase. Never hide a destination in a menu or enable swipe-only navigation.

| Width | Navigation | Main surface |
|---|---|---|
| At least 56rem | Approximately 13rem left rail; app name at top, four stacked links below, `Navigation preview` scope label beneath them. Rail can stick within the document but must scroll if shorter than its content. | Left aligned within a fluid area; about 40px padding, maximum 72rem working width. Placeholder copy remains much narrower. |
| Below 56rem | Compact static Night top header with Parchment app name and `Navigation preview`; fixed Night bottom navigation, four equal text links, at least 64px tall plus device safe-area inset. Selection uses a Lantern top edge mark and semibold Parchment label, not an extra colored field. | Single column, 16–24px padding. Reserve bottom space for the navigation and safe area; neither text nor keyboard focus may sit behind it. |

Use one document scroll, not a locked viewport or nested placeholder scroller. At short landscape heights, navigation must not consume the whole usable screen. At zoom/reflow the narrow layout takes over; labels remain visible without horizontal scrolling. No Capture autofocus and no mobile keyboard: there are no entry fields.

Schematic, not a pixel comp (selected view shown in brackets):

```text
Desktop                               Phone
┌────────────────┬────────────────┐   ┌──────────────────────────┐
│ Memory Loop    │ Capture        │   │ Memory Loop              │
│                │ Purpose       │   │ Navigation preview       │
│ Ground         │                │   ├──────────────────────────┤
│ [Capture]      │ ┌────────────┐ │   │ Capture                  │
│ Think          │ │ Not yet    │ │   │ Purpose                  │
│ Recall         │ │ available  │ │   │ ┌──────────────────────┐ │
│                │ └────────────┘ │   │ │ Not yet available    │ │
│ Navigation     │                │   │ └──────────────────────┘ │
│ preview        │                │   │                          │
└────────────────┴────────────────┘   │                          │
                                      ├──────────────────────────┤
                                      │Ground [Capture]Think Recall│
                                      └──────────────────────────┘
```

## Four placeholder surface briefs and exact copy

Each view owns its H1, purpose sentence, and status region. These are static explanations, not alerts, forms, disabled product controls, or previews of settled future feature design. All four views use the same shell styling; distinct purpose and copy are sufficient to distinguish them.

| View / route | Purpose sentence below H1 | Status heading and body | Available within view |
|---|---|---|---|
| **Ground** `/ground` | An overview built from interchangeable panels. | **Panels aren't available yet** — Panel contents haven't been chosen. This preview doesn't display vault information. | Text link **Open Capture** to `/capture`; it opens the placeholder, not a capture operation. |
| **Capture** `/capture` | Save thoughts as timestamped entries in a daily Markdown note. | **Quick capture isn't available yet** — Note entry and saving are not available in this preview. | No textarea, save button, attachments, or draft handling. The purpose sentence describes the intended job, qualified immediately by the status. |
| **Think** `/think` | Discuss ideas with AI using vault context. | **AI chat isn't available yet** — This preview can't send messages or access vault context. | No composer, bubbles, model selector, history, service status, or permission prompt. |
| **Recall** `/recall` | Access files in your vault. | **Vault access isn't available yet** — This preview can't list, open, or search vault files. | No tree, file list, search field, upload control, or editor. Search is mentioned only as unavailable, not committed future scope. |

H1 text is exactly the tab name. The persistent scope label is exactly **Navigation preview**, styled as neutral text, never a green “connected” badge. Do not say “No notes,” “No conversations,” “Vault empty,” “Offline,” or “Disconnected”: none of those facts are known. Do not show indefinite spinners or skeletons for capabilities that are not being loaded.

## Links, history, and focus

- `/` resolves to `/ground` by replacing the root history entry. This is a proposed neutral landing choice, not a statement that Ground outranks quick capture. `/capture` can be bookmarked directly. No last-used-route storage or hidden redirect based on state.
- Each destination must load directly and on refresh at the same path. The eventual router/host must serve these routes without requiring an extra application server solely for the shell. Exact hosting mechanism belongs to architecture selection.
- Activating a different destination creates one history entry. Activating the current one does not create duplicates. Preserve normal link affordances: open in new tab, copy address, and modified clicks. Back/Forward restores the correct route and selected link; history does not bounce through `/`.
- Back may leave the application normally. There is no unsaved-content guard, leave dialog, or history trap in this phase because no view accepts input.
- On client-side navigation, update the document title to **{View} · Memory Loop**, then move focus to the new H1 using a programmatic focus target. Do not focus it on a hard load or refresh. Back/Forward should restore scroll and originating focus where feasible; if that element no longer exists, focus the restored view's H1. Do not force scroll-to-top over browser history restoration.
- A visible-on-focus **Skip to content** link targets main content. The nav exposes the active link with `aria-current="page"`. Route changes are conveyed by title and heading focus; do not add a competing live announcement.
- Unknown paths retain the shell with no selected destination. Document title: **Page not found · Memory Loop**; H1: **Page not found**. Body: **This address doesn't match a Memory Loop view.** Link: **Go to Ground**. No silent success redirect, fake backend error, or “retry connection” action.

## Replacement seams, not an extension framework

The shell owns branding/scope text, navigation order, location/selection, the content outlet, and route focus/title behavior. Each of the four views owns only its content inside that outlet. A future view replacement must not require editing the other three views or redefining navigation. Keep shared primitives optional: a view must not be forced into today's placeholder status layout.

Ground alone owns future dashboard panels. Replacing a panel is a narrower seam inside Ground, not a rule that Capture, Think, and Recall become plugins. Phase 1 needs neither a panel registry nor add/remove/reorder behavior. It must not route Capture through a Ground panel or make its existence depend on dashboard configuration.

Presentation-only shell state is the current route and focus. Do not create fake domain stores, sample vault adapters, API endpoints, a service health model, persistence, or an event bus to anticipate the daemon. Reserve no credential-bearing frontend integration. Future daemon ownership and reconnect-safe operations remain requirements for later phases, not simulated states here.

## Accessibility and state policy

Proposed baseline: WCAG 2.2 AA, including keyboard access and reflow. Semantic header, navigation, and main landmarks; one H1 per view; status region headed at H2. Use native links and no positive tabindex or custom keyboard shortcuts. All functionality is operable using Tab, Shift+Tab, and Enter with clear focus indication.

Acceptance targets: link hit areas at least 44×44 CSS pixels; full navigation rows/cells clickable; body text contrast at least 4.5:1; meaningful non-text indicators at least 3:1 against adjacent colors. Implemented solid-color pairs and focus visibility were checked; all eight independent route/viewport accessibility and boundary checks passed after the landmark correction. This is not proof of manual assistive-technology or physical-device behavior. Color is reinforced by selection mark, weight, and `aria-current`. Gold/blue on Parchment must not be assumed accessible for text or focus merely because they are approved brand colors.

Support 200% text resize, 320 CSS-pixel reflow, enlarged text spacing, reduced motion, and device safe areas. Do not use all-caps microcopy, icon-only navigation, custom scrollbars, or gesture dependence. Decorative icons, if introduced after review, must be hidden from assistive technology when duplicating visible text.

Present states in phase 1: route default/current, link hover/pressed/focus, unavailable-feature explanation, and unknown route. There is no simulated loading, save success/error, pending message, file access denied, or reconnect state. A true shell-load failure is not the same as an unavailable feature; do not invent recovery guarantees for it in this design.

## Phase-1 validation criteria for the later build

These remain acceptance criteria. The implementation checks actually performed are distinguished below; do not mistake them for independent GREEN. Use test-owned inputs rather than fixtures derived from real vault content.

1. **Route contract:** test the four labels/order/paths, root replacement, direct load/refresh, current-link semantics, title, current-link no-op history, unknown-route recovery, and Back/Forward through all four routes. Include modified-click/native-link behavior.
2. **Honest placeholders:** assert the reviewed purpose/status copy and lack of input/save/send/search/configuration controls. Assert no conversation, file, panel metric, or connection state fixtures. Capture works as a route with Ground absent or its content replaced.
3. **Replacement smoke check:** replace each view in isolation with a test-owned heading; shell and the other routes remain intact. Replace Ground content without affecting `/capture`. No production plugin mechanism is needed for this check.
4. **Keyboard/screen reader and contrast:** verify skip link, logical order, H1 focus on client navigation, history fallback, accessible names, `aria-current`, and no duplicate announcements. Measure actual brand text/indicator/focus combinations in each state; test focus on both navigation and workspace in the current dark default, including simultaneous focus and selection. Run an automated accessibility check, then manually inspect focus visibility and landmark/heading navigation.
5. **Responsive visual pass:** inspect desktop 1440×900, phone 390×844, narrow phone 320×568, and short landscape 844×390 in one batch. Check long wrapped status text with test-owned strings, 200% text resize, 320px reflow, text spacing, safe areas, and reduced motion. Confirm no horizontal scroll, clipped labels, fixed-nav obstruction, or unjustified empty-state height. Batch fixes; at most one confirmation round.
6. **Boundary check:** inspect runtime/network/storage behavior: no service polling, domain API calls, external AI/font calls, vault/filesystem access, or user-content persistence. A production asset load is not a daemon connection. Run the chosen project's type/build/test checks and the Impeccable detector on changed UI targets once.

## Approval and handoff

The user approved the **personal-brand palette and Source Sans 3/Semibold direction**, then authorized a plan and implementation without expanding the shell scope. That approval supersedes the former mineral-green/Public Sans appearance. No fresh concept round is needed. Implement the **desktop rail/mobile bottom navigation**, **four routes and exact placeholder copy**, and **nonfunctional/accessibility boundaries** under the plan, with actual validation before acceptance. The alternatives note is historical, not a request to choose the direction again.

The plan selects Bun-managed React/TypeScript/Vite and React Router for this frontend-only phase. No daemon or additional application server is required. The existing preview process still binds to loopback; its temporary Tailscale HTTPS endpoint was used to inspect the dark refinement. No Tailscale/server configuration or exposure was changed. Long-term deployment/security, panel contents, and future feature workflows remain separate decisions.

The development-only direction contract is mapped in `.impeccable/surfaces/src-app-tsx.md`. The original phase's finish gate closed; the subsequent dark refinement awaits parent-owned independent verification/review. No standing build-path preference or generated images were created. [DESIGN.md](../../../DESIGN.md) and the [sidecar](../../../.impeccable/design.json) reflect the actual current dark CSS and clearly distinguish it from the earlier acceptance.

## Original implementation evidence and closure — before dark refinement

- `bun --no-env-file run build` passed (TypeScript check plus Vite production bundle). The focused frozen `tests/unit/navigation.test.tsx` passed **6/6**; the implementer did not run or alter the complete suite.
- Two batched rendered inspections were performed, with one spacing correction between them. All four views were captured/opened at 1440×900 and 390×844, plus Capture at 320×568, Ground at 844×390, selected/unselected focus, 200% root text size, increased text spacing, and test-owned long-copy wrapping. Evidence is in `.impeccable/review/` and is not shipping content. The full-page landscape/enlarged-text captures show a fixed footer at the physical viewport boundary; content below remains scrollable. Settled landscape bottom clearance was checked: content-link bottom 244.78px, nav top 326px.
- Computed rendered solid colors produce **17.59:1 Night/Parchment** for text and focus-ring pairs, and **10.47:1 Lantern/Night** for selection. Effective opaque backgrounds were used, not the desktop nav's transparent intermediate element. Source Sans 3 loaded locally. The focused browser follow-up confirmed no H1 autofocus on entry, H1 focus after committed client navigation, Back title/focus restoration, reduced-motion preference, zero local/session storage entries, and the actual 2px ring colors. These are focused checks, not the independent browser/axe suite.
- Detector ran once: one `side-tab` warning for the 3px selected-navigation marker in `src/styles.css`. This is the explicitly approved navigation indicator, not a card/callout accent; retain as a documented brief exception for the reviewer. No detector rerun was performed.
- The setup author resolved the automatic favicon 404 using a neutral declaration. The later independent favicon regression passed. Designer resolved the scope-label landmark defect by changing its paragraph to a footer; targeted DOM evidence preserved geometry/styles at all four inspected sizes, so existing screenshots remained valid.
- Independent GREEN completed: unit 10/10, routing 10/10, accessibility/boundary 8/8, and typecheck/build. The final accessibility confirmation log is `/tmp/opencode/memory-loop-landmark-confirmation.log`; the parent confirmed completion of the previously blocked post-axe assertions. The technical Oracle returned **Accept**, no material findings. The fresh finish reviewer returned **ship** with no material fixes; [review](../../../.impeccable/review/finish-review.md).
- Nested reviewer delegation was originally blocked at depth 1; the parent subsequently dispatched the fresh reviews. Final documentation follows the shipped documenter role directly because nested delegation remains unavailable. No new UI, suite, screenshots, detector run, or polish accompanied documentation. Manual assistive-technology use, physical-device safe areas, and deployment choices remain evidence/scope limits, not observed unresolved defects.

## Dark-default refinement evidence

The only production source change is `src/styles.css`: dark native color scheme, Night canvas, Parchment text/focus/notice rules, and matching compact header colors. Routes, TSX/TypeScript, controls, text, dimensions, font files, tests, and configuration are unchanged. There is no artificial failing test for this visual preference: the concrete before/after evidence is the change boundary. Existing behavioral tests are retained for the parent's independent pass.

Evidence lives under `.impeccable/review/dark-default/`: two before captures and 13 after captures, all opened. The after batch covers every route at 1440×900 and 390×844, plus narrow 320×568, landscape 844×390, selected/unselected keyboard focus, and 200% text. Before/after Ground geometry and exact copy match at desktop/phone. The browser was explicitly configured to prefer light, confirming the application's dark default is not an OS-dependent branch. Computed text, focus, and notice boundaries measure 17.59:1 against Night; Lantern selection measures 10.47:1. Browser console/page errors were empty; focused client-navigation heading focus and current-link no-op passed. No full suite was run by Designer.

`bun --no-env-file run build` passed (TypeScript plus Vite). The existing service was not stopped or reconfigured. At `2026-10-29T20:58:31.183Z`, `https://gsai.raptor-piranha.ts.net:9443/` returned 200 and referenced `/assets/index-p7DOp87L.css`; both served CSS and JS matched current `dist/` bytes and hashes in `endpoint.json`. The before CSS was `/assets/index-CLpHIa7j.css`, so the endpoint was not serving stale light styling at the check. This is a point-in-time preview verification, not an uptime or production-deployment claim. Independent full verification and review remain the parent's next handoff.

The dark-refinement detector ran once over the changed stylesheet and reported only the existing `side-tab` warning at the unchanged approved 3px navigation marker. Its output is `/tmp/opencode/memory-loop-dark-detector.json`; no new detector issue or new accent style was introduced.

On the resumed run after the usage-limit interruption, the saved dark work and 29 protected behavior/test/config/font hashes were confirmed intact. A fresh production build reproduced the same assets. The prior preview process was no longer present; only the loopback Vite preview was restored, without stopping any existing service or changing Tailscale settings. At `2026-10-29T21:26:13.646Z`, loopback returned current dark assets and fresh desktop/phone DOM checks passed, but the Tailscale HTTPS endpoint still refused connections. See `.impeccable/review/dark-default/resume.json` and its handoff for this current runtime blocker; the earlier successful HTTPS checks above are historical, not a claim of current availability. Parent-owned independent verification/review and private-endpoint restoration remain pending.
