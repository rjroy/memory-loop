---
name: Memory Loop
description: Dark-default personal-brand interface system extracted from the running phase-1 shell.
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
---

# Design System: Memory Loop

## Overview

**Creative North Star: "Studio console"**

Stable navigation sits beside a replaceable work surface. Night now extends across navigation and workspace, with readable Parchment text and thin Parchment notice boundaries. Spacing, alignment, and type weight separate areas without adding new surface hues. The personal brand appears through exact color roles and a single interface family.

This is a task-focused interface, not a promotional surface. The system is flat and restrained: no hero imagery, decorative brand motifs, shadows, or entrance choreography. Unavailable functionality is explained plainly rather than illustrated with invented activity. Dark is the default even when the operating system prefers light; there is no theme switch or stored preference.

**Key Characteristics:**
- Stable navigation and replaceable content.
- A unified Night field with a purposeful selection accent.
- One locally served interface family in regular and semibold.
- Flat boundaries, visible focus, and honest empty states.

Extracted from `src/styles.css` and the existing shell components. The original light-workspace shell passed independent GREEN, technical **Accept**, and visual **ship**; the subsequent user-approved dark-default refinement is built and visually checked, with parent-owned independent verification/review pending. Source palette/font provenance is in [the local brand snapshot](.lore/work/design/personal-brand-snapshot.md); route strategy remains in [the surface brief](.impeccable/surfaces/src-app-tsx.md). This records the actual current system without rerolling its visual world.

## Colors

Night and Parchment carry the interface; Lantern marks a deliberate choice. The frontmatter values preserve the CSS source notation.

### Primary
- **Lantern:** selected-navigation edge and browser text-selection background; also the visible skip-link surface. It is not a warning or connection-status color.

### Secondary
- **Horizon:** declared core-brand token, reserved for information accents. No rendered phase-1 component uses it; reservation is not a new UI state.

### Neutral
- **Night:** the dominant canvas for workspace, desktop rail, compact header, and bottom navigation. It also supplies text on the Lantern skip link and text-selection highlight.
- **Parchment:** ordinary text, content links, notice boundaries, and focus outlines across the dark interface. Notice surfaces remain transparent over Night, not light or elevated cards.

### Named Rules
**The Purposeful Accents Rule.** Use accent color for a real selection or information role, not to fill empty space.

Current dark-default solid-color evidence: Parchment against Night measures 17.59:1 for text, notice boundaries, and focus; Lantern against Night measures 10.47:1. These were checked from computed styles at the running Tailscale preview. Other color pairings are not thereby approved. Sidecar tonal ramps remain panel-only synthesized inspection aids, not additional brand colors or shipped tokens.

## Typography

Source Sans 3 is the only interface family, with system-ui/sans-serif fallbacks. Two unchanged local font files supply regular and semibold; the SIL OFL/copyright notice ships alongside them. No display serif, italic, or monospace role is present. Font synthesis is disabled.

The frontmatter records the observed headline, title, body, emphasis, label, selected compact navigation, and two app-name sizes. Desktop navigation inherits body sizing; its current destination uses emphasis. Compact navigation uses label sizing and semibold only for the selected destination. Scope text remains regular. There is no fluid display-type scale; user text enlargement and natural wrapping remain available.

Purpose prose is bounded at 70ch; status content is bounded by its container. These are the actual measures, not a requirement to pad short copy to a target length.

### Named Rules
**The One Interface Voice Rule.** Use regular and semibold Source Sans 3 for working interface text; do not introduce a display face to decorate a task.

## Layout

At 56rem and above, a 13rem rail sits beside a `minmax(0, 1fr)` content column. The rail is sticky with `min-height: 100svh`, not a clipped fixed-height scroller. The workspace is full-width up to 72rem and padded 3rem vertically / 2.5rem horizontally. Navigation rows are separated by .5rem; navigation begins 2.75rem below the app name. Scope text follows navigation inside a contentinfo landmark.

