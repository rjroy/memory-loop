---
name: Memory Loop
description: Four-mode Memory Loop workspace with compact top navigation, six independent Ground cards, reflective Recall and a space-first Think conversation surface.
colors:
  night: "#031315"
  parchment: "#fef6e1"
  lantern: "#efb83f"
  horizon: "#5e8bd6"
  ivory: "#d5d3c5"
  supporting-text: "#a8b4ae"
  horizon-bright: "#8eaef2"
  lantern-bright: "#ffd477"
  danger: "#f18a83"
  navigation-surface: "#0b1c20"
  working-surface: "#142629"
  document-surface: "#1a2e30"
  raised-surface: "#243b3e"
  warm-surface: "#292f29"
  selected-surface: "#213c50"
  rule: "#344b4e"
  control-boundary: "#718788"
  think-field: "color-mix(in srgb, #5e8bd6 10%, #031315)"
  think-user: "color-mix(in srgb, #5e8bd6 20%, #031315)"
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
    fontSize: "clamp(2rem, 3.9vw, 3.5rem)"
    fontWeight: 400
    lineHeight: 1.05
  reading:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  capture-writing:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  think-reading:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  think-invitation:
    fontFamily: "IM Fell English SC, Georgia, serif"
    fontSize: "3.375rem"
    fontWeight: 400
    lineHeight: 1.05
  think-phone-invitation:
    fontFamily: "IM Fell English SC, Georgia, serif"
    fontSize: "2.625rem"
    fontWeight: 400
    lineHeight: 1.05
  think-markdown-headline:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.4
  think-markdown-title:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.4
  note-identity:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.25rem"
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
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    padding: "12px clamp(20px, 4.4vw, 64px); safe-area-aware"
  navigation-link:
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  compact-navigation-link:
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  compact-navigation-link-current:
    textColor: "{colors.parchment}"
    typography: "{typography.compact-selected}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  ground-card:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    padding: "1rem 0 0; top rule"
  ground-inspiration:
    backgroundColor: "{colors.warm-surface}"
    textColor: "{colors.ivory}"
    padding: "1.25rem"
  think-conversation:
    backgroundColor: "{colors.think-field}"
    textColor: "{colors.ivory}"
    typography: "{typography.think-reading}"
    width: "100%"
  think-user-message:
    backgroundColor: "{colors.think-user}"
    textColor: "{colors.ivory}"
    typography: "{typography.think-reading}"
    rounded: "{rounded.notice}"
    padding: "14px 18px; narrow 12px 16px"
  think-composer:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.notice}"
    padding: ".625rem .75rem"
  think-primary-action:
    backgroundColor: "{colors.horizon}"
    textColor: "{colors.night}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .75rem"
    width: "5rem"
  think-new-chat:
    backgroundColor: "{colors.think-field}"
    textColor: "{colors.ivory}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .75rem"
  content-link:
    textColor: "{colors.horizon-bright}"
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
    textColor: "{colors.ivory}"
    padding: "12px 2rem; narrow 8px 20px"
  recall-button:
    backgroundColor: "context dark surface"
    textColor: "{colors.ivory}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  recall-button-hover:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  recall-button-active:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .875rem"
  files-toggle:
    backgroundColor: "{colors.navigation-surface}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.navigation}"
    padding: "12px"
    width: "44px"
    height: "44px"
  files-tooltip:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: ".5rem .75rem"
  reader-files-toggle:
    backgroundColor: "{colors.document-surface}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.navigation}"
    padding: "12px"
    width: "44px"
    height: "44px"
  vault-folder:
    backgroundColor: "{colors.navigation-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem"
  vault-file:
    backgroundColor: "{colors.navigation-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem .625rem 1.875rem"
  vault-file-current:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.parchment}"
    typography: "{typography.emphasis}"
    rounded: "{rounded.square}"
    padding: ".625rem .5rem .625rem 1.875rem"
  note-identity:
    textColor: "{colors.parchment}"
    typography: "{typography.note-identity}"
  markdown-document:
    backgroundColor: "{colors.document-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.reading}"
  markdown-code:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ivory}"
    typography: "{typography.code-block}"
    padding: "{spacing.standard}"
  recall-state:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ivory}"
  capture-workspace:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.ivory}"
  capture-editor:
    backgroundColor: "{colors.document-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.capture-writing}"
  capture-action:
    backgroundColor: "{colors.lantern}"
    textColor: "{colors.night}"
