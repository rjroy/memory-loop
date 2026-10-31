---
title: Ground — six independent ways back into the work
date: 2026-10-31
status: draft
tags: [ground, dashboard, ux, responsive, accessibility, design]
related: [.lore/work/intents/ground.md, .lore/work/design/think-chat-ux.md, .lore/work/design/character-integration.md]
---

# Ground: pick up a thread

Implementation-ready UX proposal for `memory-loop-9ya.1`, following approval of
the Ground implementation plan. The [composition](ground-dashboard/index.html)
is a static design artifact with fictional notes, questions, goals and chats;
its actions do not contact the application. [Before](ground-dashboard/before.html)
reconstructs the current placeholder from its source and existing stylesheet.
Neither is a live Ground implementation or evidence of real vault access.

## Authority and direction

The updated [Ground intent](../intents/ground.md) and approved local implementation
plan supply behavior. Current `DESIGN.md`, the approved
[character board](memory-loop-character/index.html) and
[integration provenance](character-integration.md) supply visual authority.
The older personal-brand snapshot is historical where it conflicts with these
later approvals: do not bring back a global rail, bottom navigation, single-font
restriction or no-art rule. PRODUCT.md's older stack/capability descriptions are
not the current Next/Bun/Hono technical contract.

**Mode:** Operate, with a small inspiring arrival and readable reflective content.
One personal user on desktop and phone wants to begin a thought, remember a goal,
or resume something real. No counters, productivity scores or invented activity.

### Direction contract

- **Thesis:** a useful place to return, not six identical tiles. Commands lead;
  quote, question and goals share a quieter band; recent writing is denser below.
- **Own world:** existing Night frame, Parchment text and quotation field,
  Lantern invitation, Horizon focus/current location. IM Fell invites; Source Sans
  operates; Libre Baskerville gives the quotation and Markdown headings an
  editorial voice. Full, unchanged A.1 stays beside the invitation, never behind
  content. A.5 stays in the existing header. No new art, texture, gradient or motion.
- **Story:** arrive → choose a skill/question or a familiar thread → enter Think
  with an intact editable draft, or Recall at the actual source note. Reading a
  quote or goals does not require an action.
- **First viewport:** unchanged compact app banner; a short invitation/art row;
  immediately useful wrapping Quick Actions; then Inspiration, Prompts and Current
  Goals across a wide desktop. The start of recent writing follows without a
  second hero. Phone keeps the same document order and scrolls naturally.
- **Form:** fixed, responsive six-card composition inside the approved world;
  brief-pinned extension, not an identity replacement or concept tournament.
  The signature is the small complete lantern landscape beside an invitation,
  balanced by one warm quotation field and genuine working links.
- **Finish:** this design artifact ends with rendered-composition evidence and
  parent-owned fresh review after technical contracts. Production implementation
  still needs its own interaction, accessibility and visual acceptance; this is
  not a shipping verdict or an update to global DESIGN.md.

## Concrete composition

### Shared shell and order

Keep the current header, 40px A.5, 28px IM Fell identity, native four-destination
links and Horizon current underline. No dashboard navigation, settings button,
panel menu, section jump bar, global rail or bottom tabs. Keep the app skip link
and route-ready focus behavior. Ground has a visually hidden H1/focus anchor;
the visible invitation remains **Pick up a thread.** No purpose/developer paragraph
or unavailable-panels notice remains once real cards are available.

DOM, reading and mobile order are **Quick Actions → Inspiration → Prompts →
Current Goals → Recent captures → Recent conversations**. Each is a separate
named section with an H2, not an ARIA widget or a draggable panel. Arrival art is
outside these six data boundaries. Do not manufacture an empty position when a
card is deliberately absent in an intermediate implementation phase.

### Wide desktop: 1440 × 900

