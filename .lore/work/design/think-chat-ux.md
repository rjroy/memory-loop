---
title: Think — conversation, open draft and honest continuity
date: 2026-10-30
status: draft
tags: [think, ux, responsive, chat, accessibility, design]
related: [.lore/work/intents/think.md, .lore/work/design/think-execution-reconnect.md, .lore/work/design/think-transcript-persistence.md, .lore/work/design/think-permissions-context.md]
---

# Think: leave room for the next thought

Design-only proposal for `memory-loop-42j.4`, following the user's request to design the UX now. No app implementation, new integration contract, asset generation or activation. The [static review examples](think-chat-ux/index.html) contain explicitly fictional conversation text and inert sample actions. They are not a functioning chat client.

**User-directed space revision:** the prior draft and review receipts were not user approval. The user asked for substantially more dialogue space: a one-line growing editor with Send/Stop on its right, no routine Think section header, help disclosure, explanations or saving footer, and New chat in existing spare space. This revision replaces that composition rather than defending it. Ordinary transcript I/O retries are now daemon-owned automatic bounded-backoff work; the parallel transcript design owns their technical details. There is no public Retry logging control or endpoint in this UX.

## Authority and direction

The current [intent](../intents/think.md), approved [execution/reconnect design](think-execution-reconnect.md), [transcript draft](think-transcript-persistence.md) and [permissions/context draft](think-permissions-context.md) supply the behavior. This UX does not approve those adjacent drafts or claim their capability gates have run. Later settled choices in those documents supersede the intent's earlier open-question wording. PRODUCT.md remains useful product/brand context but its older stack and unimplemented-capability descriptions are not the current Think technical contract. Existing [DESIGN.md](../../../DESIGN.md), the [approved character board](memory-loop-character/index.html) and [character integration](character-integration.md) supply visual authority.

**Modes:** Operate while composing/controlling a run; Read while following or revisiting its output. One personal user, often on a phone, sometimes reading older text while the AI works. Success: know whose words these are, keep writing, understand what is actually known, and never accidentally resend or stop work.

### Direction contract

**Thesis:** give the dialogue the work area. The only permanent chat controls are New chat and a one-line growing editor with Send/Stop beside it. No chat-management sidebar, section-status header, help feature, split inspector or routine footer. Service machinery earns space only when the user needs to act or understand an exception.

**Own world:** preserve the compact A.5/IM Fell identity and horizontal Ground/Capture/Think/Recall top navigation, Night frame, cool 10% Horizon / 90% Night Think field, Parchment ink and Horizon focus/location. A questioning IM Fell invitation and unchanged Guide mark welcome a new thought; they give way to the conversation rather than becoming a watermark. Source Sans carries controls and prose; Libre Baskerville carries Markdown headings, not every label. No new art, palette, theme or generic white chat surface.

**Story:** arrive at a fresh conversation → write → send once → follow AI text and clearly identified activity → draft the next thought while waiting → explicitly Send after the run settles. A lost connection changes what can be known, not who owns execution.

**First viewport:** unchanged branded top navigation, then the dialogue with no intervening Think bar. New chat sits in the existing left margin on a roomy desktop; when that margin is unavailable it uses spare space in the existing app banner, not a new row of chat chrome. The compact composer sits immediately below the reading scroller with Send/Stop on its right. An empty chat can show “What else could this become?” and the small Guide mark, without extra instructions. Nothing reserves that space once messages exist. Routine connection, drafting and logging explanations are absent.

**Form:** a familiar chronological conversation, extended inside the approved Think world. Brief-pinned shell/behavior, code-led static examples; no identity replacement or concept lottery. The signature is continuity of the open draft against a changing conversation, not decorative animation.

**Review boundary:** a bounded draft and inspected static examples, then parent-owned fresh design review and technical interaction check. Neither this document nor a polished example authorizes production work or constitutes acceptance.

## Composition and exact responsive handoff

