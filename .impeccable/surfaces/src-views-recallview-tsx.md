---
version: 1
slug: "src-views-recallview-tsx"
primary_target: "src/views/RecallView.tsx"
related_targets: ["src/recall","src/shell/AppShell.tsx","src/shell/RouteEffects.tsx"]
---

# Recall — files beside the page

Modes: Operate (choose a file), Read (document). One personal user on desktop/phone. User-approved [surface design](../../.lore/work/design/recall-read-only.md), [PRODUCT.md](../../PRODUCT.md), and inherited dark [DESIGN.md](../../DESIGN.md) are authority. No search, editing, media, vault/config picker, or remote API exposure.

## Direction contract

THESIS: Files beside the page: select a known vault file and read an ordinary document, not a dashboard or disabled editor. The signature is immediate file identity with no stale body, while phone Files gives way to the requested page.

OWN-WORLD: Night fields, Parchment reading/focus, Lantern current-file underline, Source Sans 3 400/600, flat rules and native controls. No art, new hues, or theme switch.

STORY: Find a folder, recognize the literal filename/path, open it, and read. Recovery explains what failed without exposing host paths or pretending the vault is empty.

FIRST VIEWPORT: Desktop keeps the 13rem app rail, Recall toolbar, 14–16rem Files panel, and remaining-width reader with 68ch prose. Narrow Files fills the area above persistent bottom links and closes on selection. Identity/path and formatting disclosure precede Markdown.

Sidebar correction (`memory-loop-ms4`): retain the toolbar title/Read-only alignment but move visibility to a 44×44px local icon control. A 20px plain left chevron belongs at the sticky Files header's upper-right; when collapsed, a plain right chevron belongs at the reader's upper-left, with no retained icon rail. Accessible Collapse files sidebar / Expand files sidebar names, controlled/expanded state, hover/focus tooltips with Escape dismissal, and focus return preserve the existing selection/history/scroll model. This supersedes the prior toolbar text toggle and has fresh technical **Accept** / visual **SHIP**; R1/R2/R3/V1 are independently resolved. Current-build independent unit **25/25**, Recall browser **25/25**, legacy browser **18/18**, and typecheck/build pass; backend **87** remains prior unchanged evidence. See the [refreshed guidance](../../.lore/work/design/personal-brand-snapshot.md#approved-recall-sidebar-adaptation). Palette roles and all unrelated design stay unchanged; fixture-only acceptance does not activate real-vault reads.

FORM: User-pinned tree/reader structure, shaped directly within the established world; no roll/seed or generated comp. Code-led written schematic approved by the user.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Finish contract discharged: built after independent RED, verified with final Recall 17/17 and frontend unit 24/24, typecheck/build pass, technical **Accept**, visual **ship**, and canonical DESIGN.md/sidecar documentation. UI-001/002/003 are resolved, including hash-only pane preservation after client selection. Fixture warnings are resolved and the rail concern is closed as an image-tool artifact; evidence: [handoff](../review/recall/handoff.md). No shipping rasters. This brief supersedes the phase-1 placeholder contract for the Recall interior only; other views remain unchanged. Real-vault activation and authenticated remote transport are separate deployment choices.