Below 56rem, the shell becomes one document column. A compact Night header with Parchment text uses 1.5rem / 1.25rem / 0 padding; the workspace uses 2rem / 1.25rem. Four equal, text-labeled navigation cells are fixed along the bottom, with a 4rem minimum height and `env(safe-area-inset-bottom, 0px)` padding. The document reserves the navigation height, inset, and 1.5rem of additional clearance. Cell height may grow when text wraps. There is one document scroll and no gesture-only access. The dark refinement preserves all layout measurements and route copy.

Reused spacing steps are recorded above. Additional source-specific values, such as the rail offset and workspace insets, belong to their layout/component rules rather than an invented universal scale. Headings, purpose text, and notices flow naturally without fixed content heights.

## Elevation & Depth

Surfaces are flat. A continuous Night field, one-pixel Parchment boundaries, spacing, and type weight create hierarchy without inventing lighter background shades. There are no shadow, blur, gradient, or material-texture tokens. State changes are immediate; the implementation contains no timed transitions or animations, so reduced-motion users have no decorative motion to disable. Native browser surfaces follow the declared `color-scheme: dark`; there is no custom scrollbar system.

### Named Rules
**The Flat Surface Rule.** Separate work areas with fields, spacing, or a single rule rather than decorative depth.

## Shapes

Navigation has modest corners; compact navigation is square. Notices have slightly softer corners, a single Parchment outline, and no shadow. The frontmatter records those three observed corner treatments. No pills, ornamental badges, icons, or geometric brand artwork are part of this shell.

The selected-navigation mark is a 3px Lantern edge: vertical within desktop links, horizontal at the top of compact cells. This explicitly approved state indicator is not a general license for colored card/callout stripes. The detector warning was reviewed and retained as that narrow exception.

## Components

### Navigation

Real page links, not ARIA tab widgets. Desktop rows have a 3rem minimum height; compact cells use the reserved navigation height. Current location combines the Lantern edge, semibold text, and `aria-current="page"`. Hover/pressed feedback underlines text; focus is independent of current location, using a 2px Parchment outline inset 6px against Night. Desktop and compact link variants are separately mapped in the frontmatter/sidecar.

### Notice containers

A content-sized section with H2 and explanatory children: at most 42rem wide, generous padding, a single outline, and notice corners. Text follows its heading after .5rem. There is no skeleton, alert role, fake disabled form, or simulated service state. This reusable visual primitive does not force future views into a notice layout.

### Content links

Native, persistently underlined Parchment text links in semibold, with a 44px minimum hit height. Hover thickens the underline; pressed feedback moves its offset closer. Dark-surface keyboard focus uses the 2px Parchment outline with a 4px offset. These are links, not filled action buttons; there are no input/button component variants to canonize.

### Skip link and scope information

The skip link is visually above the viewport until focus; its visible state is Lantern with Night text, a 44px minimum hit height, and a Parchment outline separated by 3px. It targets the focusable main landmark. Main itself uses the Parchment outline inset 10px against Night. The scope label is plain regular Parchment text in a footer/contentinfo landmark, not a status badge or live region.

### View heading and purpose

A focusable H1 with a modest fixed type scale, followed by the body-sized purpose after .75rem. The component preview shows the real pattern, not a hero. Exact route content and focus/history behavior stay in the surface/design records rather than becoming global typography tokens.

## Do's and Don'ts

### Do:
- Do keep selection, keyboard focus, and unavailable-feature copy distinct.
- Do preserve native links, readable wrapping, and document scrolling.
- Do use local font files with their OFL and recorded provenance.
- Do measure contrast for any new rendered color pairing.

### Don't:
- Don't add decorative art, taglines, shadows, gradients, or simulated activity to the working shell.
- Don't replace the approved navigation marker with an unrelated accent treatment.
- Don't turn Horizon or panel-only tonal ramps into invented status colors.
- Don't infer button, input, loading, or error styles from components this phase does not contain.