### Desktop, 1440 × 900

- Retain the production top banner's proportions: 40px A.5, 28px IM Fell wordmark, 16px native navigation links with 44px targets; Think has the Horizon underline and current-page semantics. No left app rail, phone bottom tabs or prior-chat list.
- Dialogue starts directly below the app banner. Think remains the active app destination and has a screen-reader-accessible H1/focus anchor, not a visible full-width section header. Remove the Chat details feature entirely; do not relocate its commentary into another menu or panel.
- Place **New chat** in the already-empty left gutter, 32px from the viewport edge and 16px below the banner, only when the actual font-scaled gutter can fit it with clearance from the centered lane. The example uses a shell container threshold of 76em so enlarged text changes this decision too. No column/rail width is allocated. At 1440px/normal text this is outside the 52rem reading lane; it never overlays messages, the editor, focus targets or scrollbars. Without that spare gutter, the same single control sits in unused app-banner space. It never becomes an extra Think header.
- Center a conversation/composer lane at **52rem maximum**, with **68ch maximum prose**. Use 32px desktop workspace gutters. User entries are a quiet inset Horizon-tinted field, with left-aligned text and visible **You** attribution. AI text is unboxed on the cool field with visible **AI** attribution. Roles, spacing and accessible labels distinguish them even without color.
- Use 17px / 1.65 Source Sans prose. User/AI role labels are 14px semibold. Separate messages by 24–32px, paragraphs by about 1em; keep metadata/tool rows at 14px / 1.5. No avatar column repeated on every message, oversized floating bubbles or timestamp on every streamed fragment.
- The composer is one compact grid row, not an overlay: a screen-reader **Message** label, a textarea starting at one comfortable line (46px at normal text), and **Send / Stop immediately to its right** in the same row. The action is at least 44px and stays bottom-aligned as text grows. Grow only as the draft actually wraps or gains new lines, up to the smaller of 12rem or about 30% of available viewport height, then scroll the editor itself. Emptying the draft returns it to one line. It stays editable in every state.
- No separate visible label row, action row, keyboard hint, “you can draft” explanation, saving line or routine footer. A genuine exception may add one concise wrapping note immediately above the row, associated with the affected control; it never overlays content. Healthy work is quiet.

### Phone, 390 × 844 and 320 × 568

- Keep the same horizontal top navigation, wrapping under the wordmark as the existing shell does. Do not reduce navigation text to fit. Use safe-area-aware **20px** side gutters; message insets can be 16px inside the lane. **New chat uses the spare right side of the existing wordmark row**: text label at 390px; a drawn plus in a 44px target at cramped widths such as 320px, with accessible name and native tooltip **New chat**. The wordmark and four destinations stay intact; no chat toolbar or bottom navigation is added.
- Navigation and the one New chat action precede the conversation and compact composer in logical focus order. The lane becomes full available width. Send/Stop stays to the right of the editor even at 320px; the input takes the remaining width and grows only for actual text. No independent tool pane, side drawer or chat switcher.
- The empty invitation is **42px** IM Fell on phone (54px desktop); A.5 is 56px (64px desktop). At small/short heights it remains in the conversation flow, not a fixed hero reserving space. An existing conversation never reserves its space.
- At normal portrait sizes, the conversation is the only reading scroller. The composer has its own bounded text-editing overflow; code/tables may have local horizontal scroll. These are content needs, not unrelated panes.
- Use actual banner/composer heights, `100dvh` with an appropriate fallback, and safe-area padding. Never subtract guessed header heights or absolutely position the composer over the last message. Reserve the compact composer and any real exception's space in layout, not permanently empty rows.
- At short height, enlarged text, an expanded notice, or an OS keyboard leaving insufficient room for a useful reading area, allow **one ordinary page scroll** rather than a zero-height transcript or clipped composer. The same composer stays in document flow; the top app header can scroll off, but never becomes bottom navigation. A focus-only **Skip to message** link and ordinary focus scrolling keep the editor reachable. Minimum 44px controls and rem-scaled text remain intact. At 844 × 390 / 200% text the full layout can exceed one screen; reachability and no overlap are the requirement, not cramming everything into 390px.
- Virtual keyboards vary. Prefer browser viewport resizing/focus scrolling; use VisualViewport measurement only if real-device evidence requires it, with listener cleanup and no double application of keyboard offsets. Do not continuously scroll the whole page in response to token/viewport events. Physical iOS/Android keyboards, safe areas, zoom and assistive technologies remain to be tested; static Chromium cannot certify them.