- Workspace: maximum **76rem**, centered inside safe-area-aware gutters of
  `clamp(20px, 4.4vw, 64px)`; 24px top/48px bottom at ordinary text. Card grid
  gaps are 24px, section row separation 28px. Type/spacing scale with text;
  artwork retains a 192px cap and hit targets retain a 44px floor. Use layout
  height, never viewport-height clipping.
- Arrival: two columns, invitation taking remaining width and art at **26% of
  the row, capped at 192px**. Gap 24px; art is square, `object-fit: contain`, no
  crop, recolor or mask. Invitation **56px/1.05 maximum**, IM Fell/Lantern,
  no supporting paragraph. The row follows its content, approximately 192px tall
  at this width rather than the incumbent 512px art/large top margin.
- The grid's own available width determines columns: **66rem or wider: three**;
  **44rem to below 66rem: two**; **below 44rem: one**. These are font-scaled
  container thresholds, not device labels or JS viewport guesses.
- Quick Actions spans all columns. Use a section rule and compact heading, then
  a wrapping strip of descriptive buttons; no enclosing raised rectangle.
- At three columns: Inspiration, Prompts and Current Goals each take one column.
  At two columns: Inspiration/Prompts share a row; Goals spans the next row.
  At one column: all follow source order. Do not stretch the three cards to equal
  height or crop long content merely to preserve a horizontal baseline.
- Recent captures takes one column; Recent conversations spans the remaining
  two on the three-column layout. In the two-column layout each takes one.
  At one column they follow source order. Each surface is content-height; one
  page scrollbar. Ten conversations are ten visible rows, not a carousel or an
  internally scrolling card. The page may be longer than one viewport.

### Phone: 390 × 844 and 320 × 568

- Header wraps exactly as the incumbent shell does; all four labels keep 16px
  ordinary text and 44px minimum targets. At 320px it may occupy more than one
  navigation line. No label shrinking to make a screenshot fit.
- Ground gutters **20px plus safe-area clearance**. Available card widths are
  350px / 280px respectively. Top inset 20px, grid gaps 24px. No fixed heights.
- Arrival keeps invitation beside the full image, using the same 26% art column
  (about 91px / 73px). Invitation has a **32px minimum** and wraps naturally.
  Artwork does not become a full-width block ahead of useful content. Its alt
  text remains the existing concise description; do not duplicate it as a caption.
- Quick Actions buttons wrap and each takes full width below a **26rem** content
  width. Button description is first and skill reference second, both visible.
  No horizontally scrolling command strip, tooltip-only explanation or ellipsis.
- Quote, question, goals, five captures and ten conversations remain in page flow.
  In each conversation row the title/time precede a wrapping action line when
  its own width is below **27rem**. Resume and Delete never overlap title text.
  Captures show a bounded excerpt but the timestamp/source identity wraps fully.
- No sticky card toolbar, fixed bottom action or persistent job/status footer.
  Keyboard focus scrolls normally; the app skip link targets the real main.

### Landscape, zoom, text and content extremes

At **844 × 390**, ordinary text may yield two columns where the actual content
width reaches 44rem; it is acceptable to scroll beyond the screen. At **200% text**
the same container thresholds must reduce columns; do not rely only on CSS px
media queries. At 320px, 390px and landscape with enlarged text, preserve 44px
targets, natural header height, full control labels and ordinary page scrolling.
When the actual Ground width falls below **14rem** (for example phone at 200%
text), give the invitation the full width and move the small 26%-width artwork
after it, aligned to the end. This prevents splitting “thread” into isolated
letters merely to keep the image beside it; the artwork still never becomes a
full-width interstitial. At ordinary 320/390px text it remains beside the invitation.
Do not subtract a guessed header from `100vh` or introduce card-local vertical
scrollbars. Long unbroken text wraps; tables/code in Goals alone can scroll
horizontally inside the established accessible renderer.

