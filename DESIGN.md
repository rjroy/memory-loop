---
name: Memory Loop
description: Dark personal-brand shell and read-only Recall system extracted from the built interface.
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
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.5
  app-name:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.4
  compact-app-name:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  reading:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  note-identity:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
  markdown-headline:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.3
  markdown-title:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.3
  markdown-subtitle:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  markdown-small-heading:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
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
  navigation-rail:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    padding: "2rem 1.5rem"
    width: "13rem"
  navigation-link:
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: ".625rem 1rem"
  navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.navigation}"
    padding: ".625rem 1rem"
  compact-navigation-link:
    textColor: "{colors.parchment}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: ".75rem 4px"
  compact-navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.compact-selected}"
    rounded: "{rounded.square}"
    padding: ".75rem 4px"
  placeholder-notice:
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.notice}"
    padding: "{spacing.generous}"
  content-link:
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
  skip-link:
    backgroundColor: "{colors.lantern}"
    textColor: "{colors.night}"
    typography: "{typography.emphasis}"
    padding: ".5rem 1rem"
  view-heading:
    textColor: "{colors.parchment}"
    typography: "{typography.headline}"
  recall-toolbar:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    padding: "1.75rem 2rem"
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
    textColor: "{colors.parchment}"
    typography: "{typography.note-identity}"
  markdown-document:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
    typography: "{typography.reading}"
  markdown-code:
    textColor: "{colors.parchment}"
    typography: "{typography.code-block}"
    padding: "{spacing.standard}"
  recall-state:
    backgroundColor: "{colors.night}"
    textColor: "{colors.parchment}"
---

# Design System: Memory Loop

## Overview

**Creative North Star: "Studio console"**

Stable navigation sits beside replaceable work surfaces. Night spans navigation and workspace, with readable Parchment text and thin boundaries. Spacing, alignment, and type weight separate areas without adding surface hues. The personal brand appears through exact color roles and one interface family; monospace is reserved for actual note code.

This is a task-focused interface, not a promotional surface. The system is flat and restrained: no hero imagery, decorative brand motifs, shadows, or entrance choreography. Functional Recall presents files and an unboxed document; the other three views explain unavailable functionality without invented activity. Dark is the default even when the operating system prefers light; there is no theme switch or stored preference.

**Key Characteristics:**
- Stable navigation and replaceable content.
- A unified Night field with a purposeful selection accent.
- One locally served interface family in regular and semibold.
- Flat boundaries, visible focus, and honest empty states.
- Bounded file browsing and comfortable, unboxed Markdown reading.

Merged from `src/styles.css`, `src/recall/recall.css`, the shell, and built Recall components. The shell/dark refinement and read-only Recall are accepted: Recall has visual **ship**, technical **Accept**, and independent behavioral verification. This records the completed read-only slice, not activation of a real vault or remote API. Source palette/font provenance is in [the local brand snapshot](.lore/work/design/personal-brand-snapshot.md). Route strategy remains in the [shell brief](.impeccable/surfaces/src-app-tsx.md) and [approved Recall brief](.lore/work/design/recall-read-only.md).

## Colors

Night and Parchment carry the interface; Lantern marks a deliberate choice. The frontmatter values preserve the CSS source notation.

### Primary
- **Lantern:** selected-navigation edge, current-file underline, browser text selection, focus-only pane-jump surfaces, and pressed Recall buttons. It is not a warning or connection-status color.

### Secondary
- **Horizon:** declared core-brand token, reserved for information accents. No current component renders it; reservation is not a new UI state.

### Neutral
- **Night:** the canvas for workspace, rail, toolbar, file hierarchy, reader, and bottom navigation. It also supplies text on inverse hover/pressed controls and text selection.
- **Parchment:** text, links, boundaries, code/table rules, and focus outlines. Hovered Recall buttons invert to Parchment with Night text; document/notice surfaces remain Night, not light or elevated cards.

### Named Rules
**The Purposeful Accents Rule.** Use accent color for a real selection or information role, not to fill empty space.

Solid-pair evidence: Parchment/Night measures 17.59:1 and Lantern/Night 10.47:1, including the inverse button pairings. Recall's fixture-only computed-style/contrast evidence confirms those same source values. Other pairings and native disabled-checkbox appearance are not thereby contrast-approved. Existing sidecar tonal ramps remain panel-only synthesized inspection aids, not additional brand colors or runtime tokens.

## Typography

Source Sans 3 is the only interface/prose family, with system-ui/sans-serif fallbacks. Two unchanged local files supply regular and semibold; the SIL OFL/copyright notice ships alongside them. Actual inline/fenced code uses the native monospace stack recorded above, with no new font asset. No display serif or separate decorative face is introduced. Font synthesis is disabled; note-authored emphasis is content, not a new interface font role.