## New chat, draft and sending

**New chat is a context change, not Stop.** Its accessible name is exactly New chat, including when only the plus is visible. Without a draft it starts the new conversation directly. If old work was active, announce **“New chat. Previous work continues.”** once through the polite status, not a permanent visible banner. This is not a link to an old chat and does not imply a return interface exists. No previous-chat list, recent-chat menu, “resume” button or Ground substitute is added.

With a nonempty unsent draft, show a small inline confirmation beside the current composer: **“Discard this draft and start a new chat?”** Actions: **Keep writing** (safe/default) and **Discard & start**. This protects actual user text, not permissions or a tutorial. Do not copy the draft into the new conversation, auto-save it as a message or Stop the old run. Escape/Keep writing dismisses and returns focus to the editor; the explicit discard action is the only discard. No modal, typed confirmation or warning for an empty draft. A failed new-conversation creation shows its own compact retry/check state and never changes the old run's fate; it does not silently fall back to the old identity or resurrect a discarded draft. The absence of prior-chat resume remains a scope fact here, not repeated interface commentary.

The current draft lives in Think presentation memory, keyed by the current conversation, through SPA navigation and browser reconnect. Hard reload/browser closure loses unsent text. This is the retention contract, not a reason to add a help feature, persistent warning, browser draft database, outbox or global leave guard. Once the New chat discard action is confirmed, the old draft is intentionally discarded.

### Composer interaction

- Accessible label **Message** (visually hidden), placeholder **“Follow the thought…”**. Neither placeholder nor color is its only accessible label. Input, selection, clipboard and ordinary editing remain available while working, waiting, stopping, disconnected, denied or unavailable. Never set the textarea to disabled/read-only because Send is unavailable.
- **Enter inserts a line break everywhere; Shift+Enter also inserts a line break.** Send is an explicit button, with **Ctrl+Enter / Cmd+Enter** as an eligible-Send-only hardware shortcut. This lets the user write freely while the action changes to Stop, avoids guessing keyboard type from viewport width, and makes the phone/IME rule consistent. Respect `isComposing`/composition events and ignore repeated shortcut keydowns; the Enter ending IME composition never sends. Neither Enter nor the Send shortcut ever activates Stop. The shortcut may be in the button's accessible description/native title; it gets no permanent hint row.
- Send requires non-whitespace text, an available current conversation and authoritative eligibility. New chat creation/cold lookup may show Send unavailable without blocking typing. At most one unresolved Send/run per conversation; no follow-up queue, offline sending or auto-send after reconnect/Stop/answer.
- Capture an immutable submission on activation. Show it once as **You** with a receipt status, not a duplicated optimistic/final pair. Clear only the captured draft version when daemon registration is confirmed; retain newer edits. While the receipt is unconfirmed, retain the submitted text and label it **“Checking whether your message was received…”**; newer writing stays a separate draft, not a queued send. If registration is later confirmed, do not delete newer typing or show the same user message twice.
- On definitive rejection, show **“Message wasn’t accepted.”** with a safe reason. If the editor still contains the same submission, leave it there. If the user has written something else, offer **Use unsent message** on that rejected entry: restore only into an empty editor; otherwise ask inline before replacing the newer draft. A deliberate corrected Send uses a new command. Ambiguity never gets a Resend/Retry generation button.
- Activation never moves focus to each incoming message. After Send keep focus in the editor. When Send changes to Stop under a focused control, keep a stable action area but do not let a held/repeated Enter activate Stop: suppress repeat activation and require a fresh explicit Stop press. Stop is never the textarea's Enter action.