---

# Design System: Memory Loop

## Overview

**Creative North Star: "One familiar place, four different ways to arrive"**

The user approved the [four-mode character board](.lore/work/design/memory-loop-character/index.html) at `acfac1f` and explicitly authorized its application in `memory-loop-44w`, then clarified that its compact horizontal top navigation—not the old app rail/bottom bar—is part of that approved direction. Shared Memory Loop artwork and IM Fell English SC connect four emotional jobs: inspiring Ground, quiet blank-slate Capture, curious Think, and reflective Recall. Older assistant-authored restraint and retained navigation adaptations are superseded, not immutable brand rules.

Ground gives the approved rounded Memory Loop artwork enough room beside its invitation. The user-approved dark-first refinement (`memory-loop-kqk`) makes Parchment an accent, not a working background: Capture has an open dark editor, Ground's quotation has a warm dark inset, and Recall pairs darker Files with a lighter dark editorial reader. Think retains its cool Night/Horizon mixture; its questioning invitation and compact artwork give way completely to a real conversation. Artwork frames identity, never reading text. The same fonts, layouts and behavior remain, without a theme switch or invented runtime content.

**Key Characteristics:**
- Stable navigation and replaceable content.
- One recognizable family with four deliberately different moods.
- Local IM Fell identity, Source Sans interface/prose, and Libre Baskerville reading headings.
- Flat boundaries, visible focus, and honest empty states.
- Bounded file browsing and comfortable, unboxed Markdown reading.

Extracted from `src/styles.css`, `src/ground/ground.css`, `src/recall/recall.css`, the shell and four views. `memory-loop-44w` is independently accepted: typecheck/build, frontend unit **25/25**, Recall browser **26/26**, legacy browser **20/20**, fresh visual **SHIP** and technical **Accept**. Backend **87** remains prior unchanged evidence. 44W-T1 is resolved for initial unfocused pointer targets and natural keyboard operation at 844×390/200% text; history/UI-001/002/003 and MS4 regressions remain verified. [Integration provenance](.lore/work/design/character-integration.md) records seven unchanged copied files, three reused Source Sans files, rights, hashes and acceptance evidence. The [brand snapshot](.lore/work/design/personal-brand-snapshot.md) preserves history and records the kqk source reread. Historical acceptance does not establish acceptance or publication of this palette refinement.

**Think Phase 5 implementation record:** the [approved space-first UX](.lore/work/design/think-chat-ux.md) and its board extend that incumbent world. Current rules below also describe `src/think/think.css`, the controlled components and persistent shell integration. Independent technical verification and visual review accepted the fixture implementation after corrections. A nonblocking enlarged-text placeholder issue remains tracked as `memory-loop-2sj`. No personal Think activation or physical-device acceptance is claimed.

## Colors

The user approved dark working surfaces throughout after reviewing the current personal-brand guide. Night anchors the frame; restrained app-specific dark mixtures distinguish work areas. Weathered Ivory carries everyday text, while Parchment is reserved for identity, headings and emphasis. The existing interface colors remain unchanged; approved artwork has since been replaced by Returning Thread. The guide's functional extension supplies bright Horizon, bright Lantern and bright Ember; these are not new identity colors.

### Primary
- **Lantern:** Ground invitation, Capture action, browser text selection and focus-only pane-jump surfaces. Capture hover uses the guide's bright Lantern; Night text remains. Not a connection-status signal.

### Secondary
- **Horizon:** selected app-link/current-file underline and Think's Send/Stop action with Night text. Bright Horizon supplies content links, focus and primary Think hover; original Horizon is not small body-link text on the lighter dark reader. Think retains a 10% Horizon/90% Night field and a quiet 20% Horizon/80% Night user-message field. Selection also retains semibold text and `aria-current`.