The incumbent headline/title/body/label and app-name steps remain intact. Desktop navigation inherits body sizing; its current destination uses emphasis. Compact links use label sizing and semibold only when current. Recall adds the observed reading, identity, Markdown-heading, and code roles—not a replacement interface ramp. The code-inline size is relative to its text context; fenced code uses its explicit step. There is no fluid display scale; text enlargement and natural wrapping remain available.

Shell purpose prose is bounded at 70ch. Recall prose is bounded at 68ch, with 1.7 line height; note identity/path and compatibility copy remain compact. Markdown paragraphs have 1.4em separation, headings 1.8em before / .65em after, and the first content block has no added top margin. These are measures, not a requirement to pad short copy.

### Named Rules
**The One Interface Voice Rule.** Use regular and semibold Source Sans 3 for working interface text; do not introduce a display face to decorate a task.

**The Content Code Rule.** Use the native monospace stack for actual code, not filenames, navigation, or a technical-looking interface costume.

## Layout

At 56rem and above, a 13rem rail sits beside a `minmax(0, 1fr)` content column. The rail retains its sticky/minimum-viewport treatment. Navigation rows have .5rem gaps and begin 2.75rem below the app name. The obsolete Navigation preview footer is no longer rendered. Ground/Capture/Think retain their 72rem maximum workspace and 3rem / 2.5rem insets.

Below 56rem, those three placeholder views retain their compact brand header, 2rem / 1.25rem workspace insets, fixed four-cell bottom navigation, and reserved document clearance. Cells have a 4rem minimum height and bottom safe-area padding, and can grow for wrapped labels. They use one document scroll.

Recall is a task-specific layout, not a new rule for all views. Its 100dvh workspace clips page overflow and allocates a wrapping toolbar above independently scrollable Files and reader panes. Desktop Files defaults visible, using `clamp(14rem, 22vw, 16rem)` beside the remaining reader width; its divider is one Parchment rule. Toolbar insets are 1.75rem / 2rem; Files uses 1.5rem / 1rem / 2rem and reader 1.75rem / 2rem / 4rem. Hiding Files expands the reader's available space without increasing its prose measure.

Narrow Recall uses `minmax(0, 1fr) auto` rows: main workspace above the actual bottom-navigation height, rather than an estimated fixed offset. The route toolbar replaces the redundant brand header. Files or reader fills the available main area; this is not a modal, backdrop, half-sheet, or focus trap. Toolbar/Files insets respect top/side safe areas; reading gutters are 1.25rem and bottom padding 3rem. Short landscape uses the same topology. Hidden reader content is removed while Files is shown; all four app links remain available.

Reused spacing steps are recorded above. Additional source-specific values, such as the rail offset and workspace insets, belong to their layout/component rules rather than an invented universal scale. Headings, purpose text, and notices flow naturally without fixed content heights.

## Elevation & Depth

Surfaces are flat. A continuous Night field, one-pixel Parchment rules, spacing, and weight create hierarchy. There are no shadow, blur, gradient, or material-texture tokens. State changes are immediate, without timed animation; the folder chevron rotates directly with disclosure state. Browser surfaces use `color-scheme: dark`. Recall explicitly uses thin Parchment-on-Night scrollbars; no ornamental scrollbar or new surface palette is introduced.

### Named Rules
**The Flat Surface Rule.** Separate work areas with fields, spacing, or a single rule rather than decorative depth.

## Shapes

Navigation and Recall buttons share modest corners; compact navigation and file rows are square. Notices have slightly softer corners, a single Parchment outline, and no shadow. The frontmatter preserves those three corner treatments. A drawn 16px disclosure chevron is functional hierarchy notation, not decorative brand artwork. No pills, ornamental badges, or image assets are introduced.

The selected-navigation mark is a 3px Lantern edge: vertical within desktop links, horizontal at the top of compact cells. This explicitly approved state indicator is not a general license for colored card/callout stripes. The detector warning was reviewed and retained as that narrow exception.

## Components

### Navigation

Real page links, not ARIA tab widgets. Desktop rows have a 3rem minimum height; compact cells use the reserved navigation height. Current location combines the Lantern edge, semibold text, and `aria-current="page"`. Hover/pressed feedback underlines text; focus is independent of current location, using a 2px Parchment outline inset 6px against Night. Desktop and compact link variants are separately mapped in the frontmatter/sidecar.

### Notice containers

A content-sized section with H2 and explanatory children: at most 42rem wide, generous padding, a single outline, and notice corners. Text follows its heading after .5rem. There is no skeleton, alert role, fake disabled form, or simulated service state. This reusable visual primitive does not force future views into a notice layout.

### Content links