## Status language: three facts, not one spinner

**Admission**, **run state**, and **monitoring** remain separate in the state model; preview completeness and logging health are separate again. That is a technical contract, not five visible status widgets. Normal operation needs no Connected/Ready/Response complete line: the conversation and Send/Stop carry it. Show compact message-local or composer-adjacent exception text only when it changes what the user can do or trust. No percentage/countdown guesses or “stopped” inferred from a closed connection.

| State / evidence | Visible treatment and action |
| --- | --- |
| Fresh, usable conversation | Empty invitation and compact editor, no Ready/saving/help line. Send enabled only for eligible text. Transcript has not started. |
| Creating a new conversation | **Starting chat…**. Editor available, Send unavailable. A lost create response checks the same identity; no second random creation. Creation failure offers explicit **Try starting chat again** for that same create command; New chat remains a separate deliberate action. |
| Cold current-conversation lookup | **Opening current chat…**. Named loading region, no false “no messages” empty state. Composer available, Send unavailable until authoritative state arrives. Never auto-create an unknown existing identity. |
| Send registered / accepted, not yet agent-admitted | Message-local **Waiting to start** only while needed. User entry is registered, not “AI read it.” One occupied admission slot. Stop replaces Send for that accepted operation where reachable. |
| Send receipt or upstream admission uncertain | Message-local **Checking message receipt…**. Receipt/snapshot checks, no duplicate/resend button or second explanatory paragraph. No fresh Send; offer Stop only if a target run is known and the daemon can receive the request. Without a known target show unavailable **Checking…**, not an invented Stop target. |
| Connected, working | Stop beside the editable input. A small current tool summary or inline streaming mark in the AI response is sufficient; no extra AI-working, Connected or draft-help bar. Native retry/compaction remain this run, not new user messages. |
| Browser watch reconnecting, last known working | One concise exception: **Reconnecting. Work may continue.** Keep observed content and draft. Stop remains enabled if the command endpoint is independently reachable/target known; if not, unavailable Stop and append **Stop unavailable** to that same note. Never queue a Stop for automatic delivery. |
| Snapshot resynchronizing | **Catching up…**. Replace/merge authoritative state by stable identities before healthy following; do not append duplicate history. Disable new admission until eligibility is known; target-specific Stop may remain available if the daemon can validate it. Do not replace the whole lane with a spinner or clear the draft. |
| Daemon-to-OpenCode live-preview gap | Part-local **“Partial response · catching up”**. Keep observed text, but never append a suffix as if the gap were continuous. Replace that part with its canonical full value when available. This is not an AI failure, browser disconnection, or proof of logging success. |
| Service missing/incompatible or setup required, before work | **Think is unavailable** plus a safe reason and **Check connection** / operator setup guidance. Editor available; Send unavailable. Recall/global navigation still work. No browser credentials/settings editor or service auto-start. |
| Daemon epoch / upstream process changed; continuity unavailable | **Service changed; outcome unknown.** Keep available text/draft, no fake empty chat, stopped result, automatic attach/create/resend or promise that restart restores work. Stop unavailable unless the service later supplies a valid controllable target. New chat is explicitly a different identity, never disguised recovery. |
| Authorization denied | **“Access to this chat was denied.”** Stop automatic reconnect attempts; retain editor/draft. Explain access must be corrected before **Check access**. Do not mislabel denial as endless reconnecting or expose private diagnostics. |
| Invalid/unknown current conversation | **“This chat couldn’t be opened.”** Explain invalid address/not available safely. Explicit New chat is possible; never create under the supplied existing ID or attach an arbitrary TUI session. |
| Final response / native execution completed | Restore eligible Send and preserve draft, with no routine completion banner. Do not claim All work finished: background activity can later update the same conversation. No application turn cap or conversation reset. |
| Run failed | **“Response ended with an error.”** Keep partial text and specific safe failure class. Stop is no longer offered for a confirmed terminal. Any next Send is deliberate; no automatic regeneration or hidden retries beyond native observed behavior. |