Type: H2 18px/1.4 Source Sans semibold; controls/prose 16px/1.5; secondary
timestamps/skill references 14px/1.5, never reduced to fit. Quote 20px/1.6 Libre
Baskerville, attribution 16px Source Sans. Prompts question 22px/1.35 Source Sans.
Goals uses safe Markdown with a local, compact heading scale beginning at 22px;
it does not reuse the large Recall page spacing blindly. No font synthesis.

## Six card contracts and material states

These are UI requirements, not resource grammars, SQL schemas or endpoint names.
The technical contract owns exact filenames, parsing limits and response shapes.
The proposed `03_Resources/Memory-Loop/` defaults remain valid planning inputs.

| Card | Required presentation data and ready treatment | Empty / missing / malformed |
| --- | --- | --- |
| Quick Actions | Ordered stable action identity, skill reference and plain descriptive text. The description is the button's primary label; show the skill below in Source Sans. Native buttons, not fake links. Activate a fresh-chat prefill with **only the skill reference**; description is not sent or inserted. | Empty: **No quick actions yet.** Missing: **Quick Actions file not found.** Malformed: **Quick Actions couldn’t be read.** Show the designated relative resource path once in the missing/malformed state and a concise safe authoring error supplied by the reader. No Create file/Edit config button. |
| Inspiration | One daemon-selected quote, nonempty attribution, optional supplied source title/URL. Parchment field, Night text/focus; quote and attribution together. A supplied safe HTTP(S) source may be a small **Source** link with an accessible new-tab indication. No browser-generated attribution or quote. | Empty: **No inspiration yet.** Missing: **Inspiration file not found.** Malformed: **Inspiration couldn’t be read.** Never display a quote stripped of attribution. Retain a previously validated attributed selection on a transient refresh failure, with a local exception. |
| Prompts | One complete selected question, displayed as a large, left-aligned native button with a quiet drawn arrow. Accessible name includes the actual question; full text wraps. Activates a fresh-chat prefill containing that question only. | Empty: **No questions yet.** Missing: **Prompts file not found.** Malformed: **Prompts couldn’t be read.** No fabricated question or disabled pretend question. |
| Current Goals | Bounded raw Markdown from the designated resource and its read state. Render safe CommonMark/GFM with existing link/image/raw-HTML policy. Task boxes are read-only. H2 names the card; source headings begin at H3, with the same cap at H6. | Empty: **No goals written yet.** Missing: **Goals file not found.** Malformed refers to a reader/encoding/limit failure, not ordinary unconventional Markdown: **Goals couldn’t be read.** No goal editor, completion toggle, percentage or simulated checkbox action. |
| Recent captures | At most five actual timestamped entries across dated Inbox files, ordered newest first. Each needs stable entry identity, full timestamp, bounded plain excerpt and actual source-note address/path. A full row is one native Recall link; accessible name distinguishes same-note entries by timestamp. Excerpt can be three lines (server-bounded text); source path/time wrap fully. No generated note title or file-mtime substitution. | Empty: **No captures yet.** Optional real **Open Capture** link. Missing Inbox: **Capture folder not found.** Unreadable/malformed source coverage must not silently masquerade as no captures; show a local safe notice. If returning partial entries is technically supported, label **Some captures couldn’t be read.** Never invent five rows. |
| Recent conversations | At most ten newly registry-owned chats by meaningful activity; stable opaque identity, honest title or **Untitled conversation**, full accessible recency, authoritative resume/delete availability and protection reason. Title is text; separate **Resume** native link when a valid destination exists, and **Delete** button. Current selection can say **Current in Think**. Generated daily/weekly sessions and legacy chats are absent. | Empty: **No recent conversations yet.** No migration pitch, broken sample rows or synthetic older history. Unavailable registry: **Recent conversations couldn’t be loaded.** A corrupt/unavailable individual record gets an honest local unavailable state if supplied; do not resume another identity. No old-data deletion controls during uncertain refresh. |

### Loading, refresh and failure shared grammar

