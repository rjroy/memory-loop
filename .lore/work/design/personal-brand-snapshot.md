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