### Stop outcomes

Stop is labelled **Stop**, not Cancel all. It targets the current known `runId`, uses a new Stop command identity and never fires on navigation, tab closure, reconnect, a transcript error or New chat.

| Evidence | Treatment |
| --- | --- |
| Explicit request being registered/settling | **Stopping…** in the same action position; prevent duplicate activation, keep editor usable. No second redundant explanation. Acknowledged interrupt alone is not Stopped. Lost acknowledgement is checked, not automatically issued against a newer run. |
| Confirmed interruption / cancelled before delivery | **Stopped** / **Stopped before starting**. Preserve observed/canonical text and tool facts. Restore eligible Send; never auto-send the draft. |
| Completion won | Message-local **Finished before Stop took effect.** Keep the result; do not relabel it Stopped. |
| Stop request definitively failed while same run remains controllable | **“Couldn’t request Stop. Work may still be running.”** Explicit **Retry Stop** targets that same run, after current-state validation. No generic Retry that could restart generation. |
| Outcome or delivery still unknown | **“Stop outcome isn’t confirmed.”** Keep checking authoritative state; no success claim. Offer manual Retry Stop only when the daemon can safely identify/control the target, otherwise an unavailable action with the reason. |

Stop is best effort: it cannot undo changes already made, and some background work may continue. This remains a behavior contract, not persistent interface prose or a help disclosure. Do not add a confirmation gate to every Stop or promise rollback/killing every descendant.

## Messages, Markdown and agent activity

- Use chronological message articles with stable `messageId`/part keys and explicit **You / AI** text, plus accessible names such as “AI, message 4.” Do not place the whole conversation in an assertive or continuously reread live region. A short polite status announces material state changes/new response availability, not every token/tool tick. `aria-busy` belongs to affected content regions, not the whole app/editor.
- Render full original user text and assistant text with the maintained safe CommonMark/GFM foundation. Cap application-generated message headings below Think's route H1; lists/tasks/tables/code keep native semantics. Escape raw HTML; no automatic remote images/embeds. HTTP(S) links are deliberately opened with a new-tab indication and safe relationships; unsafe/protocol-relative links stay inert. Internal vault/wiki/heading-link resolution is not added by chat. No hidden reasoning, injected instructions, system prompts or raw tool payloads appear as messages.
- **Markdown specifics:** prose 68ch, 17px/1.65; H2/H3/H4–H6 24/20/18px Libre Baskerville; balanced headings only, not streamed paragraphs. Code stays monospace, preserving whitespace in a bounded horizontal scroller with an accessible label and keyboard entry when overflowed. Tables use an accessible horizontal region with full headers and no page-wide overflow. Long URLs/ordinary prose wrap; code does not wrap away meaningful whitespace. Disabled task checkboxes remain read-only. Streaming may display incomplete Markdown plainly until safe parsing catches up; never execute incomplete HTML.
- Do **not** add a code-copy toolbar, message action menu, edit/regenerate/branch, attachments, model picker or feedback buttons in this slice. Native text selection/copy works; code-copy would be a separate convenience, not a dependency for good code rendering.
- Group tools under **AI activity**, tied to the owning assistant message/run, never as user messages. Show safe category, started/working/completed/failed/interrupted/unknown and duration only when supplied. Example: **File read — working**, **File search — completed**. Unknown/plugin tool: **Custom tool**, not a copied arbitrary title. No paths, commands, stdout, URLs, argument/result dump or expandable raw payload in the initial UI.
- A compact native disclosure within the owning AI entry summarizes current activity, e.g. **File read · working**. Its expanded list uses stable call IDs; completed earlier activity can stay collapsed. Preserve the user's disclosure choice; new tokens/actions do not repeatedly expand it or steal focus. Do not duplicate it with a second current-run bar near the composer. While reading older text, Stop and the conditional latest-position control remain available. No pretend percent progress or timer unless a real elapsed duration is supported.
- Native background output is **AI activity / Background activity**, attached to its actual message/run; never invent a new user message or receipt. “Response complete” can be followed by later real activity without rewriting old facts. No global “everything stopped/finished” claim.
- Generic tool failure: **“Custom tool failed · Execution error”** (or actual safe category), with cause unknown unless positive public evidence says otherwise. It does not trigger a made-up permission fault, blanket tool shutdown or a tool approval control.

