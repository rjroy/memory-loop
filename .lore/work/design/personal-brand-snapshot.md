---
title: The Guide — Memory Loop guidance snapshot
date: 2026-10-29
status: approved-direction-reference
---

# Personal-brand guidance for Memory Loop

This is a self-contained, limited guidance snapshot for the approved color/type adaptation of [the phase-1 shell](phase-1-shell.md). It is not a copy of the complete brand guide or a new identity. The user's subsequent authorization to plan and implement the shell is recorded in the [implementation plan](../plans/phase-1-shell.md), not conferred by this snapshot. Artwork remains outside scope.

## Provenance

| Field | Recorded value |
|---|---|
| Authoritative source | `/home/rjroy/Projects/personal-brand/brand/BRAND.md` |
| Source repository | `/home/rjroy/Projects/personal-brand` |
| Source repository HEAD | `78c0647608c03db8b4790e0253dea7dfe233f5f5` |
| Last commit affecting the source file | `71bff1d9197580ecaed4fb462101390a86d4360d` |
| Source file SHA-256 | `8a9042b02638cb14913d84977433ffb408e26a6d5a547f9520a3098707e3c8e5` |
| Source dirty status at inspection | Clean: `git status --porcelain=v1 --untracked-files=all` returned no entries. No relevant staged, unstaged, or untracked changes were present; both source-file diffs were empty. |
| Inspection date | 2026-10-29 |
| Guidance extracted | Source §4 core palette/usage, §5 interface typography, §6 grounded voice, and §8/§10 scope/conflict rules. The Memory Loop role mapping below was approved separately by the user. |
| Copied files at initial guidance snapshot | No source files copied verbatim. Selected guidance was transcribed into this local snapshot only. No full guide/PDF, font/license files, mark, or artwork was copied or generated at that stage. The later authorized font-copy manifest is below. |

The external path is provenance, not a build/runtime dependency. This local snapshot contains the guidance needed to review the proposal without access to that repository. A later source change does not silently update this decision: review differences and refresh provenance explicitly. Future font or asset integration needs its own authorized copy, license/provenance record, and verification. The personal-brand skill could not be loaded in this session; the authoritative guide and the user's explicit portability/provenance requirements governed this snapshot.

## Approved application of the core palette

| Core color | Exact value | Memory Loop role |
|---|---|---|
| Night | `#031315` | Current dark-default workspace, notices, header, rail, and bottom-navigation canvas; text on the Lantern skip link/selection highlight. |
| Parchment | `#FEF6E1` | Readable text, content links, notice boundaries, and focus outlines on Night. No pure-white replacement. |
| Lantern | `#EFB83F` | Selected-navigation edge marker; occasional future primary-action fill with Night text, not a new phase-1 action. |
| Horizon | `#5E8BD6` | Reserved purposeful information accents. No blue decoration or small blue body text merely to use all four colors. |

Night and Parchment dominate; Lantern and Horizon are purposeful accents, not equal shares of the page. Use spacing, weight, underlines, and existing geometry for hierarchy rather than adding hues, textures, gradients, or automatic opacity-derived palettes. The source's ANSI extension is not required or imported for this shell. Future semantic-color needs require a deliberate decision, not an invented palette.

## Approved interface typography and limits

Use **Source Sans 3** for interface text and regular-weight navigation, with **Source Sans 3 Semibold** for the current destination, labels, and heading emphasis. This includes the plain Memory Loop app-name text. The source assigns IM Fell English SC to brand-name/hero contexts and optionally Libre Baskerville to article headings; neither display role is needed in this task-focused shell. Fonts were not copied at the initial snapshot; the later implementation now serves the two approved weights locally with a usable system-ui fallback, as recorded below.

Keep the existing layout, four routes, honest placeholder copy, and nonfunctional boundaries. No hero art, logo insertion, taglines, arches, lantern illustrations, path motifs, or promotional language. The brand's grounded voice supports making unavailable functionality clear, not dressing it as a promise or manufactured activity. Any future artwork use must start from the approved source files; this text does not authorize recreation or modification.

## Validation boundary