Native, persistently underlined Parchment links in semibold, with a 44px minimum hit height. Hover thickens the underline; pressed feedback moves its offset closer. Keyboard focus uses the 2px Parchment outline with a 4px offset. These shell links remain distinct from Recall's working buttons and from note-authored web links.

### Skip and pane-jump controls

The app skip link is above the viewport until focus; its visible state is Lantern with Night text, a 44px minimum hit height, and a Parchment outline separated by 3px. It targets focusable main, whose outline is inset 10px. Recall's focus-only Skip to note / Return to files buttons use the same inverse accent vocabulary inside their panes, without history entries. They are focus helpers, not hidden shortcuts or new destinations.

### View heading and purpose

A focusable H1 with a modest fixed type scale, followed by body-sized purpose after .75rem in the three placeholder views. Recall uses that H1 within its toolbar instead. Exact route content and focus/history behavior stay in the surface/design records rather than becoming global typography tokens.

### Recall toolbar and buttons

The route H1 and plain Read-only label form a wrapping toolbar with one bottom rule; its 44px heading row retains the previous title alignment. Recovery buttons retain their Parchment stroke, shared navigation corners, and recorded padding. Hover inverts to Parchment/Night; pressed state uses Lantern/Night. Keyboard focus remains the separate Parchment outline. Pending work shows a short status rather than a simulated percentage; duplicate retries are suppressed while the relevant read is pending.

Files visibility uses a quiet icon-only button, not a detached toolbar text action. A 20px plain left chevron sits in a 44×44px target at the upper-right of the sticky Files header; when collapsed, a plain right chevron sits at the upper-left of the reader, outside the centered prose measure. Its local controls row remains reachable while the reader scrolls. No destination-icon rail or empty Files column remains. Both desktop and narrow use the accessible names Collapse files sidebar / Expand files sidebar, `aria-expanded`, and `aria-controls` targeting the retained, hidden Files navigation. The SVG is hidden from assistive technology. Closing focuses the visible expand control; opening targets the current file or Files heading. Narrow selection still closes Files immediately without changing note/history/scroll semantics.

Matching Parchment-on-Night tooltips appear on pointer hover and keyboard focus, remain available while the pointer enters them, and dismiss with Escape without moving focus or collapsing Files. A subsequent Escape within expanded Files collapses it and returns focus to the visible expand control. Normal Tab/Shift+Tab and Enter/Space operation is retained. The approved Parchment focus and Lantern selection mapping is unchanged; the source site's compound glyph, retained icon rail, and newer Horizon roles are not imported. This correction implements the user's [refreshed sidebar direction](.lore/work/design/personal-brand-snapshot.md#approved-recall-sidebar-adaptation). `memory-loop-ms4` has fresh technical **Accept** and visual **SHIP**: R1/R2/R3/V1 are resolved, including sticky-header row clearance, breakpoint focus transfer, anchor-adjusted reading restoration, and unobscured focused helpers. Independent current-build unit **25/25**, Recall browser **25/25**, legacy browser **18/18**, and typecheck/build pass; backend **87** remains prior unchanged evidence. Verification used test-owned fixtures, not real-vault activation.

### Vault file hierarchy

Native nested lists, folder buttons and note links live in Vault files navigation, separate from Primary app navigation. Folders expose expanded state and a controlled nested list; no ARIA tree/roving-arrow model is claimed. Rows target 44px minimum height, wrap literal names, and preserve extensions. Deep nesting can scroll inside Files, never the page. Current-file semibold text and a 2px Lantern underline are distinct from the Parchment focus outline inset 2px. A collapsed folder does not close its selected document.

### Markdown reader

The unboxed article is named by its literal filename, not by invented metadata or the first source heading. A relative path and default-closed native Formatting support disclosure precede the document and scroll with it. File identity is focusable; an arriving response does not refocus the page or make the entire article a live region.

Source H1–H5 become native H2–H6 beneath Recall's route H1; source H6 stays H6. This approved cap preserves text but does not repair skipped source levels. CommonMark/GFM lists retain markers; task checkboxes are disabled and named from their task text. Code uses the native stack, bordered padded scrollers, and preserved whitespace. Tables have their own focusable horizontal scroller, semantic headers, 8rem minimum cell width and one-pixel row rules. Quotes use a single Parchment rule; no syntax-color palette or media viewer exists.

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
- Don't add decorative art, taglines, shadows, gradients, or simulated activity to the working shell.
- Don't replace the approved navigation marker with an unrelated accent treatment.
- Don't turn Horizon or panel-only tonal ramps into invented status colors.
- Don't invent search, editing, media, configuration, or transport controls from these read-only components.
- Don't treat panel-only component schematics or tonal ramps as live vault data or additional runtime tokens.