### Neutral
- **Night:** shared top identity/navigation, Recall toolbar, Ground canvas and code wells. Files uses `#0b1c20`, Capture's surrounding field `#142629`, reader/editor `#1a2e30`, Inspiration `#292f29`, hover `#243b3e` and selected file/pressed secondary controls `#213c50`.
- **Text:** Weathered Ivory `#d5d3c5` for prose/controls, tinted supporting text `#a8b4ae`, Parchment `#fef6e1` for identity/editorial headings/current location. No Parchment working surfaces or secondary hover inversions.
- **Boundaries:** quiet decorative rules `#344b4e`; control boundaries and the desktop Files/document divider `#718788`. Native controls retain dark color-scheme, including Capture and Recall. Focus is bright Horizon, with the retained Parchment outline on filled Think actions and skip links.
- **Destructive action:** bright Ember `#f18a83` text/border on a dark field distinguishes Delete conversation; hover remains dark. Existing confirmation, labels, disabled reasons and recovery stay unchanged. No new status widgets or color-only meanings are introduced.

### Named Rules
**The Purposeful Accents Rule.** Give warmth, curiosity, selection and focus explicit roles; do not make color the only indication of a state.

Core contrast remains Parchment/Night 17.59:1; Lantern/Night 10.47:1; Horizon/Night 5.54:1. Ivory/reader is 9.44:1, supporting text/reader 6.64:1, bright Horizon/reader 6.42:1. Control boundaries against reader/raised surfaces are 3.74/3.12:1; bright Ember retains at least 4.76:1 across the dark fields. Decorative separators are not control boundaries. Native disabled-checkbox appearance is not thereby contrast-approved. Sidecar tonal ramps remain inspection aids, not runtime tokens.

**kqk author evidence:** `/tmp/opencode/kqk-dark-first/before/` and `after/` contain 20 paired captures plus three after-only enabled Think/focus captures. Actual production components are bundled in isolation with controlled browser API/presentation adapters, without Next/daemon integration, personal notes or model access. Desktop 1440×900, phone 390×844 and 320×568 at 200% text retain identical measured layout/document dimensions across the paired states. `checks.json` records 324 focused geometry, dark-field and computed-color contrast assertions; `detector.json` is empty. Before/after bundle builds pass and fixture listeners/browsers close. Independent regression and fresh visual review remain required; author evidence is not a shipping verdict or physical-device/assistive-technology acceptance.

## Typography

Source Sans 3 regular/semibold remains the interface and reading-prose family. IM Fell English SC regular carries the Memory Loop wordmark and Ground/Think invitations. Libre Baskerville regular carries literal note identity and editorial Markdown headings. Each face is local and ships with its OFL; the two new fonts are preloaded. Native monospace remains code-only. Font synthesis stays disabled.

Route/Files/status headings retain their Source Sans hierarchy. Shared identity is 28px IM Fell with one 40px Memory Loop image, at every viewport. Navigation remains 16px Source Sans rather than shrinking on phones; text scales naturally at 200%. Ground's invitation uses `clamp(2rem, 3.9vw, 3.5rem)`. Think's empty invitation is 54px desktop / 42px narrow, without space reserved after messages arrive. Recall retains 28/22/18/17px Markdown steps in Libre Baskerville 400 with 1.4 line height; Think uses 24/20/18px headings, 17px/1.65 prose and 14px semibold You/AI labels. These Think sizes are intentional surface rules, not changes to Recall's ramp. Code sizes stay relative/explicit as recorded above.

Shell purpose prose is bounded at 70ch. Recall prose is bounded at 68ch, with 1.7 line height; filename/path stay compact in the dark section titlebar. Markdown paragraphs have 1.4em separation, headings 1.8em before / .65em after, and the first content block has no added top margin. These are measures, not a requirement to pad short copy.

### Named Rules
**The Three Type Roles Rule.** IM Fell names/invites; Source Sans operates/explains; Libre Baskerville marks reflective editorial headings. Do not turn every label into display type.

**The Content Code Rule.** Use the native monospace stack for actual code, not filenames, navigation, or a technical-looking interface costume.

## Layout

