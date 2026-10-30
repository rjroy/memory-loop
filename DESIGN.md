---
name: Memory Loop
description: Accepted four-mode personal-brand workspace, compact top navigation and reflective read-only Recall.
colors:
  night: "#031315"
  parchment: "#fef6e1"
  lantern: "#efb83f"
  horizon: "#5e8bd6"
typography:
  headline:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  emphasis:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  compact-selected:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  app-name:
    fontFamily: "IM Fell English SC, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  compact-app-name:
    fontFamily: "IM Fell English SC, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  invitation:
    fontFamily: "IM Fell English SC, Georgia, serif"
    fontSize: "clamp(3rem, 5.3vw, 4.8rem)"
    fontWeight: 400
    lineHeight: 1.05
  reading:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  note-identity:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "clamp(1.25rem, 1.8vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.5
  markdown-headline:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.4
  markdown-title:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.4
  markdown-subtitle:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.4
  markdown-small-heading:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.4
  code-inline:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: ".875em"
  code-block:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: ".9375rem"
    lineHeight: 1.6
rounded:
  square: "0"
  navigation: "4px"
  notice: "6px"
spacing:
  tight: ".5rem"
  compact: ".75rem"
  standard: "1rem"
  compact-inset: "1.25rem"
  generous: "1.5rem"
  section: "2rem"
  reading-inset: "1.75rem"
  control-inline: ".875rem"
components:
  navigation-header:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    padding: "12px clamp(20px, 4.4vw, 64px); safe-area-aware"
  navigation-link:
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  compact-navigation-link:
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  compact-navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.compact-selected}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  placeholder-notice:
    textColor: "context foreground; Think uses Night on Horizon"
    typography: "{typography.body}"
    rounded: "0; Think 6px"
    padding: "1.5rem 0 0; Think 1.75rem 2rem"
  content-link:
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
  skip-link:
    backgroundColor: "{colors.lantern}"
    textColor: "{colors.night}"
    typography: "{typography.emphasis}"
    padding: ".5rem 1rem"
  view-heading:
    textColor: "context foreground"
    typography: "{typography.headline}"
  recall-toolbar:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    padding: "12px 2rem; narrow 8px 20px"
  recall-button:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  recall-button-hover:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.night}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  recall-button-active:
    backgroundColor: "{colors.lantern}"
    textColor: "{colors.night}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  files-toggle:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.navigation}"
    padding: "12px"
    width: "44px"
    height: "44px"
  files-tooltip:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .75rem"
  reader-files-toggle:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.night}"
    rounded: "{rounded.navigation}"
    padding: "12px"
    width: "44px"
    height: "44px"
  vault-folder:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem"
  vault-file:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem .625rem 1.875rem"
  vault-file-current:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem .625rem 1.875rem"
  note-identity:
    textColor: "{colors.night}"
    typography: "{typography.note-identity}"
  markdown-document:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.night}"
    typography: "{typography.reading}"
  markdown-code:
    textColor: "{colors.night}"
    typography: "{typography.code-block}"
    padding: "{spacing.standard}"
  recall-state:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
---

# Design System: Memory Loop

## Overview

**Creative North Star: "One familiar place, four different ways to arrive"**

The user approved the [four-mode character board](.lore/work/design/memory-loop-character/index.html) at `acfac1f` and explicitly authorized its application in `memory-loop-44w`, then clarified that its compact horizontal top navigation—not the old app rail/bottom bar—is part of that approved direction. Shared A.5 identity and IM Fell English SC connect four emotional jobs: inspiring Ground, quiet blank-slate Capture, curious Think, and reflective Recall. Older assistant-authored restraint and retained navigation adaptations are superseded, not immutable brand rules.

Ground gives the full, unaltered A.1 narrative artwork enough room beside its invitation. Capture uses Parchment and open space, with no illustration or fake input. Think uses a cool Night/Horizon mixture, a questioning display line and compact A.5. Recall keeps its dark navigation/hierarchy beside a Parchment editorial reader. Artwork frames identity, never note text. No new features, theme switch, invented user content, generated assets, or external resource services are added.

**Key Characteristics:**
- Stable navigation and replaceable content.
- One recognizable family with four deliberately different moods.
- Local IM Fell identity, Source Sans interface/prose, and Libre Baskerville reading headings.
- Flat boundaries, visible focus, and honest empty states.
- Bounded file browsing and comfortable, unboxed Markdown reading.

