# Approved character — runtime integration

`memory-loop-44w`, 2026-10-30. The user approved the four-mode board at `acfac1f` and explicitly said “yes please apply it,” including the later top-navigation correction. The application has fresh independent visual **SHIP** and technical **Accept**, with current-build typecheck/build, unit **25/25**, Recall browser **26/26** and legacy browser **20/20** passing; backend **87** remains prior unchanged evidence. Approval covers existing artwork/type integration, not new artwork, future features, real-vault activation or remote API exposure.

## Portable direction and boundaries

**One familiar place, four different ways to arrive.** Shared unchanged A.5 and IM Fell English SC identify Memory Loop. Ground is inspiring: a gold invitation beside full A.1 narrative art. Capture is quiet Parchment with open space, not a fake textbox. Think is curious: a questioning IM Fell invitation, compact A.5 and a cool Horizon/Night field. Recall is reflective: dark Files beside warm Parchment, Libre Baskerville literal identity/editorial headings and Source Sans reading prose. Artwork never sits behind note text. Existing unavailable-feature wording stays honest and unchanged; no invented goals, chats, quotes, metrics or user notes ship.

### Approved top-navigation correction

The user clarified that the board's relocated horizontal app links are preferred because they recover workspace. Retaining the old 13rem global rail/phone bottom bar was an incorrect first adaptation, not a new user-approved constraint. The current application has **one compact top identity/header and horizontal Ground/Capture/Think/Recall native links at every size**, above the full-width workspace. Groups/links wrap as needed at enlarged text without shrinking labels. No permanent global app sidebar, bottom tab bar, duplicate Recall toolbar logo or reserved bottom-bar clearance remains. The independent collapsible **Files** tree is preserved.

Recall's grid uses actual header height plus a `minmax(12rem, 1fr)` workspace row. If enlarged content outgrows a short viewport the page can scroll instead of clipping controls or reducing the reader to zero. Short-height pane top insets are 16px; chevrons remain 20px in 44px targets. This is CSS/layout only: no route/history/scroll/focus algorithm or new feature. Earlier rail-layout verdicts are superseded by fresh acceptance of the corrected top-navigation application.

The previous no-art, one-font and uniformly dark rules were project adaptations, explicitly revisited by the user—not restrictions in the underlying brand. There is no theme toggle, new identity, generated image, paid rendering, crop, recolor, derivative, font subset, dependency or external resource service.

### Contextual color decision

The current source guide `BRAND.md` §8 specifies **Horizon focus on Night, Night focus on Parchment, and Horizon selected-location underlines**. Apply those roles under the new explicit board/application approval: app navigation and current file use Horizon plus semibold/`aria-current`; Files/dark controls focus Horizon; reader/Capture focus Night. All app links now share the same 2px selected underline across sizes. Lantern remains Ground warmth/action, text selection, pressed controls and focus-only pane helpers. The core palette is unchanged; Muted Night `#344548` / Weathered Ivory `#d5d3c5` come from the guide's functional neutral extension. Think uses a 10% Horizon / 90% Night sRGB surface, as in the board.

`memory-loop-ftj` is resolved by that later explicit user authorization and the accepted 44w implementation—not retroactively by the earlier guidance-only decision. Source-pair contrast and independent browser/axe verification support the mapping. Contrasts: Night/Parchment **17.59:1**, Night/Horizon **5.54:1**, Night/Lantern **10.47:1**, Muted Night/Parchment **9.32:1**, Weathered Ivory/Night **12.60:1**; Think text/support/focus **15.68 / 11.23 / 4.94:1**. Decorative rules are not control boundaries. These do not certify native disabled controls, physical devices or assistive-technology use.

## Source validation, not a source refresh

- Runtime transfer source: **this repository's approved board**, `.lore/work/design/memory-loop-character/assets/`, pinned by `acfac1f`. No board file, source artwork or historical guidance snapshot was changed.
- Authoritative guide reread directly: `/home/rjroy/Projects/personal-brand/brand/BRAND.md` §§3–8 and `brand/site/README.md`; prior board inspection also covers site markup/CSS and both approved artworks. Personal-brand skill access was denied in this session; direct file inspection was used, not claimed skill execution.
- Source repository rechecked at integration: HEAD **`55dbe8766668cd409b16bddb437a6bceb7fb56f3`**, worktree clean, matching the board's transfer revision. The [board provenance](memory-loop-character/source-provenance.md) retains original source paths, guide hashes and its original review-only authorization. The later explicit application approval above authorizes this separate runtime transfer.
- Seven files below were copied byte-for-byte from the pinned board; three already-present Source Sans/license files match and are reused. Original font/brand licenses remain separate. Artwork retains Ronald Roy's rights; approval covers this Memory Loop use, not blanket redistribution/modification.
- Every original image is displayed at original proportions and full composition using local `<img>` elements. A.5 supplies compact identity; A.1 is reserved for Ground's larger narrative placement. No local source checkout is needed at runtime.

## Exact runtime manifest

Source paths below are relative to the pinned board's `assets/` directory. Destination paths are repository-relative. Source/destination SHA-256 values match exactly.