One full-width header precedes the workspace: Memory Loop artwork/IM Fell identity at the start, horizontal Ground/Capture/Think/Recall links at the end when space permits. Flex wrapping moves the link group onto a second top row on phones or enlarged text; links may reflow naturally without clipping or reducing type. Header has 12px vertical padding, safe-area-aware gutters and 8px/24px group gaps. There is no permanent global app sidebar, fixed bottom navigation or reserved bottom-bar clearance. Ground centers a maximum 76rem workspace, with invitation and uncropped art above its cards. Capture and Think give their available workspaces to writing and conversation respectively.

Ground's card grid uses document scrolling: one column by default, two from a 44rem container and three from 66rem. Quick Actions spans the grid; Goals spans both columns in the two-column layout. In the three-column layout, Recent captures occupies one column and Recent conversations spans two. Capture has a compact top action and full-width textarea filling the remaining workspace, with 32px desktop and safe-area-aware 20px narrow side gutters. Short or enlarged layouts permit page scrolling and retain a six-line editor floor. Its textarea owns writing overflow; errors can reflow beside or below the stable action without covering the editor.

**Think:** a centered 52rem maximum conversation/composer lane, with 68ch maximum messages; 32px desktop side gutters become safe-area-aware 20px gutters below 56rem. At normal portrait/desktop sizes the conversation owns reading scroll and the composer occupies an actual grid row beneath it, never covering the last message. Header height comes from layout, not a guessed deduction from `100dvh`. The textarea starts at 2.875rem (46px at ordinary text), grows only with the draft, then scrolls locally; Send/Stop stays bottom-aligned to its right with a 44px minimum target. No visible Think section bar, Chat details, routine hint or logging footer remains.

The single **New chat** button uses the existing spare desktop gutter at 32px left / 16px below the banner only when the banner's font-scaled container reaches 76em. Otherwise it stays in the existing banner, with a drawn plus below 21em and the same accessible name. It never reserves a side rail or overlays the reading/editor lane; the four native top links remain.

Short views (below 32rem height), or a workspace below 20rem usable height, escape to ordinary page flow with visible reader overflow instead of a miniature reading pane. This also occurs in enlarged portrait layouts. The composer remains after the conversation in document flow; Skip to message and native focus scrolling keep it reachable. Current enlarged-portrait captures expose a residual transition from the cool workspace field to Night below the original viewport; this is an open visual-review finding, not a prescribed surface treatment. Physical OS keyboards/VisualViewport, safe areas and assistive technologies remain device checks, not claims from Chromium.

Recall's app uses `auto minmax(12rem, 1fr)` grid rows within 100dvh: actual top-header height, then the workspace. The lower bound prevents enlarged headers from crushing the working area to zero; if content outgrows a short viewport the page can scroll, rather than clipping controls. Normal layouts keep independent pane scrollers. Desktop Files remains default-visible with the same `clamp(14rem, 22vw, 16rem)` split; the dark reader remains bounded to 68ch.

Narrow Recall has the same shared top identity/navigation and a compact Recall/Read-only section titlebar—no duplicate logo. The selected filename/path wraps onto a second titlebar row, outside both pane scrollers. Files or reader fills the remaining work area non-modally. Titlebar padding is 8px vertically on narrow/short viewports; short-height layouts tighten its row gap and use a rem-scaled 18px Recall heading when a file is selected. Files/reader top insets remain 16px. The independent collapsible Files tree is not the removed global app sidebar. The 53h titlebar and reader-local Skip correction require renewed independent verification; earlier 44w checks are baseline evidence, not acceptance of this refinement.

Reused spacing steps are recorded above. Header/workspace insets belong to their layout rules rather than an invented universal scale. Headings, purpose text and unavailable copy wrap naturally.

## Elevation & Depth

Surfaces are flat, but not emotionally uniform: deep Night, warm quotation and cool Think mixtures separate moods. Recall's darker Files and lighter dark document are divided by a single visible rule; the reader remains unboxed. Full approved artwork supplies narrative richness, not invented texture or shadow. No blur, gradient or timed entrance is added. Native browser surfaces use dark color-scheme throughout; thin contextual scrollbars, ivory carets and Lantern text selection complete the treatment.

### Named Rules
**The Flat Surface Rule.** Separate work areas with fields, spacing, or a single rule rather than decorative depth.