Extracted from `src/styles.css`, `src/recall/recall.css`, the shell and four views. `memory-loop-44w` is independently accepted: typecheck/build, frontend unit **25/25**, Recall browser **26/26**, legacy browser **20/20**, fresh visual **SHIP** and technical **Accept**. Backend **87** remains prior unchanged evidence. 44W-T1 is resolved for initial unfocused pointer targets and natural keyboard operation at 844×390/200% text; history/UI-001/002/003 and MS4 regressions remain verified. [Integration provenance](.lore/work/design/character-integration.md) records seven unchanged copied files, three reused Source Sans files, rights, hashes and acceptance evidence. The historical [snapshot](.lore/work/design/personal-brand-snapshot.md) is unchanged. No real vault or remote API is activated.

## Colors

Night and Parchment carry complementary dark/light contexts. Horizon identifies location and dark-context focus; Lantern offers warmth and the Ground action. The four core values are unchanged. Muted Night `#344548` and Weathered Ivory `#d5d3c5` are source-guide functional neutrals, not new identity colors.

### Primary
- **Lantern:** Ground invitation/action, browser text selection, focus-only pane-jump surfaces, and pressed Recall buttons. Night text on Lantern; not a connection-status signal.

### Secondary
- **Horizon:** selected app-link/current-file underline; dark-context focus; Think's honest unavailable-feature surface and 10% Horizon/90% Night field. Selection also retains semibold text and `aria-current`.

### Neutral
- **Night:** shared top identity/navigation, toolbar, hierarchy and Ground; text/focus on Parchment. Light supporting text is Muted Night.
- **Parchment:** Capture and reader surfaces; dark-context text. Dark supporting text is Weathered Ivory. Rules mix context foreground/background; secondary control hover reverses that context's pair.

### Named Rules
**The Purposeful Accents Rule.** Give warmth, curiosity, selection and focus explicit roles; do not make color the only indication of a state.

Core contrast: Parchment/Night 17.59:1; Lantern/Night 10.47:1; Horizon/Night 5.54:1. Contextual source-pair calculations and rendered-resource checks are recorded with the author evidence. Decorative separators are not control boundaries. Native disabled-checkbox appearance is not thereby contrast-approved. Sidecar tonal ramps remain inspection aids, not runtime tokens.

## Typography

Source Sans 3 regular/semibold remains the interface and reading-prose family. IM Fell English SC regular carries the Memory Loop wordmark and Ground/Think invitations. Libre Baskerville regular carries literal note identity and editorial Markdown headings. Each face is local and ships with its OFL; the two new fonts are preloaded. Native monospace remains code-only. Font synthesis stays disabled.

Route/Files/status headings retain their Source Sans hierarchy. Shared identity is 28px IM Fell with one 40px A.5, at every viewport. Navigation remains 16px Source Sans rather than shrinking on phones; all text scales naturally at 200%. Invitations use bounded fluid IM Fell scales, up to 76.8px on Ground and 68px on Think. Recall retains 28/22/18/17px Markdown steps in Libre Baskerville 400 with 1.4 line height. Code sizes stay relative/explicit as recorded above.

Shell purpose prose is bounded at 70ch. Recall prose is bounded at 68ch, with 1.7 line height; note identity/path and compatibility copy remain compact. Markdown paragraphs have 1.4em separation, headings 1.8em before / .65em after, and the first content block has no added top margin. These are measures, not a requirement to pad short copy.

### Named Rules
**The Three Type Roles Rule.** IM Fell names/invites; Source Sans operates/explains; Libre Baskerville marks reflective editorial headings. Do not turn every label into display type.

**The Content Code Rule.** Use the native monospace stack for actual code, not filenames, navigation, or a technical-looking interface costume.

## Layout

One full-width header precedes the workspace: A.5/IM Fell identity at the start, horizontal Ground/Capture/Think/Recall links at the end when space permits. Flex wrapping moves the link group onto a second top row on phones or enlarged text; links may reflow naturally without clipping or reducing type. Header has 12px vertical padding, safe-area-aware gutters and 8px/24px group gaps. There is no permanent global app sidebar, fixed bottom navigation or reserved bottom-bar clearance. Ordinary workspace insets remain 3.5rem and `clamp(2rem, 4.4vw, 4.5rem)`; Ground keeps its two-column art composition, Capture/Think 64rem measures.