| Board source | Runtime destination | SHA-256 | Transfer |
|---|---|---|---|
| `approved-a5.svg` | `public/brand/the-guide/approved-a5.svg` | `e397ce8fcb773de5820605dfbd9c7d8962dbecdb5719e2114bc76b31000b1ad0` | Copied |
| `approved-a1.webp` | `public/brand/the-guide/approved-a1.webp` | `7604118d45b44b13bf90324e958d0a3e8328426cbc617dc55e4a6e3f838f5fbb` | Copied |
| `BRAND-RIGHTS.txt` | `public/brand/the-guide/BRAND-RIGHTS.txt` | `8d77497ddf12ab3c83064b46c2a75d28a6f42b709696269160e2309a941fcbf5` | Copied |
| `fonts/im-fell-english-sc/IMFellEnglishSC-Regular.ttf` | `public/fonts/im-fell-english-sc/IMFellEnglishSC-Regular.ttf` | `bfcbaf94bafb9843518e55034449b6c7f796cef0b3f6c36985c2eb1cde7b55e0` | Copied |
| `fonts/im-fell-english-sc/OFL.txt` | `public/fonts/im-fell-english-sc/OFL.txt` | `8888dbda490cc8daef2d90eb49a20d72ffbd95e4aa02adabc4d8e88f2e6755bb` | Copied |
| `fonts/libre-baskerville/LibreBaskerville-Regular.ttf` | `public/fonts/libre-baskerville/LibreBaskerville-Regular.ttf` | `b93dfb2ec674ef59fd9a1b47498a8d1db498bb9e64ed22a96f8071082e3d6add` | Copied |
| `fonts/libre-baskerville/OFL.txt` | `public/fonts/libre-baskerville/OFL.txt` | `3624eddd4c8f8a908130a417ae7cd089c9da69899c4e0ca1a5217d0a6fae16fd` | Copied |
| `fonts/source-sans-3/SourceSans3-Regular.ttf` | `public/fonts/source-sans-3/SourceSans3-Regular.ttf` | `7ca2b9c4677ce81daf8a7feafb1680f5d228065698b500c5a24e22831e2ae849` | Existing, reused |
| `fonts/source-sans-3/SourceSans3-SemiBold.ttf` | `public/fonts/source-sans-3/SourceSans3-SemiBold.ttf` | `554fa345ebef3febe9a6233a0b25ee38000dd1687c8d6ed5fafeaa9bf1e0cd78` | Existing, reused |
| `fonts/source-sans-3/OFL.txt` | `public/fonts/source-sans-3/OFL.txt` | `f5cdf59463564e8428c1159d7e7b76eb408c9b5fd4af049c193533c681880169` | Existing, reused |

The two new fonts preload from local URLs in `index.html`; Source Sans uses its existing local regular/semibold files. Neutral `data:,` favicon remains unchanged. No font API or external stylesheet is used.

## Implementation and author evidence

Only presentation changes: shared top banner/native navigation, route-specific surfaces, static invitation/art, typography and contextual colors. Duplicate Recall identity was removed; RecallView matches the pre-44w baseline. FilesToggle, MarkdownDocument, route effects, API/hooks and history/scroll/focus callbacks remain untouched. The independent test author added top-navigation/T1 characterization and corrected obsolete bottom-bar assertions. Existing controls, tooltips, sticky clearance, helper stacking and restoration pass renewed independent verification.

Current correction evidence: `/tmp/opencode/44w-topnav/`. Opened `corrected-desktop-{ground,capture,think,recall}.png`, `corrected-phone-{ground,capture,think,recall}.png`, 320px Recall and initial/keyboard 844×390-at-200% Files captures. All four routes were captured/measured at all four sizes in one batch. Original before captures and superseded rail adaptation remain in `/tmp/opencode/44w-visual/`; independent top-nav RED is `/tmp/opencode/44w-topnav-red.log`. Inspection owns disposable config/vault/daemon on a free loopback port and removes/stops only those fixtures. No personal config/notes or existing preview service was read/reconfigured.

Final independent receipts: `/tmp/opencode/44w-topnav-green-*.log` cover typecheck/unit **25/25**/build/Recall **26/26**/legacy **20/20**. Fresh visual **SHIP** is in `/tmp/opencode/44w-topnav/independent-visual-review.md`; parent-owned fresh Oracle **Accept** resolves 44W-T1 with initial unfocused raw-pointer and natural keyboard checks at 844×390/200%, plus 11 fixture checks covering history/UI-001/002/003/MS4. Seven production-source hashes match; callbacks remain baseline. No current material finding or new deferral remains. Backend **87** is prior unchanged evidence, not a rerun.

Author evidence records initial unfocused expand/collapse centers hitting their own controls at y≈283/284, all four top links initially visible, and a 384px enlarged workspace. All 16 route/size combinations have one identity, nav above main, no horizontal overflow, loaded local assets/active fonts and no external/failed requests or page errors. The earlier keyboard regression already passed before correction; the real former defect was initial pointer obstruction. Acceptance does not imply physical-device availability, assistive-technology certification or real-note access.
