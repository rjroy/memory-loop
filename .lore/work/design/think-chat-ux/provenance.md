# Static Think examples — user-directed space revision

`memory-loop-42j.4`, design-only draft. The user rejected the earlier space allocation and routine commentary. Prior draft review receipts were not user approval. Current examples remove the Think/status header, Chat details, visible composer label, action/hint row and logging footer. Send/Stop is beside a one-line growing editor. New chat uses the existing desktop gutter or spare app-banner space, with no new rail or message overlay.

All conversation, activity, draft and question text is fictional review material. Product actions are inert; the state selector, native activity disclosure, textarea growth/editing and radio selections are review affordances only. There are no application imports, service calls or storage. A persistent transcript-delay example is an ordinary conversation with a single subdued note, not a primary Logging problem view or maintenance panel. There is no Retry logging control.

## Existing artwork and fonts, unchanged

Referenced read-only from the adjacent approved board, without copies, transformations, crops, recoloring, downloads, installs or generation:

- `../memory-loop-character/assets/approved-a5.svg` — The Guide A.5, © Ronald Roy. Existing rights and provenance remain in the board's `source-provenance.md` and `assets/BRAND-RIGHTS.txt`.
- `../memory-loop-character/assets/fonts/im-fell-english-sc/IMFellEnglishSC-Regular.ttf` — IM Fell English SC, existing adjacent OFL.
- `../memory-loop-character/assets/fonts/source-sans-3/SourceSans3-Regular.ttf` and `SourceSans3-SemiBold.ttf` — Source Sans 3, existing adjacent OFL.
- `../memory-loop-character/assets/fonts/libre-baskerville/LibreBaskerville-Regular.ttf` — Libre Baskerville, existing adjacent OFL.

The same actual faces now use their normal family names in this artifact. Night, the cool 10% Horizon Think field, Parchment ink and the approved top identity/navigation remain. The 20% Horizon user field and original message text are retained, so space gains are not produced by shrinking prose or removing conversation content. Completed tool rows are available in the compact activity disclosure, not shown as an expanded routine status panel.

## Matched comparison and bounded evidence

Evidence directory: `/tmp/opencode/think-chat-ux-space-revision/`. `before/` preserves the prior artifact source; `render.mjs` serves only allowlisted before/after presentation files and the five approved artwork/font references on an owned ephemeral loopback port, excluding the listed live/preview ports. No app, vault, private configuration, `.next`, dependency or runtime operation is needed. The browser and server are stopped after capture.

The matched **working conversation uses the same original user/AI text and unsent draft in both versions** at 1440×900, 390×844, 320×568 and 844×390/root text 200%. Files are `before-{desktop,phone,compact,landscape-200}-working.png` and matching `after-*`. Extra after examples cover new chat (desktop/phone), disconnected, persistent notice, older Markdown with Latest response, and an ordinary agent question (phone). These are fixture screenshots, not real notes or a live Think implementation.

`inspection.json` records dialogue/composer rectangles, font size, editable input, button geometry, overlap/hit testing, ordinary Tab reachability and text growth. `render.log` summarizes comparisons. The desktop/portrait reading-area measure is the height of the bounded conversation scroller; the short enlarged view uses ordinary document flow, so its initial visible dialogue and total page height are reported instead of falsely treating intrinsic content height as an allocated viewport. The review-only top strip is present in both versions and is not proposed product UI.

The composer starts at one comfortable line and grows only for actual content. A long fixture draft can therefore use two or three lines at narrow widths; the empty editor and typed-multiline growth are measured separately. Minimum 44px New chat/action targets and the same-row editor/action relationship are checked. At cramped widths the single New chat control uses its drawn plus, accessible name and native title; it is not a newly allocated sidebar or bottom bar.

### Recorded comparison

| Viewport | Prior dialogue height | Revised dialogue height | Gain |
| --- | ---: | ---: | ---: |
| 1440×900 | 459.8px | 704px | **244.2px / 53%** |
| 390×844 | 345.8px | 557px | **211.2px / 61%** |
| 320×568 | 128px | 236px | **108px / 84%** |

The same-draft composer region shrinks from 230px to 70px on desktop and from 206px to 90px on 390px phone; these include padding, not just the textarea. Empty textareas measure **46px** at normal text and grow to 94px for the three-line editing probe. At 320px the populated fixture genuinely wraps to three lines; the complete document now fits 568px instead of extending to 637px. No conversation prose was shrunk to obtain these gains.

At 844×390/200% the root is confirmed **32px**. This is document-flow mode, not a fixed dialogue pane: initial visible dialogue increases from about 6px to 114px, and total page height decreases from 1672px to 1041px. Keyboard focus scrolls the controls into view; this is not a claim that the whole enlarged layout fits in 390px.

All **14 final captures** were opened. `desktop-before-after.png` and `phone-before-after.png` pair the actual matched captures, before on the left. No page errors, external/failed requests, horizontal overflow, composer overlap or New-chat overlap with visible conversation/editor content was observed. All visible action targets were at least 44×44px; editor/action remained side by side. Ordinary Tab reached New chat, Message and enabled Send/Stop in every relevant after example; focus-center hit tests passed. Disabled Send/Stop were correctly skipped, not treated as reachable actions. Every editor remained editable, including disconnected state. All owned fixture processes were stopped.

The short enlarged layout deliberately permits page scrolling. Browser focus scrolling makes the editor and actions reachable, but static Chromium is not evidence of real iOS/Android keyboards, IME, safe areas, VisualViewport or assistive-technology behavior. Long-content transfer, actual streaming, receipt reconciliation, Stop and automatic transcript retry remain technical contracts, not capabilities tested by this static artifact.

`detector.json` retains **nine findings**, not a clean pass: five contextual palette advisories, three parsed font-family warnings and one empty-invitation type-step advisory. The fonts are the exact approved local files under their actual family names; the warnings report shortened pieces of quoted shorthand family names, not substituted faces. The 10%/20% fields, supporting ink, contextual rules and 42px invitation are documented proposals/established roles; no global ignore or unrelated design-system repair was applied. There is no remaining activity-padding warning in this scan. Syntax, links and whitespace checks are bounded author checks. Parent owns fresh review; no self-issued approval, Bead closure, commit, deployment or live-app change accompanies this revision.