Below 56rem the same top header precedes 2rem/1.25rem workspace insets. All three placeholders use one document scroll. Capture's flex composition has a 24rem minimum inner height to preserve its intentional blank-slate space, not a calculation based on a removed bottom bar.

Recall's app uses `auto minmax(12rem, 1fr)` grid rows within 100dvh: actual top-header height, then the workspace. The lower bound prevents enlarged headers from crushing the working area to zero; if content outgrows a short viewport the page can scroll, rather than clipping controls. Normal layouts keep independent pane scrollers. Desktop Files remains default-visible with the same `clamp(14rem, 22vw, 16rem)` split; the reader stays Parchment and bounded to 68ch.

Narrow Recall has the same shared top identity/navigation and a compact Recall/Read-only toolbar—no duplicate logo. Files or reader fills the remaining work area non-modally. Toolbar padding is 8px vertically on narrow/short viewports; short-height Files/reader top insets are 16px without reducing text. The independent collapsible Files tree is not the removed global app sidebar. At 844×390/200% text, both initial pointer targets and keyboard-focused chevrons are unobscured, and all four top links are initially visible.

Reused spacing steps are recorded above. Header/workspace insets belong to their layout rules rather than an invented universal scale. Headings, purpose text and unavailable copy wrap naturally.

## Elevation & Depth

Surfaces are flat, but no longer emotionally uniform: Night, Parchment and the cool Think mixture separate moods. Full approved artwork supplies narrative richness, not invented texture or shadow. No blur, gradient or timed entrance is added. Native browser surfaces use light color-scheme in Capture/reader and dark elsewhere; thin contextual scrollbars and Lantern text selection complete the treatment.

### Named Rules
**The Flat Surface Rule.** Separate work areas with fields, spacing, or a single rule rather than decorative depth.

## Shapes

Navigation and Recall buttons keep modest corners; compact navigation/file rows remain square. Ground/Capture notices are separated by a single rule; Think's Horizon notice has 6px corners. Approved A.5/A.1 preserve their original rounded compositions and proportions without CSS crops/recoloring. Folder chevrons remain functional notation, not new illustration.

All top app links use the same 2px Horizon selected underline, semibold text and programmatic current state across sizes. Current-file underline remains Horizon. None is a general callout stripe.

## Components

### Navigation

Real page links, not ARIA tab widgets. Existing dimensions, order, current-click/query guard and routing remain. Current location combines Horizon underline, semibold and `aria-current="page"`; keyboard focus is an independent 2px Horizon outline inset 6px against Night.

### Notice containers

A section with H2 and explanatory children, at most 42rem wide. Text follows its heading after .5rem. Ground uses a quiet rule under its invitation, Capture rests its honest notice below open space, Think uses Night text on Horizon. Existing tested purpose/unavailable copy is unchanged. No skeleton, alert role, disabled form or simulated service state is added.

### Content links

Native semibold links retain 44px minimum height. Ground's real Open Capture destination uses Lantern/Night primary-action styling; other content links stay underlined. Focus uses context focus color, 2px with 4px offset. These remain native links, not invented save/send buttons.

### Skip and pane-jump controls

The app skip link is above the viewport until focus; its visible state is Lantern with Night text, a 44px minimum hit height, and a Parchment outline separated by 3px. It targets focusable main, whose outline is inset 10px. Recall's focus-only Skip to note / Return to files buttons use the same inverse accent vocabulary inside their panes, without history entries. They are focus helpers, not hidden shortcuts or new destinations.

### View heading and purpose

A focusable H1 with a modest fixed type scale, followed by body-sized purpose after .75rem in the three placeholder views. Recall uses that H1 within its toolbar instead. Exact route content and focus/history behavior stay in the surface/design records rather than becoming global typography tokens.

### Recall toolbar and buttons

The compact Recall H1/Read-only row sits below the shared top app header, without duplicated branding. Recovery buttons use their context's ink/surface/border and reverse on hover; pressed uses Lantern/Night. Night contexts focus Horizon; the reader focuses Night on Parchment. Pending/read/retry behavior is unchanged.

