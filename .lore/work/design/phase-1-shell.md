---
title: Phase 1 — frontend shell shape
date: 2026-10-29
status: brand-direction-approved
---

# Phase 1: four places, one dependable shell

**Personal-brand color/type direction approved; no implementation authority.** This is an Impeccable `shape` brief. [The restart intent](../intents/project-restart.md) and current conversation supply product truth; [PRODUCT.md](../../../PRODUCT.md) records it. The user approved updating this proposal to the personal-brand direction described below. Layout, detailed interactions, accessibility targets, and technical choices remain proposals unless separately approved. No previous app design is inherited.

## Job, outcome, and limits

**Mode: Operate.** One person opens Memory Loop on a desktop or phone at home to capture a thought, think with AI, or access vault material. Phase 1 proves that these places are easy to reach and clearly identified—not that those jobs work yet.

Success: all four destinations work as links, survive refresh and browser history, fit phone and desktop, and explain their absent functionality without pretending to contain live material. Capture remains a first-class destination regardless of Ground's contents.

Only navigation, route rendering, focus management, and responsive shell behavior work. No daemon, vault reads/writes, AI calls, capture entry, storage, panel configuration, settings, authentication UI, permissions, network monitoring, reconnect handling, or asynchronous operations. No example conversations, filenames, timestamps, counts, charts, quotes, or activity. Do not populate blank space to make the shell look finished.

## Approved personal-brand direction; studio-console structure retained

The useful property of a studio console is **stable controls beside a replaceable working area**. Keep that layout discipline, now using the approved personal brand: four plainly named destinations, a Night navigation rail, a Parchment workspace, and a Lantern selection marker. [The self-contained brand snapshot](personal-brand-snapshot.md) records the authoritative source and provenance. The former mineral-green palette and Public Sans are superseded. No faders, meters, LEDs, waveform graphics, metallic textures, or invented machine state.

- **Scene assumption:** use alternates between a normally lit home desk and a phone in variable household light. Keep the workspace light; the dark rail separates navigation without darkening future writing surfaces. Parchment is a flat brand color, not simulated paper. No theme switch in phase 1.
- **Color strategy:** restrained, using the approved exact core values. **Night `#031315`** supplies desktop-rail/mobile-bottom-nav backgrounds and primary text/rules on the workspace. **Parchment `#FEF6E1`** supplies workspace/placeholder surfaces and text on Night. **Lantern `#EFB83F`** supplies the selected-navigation edge mark; occasional action fills with Night text are reserved for future real actions, not added in phase 1. **Horizon `#5E8BD6`** is reserved for purposeful information accents and need not appear in the current placeholders. No pure white, extra hues, gradients, textures, or automatically invented tints. Hierarchy comes from spacing and weight rather than dimming essential text.
- **Selection, hover, and focus proposal:** navigation remains Night with Parchment labels in all states. The current destination gets a Lantern edge mark and semibold label; hover/pressed feedback can underline the label without layout shift or new colors. Focus is separate from selection: a Parchment outline with Night separation on navigation, and a Night outline with Parchment separation on the light workspace. Keep the selection edge inside the link so a focus outline remains distinct. Content links use Night and a persistent underline; no gold/blue small text on Parchment is assumed legible. These combinations are proposed, not contrast-tested.
- **Type:** Source Sans 3 for interface text and regular-weight navigation; Source Sans 3 Semibold for the current destination, labels, and heading emphasis, including the plain app name. Body 1rem/1.5; H1 1.75rem/1.2; secondary heading 1.125rem; navigation and scope label at least .875rem. Fixed rem sizes, no display typography. No IM Fell hero treatment or Libre Baskerville article styling is needed. Fonts are not copied here; later implementation needs file/license checks and local delivery, with a working system-ui fallback. No external font request is required.
- **Geometry:** 4px spacing rhythm; 16/24/40px working gaps. Navigation rows have modest 4px corners; content boundaries are flat 1px Night rules with 6px corners on Parchment, not a field of floating cards. No shadows, ornamental badges, background effects, logo/hero artwork, taglines, or decorative lantern/path/arch motifs.
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
| Below 56rem | Compact static Parchment top header with Night app name and `Navigation preview`; fixed Night bottom navigation, four equal text links, at least 64px tall plus device safe-area inset. Selection uses a Lantern top edge mark and semibold Parchment label, not an extra colored field. | Single column, 16–24px padding. Reserve bottom space for the navigation and safe area; neither text nor keyboard focus may sit behind it. |

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