- Every card owns loading/error/empty and a render-failure boundary. One failed
  resource, component or list never removes usable siblings or disables Capture.
  Ground host holds composition only; it does not fetch all data as an all-or-none
  prerequisite. Readers, weighted selection and schedules belong to the daemon.
- On first load keep the heading and show one plain local **Loading…** line,
  named for the card through section semantics. No fake text skeleton pretending
  to be a quotation or activity. Mark the affected region busy, not the whole page.
- Transport failure: **[Card name] couldn’t be loaded.** with a native **Retry**
  button scoped to that read. A retry is not a job run, quote regeneration,
  conversation creation or resubmission. Missing/malformed files offer **Check
  again** to reread after the user fixes the ordinary file elsewhere; the app does
  not initialize or overwrite it. Safe relative paths wrap; no stack traces.
- During routine refresh keep validated content and avoid a flashing loading
  replacement. On refresh failure append **Couldn’t update. Showing the previous
  version.** Do not claim content is current. Cached chat data never authorizes
  Delete: unavailable/unknown execution or selection authority blocks it.
- A confirmed missing/deleted resource replaces stale content with its honest
  missing state. Do not retain disappeared personal content indefinitely under
  the label “previous version.” No localStorage vault-content cache.
- Quote and prompt each select **once when Ground is entered or explicitly
  refreshed**, with weights 1…N and at most 50 entries. Unrelated rerenders, list
  refreshes, confirmation toggles and quote-source clicks do not reshuffle them.
  A card's failed-read retry can complete its pending selection, not quietly
  reroll a successfully displayed sibling. No shuffle button, favorites or
  “updated today” claim. Persisted resources remain readable if automatic jobs
  are down; no job queue, cron badge or generation control appears here.
- No global spinner/empty-dashboard substitute. A truly shared outage may have
  one short service exception, but card content, navigation and local recovery
  remain reachable. Do not add six identical alert banners when one cause is known.
- Updates do not steal focus. Use concise polite announcements for requested
  refresh, handoff and deletion results, not six assertive loading alerts or a
  live region containing whole quotes/goals/lists.

## Think handoff: preserve intent, never send

### Deliberate shared-session action

Quick Actions and Prompts invoke one intentional action on the persistent Think
session: **open fresh with prefill**. Resume selects the exact registered chat
through that session. Do not navigate to bare Think and then overwrite whatever
editor happens to mount, pass prompt text in a URL, auto-send, or use local card
state as conversation ownership. The shell must preserve selection protection
even while Ground is visible.

**Explicit behavior distinction:** the existing Think **New chat** button keeps
its approved **Keep writing / Discard & start** flow. Do not silently change it.
Ground's distinct prefill/resume actions preserve the previous conversation's
keyed in-memory draft, which the existing session already supports for selection.
The new action must not call its draft-deleting New chat branch as a shortcut.
This does not introduce persisted drafts or change reload/browser-close loss.
If implementation cannot preserve both old/new draft versions without changing
the existing New chat behavior, stop that shared-behavior change for a bounded
user choice; resource cards and this layout are not blocked by that question.

### Confirmation and transitions

1. Capture the requested action identity, prefill and the current identity/draft
   version. **Any nonempty string, including whitespace**, needs the draft
   safeguard when changing chats. Empty draft permits immediate handoff. Resuming
   the already selected chat is just returning to Think; no discard confirmation.
2. Show one inline confirmation in the initiating card, directly after the
   activated button/row, using the current confirmation vocabulary, not a new
   modal: **Start a new chat? Your draft stays in the current chat.** or
   **Open this conversation? Your draft stays in the current chat.** Buttons:
   **Cancel** and **Start new chat** / **Open conversation**. Give the group an
   accessible name; focus Cancel. Another activation must not silently replace
   the pending target. The user cancels first.
3. Cancel/Escape leaves identity, draft and navigation unchanged and returns focus
   to the initiating control. It does not navigate back to Think as a side effect.