Files visibility uses a quiet icon-only button, not a detached toolbar text action. A 20px plain left chevron sits in a 44×44px target at the upper-right of the sticky Files header; when collapsed, a plain right chevron sits at the upper-left of the reader, outside the centered prose measure. Its local controls row remains reachable while the reader scrolls. No destination-icon rail or empty Files column remains. Both desktop and narrow use the accessible names Collapse files sidebar / Expand files sidebar, `aria-expanded`, and `aria-controls` targeting the retained, hidden Files navigation. The SVG is hidden from assistive technology. Closing focuses the visible expand control; opening targets the current file or Files heading. Narrow selection still closes Files immediately without changing note/history/scroll semantics.

Matching tooltips use the surrounding context's ink/surface: Parchment/Night in Files, Night/Parchment in the reader. Their hover/focus/Escape behavior, 20px/44px geometry, local placement, sticky clearance and focus return are unchanged. The source site's compound glyph and retained destination rail are not imported. Current 44w verification is unit **25/25**, Recall browser **26/26**, legacy browser **20/20**, typecheck/build, visual **SHIP** and technical **Accept**; 44W-T1 and the protected MS4/history findings are resolved.

### Vault file hierarchy

Native nested lists, folder buttons and note links remain unchanged. Rows target 44px, wrap names/extensions, and deep nesting scrolls inside Files. Current-file semibold/Horizon underline is distinct from the Horizon focus outline inset 2px. Collapsing a folder does not close its selected document.

### Markdown reader

The unboxed article is named by its literal filename, not by invented metadata or the first source heading. A relative path and default-closed native Formatting support disclosure precede the document and scroll with it. File identity is focusable; an arriving response does not refocus the page or make the entire article a live region.

Source H1–H5 still become native H2–H6; source H6 stays H6. This cap does not repair skipped source levels. Markdown renderer/links/tasks/code/tables are unchanged; only type and contextual rule colors change. Literal identity is Libre Baskerville above a thin rule, metadata stays legible Source Sans, and body stays 17px/1.7. Code/table scrollers retain their semantics and bounded overflow. No syntax-color palette or media viewer is added.

Raw HTML is escaped text. Markdown images become Image not shown text, and embeds remain literal. Only deliberate HTTP(S) links are live, opening a new tab with an accessible indication and safe relationship. Note/heading/wiki and unsafe links remain text. Frontmatter passes through ordinary Markdown rather than becoming application metadata.

### Read-only states and restoration

Loading, no selection, empty eligible tree, empty document, configuration failure, unavailable vault/note, invalid note address and transport failure have distinct plain text. Blocking workspace states replace an unusable split and hide its meaningless toggle. A usable reader can remain while a tree refresh fails. Recovery uses the same button vocabulary; no red/blue status palette, alert cards, fake files, polling, or saved-content claim is added. A short polite live region reports changes without announcing note contents.

Selection uses native note URLs/history; different notes reset to top, and Back/Forward restores per-entry reading positions. Cross-tab return preserves its saved position through URL replacement and note loading. Files positions apply after hierarchy content is ready, not to a loading placeholder. Same-path/query hash-only navigation preserves pane visibility, scroll and presentation, including keyboard Skip to content after client-side selection; router fallback keys do not mix note positions. These three restoration regressions are independently verified and technically accepted. Session presentation memory is not persisted note data or authoritative daemon state.

## Do's and Don'ts

### Do:
- Do keep selection, keyboard focus, and unavailable-feature copy distinct.
- Do preserve native links, readable wrapping, and document scrolling.
- Do use local font files with their OFL and recorded provenance.
- Do measure contrast for any new rendered color pairing.
- Do keep app navigation reachable while Files or the reader scrolls independently.
- Do preserve literal file identity, document semantics, and honest read-only recovery states.

### Don't:
- Don't crop/recolor/redraw approved artwork or place narrative art behind reading text.
- Don't turn a visual invitation into simulated user activity or a future feature.
- Don't treat prior assistant restraint as immutable brand truth, or panel-only tonal ramps as runtime colors.
- Don't invent search, editing, media, configuration, or transport controls from these read-only components.
- Don't treat panel-only component schematics or tonal ramps as live vault data or additional runtime tokens.