Acceptance targets, not validation results: link hit areas at least 44×44 CSS pixels; full navigation rows/cells clickable; body text contrast at least 4.5:1; meaningful non-text indicators at least 3:1 against adjacent colors. Actual text, focus, selection, hover, and pressed combinations remain unmeasured and untested. Focus must be distinct on both rail and content surfaces and never clipped or covered; check the proposed rings and offsets in the eventual render. Color is reinforced by selection mark, weight, and `aria-current`. Gold/blue on Parchment must not be assumed accessible for text or focus merely because they are approved brand colors.

Support 200% text resize, 320 CSS-pixel reflow, enlarged text spacing, reduced motion, and device safe areas. Do not use all-caps microcopy, icon-only navigation, custom scrollbars, or gesture dependence. Decorative icons, if introduced after review, must be hidden from assistive technology when duplicating visible text.

Present states in phase 1: route default/current, link hover/pressed/focus, unavailable-feature explanation, and unknown route. There is no simulated loading, save success/error, pending message, file access denied, or reconnect state. A true shell-load failure is not the same as an unavailable feature; do not invent recovery guarantees for it in this design.

## Phase-1 validation criteria for the later build

These are acceptance criteria, **not tests run in this documentation pass**. Add test-owned inputs rather than fixtures derived from real vault content.

1. **Route contract:** test the four labels/order/paths, root replacement, direct load/refresh, current-link semantics, title, current-link no-op history, unknown-route recovery, and Back/Forward through all four routes. Include modified-click/native-link behavior.
2. **Honest placeholders:** assert the reviewed purpose/status copy and lack of input/save/send/search/configuration controls. Assert no conversation, file, panel metric, or connection state fixtures. Capture works as a route with Ground absent or its content replaced.
3. **Replacement smoke check:** replace each view in isolation with a test-owned heading; shell and the other routes remain intact. Replace Ground content without affecting `/capture`. No production plugin mechanism is needed for this check.
4. **Keyboard/screen reader and contrast:** verify skip link, logical order, H1 focus on client navigation, history fallback, accessible names, `aria-current`, and no duplicate announcements. Measure actual brand text/indicator/focus combinations in each state; test focus on both dark navigation and light workspace, including simultaneous focus and selection. Run an automated accessibility check, then manually inspect focus visibility and landmark/heading navigation.
5. **Responsive visual pass:** inspect desktop 1440×900, phone 390×844, narrow phone 320×568, and short landscape 844×390 in one batch. Check long wrapped status text with test-owned strings, 200% text resize, 320px reflow, text spacing, safe areas, and reduced motion. Confirm no horizontal scroll, clipped labels, fixed-nav obstruction, or unjustified empty-state height. Batch fixes; at most one confirmation round.
6. **Boundary check:** inspect runtime/network/storage behavior: no service polling, domain API calls, external AI/font calls, vault/filesystem access, or user-content persistence. A production asset load is not a daemon connection. Run the chosen project's type/build/test checks and the Impeccable detector on changed UI targets once.

## Approval and handoff

The user approved updating this proposal to the **personal-brand palette and Source Sans 3/Semibold direction**, without changing the responsive layout or shell scope. That approval supersedes the former mineral-green/Public Sans appearance. No fresh concept round is needed to apply the user's pinned direction. The **desktop rail/mobile bottom navigation**, **four routes and exact placeholder copy**, and **nonfunctional/accessibility details** are preserved here for review; this update does not assert separate approval of every detail. The alternatives note is historical, not a request to choose the visual direction again.

Stack selection and LAN exposure/authentication need separate architecture decisions before implementation/serving. The design does not require Bun, Hono, Next, a daemon, or another server. Detailed panel contents and future Capture/Think/Recall workflows are deliberately unresolved and do not block shell review.

After separate implementation authorization and any remaining design review, a builder can establish the implementation direction contract and surface mappings. `DESIGN.md` and its token sidecar belong to documentation of the reviewed built world, not this shape pass. No implementation contract, canonical surface registry, build-path preference, images, or shipping tokens are created here.