### Paging, streaming and reading older content

The lane is anchored by message/part identity and a visible offset, not array positions. **Load earlier messages** at the top retrieves a page/part continuation and preserves the current reading anchor; never jump to bottom after prepending. A continuation within one message stays in the same article. Do not silently replace full history with compacted context, truncate long messages into summaries, or turn paging into an application turn limit.

Follow the latest output only while the user is already at the bottom and not selecting text, paging or deliberately reading older content. Manual upward scroll, keyboard reading, an open older activity disclosure or a selection suspends following. Only then show **Latest** (accessible name **Latest response**) in the existing action column above Send/Stop, not a full-width row or an overlay over message text. New output does not pull the reader away; activation scrolls to the latest boundary, then restores follow mode without stealing editor focus. If invoked by keyboard, keep the control/appropriate latest boundary focus coherent when the button disappears.

Stable DOM parts are updated in place; preserve text selection and scroll anchor where the same content generation permits. Canonical replacement is a replacement, not append. A replacement that invalidates selected text should wait until selection ends when feasible, marking that newer text is available; do not invent seamless selection preservation across different source bytes.

Body-reference loading is local to its part: **Loading message…**; failure **“This message couldn’t be loaded.” — Retry message**. Preserve already displayed verified text, monitoring, Stop and draft. The retry retrieves content only, not generation. On a superseded generation say **Updating message…**, never concatenate generations or restart the watch for a content error. Oversized/unsupported render resources get an explicit message-level error, with full source still retained/retrievable through the approved seam; no silent clipping or claim of unlimited browser memory. A later source-reading affordance needs an explicit design if implementation demonstrates it is necessary, not an invented download capability in this draft.

## Questions are not tool approvals

Initial full tool mode has **zero approval/reject controls, toggles or permission dialogs**. Tools can run commands, use the network, and read or change files outside the vault under the service account; working in the vault is not a sandbox or an automatic attachment of all notes. Those settled facts belong in this contract/operator guidance, not repeated chat help, an empty-state warning or a new acknowledgement gate. No automatic vault/Recall/transcript attachment is implied.

For a positively observed incompatible native ask/typed permission rejection, show a plain **“Tool access doesn’t match this chat’s full-access setup.”** Explain **“The service requested permission or refused it. This chat cannot resolve that request here.”** Keep available output/monitoring and best-effort Stop; report setup attention without an Allow/Deny/Always choice, autoapproval, prompt resend or invented tool fallback. Generic unknown execution errors remain ordinary errors, not evidence of that conflict.

Ordinary session-owned agent questions use an inline **AI question** section at their timeline position. Show a short bounded descriptor first; retrieve full authenticated details separately. Supported native fields become ordinary labelled text fields, radio groups/checkboxes/selects as appropriate, fieldsets/legends for groups, and **Send answer**. They are not the freeform composer and not a new form-builder framework. While waiting, the main editor remains editable and its action remains Stop; sending the answer is a decision reply, not a second Send/run.