4. On confirmation, preserve the old draft under its own chat. Bind one pending
   creation to one command/identity and captured prefill; repeat clicks cannot
   create more chats. Show **Starting chat…** / **Opening conversation…** locally;
   block only that pending handoff, not other card reads or navigation.
5. Keep the originating selection/draft intact until the handoff can safely
   commit. If the user edits after the captured confirmation version, changes
   selection, navigates away or initiates another valid context change while
   waiting, fence the delayed completion: do not redirect them or overwrite
   newer text. Preserve both texts under their rightful identities; re-confirm
   if completing the context change now needs another decision. No late callback
   can merge a prefill into an existing conversation's editor.
6. On successful fresh handoff, assign prefill **once** to the new conversation's
   draft. User typing while creation/lookup is pending takes precedence: initialize
   before editing, or require an unchanged target draft version; never “reapply”
   prefill after an acknowledgement or reconnect. Resume instead restores the
   target chat's own draft; it never imports the old chat's text.
7. Move to the exact Think conversation URL and focus the Message editor once
   ready, caret at end of its draft. Keep it editable while loading; Send follows
   existing authoritative eligibility. Previous work continues; the action issues
   **no Send and no Stop**, regardless of old or new busy state.
8. A definitive failure shows **Chat couldn’t be started.** / **Conversation
   couldn’t be opened.** beside the initiating action. Retain recoverable old and
   pending text. For uncertain creation, **Check chat** reconciles the same
   command/identity, never creates a second chat or resends. Do not show success
   or change identity merely because a route exists. Technical contracts settle
   receipt/retry details without weakening these safeguards.

## Recent conversations: resume and irreversible paired deletion

- Stable rows show the real title, recency and actions. Relative time can be
  displayed, with a full localized date/time available accessibly; no polling
  timestamp is treated as meaningful activity. No title-edit, archive, search,
  bulk-delete, All chats link to nowhere or “ten saved” counter.
- **Resume** opens that exact registry-owned conversation after restart as well
  as within one browser session. Loading/unavailable/deleting are real states,
  not a fallback to a new empty chat. No legacy migration or automatic replay.
- Delete stays visible but unavailable for **Current in Think**, **Open in Think
  elsewhere**, **Work in progress**, or **Work status unavailable**, as appropriate
  to supplied authority. Expose the reason as visible text and an accessible
  description, not a tooltip only. Use `aria-disabled` with guarded activation
  if keeping it focusable; absence of focus must not hide the reason. No Stop
  suggestion/action to make deletion possible. Selected protection applies even
  while the user is on Ground; unknown status is not permission to delete.
- Eligible Delete opens a compact **modal confirmation**, because this removes
  both a chat and its ordinary vault file. Title: **Delete “{conversation title}”?**
  Body: **This deletes the conversation and its transcript file. This cannot be
  undone.** If untitled, include the safe date/time to disambiguate. Show the
  vault-relative transcript path only when supplied and helpful; never a private
  absolute metadata path. Buttons: **Cancel**, **Delete conversation**.
- Initial focus Cancel; contain Tab/Shift+Tab within the dialog, Escape cancels,
  return focus to the original Delete control. No typed-name exercise, double
  confirmation, red invented palette or automatic focus on the destructive action.
  Deletion can use a clearly labelled outlined button in the existing palette;
  dangerousness is in wording, separation and confirmation, not color alone.
  The dialog is at most 32rem wide with 20px viewport clearance and padding capped
  at 24px, including enlarged text. Action inline padding caps at 14px so labels
  wrap at spaces rather than splitting “Cancel.” A short/enlarged dialog may scroll
  vertically within the viewport; this is not permission for scrolling card bodies.
- Confirm submits one target-bound deletion. The daemon rechecks ownership,
  all protected selections and native execution status. If the target becomes
  selected/running/unknown, keep it and explain the returned reason; no implicit
  Stop and no dismissal-as-success.