At the initial snapshot, palette values and typography roles were checked against the source text; contrast was not yet measured. Current dark-default Parchment/Night text, focus, and notice boundaries measure 17.59:1; Lantern/Night selection measures 10.47:1 using computed rendered solid colors. Selection also uses semibold text and `aria-current`, not color alone; content links remain underlined. The original light-workspace shell's independent acceptance is historical. The subsequent dark refinement has focused build/visual evidence and awaits parent-owned independent verification/review. These measurements do not establish manual assistive-technology or physical-device behavior.

The initial approval covered updating the design proposal to this personal-brand direction. The user subsequently authorized planning and implementing the bounded shell. Follow the plan for local font integration and append actual copy/license provenance when it occurs; no files have been copied during planning. Neither approval authorizes artwork, later domain functionality, or a claim of verified accessibility.

## Implementation font copy

Authorized files were copied unmodified on 2026-10-29. Immediately before copying, source repository HEAD was rechecked as `78c0647608c03db8b4790e0253dea7dfe233f5f5`; the full source worktree remained clean, and `brand/BRAND.md` still had the SHA-256 recorded above. The source OFL 1.1/copyright notice was inspected and is distributed alongside the fonts. No other font, artwork, or brand-guide file was imported. Source and destination SHA-256 values matched byte for byte:

| Source, relative to the recorded brand repository | Destination, relative to Memory Loop | SHA-256 (source = destination) |
|---|---|---|
| `brand/assets/fonts/Source_Sans_3/static/SourceSans3-Regular.ttf` | `public/fonts/source-sans-3/SourceSans3-Regular.ttf` | `7ca2b9c4677ce81daf8a7feafb1680f5d228065698b500c5a24e22831e2ae849` |
| `brand/assets/fonts/Source_Sans_3/static/SourceSans3-SemiBold.ttf` | `public/fonts/source-sans-3/SourceSans3-SemiBold.ttf` | `554fa345ebef3febe9a6233a0b25ee38000dd1687c8d6ed5fafeaa9bf1e0cd78` |
| `brand/assets/fonts/Source_Sans_3/OFL.txt` | `public/fonts/source-sans-3/OFL.txt` | `f5cdf59463564e8428c1159d7e7b76eb408c9b5fd4af049c193533c681880169` |

Only the local `/fonts/source-sans-3/` URLs enter the frontend. No external source-repository path or development-only provenance/contract is shipped in application markup or bundles. These fonts retain the SIL OFL 1.1, not the repository's MIT license. No conversion, subsetting, regeneration, or artwork integration was performed.

## Dark-default role refinement

After viewing the phone/Tailscale preview, the user approved dark default rather than a theme switch. The role table now reflects that application-specific mapping; the four core values, interface fonts, source files, and licenses did not change. On 2026-10-29 the authoritative source was reread and rechecked: repository HEAD remained `78c0647608c03db8b4790e0253dea7dfe233f5f5`, the source worktree was clean, and the guide SHA-256 remained `8a9042b02638cb14913d84977433ffb408e26a6d5a547f9520a3098707e3c8e5`. No additional source files, fonts, or artwork were copied. No personal-brand skill was available in this session; the source guide and explicit approval govern. Panel-only sidecar ramps remain inspection metadata, not runtime surfaces or newly approved brand colors.

## 2026-10-30 extension — site and sidebar guidance

The user explicitly approved refreshing local brand guidance and correcting Recall's sidebar. This extension records that direction for the separate UI implementation; it does not claim the correction is implemented or verified. Bead `memory-loop-4d3` covers this guidance refresh only; `memory-loop-ms4` owns the subsequent sidebar correction. The original provenance, font-copy manifest, and approval history above remain historical records, not claims about the current source layout.

### Refresh provenance and transfer record