- Do not render a Submit action until required full details are available. Detail failure shows **Couldn’t load this question — Retry question**, while monitoring/Stop remain usable. Unsupported or too-large details show an explicit error without truncating or guessing an answer.
- Reply targets the exact owned typed decision and current generation. During reply show **Sending answer…**, keep field values on an unconfirmed reply, and query/revalidate instead of duplicating it. A settled/stale question says **“This question was already answered or changed.”** Resync; do not replay the old reply. Reconnect restores currently pending questions, not old popups. Several pending descriptors can be paged with **More questions**, without a global decision inbox.
- Use only supported owned session forms. Unrelated/global MCP/TUI forms are not shown as this conversation's questions. An approval-dependent unsupported integration remains a technical compatibility issue, not a disguised agent question.
- The static board includes an ordinary-question specimen only to show the space needed when an agent actually needs an answer. Its form/actions are explicitly samples, not an implemented descriptor renderer or an always-present question panel.

## Transcript health is independent

One vault Markdown file per conversation; full original user and AI text, conservative tool summaries, no internal reasoning or raw tool dumps. Writes occur at canonical meaningful boundaries, **not token-live**. Sensitive text deliberately written in messages stays in those full logs; no automatic secret-redaction promise. These are technical facts, not a logging feature panel in Think.

| Writer state | Interface treatment |
| --- | --- |
| Not started / healthy / eligible entries pending / live part pending | Quiet: no label, footer, saved badge, timestamp or empty-chat file claim. No All saved claim while streaming. |
| Ordinary transient I/O failure and automatic retry | Quiet. The daemon retries with bounded backoff independently of this view, tokens, Send/Stop and tools. No public retry button/endpoint, spinner, countdown or user maintenance chore. |
| Meaningful persistent retryable delay, as classified by the server | One subdued composer-adjacent note: **Transcript saving is still delayed.** No action, panel or repeated toast; it clears when actual health recovers. Never suggest retrying the chat. |
| Conflict/content gap requiring attention | A safe concise symptom, e.g. **Transcript needs attention: file changed.** or **Some transcript content is unavailable.** Do not pretend a Retry button repairs it or offer overwrite/generation. Logging still does not gate Send/Stop/editor/tools. |

Snapshots also carry an aggregate flag/count of **other background logging failures**. Do not surface normal writes or first-attempt transient failures. A meaningful persistent background issue survives New chat/route return as a quiet exception, e.g. **Some transcripts need attention.** No prior-chat list, titles/files, public Retry logging control, prompt replay or tool execution is introduced. While disconnected retain the known persistent symptom rather than falsely clearing it; combine exception text compactly instead of stacking maintenance panels. The parallel transcript design owns retry classification, cadence, stopping conditions and diagnostics; the UX invents no arbitrary duration threshold.

An **Open transcript in Recall** link is conditional, not required in these examples: only render it if the daemon supplies a verified ordinary vault-relative note ID for a readable current transcript. Use the existing Recall route and safe ID encoding; no guessed filename/path, generated transcript viewer or implied live updating. This draft does not add prior-chat selection through transcript navigation.

## Native context, compaction and retries

No application turn counter, shrinking quota bar, artificial reset or countdown. Native constraints remain real:

- During native compaction: **AI is making room in its context…**; Stop remains the action, editor usable. A small activity entry later says **Context compacted**. Earlier UI messages and vault entries remain intact; no compaction-summary body is exposed as an AI message.
- During an observed native retry: **The service is retrying the response** plus a safe reason when supplied; no invented countdown/duration/attempt budget. It is the same run, not another user submission.
- On a confirmed native context/step/provider limit: **“The service reached its context limit”**, **“The agent reached its configured step limit”**, or the supported safe category. Preserve output/draft. Explain that the run ended; offer a normal deliberate next message only when the daemon reports eligible, or explicit New chat. Do not automatically restart/reset/retry or mislabel this as Memory Loop's conversation limit.

## Focus, accessibility and transitions

