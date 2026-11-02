---
title: Read-only Recall — approved surface brief
date: 2026-10-29
status: completed
surface: Recall
---

# Recall: files beside the page

Sidebar correction (`memory-loop-ms4`, 2026-10-30): the user superseded the detached text toggle with the [approved icon-sidebar adaptation](personal-brand-snapshot.md#approved-recall-sidebar-adaptation). The current layout/control descriptions below reflect that bounded correction. Fresh technical **Accept** and visual **SHIP** resolve R1/R2/R3/V1: sticky-header row clearance, breakpoint focus transfer, anchor-adjusted reading restoration, and focused-helper visibility. Independent current-build unit **25/25**, Recall browser **25/25**, legacy browser **18/18**, and typecheck/build pass; backend **87** remains prior unchanged evidence. Original read-only counts below are historical. Acceptance still does not activate real-vault reads or remote transport.

Visual application (`memory-loop-44w`, 2026-10-30) is accepted: independent current-build typecheck/build, unit **25/25**, Recall browser **26/26**, legacy browser **20/20**, fresh visual **SHIP** and technical **Accept**; backend **87** is prior unchanged evidence. The user-approved board `acfac1f` and explicit top-navigation correction now provide one compact A.5/IM Fell header with horizontal links, no permanent global rail/bottom bar or duplicate Recall logo. Files remains independent; Parchment/Libre Baskerville reading and Source Sans prose retain safe Markdown semantics. Horizon marks locations/dark focus, Night light focus. 44W-T1 initial pointer obstruction is resolved with raw-pointer and natural keyboard checks at 844×390/200%; history/UI-001/002/003/MS4 remain verified. Older restraint/layout adaptations are superseded; exact [runtime provenance](character-integration.md) and access limits remain authoritative.

Titlebar refinement (`memory-loop-53h`, 2026-10-30): the user's later request supersedes the old reader identity/disclosure placement. Filename and breadcrumb belong in the dark section titlebar; Formatting support and the old reader identity divider/spacing are removed. Skip to note has a separate reader-local article focus destination so keyboard traversal bypasses Files; ordinary selection still focuses the titlebar filename. These direct changes are reflected below; implementation/correction awaits independent acceptance, not implied by the earlier slice's receipts.

**Approved by the user: “Implement this design.”** The read-only slice is complete: independent frontend unit 24/24, Recall browser 17/17 in one run, typecheck/build pass, technical **Accept** and visual **ship**. The original 15-failure RED remains historical evidence. Acceptance does not activate a real vault or remote transport.

Authority: [Recall intent](../intents/recall.md), [local plan](../../local/plans/read-only-recall.md), [PRODUCT.md](../../../PRODUCT.md), approved dark [DESIGN.md](../../../DESIGN.md), and the backend-owned [typed contract](../../../backend/contract.ts) / [contract notes](../../../backend/CONTRACT.md). This brief records the accepted route/interaction design; canonical DESIGN.md records the actual built system. The placeholder Recall interior was replaced.

## Direction contract

THESIS: Files beside the page: select a known vault file and read an ordinary document, not a dashboard or disabled editor. The signature is immediate file identity with no stale body, while phone Files gives way to the requested page.

OWN-WORLD: Apply the approved reflective board: Night Files/navigation, warm Parchment reader, shared A.5/IM Fell identity outside the note, Libre Baskerville editorial headings, Source Sans 3 body/controls. Horizon current-file/dark focus, Night light focus, Lantern text selection/helpers. No theme switch, new generated art, renderer change or extra feature.

STORY: Find a folder, recognize the literal filename/path, open it, and read. Recovery explains what failed without exposing host paths or pretending the vault is empty.

FIRST VIEWPORT: Shared compact top identity/horizontal app links, dark Recall section titlebar with the selected filename/breadcrumb and Read-only, approximately 16rem desktop Files and remaining-width reader with 68ch prose. Narrow Files fills the work area below the titlebar; selection closes it immediately. The reader starts with note content, without a duplicate identity, compatibility disclosure or separating rule. Enlarged text can reflow the header and allow page scroll instead of clipping the work area.

FORM: User-pinned tree/reader structure, shaped directly within the established world; no roll/seed or generated comp. Code-led written schematic approved by the user.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Original read-only finish contract discharged: technical **Accept**, visual **ship**, canonical DESIGN.md/sidecar recorded; no rasters were introduced in that original slice. Later 44w artwork integration and current acceptance are recorded above.

The loopback daemon implements configuration, tree/note reads, static hosting, and the development Vite proxy. The built UI consumes those same-origin endpoints. Standalone preview remains static-only; see [current startup/transport guidance](../../../README.md#operator-guide). Real-note activation remains a separate deployment decision.

## Job and direction

One personal user, on desktop or phone, finds a Markdown file by its place in one configured vault and reads it without changing it. **Operate** is the file-selection mode; **Read** is the document mode. Success means a recognizable hierarchy, unmistakable file identity, comfortable reading, and honest recovery—not an activity dashboard.

**Files beside the page:** a folder panel and an unboxed document. Selecting a file identifies the requested note immediately, clears the previous body, and closes phone Files while loading. A late response must never make one file look like another.

The original read-only topology remains constrained; 44w applies the approved board's type, art framing and complementary light/dark roles, not unrelated concept alternatives. No real vault data was inspected; schematic brackets below denote content slots only. Historical acceptance counts do not substitute for renewed verification of the visual application.

## Layout and first state

- Preserve **Ground · Capture · Think · Recall** in that order and keep them usable in every state. Recall's dark section titlebar contains H1 **Recall**, the selected literal filename and vault-relative breadcrumb, and **Read-only**. The Files control belongs to its local pane header. The obsolete global **Navigation preview** label stays removed; do not invent a connected badge. Other tabs keep their own unavailable-feature explanations.
- **Desktop, existing ≥56rem breakpoint:** Recall spans the width below compact top navigation, not beside a permanent app rail. Files is visible on first entry, approximately 16rem wide (toward 14rem near the breakpoint), with a thin contextual divider. Reader and Files scroll independently beneath the toolbar. No resizer. Left-chevron at sticky Files header upper-right collapses it; right-chevron at reader upper-left expands it. No destination-icon rail or empty Files column. This changes space, not selection or reading position.
- **Narrow:** Files or reader fills the work area below shared top navigation and Recall/Read-only, not a half-sheet or overlaid drawer. Hidden reader is absent from layout/accessibility. This is **non-modal**: no focus trap, `aria-modal`, backdrop or disabled app navigation. No bottom navigation/clearance remains.
- First narrow entry without a note opens Files. A direct note URL starts the reader. The same left/right-chevron controls in the Files/reader headers switch modes; selection closes Files immediately, even before loading finishes. Escape within Files closes it unless dismissing a visible tooltip first. Native Back remains browser history, not a hidden close action.
- Shared top header owns the single A.5/Memory Loop identity. Recall's titlebar places the selected filename above its wrapping breadcrumb between Recall and Read-only on desktop; narrow layouts move that group onto a second row. Its app grid has an actual-height header and `minmax(12rem, 1fr)` workspace row. Short/enlarged layouts may scroll the page rather than crush panes; tight titlebar grouping, a rem-scaled 18px Recall heading when selected, and 16px pane insets keep 44px Files controls reachable.

```text
DESKTOP
┌──────────────────────────────────────────────────────────┐
│ [A.5] Memory Loop           Ground Capture Think Recall  │
├──────────────────────────────────────────────────────────┤
│ Recall   [filename.md / relative breadcrumb]    Read-only │
├─────────────────┬────────────────────────────────────────┤
│ Files         ‹ │ [rendered Markdown…]                   │
│ [folder] ▾      │                                        │
│   [filename.md] │                                        │
│ files scroll    │ [rendered Markdown… / reading scroll]   │
└─────────────────┴────────────────────────────────────────┘
PHONE: FILES                      PHONE: READER
┌─────────────────────────┐      ┌─────────────────────────┐
│ [A.5] Memory Loop       │      │ [A.5] Memory Loop       │
│Ground Capture Think Recall│    │Ground Capture Think Recall│
├─────────────────────────┤      ├─────────────────────────┤
│ Recall        Read-only │      │ Recall        Read-only │
│ [selected filename/path] │      │ [filename / breadcrumb] │
├─────────────────────────┤      ├─────────────────────────┤
│ Files                 ‹ │      │ ›                       │
│ [folder] ▾              │      │ [rendered Markdown…]    │
│   [filename.md]         │choose│                         │
│ [folder] ▸              │ ───► │                         │
│                         │      │ [rendered Markdown…]    │
│ full-height hierarchy   │      │ reading scroll          │
└─────────────────────────┘      └─────────────────────────┘
```

## File hierarchy, focus, and selection

Use native nested lists, folder disclosure buttons, and file links in **Vault files** navigation; global navigation remains **Primary**. Do **not** claim ARIA tree/treeitem semantics or introduce an incomplete arrow-key model.

- Root entries are visible; folders start collapsed except selected-note ancestors. Preserve daemon ordering. Folder buttons expose expanded state and their controlled list; Enter/Space toggles, Tab/Shift+Tab follows native controls. Expansion does not fetch a note or change history. Empty expanded folder: **No items to show.**
- File rows are actual note-location links. Preserve Enter, modified click, new tab, and copy-link behavior. Modified click does not change the current phone mode. Current file: Parchment semibold, Horizon underline, `aria-current="page"`; keyboard focus has a separate Horizon outline. No selected-folder styling or count badges.
- Target ≥44px rows; exact names/extensions wrap rather than lose their only identifier. Deep nesting may scroll horizontally inside Files, never the page. Bring focused rows into view. Collapsing a focused descendant returns focus to its folder button; collapsing a selected ancestor does not close the document. Reopening Files reveals selected ancestors.
- Focus-only **Skip to note** before the desktop hierarchy focuses the reader article without scrolling. The article has `tabindex="-1"` and is named by the titlebar filename; the next Tab enters its native links/controls rather than returning through Files. No visible heading or spacing is added. **Return to files** before the article opens Files if needed and focuses its current link or heading. These actions do not affect history.

| Action | Result and focus contract |
|---|---|
| Enter Recall | Client app-route entry focuses Recall H1; hard load does not autofocus. No response-driven focus jump. |
| Expand files sidebar (right-chevron icon) | Focus current link if already available, otherwise Files heading; keep that focus when loading completes. Restore expansion/list position. |
| Collapse files sidebar (left-chevron icon), or Escape within expanded Files | Focus the visible reader-header expand control; preserve reader position. Buttons expose expanded state and controlled panel. Escape dismisses a visible tooltip first without moving focus or collapsing Files. |
| Choose a different note | Clear old body, show safe identity when known, focus titlebar filename once, reset that note to top; narrow Files closes. |
| Note response | Update only the currently requested note. No second focus movement; concise polite status, never a live announcement of the whole article. |
| Choose current note / retry | Re-read without another history entry; preserve reading position where possible. |
| Choose A then B | Late A success/error cannot overwrite B or move focus. Superseded short reads may be abandoned. |
| Leave for another tab | Normal app navigation, no leave guard; retain presentation context in memory only. |

Resize preserves selection and reading position. Entering narrow with a note keeps the reader unless the user is actively using Files; without one, show Files unless explicitly closed. Visible narrow Files becomes a visible desktop panel on widening; otherwise restore the desktop visibility preference. If a pane becomes hidden while focused, focus the visible Files toggle instead of leaving focus in hidden content. No orientation-driven jump to the page top.

Sidebar buttons are 44×44px with 20px drawn SVG chevrons, no visible Show/Hide/Open/Close files text, and accessible names **Collapse files sidebar** / **Expand files sidebar**. `aria-controls` references the retained Files navigation even when hidden. Matching tooltips support hover and keyboard focus, remain pointer-reachable, and dismiss with Escape. Native keyboard behavior is unchanged; visual focus/tooltip colors follow dark Files or light reader context.

## Identity, links, and browser history

- Keep route H1 **Recall**. Selected identity is the literal filename, including `.md`, followed by a wrapping vault-relative path in the dark section titlebar. It labels the reader article and is focusable, not another H1 or a title invented from frontmatter/the first Markdown heading. Its selection-focus role is separate from Skip to note's reader-local article destination.
- The actual contract uses **arrays of filename components**, not host paths. Preserve the returned ID sequence. Display escaped `name`/relative components; never construct a host path or show the configured root. On a direct URL before retrieval, show loading rather than treating unvalidated URL text as a trusted filename.
- Frontend URL: **`/recall?file=<JSON component array, query-encoded once>`**. Pass that same component sequence to the contract's **`/api/vault/note?id=…`**, again with one normal query encoding. Do not put Markdown, config, credentials, or absolute paths in URL/history. Relative names may be visible in URLs; IDs are not access tokens or promises of remote access.
- Different note: push one entry. Same note, retries, expansion, and Files toggles: no entry. Back/Forward restores selection and that entry's reader position, revealing the reader; an unavailable historical target stays an error, not another file. Opening Files does not intercept Back.
- A bare `/recall` on fresh entry or Back/Forward means no selection. Explicitly returning from another app tab may restore the in-memory reading context and **replace**, not push, its bare Recall URL. Clicking already-current primary Recall preserves its selected query; modified-click retains its ordinary `/recall` area destination.
- Titles: **Recall · Memory Loop** unselected; **{filename.md} · Recall · Memory Loop** when a safe basename is known; **Note unavailable · Recall · Memory Loop** for an unknown target failure.
- Shell `RouteEffects` distinguishes Recall-local location changes from app-route entry. Recall owns note titles and actual pane scroll; query changes do not refocus the route H1. Other views retain their route effects.
- Same-path/query hash-only navigation preserves Files visibility, pane positions and presentation, including keyboard Skip to content after client-side note selection. Genuine note transitions and Back/Forward retain their selection/restoration semantics.

Expansion, visibility, last selection, and scroll are session-memory presentation only—no local/session storage or offline-note promise. Re-entry/refresh reads current daemon data; no live watching.

## Reading and compatibility

An unboxed Parchment article, not a disabled editor: filename/path stay in the dark section titlebar outside the pane scrollers. There is no duplicate reader identity, Formatting support disclosure, old divider or leftover identity-block spacing. Source Sans 3 body **1.0625rem / 1.7**, maximum **68ch**, narrow gutters **20px**. Libre Baskerville 400 supplies the **1.25rem** titlebar filename and source heading sizes 1.75rem / 1.375rem / 1.125rem / 1.0625rem, with 1.4 heading line height. Route H1 remains Source Sans; renderer H1–H5 still become H2–H6 and source H6 stays H6. This cap does not repair skipped source levels.

Lists retain markers; GFM tasks are disabled native checkboxes named from their task text. Actual code uses the browser monospace stack; code/tables retain bounded, keyboard-accessible horizontal scrolling. Long prose URLs/headings/paths wrap. Blockquote/table rules mix Night/Parchment for the light reader; no syntax palette or media chrome is added. Fixture-only author inspection is not independent approval or physical-device/assistive-technology verification.

CommonMark + GFM, with these explicit first-slice limits:
- Raw HTML is escaped source text, never live DOM. No scripts or automatic media/network requests.
- Markdown images become **Image not shown: {alt text}** or **Image not shown.** Wiki embeds stay literal text. No image element/view action.
- HTTP/HTTPS links open on deliberate activation in a new tab, with safe opener/referrer handling and an accessible new-tab indication. Unsafe/protocol-relative URLs remain text. Relative note links, heading fragments, and Obsidian wiki links also remain text in this slice.
- Frontmatter passes through ordinary Markdown, not parsed/hidden metadata or note identity. No Obsidian plugin interpretation.

Files footer: **Markdown files only.** The user removed the **Formatting support** disclosure entirely; the renderer's compatibility limits above are unchanged.

## States and copy

Use structured error **codes**, not status alone or leaked filesystem messages: three different configuration/vault failures are all 503. Transport failure and known static-preview mode are client states, not invented backend codes. Short polite status and `aria-busy` belong to the affected region; no fake rows, progress percentages, or whole-article live region.

| State / code | Copy | Placement / action |
|---|---|---|
| Tree loading | **Loading files…** | Files only; tabs/toggle usable. |
| Ready, unselected | **Choose a Markdown note** — Open a folder or choose a file in Files. Notes open read-only. | Reader; existing reader-header expand icon if Files is hidden, not a duplicate action. Never auto-select first note. |
| Empty eligible root | **No Markdown notes to show** — Recall lists Markdown files and folders only. Other files and hidden entries aren't shown. | Workspace when no requested/open note; no fake browse action. A nonempty folder hierarchy remains browsable even if it contains no notes. |
| Note loading | **Opening note…** | Reader with known identity, no previous body. |
| Zero-length success | **This note is empty.** | Keep file identity and Files control. |
| `config_missing` | **Vault not configured** — Set the vault directory in the JSON config, then restart Memory Loop. | Blocking workspace; **Check again**. |
| `config_invalid` | **Vault configuration is invalid** — Check the JSON configuration and vault directory, then restart Memory Loop. | Blocking workspace; **Check again**. No config editor/path dump. |
| `vault_unavailable` | **Vault unavailable** — Memory Loop can't read the configured vault. Check that it exists and is readable, then try again. | Workspace if nothing usable; otherwise affected region; **Try again**. Never empty-vault copy. |
| Tree refresh fails with reader usable | **Couldn't load files** — The file list couldn't be retrieved. Try again. | Files only; **Retry files**. Preserve independently opened reader; never fabricate a partial tree. |
| `note_unavailable` | **Note unavailable** — This note may have moved, been removed, or can't be read. Choose another file or try again. | Reader, known identity retained without old body; **Retry note**, Files available. |
| `invalid_request` / malformed note URL | **Note address is invalid** — Choose a Markdown note from Files. | Reader; Files control, no repeated retry of the malformed address or raw-ID display. |
| Transport failure | **Vault service unavailable** — Recall couldn't reach the vault service. Check the local service and try again. | Affected query region or whole workspace if nothing usable; **Try again**. Unexpected SPA HTML is failure, not Markdown. |
| Explicitly known static preview (reserved; no current client mode signal) | **Vault access isn't enabled in this preview** — This preview shows the interface only. Real vault access is local-only in this layer. | Not currently rendered: static fallback produces the transport state. No hostname inference, login/config/connect action, or extra endpoint. |

Blocking states replace a meaningless Files/reader split; global tabs remain. Keep requested-note intent for recovery, never silently choose another note. Retries are fresh short reads, suppress duplicate pending clicks, and add no history. No polling, job queue, cancellation feature, or offline-content claim. Config location/key and startup behavior are documented by the backend contract, not edited here.

## Boundaries and verification

No search, edits, media viewer, vault/config picker/editor, sharing, chat, or write actions. No daemon exposure: the static Tailscale preview does not expose the loopback API, and phone integration uses test-owned fixtures until access-control/transport is separately reviewed. Use specific static-preview copy only if the client explicitly knows its hosting mode; otherwise use transport-error copy. No extra endpoint or backend change is required by this proposal. Backend contract/security/deployment decisions remain in their own lane.

Verification used controlled disposable fixtures, not real notes or mutable personal configuration. Accepted behavior contracts:
1. Four app tabs work throughout Files/loading/error states. Native disclosures, links, expanded/current state, keyboard focus, pane-jump helpers, and modified clicks follow the contracts above.
2. Desktop default panel, narrow full-screen selection/close, direct entry, resize, safe areas, and independent scrolling preserve the task and never hide focused controls.
3. Selection/history/current-tab restoration and per-entry scroll work without shell focus conflicts; JSON component IDs round-trip correctly. A/B races cannot show stale content/errors.
4. Distinct empty, config, vault, note, invalid-address, and transport states match structured codes; retries preserve intent, expose no host paths, and never redirect to another note.
5. Hostile/long Markdown causes no live HTML, remote media fetch, unsafe links, page overflow, editable checkboxes, or unsupported-link promises. Compatibility copy matches actual renderer behavior.
6. Bounded later visual/keyboard/axe inspection: 1440×900, 390×844, 320×568, 844×390, plus zoom/text spacing. Fixtures cover empty/one/large trees, deep nesting, long Unicode names/paths, and multi-screen Markdown with wide tables/code. These are stress ranges, not product limits.

## Approved decisions and implementation sequence

Fixed requirements remain fixed: one JSON-configured vault, daemon reads, Markdown-only/read-only, non-modal narrow Files closing on selection and default-visible desktop Files. The later approved four-mode board/top-navigation correction supersedes original global dark/rail/bottom-bar styling, not these behavior contracts. **Original read-only decisions (subsequently visually adapted above):**
1. **Layout:** unboxed reader, independent desktop panes, initial narrow Files only without a selected note, task toolbar instead of redundant narrow branding, obsolete preview-label removal.
2. **Navigation:** native disclosures/file links rather than an ARIA tree; non-modal full-screen Files, explicit pane-focus helpers, persistent app tabs.
3. **History:** note query URLs, native Back/Forward, no toggle history, session-only cross-tab reading restoration with explicit bare-URL Back behavior.
4. **Reading:** typography/heading normalization and the stated CommonMark/GFM compatibility limits, including escaped HTML and no media/note-link resolution.

Completed handoff: independent Recall 17/17 in one run, frontend unit 24/24 and typecheck/build pass; prior backend 87 and legacy browser 18 remain valid unchanged. Technical **Accept** resolves UI-001/002/003; visual **ship** has no production UI findings. Helper/fixture issues were repaired; the rail concern was closed as an image-tool artifact, not a CSS defect. The source-outline advisory remains a documented content limit, not a claim of universal accessibility. DESIGN.md/sidecar record the built system. The root production build is current; the existing static Tailscale preview remains API-isolated. No real-vault daemon was activated and no personal notes were read. Only deployment choices remain, not implementation blockers; see the local handoff and README operator guide.