| Field | Recorded value |
|---|---|
| Source repository | `/home/rjroy/Projects/personal-brand` |
| Inspection time | `2026-10-30T01:30:50Z` (UTC) |
| Source repository HEAD | `34c446007577031b41ec68f3f575daa9885c6f76` |
| Last commit affecting `brand/BRAND.md` | `34c446007577031b41ec68f3f575daa9885c6f76` — added sidebar guidance |
| Source dirty status | Clean: full `git status --porcelain=v1 --untracked-files=all`, unstaged `git diff --name-only`, and staged `git diff --cached --name-only` returned no entries. No relevant dirty or untracked source files. |
| Skill access | Loading `personal-brand` returned `Permission denied: skill`; the authoritative guide and referenced site sources were read directly. |
| Destination | This tracked file, `.lore/work/design/personal-brand-snapshot.md`, extended in place; no pre-existing staged or unstaged diff was present in this file. |
| Transfer | Selected guidance transcribed/adapted from the five files below. No file copied verbatim; no source HTML, CSS, JavaScript, full kit, PDF, artwork, font, or license copied. No additional local guidance file created. |

Paths in the following manifest are relative to the source repository. Hashes identify the inspected files, not copied runtime assets.

| Inspected source | Guidance used | SHA-256 |
|---|---|---|
| `brand/BRAND.md` | §4 palette; §5 Typography; §8 Web and UI branding; §10–11 integration and conflict boundaries | `ace197bb0e86cae3639ef6ea7366ee92df6b3d4c7d4d0e301fb5d55df2d9e6a4` |
| `brand/site/README.md` | Styling and tokens; Responsive layout; Interactive behavior; adaptation limits | `bd20d49f7a45795df1d839347cec8e160178416ceea31f3f70ccd0164e183256` |
| `brand/site/index.html` | Collapsible sidebar specimen, lines 42–70 | `94f907c60c11b201a369b7428b7e5e62674949a41e3533c9c05b97102fcc80dd` |
| `brand/site/ui/guide.css` | Sidebar header/icon sizing and states, lines 11–51; focus and accessibility media rules | `c501e7c1a77efeb7c75da03033c7e36a7ea80cf496102c09d9e094faaf48cabd` |
| `brand/site/ui/guide.js` | Sidebar accessible state, focus, Escape, and labels, lines 52–116 | `3abbe22ebc5495a92048ccbb5515c879a4c2d8f28d9f8e5efc8db9f22a898eb2` |

This extension is self-contained guidance. External paths identify provenance only: they are not build/runtime dependencies, and no source-site script or stylesheet is required by Memory Loop. Future source revisions require another explicit comparison rather than silently replacing this snapshot.

### Relevant additions and retained application choices

- The source now supplies working light/dark UI specimens, sidebar interaction guidance, and optional functional semantic colors. Its four core color values are unchanged. Source Sans 3 is now explicitly appropriate for task-oriented page/section headings and controls, consistent with Memory Loop's existing typography.
- Source font locations moved from `brand/assets/fonts/` to `brand/fonts/`. This does not change the historical copy paths/hashes above or require replacing Memory Loop's already bundled fonts.
- Use flat separation, restrained corners, spacing, readable hierarchy, and visible hover/focus/active states. Sidebar toggles are quiet utility controls, not Lantern-filled primary actions. New surface mixtures, status colors, animations, forms, and other specimen components are not a mandate to restyle the application.
- **Retain the approved dark runtime mapping:** Night canvas, Parchment text/boundaries/focus, Lantern selection, and Horizon reserved for purposeful information. The source's newer Horizon dark-focus, selected-tab underline, and selected-sidebar fill differ from this mapping. Migration is an unresolved decision in `memory-loop-ftj` (`escalate`), not authorized by this refresh or sidebar correction. Do not silently adopt it.
- Source specimen dimensions (172px sidebar, 64px rail, 460px container breakpoint) describe that example, not Recall requirements. Preserve Recall's desktop split, narrow full-screen Files/reader switching, and reachable four-destination app navigation; no global navigation redesign is authorized.

### Approved Recall sidebar adaptation

The detached toolbar text button was the wrong fit. The user's explicit correction takes precedence over the specimen's compound sidebar glyph and retained destination-icon rail:

- **Expanded:** a plain left-chevron icon button at the upper-right of the Files/tree-management header, immediately above the hierarchy, not in the far-right Recall toolbar. Keep the control reachable while the hierarchy scrolls.
- **Collapsed:** hide the Files hierarchy and expose a plain right-chevron icon button at the upper-left of the document view. Do not retain an invented destination-icon rail or an empty Files-width column. On narrow screens, the control belongs to the currently visible Files or reader header; retain full-screen switching and bottom app navigation.
- **Icon and target:** use a 20px chevron within a minimum 44×44px button target. Preserve the restrained existing shape language and Parchment keyboard-focus treatment. No visible Show files / Hide files / Open files / Close files text. A simple inline SVG can supply the functional chevron in the later UI change; no artwork, external icon service, asset generation, package, or new font is needed.
- **Names and relationships:** use native `button` semantics and action-specific accessible names, such as **Collapse files sidebar** / **Expand files sidebar**. Hide the SVG itself from assistive technology; expose current `aria-expanded` and `aria-controls` referring to the Files region. Keep the controlled-region relationship valid in both states.
- **Tooltips:** reveal the matching action label on hover and keyboard focus, not only through a pointer-only native title. Keep it readable while the pointer moves onto it and until hover/focus leaves or it is dismissed. Escape can dismiss a tooltip without moving focus. Do not replace the button's accessible name with tooltip-only information.
- **Keyboard and focus:** support ordinary Tab/Shift+Tab and Enter/Space activation. Escape in expanded Files collapses it and returns focus to the visible expand control; never leave focus inside hidden content. When opening, preserve the existing current-file/Files-heading focus behavior. Keep folder expansion, selected file, and reading/list positions; toggling adds no history entry. Retain native nested-list disclosures and file links with `aria-current`, not an incomplete ARIA tree or tab widget.

The source site's example keeps destination links keyboard-reachable in its collapsed rail and remembers nested-group state. Recall instead keeps app destinations in its existing shell and restores the file hierarchy on expansion. That is the explicit application adaptation, not a claim that the source example hides its navigation.

### Verification boundary for this extension

This bead validates the document's source references, provenance, consistency, and whitespace only. It does not change UI, tests, canonical DESIGN.md, or the design sidecar, and does not establish rendered icon/tooltip contrast, responsive behavior, keyboard behavior, or assistive-technology results. Those belong to the separate sidebar implementation and its assigned verification. No live vault, preview service, or transport was accessed for this refresh.

## 2026-11-01 — approved dark-first application refinement

The user reviewed the current personal-brand guide, confirmed that its functional extension and restrained mixtures are appropriate, and approved implementation of the dark-first assessment in `memory-loop-kqk`. This supersedes earlier application mappings that made Parchment a large Capture/Recall/Inspiration background or inverted secondary controls to a light fill. It does not change the four-color core identity or any approved artwork.

The authoritative `/home/rjroy/Projects/personal-brand/brand/BRAND.md` (§4, §5, §8) and `brand/site/ui/guide.css` were reread directly; `personal-brand` skill access was denied in the assessment session. At reread the source repository HEAD was `55dbe8766668cd409b16bddb437a6bceb7fb56f3`. Inspected SHA-256 values remain `ace197bb0e86cae3639ef6ea7366ee92df6b3d4c7d4d0e301fb5d55df2d9e6a4` for BRAND.md and `c501e7c1a77efeb7c75da03033c7e36a7ea80cf496102c09d9e094faaf48cabd` for guide.css. These identify inspected source bytes, not copied runtime files; no source-cleanliness claim is implied by this record.

Selected application guidance: retain exact A.5/A.1 and the three typography roles; use Weathered Ivory for ordinary text and Parchment for expressive/heading accents; use the guide's bright Horizon, bright Lantern and bright Ember where functional contrast requires them. App-specific dark mixtures distinguish Files, documents, writing, warm Inspiration, hover and selection. Choose dark native controls throughout. The approved app refinement deliberately replaces the source specimen's light secondary-hover inversion with dark raised fields. Current token values and component roles belong in DESIGN.md, not in this historical snapshot. No full guide, source CSS/JS, font, artwork or other resource was copied, and no new artwork was generated.

Author before/after evidence is confined to controlled production-component fixtures in `/tmp/opencode/kqk-dark-first/`, with synthetic browser API/presentation adapters and no daemon, personal vault, model or live-service access. Independent regression and fresh visual review remain required before acceptance; these captures do not establish Next/daemon integration, physical-device or assistive-technology acceptance.