## Shapes

Navigation and Recall buttons keep modest corners; compact navigation/file rows remain square. Ground cards use a top rule except for the warm dark Inspiration field; actions have modest 4px corners. Capture uses a visible editor boundary and 4px action/editor corners. Think uses 6px corners for the editor/user field and 4px for actions; AI prose is unboxed, not another bubble or status card. Approved Returning Thread derivatives preserve their rounded composition and proportions without CSS crops/recoloring. Folder chevrons remain functional notation, not new illustration.

All top app links use the same 2px Horizon selected underline, semibold text and programmatic current state across sizes. Current-file underline remains Horizon. None is a general callout stripe.

## Components

### Navigation

Real page links, not ARIA tab widgets. Existing dimensions, order, current-click/query guard and routing remain. Think's link retains its current opaque conversation target, including modified-link behavior; ordinary reactivation does not reset that chat. Current location combines Horizon underline, semibold and `aria-current="page"`; keyboard focus is an independent 2px bright Horizon outline inset 6px against Night.

### Ground cards and handoff

Six independent named H2 sections show Quick Actions, Inspiration, Prompts, Current Goals, Recent captures and Recent conversations. Inspiration uses a warm dark field and Libre Baskerville quotation; Goals uses the safe Markdown renderer with source H1 at H3; captures use native links to Recall. Each card presents its own applicable loading, empty, missing, malformed or unavailable state and recovery; one failure cannot hide the others. Quick Actions and Prompts prepare editable unsent Think drafts; a nonempty existing draft, including whitespace, triggers an inline confirmation that preserves it. This is separate from Think's own discard flow.

Recent conversations shows at most ten registered chats with a user Send, ordered by meaningful input/confirmed assistant activity rather than reads or Resume. Rows show the original-input title (or Untitled conversation), activity time, the current-chat badge when applicable and a native Resume link for an available chat. Resume verifies existing history and its current serving epoch before selecting/navigating, preserving both keyed drafts. Its single active notice follows the initiating row in every phase, with concise target context. Cancel receives native focus/scrolling on confirmation; Escape or dismissal returns focus to the trigger. Pending/error recovery scrolls into view only while focus remains with that action, not after the user moves elsewhere. Refreshing this list or renewing selection does not reshuffle the quote or question.

Delete is a compact control beside Resume, disabled with a visible, associated reason for current/elsewhere-selected, busy, unknown, unavailable or deleting targets. The server independently rechecks safety and conservatively blocks **any child session**, including idle children; it never stops work or cascades through children. An eligible Delete opens one row-local named confirmation, not a modal or typed-name exercise: **Delete “{title}”? Chat and transcript file. No undo.** Untitled targets include their activity date/time. Cancel receives initial focus; Escape/Cancel returns to the trigger. The distinct bright Ember/dark **Delete conversation** button is the only destructive confirmation; controls retain 44px targets, wrapping and ordinary document scrolling.

Confirmed completion removes the owned chat, mapped transcript and conversation-owned private application data, then removes the row and refreshes only this list. Other chats' drafts and selection remain intact. Focus moves from the removed row to a nearby Resume or the section heading, never away from a user who moved elsewhere. A refusal stays local and refreshes availability. Accepted/incomplete, partially failed or unconfirmed deletion keeps the target fenced with only **Check status**, a read-only GET of the same command. No Undo, Retry Delete, automatic GET polling, repeated destructive POST or destructive retry on restart is implied. Technical and visual reviews accepted this source/fixture implementation; it is not live publication. Daily/weekly jobs and the final handoff remain unimplemented.

### Content links

Native Ground capture and source links remain real links with 44px minimum targets. Focus uses the context focus color, 2px with 4px offset. Quick Actions and Prompts use buttons because they initiate an unsent handoff rather than navigate directly.

### Skip and pane-jump controls