- While the operation is accepted/pending, keep the row and show **Deleting…**;
  disable that row's Resume/Delete. Do not optimistically remove it. Close the
  confirmation after authoritative acceptance, announce progress once and focus
  that row's status. Escape/dismissal is never a claim to cancel accepted deletion.
  Other cards and nonconflicting rows remain usable.
- Partial/uncertain deletion: **Deletion isn’t complete.** with the supplied safe
  outcome/recovery action. Keep a content-minimized row, no Resume if the chat is
  deleting or partially removed. Do not claim “nothing was deleted,” offer Undo,
  expose original private content, or blindly create a second deletion command.
  Technical contracts own reconciliation and durable cleanup, not the card.
- Remove the row only when both owned chat/transcript removals and logical
  private-content cleanup are confirmed. Announce **Conversation and transcript
  deleted.** If focus is within the removed row, move to the next row's Resume,
  otherwise the previous row, otherwise the section heading. Do not disturb focus
  elsewhere. Refill up to ten from the authoritative list without shifting focus
  to an unrelated new first item. Item eleven aging into/out of view never deletes.

## Accessibility and interaction finish requirements

Native links for Recall/valid Resume destinations and buttons for commands;
no `role=toolbar` unless its full arrow-key pattern is deliberately supplied.
Quick Actions is a wrapping group of ordinary tab stops. Avoid nested links/buttons
and clickable card containers. Plain descriptions are associated with their
controls. Every control has a minimum **44 × 44px** hit area; wrapped controls
grow vertically, targets do not overlap. Tab order follows the DOM order above.

Dark focus: 2px Horizon with 4px clearance; Parchment quote/dialog focus: Night.
Navigation keeps its incumbent inset focus; focus must remain distinct from
the selected underline. Hover underlines text links and gives buttons their
contextual reverse state; no hover-only action. No opacity-only unavailable
reason. Preserve native text selection, high-contrast readability and keyboard
scrolling. An empty/missing card still has a name and useful text, not a blank box.

## Artifact evidence and implementation handoff

The static artifact has a clearly separated design-review notice, not product
chrome. Its representative content is fictional, except the explicitly attributed
public-domain Emily Dickinson quotation, used as layout text rather than evidence
that scheduled sourcing was verified. All sample actions are intercepted and
report their inert nature outside the product composition. No live app imports,
service calls, browser storage, new imagery or asset copies are used.

Before evidence uses the current Ground placeholder source and current stylesheet;
after evidence uses this bounded design CSS. This is a source-backed comparison,
not a capture of the running app. Assets/fonts are referenced from existing local
`public/` files; their existing rights/provenance are unchanged.

Likely implementation surfaces: `src/views/GroundView.tsx`, focused `src/ground/`
modules, Ground-only rules in `src/styles.css`, persistent Think
`session.ts`/`types.ts`/`presentation.tsx`, and narrowly needed shell/confirmation
presentation. Reuse safe Markdown, but make heading depth/style contextual without
changing Recall/Think output. Technical contracts follow this document; they own
resource grammar, BFF/daemon reads, SQLite lifecycle, selection protection and
job publication. No scheduler or registry internals become dashboard controls.

Intermediate resource-dashboard delivery omits Recent conversations entirely until
real durable listing/resume exists, as the approved plan requires; do not ship this
artifact's fictional rows or functional-looking unavailable capability. Final
acceptance requires all six real cards and their real integration paths.

Author validation receipts are recorded after rendering below. They establish
only this static composition's geometry, resources and sample behavior—not runtime
handoff/deletion, physical-device, assistive-technology or WCAG acceptance. Fresh
independent design review follows technical contracts; no Bead closure or commit
is implied by authoring this draft.

### Author validation receipt — 2026-10-31

- **Inputs:** source-backed before inspected against `src/views/GroundView.tsx`,
  `src/components/PlaceholderNotice.tsx`, the current shell and `src/styles.css`
  at checkout HEAD `4d51bbf`. The before artifact is intentionally not a runtime
  screenshot. Before A.1 rendered at 512px desktop / 350px phone; after at
  192px / 91px, with its full aspect ratio preserved.