Native links for the four app destinations; actual buttons for New chat, Send/Stop, retries and latest-position actions. All targets minimum 44px; readable text stays at least 14px for status and 16px for input. Native textarea selection/caret, Lantern text selection, Horizon focus on dark contexts, Night focus on Horizon/light surfaces; color is never the sole message-role/error/state cue. Reduced-motion users receive no scroll animation; there is no typewriter entrance, pulsing dot or token-by-token live announcement.

Client route entry focuses the accessible Think H1; hard entry does not autofocus or pop the phone keyboard. The heading reserves no visible row; the active Think link supplies visual location. New chat success focuses the conversation/heading, not the mobile editor automatically; Keep writing explicitly returns to it. Composer stays mounted through state changes and rejected/reconnected requests. Inline errors are associated with the affected control/field, while a concise polite status announces transitions. A Stop failure does not throw focus into a warning. Tool disclosures use native keyboard behavior and keep their own focus. New chat's responsive placement never clips its focus outline or covers a message/editor target.

## Technical seams the builder must preserve

The technical designs already supply the required identities, commands, snapshots, revisions, content generations, history/decision continuations, preview completeness and logging metadata. Consume them rather than inventing UI-owned execution truth or extra state engines. In particular:

- Gate all old snapshots/body loads/form replies by conversation/epoch/watch or request generation. Chat A's late data cannot enter B; New chat does not stop A's daemon monitor/logger.
- Distinguish a failed watch from independently reachable command/receipt endpoints when deciding whether Stop/retries can be activated. Do not assume a socket's presence proves any command will succeed; report its actual attempt/outcome.
- Keep busy enforcement server-side, immutable submission receipts separate from editor versions, command reconciliation separate from manual new Sends, and content retries separate from generation.
- Use exact safe typed causes where supplied; unknown remains unknown. No raw native config, tool payloads, provider exceptions, host paths or service credentials in the UI.
- Preserve browser current-chat recovery through URL/ID pointer, without adding prior-chat navigation. No UI-derived generated filenames, auto-attachment or imported TUI conversations.

No additional product question blocks this bounded draft. Consequential runtime gates remain exactly the existing capability gates: native admission/Stop/decision compatibility, full-allow policy, long-content/history/reconnect behavior and transcript delivery. If a seam cannot supply the states above, report the specific mismatch before implementing a misleading substitute; do not turn that into a speculative new backlog or silently weaken the user's workflow.

## Static examples and validation boundary

The [review page](think-chat-ux/index.html) provides an ordinary conversation and compact composer, plus empty, disconnected, ordinary-question and reading-older specimens. There is no Logging problem primary view. `?state=working&issue=transcript` adds the subdued persistent-delay exception to the same ordinary conversation, not a feature hero. The review state selector is static-artifact navigation, not product UI. No Send/Stop/New chat action calls any service.

Local approved artwork/fonts are referenced read-only from the adjacent approved board; no copies, transformations, downloads or new assets are necessary. The review-only provenance and render evidence are recorded beside the examples. Actual desktop/phone/short-enlarged Chromium captures and their limitations belong to the handoff, not claims of a live Think implementation, real mobile keyboard behavior, assistive-technology certification or independent approval.

Author evidence and matched before/after dialogue-area measurements for this revision are recorded in [provenance](think-chat-ux/provenance.md) and `/tmp/opencode/think-chat-ux-space-revision/`. Earlier 42j.4 captures/review receipts describe the superseded composition, not user approval. No production runtime or technical capability is validated by these static examples.

With the same conversation and draft, the dialogue viewport gains **244px on desktop**, **211px at 390×844**, and **108px at 320×568**. The short 200% case uses page flow rather than a false fixed-pane measurement. Paired `desktop-before-after.png` and `phone-before-after.png` in that evidence directory show the material composition change directly. Physical-device keyboard, IME, safe-area and assistive-technology limits remain explicit.
