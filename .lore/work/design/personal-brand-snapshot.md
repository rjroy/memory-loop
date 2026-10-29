---
title: The Guide — Memory Loop guidance snapshot
date: 2026-10-29
status: approved-direction-reference
---

# Personal-brand guidance for Memory Loop

This is a self-contained, limited guidance snapshot for the approved color/type adaptation of [the phase-1 shell proposal](phase-1-shell.md). It is not a copy of the complete brand guide, a new brand identity, or authorization to implement UI or use artwork.

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
| Copied files | No source files copied verbatim. Selected guidance was transcribed into this new local snapshot only. No full guide/PDF, font/license files, mark, or artwork was copied or generated. |

The external path is provenance, not a build/runtime dependency. This local snapshot contains the guidance needed to review the proposal without access to that repository. A later source change does not silently update this decision: review differences and refresh provenance explicitly. Future font or asset integration needs its own authorized copy, license/provenance record, and verification. The personal-brand skill could not be loaded in this session; the authoritative guide and the user's explicit portability/provenance requirements governed this snapshot.

## Approved application of the core palette

| Core color | Exact value | Memory Loop role |
|---|---|---|
| Night | `#031315` | Desktop rail and mobile bottom-navigation background; primary text and structural rules on the light workspace. |
| Parchment | `#FEF6E1` | Workspace and placeholder surfaces; navigation text and proposed rail focus ring. No pure-white replacement surface. |
| Lantern | `#EFB83F` | Selected-navigation edge marker; occasional future primary-action fill with Night text, not a new phase-1 action. |
| Horizon | `#5E8BD6` | Reserved purposeful information accents. No blue decoration or small blue body text merely to use all four colors. |

Night and Parchment dominate; Lantern and Horizon are purposeful accents, not equal shares of the page. Use spacing, weight, underlines, and existing geometry for hierarchy rather than adding hues, textures, gradients, or automatic opacity-derived palettes. The source's ANSI extension is not required or imported for this shell. Future semantic-color needs require a deliberate decision, not an invented palette.

## Approved interface typography and limits

Use **Source Sans 3** for interface text and regular-weight navigation, with **Source Sans 3 Semibold** for the current destination, labels, and heading emphasis. This includes the plain Memory Loop app-name text. The source assigns IM Fell English SC to brand-name/hero contexts and optionally Libre Baskerville to article headings; neither display role is needed in this task-focused shell. No fonts have been copied or installed. Future implementation should verify the supplied files and licenses, use a local delivery plan, and retain a usable system-ui fallback.

Keep the existing layout, four routes, honest placeholder copy, and nonfunctional boundaries. No hero art, logo insertion, taglines, arches, lantern illustrations, path motifs, or promotional language. The brand's grounded voice supports making unavailable functionality clear, not dressing it as a promise or manufactured activity. Any future artwork use must start from the approved source files; this text does not authorize recreation or modification.

## Validation boundary

Palette values and typography roles were checked against the source text. Contrast has **not** been measured or tested in rendered combinations. Proposed focus treatment: Parchment ring with Night separation on dark navigation; Night ring with Parchment separation on the workspace. Selection uses a Lantern edge mark plus semibold text and `aria-current`, not color alone. Gold/blue small text on Parchment is not assumed accessible; prefer Night text and underlined links. Actual text, selection, focus, hover, and pressed combinations must be checked before implementation acceptance.

User approval covers updating the design proposal to this personal-brand direction. It does not authorize UI implementation, assets, architecture, or a claim of verified accessibility.