- **Actual renderer:** installed `/usr/bin/chromium` through the existing
  Playwright package, loading local `file:` artifacts only. No server started,
  packages installed, external HTTP requests or application state used. Two
  approved illustrations and all four existing font faces loaded successfully.
- **Rendered sizes:** 1440×900, 390×844, 320×568 and 844×390, each at 100% and
  200% root text. Actual normal-text card columns were three / one / one / two;
  all enlarged cases reduced to one. All eight final cases had document width
  equal to viewport width and no script errors. Product controls measured at
  least 44×44px. State examples at 390px covered loading, empty, missing,
  malformed, long and independent failure without removing the six sections.
- **Looked at:** desktop/phone populated composition and source-backed before;
  phone empty/loading/missing/malformed/mixed/long examples; enlarged phone
  product-top crops; ordinary/enlarged landscape; prefill safeguard and delete
  confirmation. Initial narrow enlarged invitation and dialog-label wrapping
  were corrected. The short landscape intentionally scrolls: Quick Actions
  begins 313px below the product top and its actions need a small initial scroll.
  Enlarged phone similarly prioritizes readable text, not above-fold promises.
- **Sample behavior:** keyboard activation focused Cancel for prefill/delete;
  Escape returned focus to the triggering control; selected/running/unknown
  Delete remained unavailable and keyboard-guarded; sample Delete left all ten
  fictional rows intact. Native reverse-Tab initially failed the exact focus
  cycle; explicit sample dialog containment corrected it and forward/reverse
  checks passed. The 320px/200% dialog had no horizontal overflow; labels remained
  readable and its content scrolled vertically within a 526px interior height.
  These demonstrate presentation only, not real handoff/lifecycle safety.
- **Solid-pair contrast:** Parchment/Night 17.59:1; Lantern/Night 10.47:1;
  Horizon/Night 5.54:1; Weathered Ivory/Night 12.59:1; Muted Night/Parchment
  9.32:1. This is not a whole-surface WCAG or assistive-technology verdict.
- **Mechanical detector:** ran once on the four artifact sources. Its ten
  findings were retained for review, not “fixed” by restyling the approved world:
  inherited rule/Weathered Ivory pairs are documented in DESIGN.md prose;
  IM Fell/Libre font warnings truncate the already approved family names;
  flat-type warning counts the hidden H1 and misses the visible invitation;
  hidden-dialog border black is not the visible Night button treatment; the
  before artifact's 5px Capture-link radius is incumbent source, not a new token.
  No detector config/ignore rule or global design-system file was changed.
  The final dialog focus/spacing correction was checked directly afterward,
  without a second detector run.
- **Receipts:** `/tmp/opencode/ground-design-9ya1/geometry-and-interactions.json`
  contains viewport/resource/state/contrast measurements and the initial
  reverse-Tab finding; `final-acceptance.json` records its correction and the
  final focused checks with **zero failures**. Screenshot names in that folder:
  `before-desktop.png`, `before-phone.png`, `desktop.png`, `phone.png`,
  `small-phone.png`, `landscape.png`, their `-text200` equivalents,
  `phone-{loading,empty,missing,malformed,mixed,long}.png`,
  `phone-confirm-prefill.png`, `phone-confirm-delete.png`, and
  `small-phone-text200-confirm-delete.png`. `*-composition.png` omits only the
  outer review notice; `*-viewport.png` preserves the exact viewport. These are
  static design evidence, not shipping assets.

**Limits:** no production code/tests, build, `.next`, private configuration,
daemon, native model, personal vault, proxy or deployment was changed or
validated. Physical devices, browser zoom distinct from root-text enlargement,
screen readers, real malformed-resource parsing, durable resume/deletion and
scheduled jobs remain outside this author's assigned validation. The brief stays
draft pending the planned technical contracts and fresh independent design review.