The app skip link is above the viewport until focus; its visible state is Lantern with Night text, a 44px minimum hit height, and a Parchment outline separated by 3px. It targets focusable main, whose outline is inset 10px. Recall's focus-only Skip to note / Return to files buttons use the same inverse accent vocabulary inside their panes, without history entries. Skip to note focuses the existing reader article (`tabindex="-1"`, named by the titlebar filename) without scrolling; the next Tab follows native order inside the article rather than returning through Files. Return to files opens Files if needed and focuses its current file or heading. Ordinary note selection still focuses the titlebar filename once. Neither focus destination adds a visible reader heading or spacing.

### View heading and purpose

A focusable H1 anchors each route. Ground, Capture and Think register it as an accessible, visually hidden heading; Ground's visible invitation precedes its card headings. Recall uses its H1 within the toolbar. Exact route content and focus/history behavior stay in the surface/design records rather than becoming global typography tokens.

### Capture editor and action

The labelled textarea stays editable during saving; the compact top Capture action remains focusable and exposes its disabled state. Desktop Enter captures and Shift+Enter inserts a line; mobile Enter inserts a line and the button captures. Preserve composition, repeated-key protection, focus and newer drafts. A confirmed save clears only unchanged text; a rejected or uncertain save retains it. Uncertainty explicitly warns that another capture may duplicate the entry, without automatic retry. The persistent shell owns volatile draft state across navigation. See the [Capture UX brief](.lore/work/design/capture-ux.md); physical phone and assistive-technology checks remain open in `memory-loop-22s`.

### Think conversation, composer and New chat

The conversation has a named reading region and chronological message articles with visible and accessible **You / AI** attribution; color is supplementary. Reuse `MarkdownDocument` unchanged: escaped raw HTML, no remote images/embeds, deliberate safe HTTP(S) links with accessible new-tab indication, read-only tasks, keyboard-accessible code and table scrollers. No code-copy toolbar, raw tool payloads, reasoning, message menus or approval controls are added. Native AI activity disclosures show only supplied category/state/duration and retain their expansion state. Ordinary owned questions use labelled native controls and an exact decision reply, never permission approval.

Message is a real labelled textarea (label visually hidden). It stays editable while busy, reconnecting, denied or unavailable. **Enter sends when eligible; Shift+Enter inserts a line. Ctrl/Cmd+Enter also sends, and no editor shortcut activates Stop.** IME/repeated key activation is guarded. Send uses the captured identity/draft version; acknowledgement cannot erase newer writing. Its captured original appears once while awaiting the manifest. Stop uses the known run, shows requesting/uncertain/failure states honestly and is best effort—not undo or cancellation caused by navigation.

The shell owns one persistent Think session. `/think?conversation=<opaque-id>` is authoritative; one per-tab `sessionStorage` pointer stores only that ID. Initial bare Think creates once, retaining typing during registration; adopting the initial browser entry key is not a second activation. Drafts remain volatile through SPA navigation/reconnect and are lost on hard reload. New chat changes identity without stopping previous work; only a nonempty draft prompts the inline **Keep writing / Discard & start** safeguard. Ground's separate prefill/Resume handoff preserves keyed drafts. Same-epoch Resume retains pending command ownership and recoverable originals; explicit verified Resume can adopt a fresh epoch without accepting stale callbacks.

A memory-only view token belongs to each browser view. The persistent shell renews its selected conversation every 30 seconds across all four destinations; the daemon retains two-minute selection leases across browser views. Renewal/registration must succeed before Think mutations, while Message remains editable and other destinations' reads stay independent. Transient initial history-read failures get at most five additional reads with backoff, fenced to the active identity/generation and cleared on success or departure. Recovery does not replay native commands or relax established-session epoch fences. This accepted source/fixture behavior is not yet published to the live app; scheduled generation and the final handoff remain later scope.

The UI follows daemon snapshots/SSE state signals and separately retrieved, versioned body references; it does not own execution truth. Body loading/unloaded/error actions stay local to the part and never retry generation. Selection or reading older content suspends following; **Latest response** floats over the conversation immediately above the composer, aligned to the lane's right edge. Per the user's placement correction, it is outside layout flow: appearing/disappearing must not resize the transcript, editor or Send/Stop. It retains an opaque Night field, visible boundary, 44px minimum target and native keyboard access; activating it returns focus to the reading region when the button held focus. Reading anchors survive content growth. Reader resizing keeps an active question control within the boundary, including its focus outline, but waits until a pointer activation finishes before moving its target. Accessible absolute labels have local positioning contexts so they cannot extend document height outside the reader.

Healthy/transient transcript writes stay quiet. Only server-classified persistent/conflict warnings appear beside the composer, including background warnings across New chat. No routine Connected/All saved line, Retry logging control or generation retry is implied. Admission, run, monitoring, content and logging remain separate state facts without becoming five permanent status widgets.

**Evidence boundary:** independent actual UI/native and held-acknowledgement/background-warning cases passed in `/tmp/opencode/think-phase5-actual-ui-verified.log` and `/tmp/opencode/think-phase5-ack-background-acceptance.log`; the integrated unit/TypeScript result is recorded in `/tmp/opencode/think-phase5-integrated-unit-green.log`. Author captures/geometry in `/tmp/opencode/think-phase5-refinement-after-v2/` cover 1440×900, 390×844, 320×568 and 844×390 at 100% and 200% text. At 320px document height fell from 745px to 568px; a focused question measured 402.08–446.47px inside reader 121–454px. Native answer state, replied receipt, settled UI and subsequent AI continuation were observed. These focused results do not close whole-phase convergence, fresh technical/visual reviews or the residual enlarged-portrait surface finding.

### Recall toolbar and buttons

The dark section titlebar sits below the shared top app header, without duplicated branding. Desktop groups Recall H1, the selected literal filename with its relative breadcrumb, and Read-only across one row; the filename/path group wraps below Recall/Read-only on narrow screens. Full names and paths wrap rather than truncate. Recovery buttons use ivory text and visible boundaries on dark surfaces, raised dark hover and selected dark pressed states. Both Files and reader focus bright Horizon. Pending/read/retry behavior is unchanged.

Files visibility uses a quiet icon-only button, not a detached toolbar text action. A 20px plain left chevron sits in a 44×44px target at the upper-right of the sticky Files header; when collapsed, a plain right chevron sits at the upper-left of the reader, outside the centered prose measure. Its local controls row remains reachable while the reader scrolls. No destination-icon rail or empty Files column remains. Both desktop and narrow use the accessible names Collapse files sidebar / Expand files sidebar, `aria-expanded`, and `aria-controls` targeting the retained, hidden Files navigation. The SVG is hidden from assistive technology. Closing focuses the visible expand control; opening targets the current file or Files heading. Narrow selection still closes Files immediately without changing note/history/scroll semantics.

Matching tooltips use ivory text, raised dark fields and visible boundaries in both Files and reader. Their hover/focus/Escape behavior, 20px/44px geometry, local placement, sticky clearance and focus return are unchanged. The source site's compound glyph and retained destination rail are not imported. Historical 44w verification is unit **25/25**, Recall browser **26/26**, legacy browser **20/20**, typecheck/build, visual **SHIP** and technical **Accept**; 44W-T1 and the protected MS4/history findings are resolved.

### Vault file hierarchy

Native nested lists, folder buttons and note links remain unchanged. Rows target 44px, wrap names/extensions, and deep nesting scrolls inside Files. A dark selected fill and current-file semibold/Horizon underline are distinct from the bright Horizon focus outline inset 2px. Sticky Files header and transparent rows share the sidebar field rather than hardcoded Night patches. Collapsing a folder does not close its selected document.

### Markdown reader

The unboxed article is named by its literal filename, not by invented metadata or the first source heading. The focusable filename and wrapping vault-relative breadcrumb appear only in the dark section titlebar, not inside the reader. The user removed the Formatting support disclosure entirely, along with the old identity block's divider and spacing. The article itself is programmatically focusable for Skip to note but adds no ordinary Tab stop or visible header. An arriving response does not refocus the page or make the entire article a live region.

Source H1–H5 still become native H2–H6; source H6 stays H6. This cap does not repair skipped source levels. Markdown renderer/links/tasks/code/tables are unchanged. Literal identity is 20px Libre Baskerville in the dark titlebar, its breadcrumb is legible Source Sans, and reader body stays 17px/1.7. Code/table scrollers retain their semantics and bounded overflow. No syntax-color palette or media viewer is added.

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
