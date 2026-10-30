---
title: Think — conversation, open draft and honest continuity
date: 2026-10-30
status: draft
tags: [think, ux, responsive, chat, accessibility, design]
related: [.lore/work/intents/think.md, .lore/work/design/think-execution-reconnect.md, .lore/work/design/think-transcript-persistence.md, .lore/work/design/think-permissions-context.md]
---

# Think: leave room for the next thought

Design-only proposal for `memory-loop-42j.4`, following the user's request to design the UX now. No app implementation, new integration contract, asset generation or activation. The [static review examples](think-chat-ux/index.html) contain explicitly fictional conversation text and inert sample actions. They are not a functioning chat client.

## Authority and direction

The current [intent](../intents/think.md), approved [execution/reconnect design](think-execution-reconnect.md), [transcript draft](think-transcript-persistence.md) and [permissions/context draft](think-permissions-context.md) supply the behavior. This UX does not approve those adjacent drafts or claim their capability gates have run. Later settled choices in those documents supersede the intent's earlier open-question wording. PRODUCT.md remains useful product/brand context but its older stack and unimplemented-capability descriptions are not the current Think technical contract. Existing [DESIGN.md](../../../DESIGN.md), the [approved character board](memory-loop-character/index.html) and [character integration](character-integration.md) supply visual authority.

**Modes:** Operate while composing/controlling a run; Read while following or revisiting its output. One personal user, often on a phone, sometimes reading older text while the AI works. Success: know whose words these are, keep writing, understand what is actually known, and never accidentally resend or stop work.

### Direction contract

**Thesis:** one conversation lane and an always-open draft. No chat-management sidebar, split inspector or competing pane. The conversation leads; service machinery stays compact until it needs attention.

**Own world:** preserve the compact A.5/IM Fell identity and horizontal Ground/Capture/Think/Recall top navigation, Night frame, cool 10% Horizon / 90% Night Think field, Parchment ink and Horizon focus/location. A questioning IM Fell invitation and unchanged Guide mark welcome a new thought; they give way to the conversation rather than becoming a watermark. Source Sans carries controls and prose; Libre Baskerville carries Markdown headings, not every label. No new art, palette, theme or generic white chat surface.

**Story:** arrive at a fresh conversation → write → send once → follow AI text and clearly identified activity → draft the next thought while waiting → explicitly Send after the run settles. A lost connection changes what can be known, not who owns execution.

**First viewport:** shared top navigation; compact Think heading/status at left and New chat at right; one centered readable lane; composer immediately below that lane's scroll area. New chat shows “What else could this become?” with a small unaltered A.5. During a conversation that invitation is absent. The action beside the draft is Send or Stop, with a short reason when unavailable. Logging has its own quiet line/warning, never an AI-message bubble.

**Form:** a familiar chronological conversation, extended inside the approved Think world. Brief-pinned shell/behavior, code-led static examples; no identity replacement or concept lottery. The signature is continuity of the open draft against a changing conversation, not decorative animation.

**Review boundary:** a bounded draft and inspected static examples, then parent-owned fresh design review and technical interaction check. Neither this document nor a polished example authorizes production work or constitutes acceptance.

## Composition and exact responsive handoff

### Desktop, 1440 × 900

- Retain the production top banner's proportions: 40px A.5, 28px IM Fell wordmark, 16px native navigation links with 44px targets; Think has the Horizon underline and current-page semantics. No left app rail, phone bottom tabs or prior-chat list.
- Think fills the work area below it. A compact section header has **Think** (24px Source Sans semibold), one current status line, and **New chat** (minimum 44px) at the opposite edge. **Chat details** is a native disclosure in this header, not a modal or settings panel.
- Center a conversation/composer lane at **52rem maximum**, with **68ch maximum prose**. Use 32px desktop workspace gutters. User entries are a quiet inset Horizon-tinted field, with left-aligned text and visible **You** attribution. AI text is unboxed on the cool field with visible **AI** attribution. Roles, spacing and accessible labels distinguish them even without color.
- Use 17px / 1.65 Source Sans prose. User/AI role labels are 14px semibold. Separate messages by 24–32px, paragraphs by about 1em; keep metadata/tool rows at 14px / 1.5. No avatar column repeated on every message, oversized floating bubbles or timestamp on every streamed fragment.
- The composer is a separate grid row, not an overlay: visible **Message** label; multiline textarea; a bottom row with one short action explanation at left and **Send / Stop** at right. Three initial lines on desktop; two on phones. Grow only up to the smaller of 12rem or roughly 30% of available viewport height, then scroll the textarea itself. It stays editable in every state.
- A narrow logging line sits below the action row. A logging warning expands here in normal layout and shrinks the conversation viewport; it never covers text or the action. No redundant control toolbar or persistent “all saved” badge.

### Phone, 390 × 844 and 320 × 568

- Keep the same horizontal top navigation, wrapping under the wordmark exactly as the existing shell does. Do not reduce navigation text to fit. Use safe-area-aware **20px** side gutters; message insets can be 16px inside the lane. New chat remains visible in the Think section header, not an overflow menu.
- Use the same DOM order: global navigation → Think/status/New chat/details → conversation → latest-position control when needed → composer/action/logging. The message lane becomes full available width. No independent tool pane, side drawer or chat switcher.
- The empty invitation is **42px** IM Fell on phone (54px desktop); A.5 is 56px (64px desktop). At small/short heights it remains in the conversation flow, not a fixed hero reserving space. An existing conversation never reserves its space.
- At normal portrait sizes, the conversation is the only reading scroller. The composer has its own bounded text-editing overflow; code/tables may have local horizontal scroll. These are content needs, not unrelated panes.
- Use actual header/composer heights, `100dvh` with an appropriate fallback, and safe-area padding. Never subtract guessed header heights or absolutely position the composer over the last message. Reserve all composer/action/logging space in the layout.
- At short height, enlarged text, an expanded notice, or an OS keyboard leaving insufficient room for a useful reading area, allow **one ordinary page scroll** rather than a zero-height transcript or clipped composer. The same composer stays in document flow; the top app header can scroll off, but never becomes bottom navigation. A focus-only **Skip to message** link and ordinary focus scrolling keep the editor reachable. Minimum 44px controls and rem-scaled text remain intact. At 844 × 390 / 200% text the full layout can exceed one screen; reachability and no overlap are the requirement, not cramming everything into 390px.
- Virtual keyboards vary. Prefer browser viewport resizing/focus scrolling; use VisualViewport measurement only if real-device evidence requires it, with listener cleanup and no double application of keyboard offsets. Do not continuously scroll the whole page in response to token/viewport events. Physical iOS/Android keyboards, safe areas, zoom and assistive technologies remain to be tested; static Chromium cannot certify them.

## New chat, draft and sending

**New chat is a context change, not Stop.** Its accessible name is exactly New chat. Without a draft it starts the new conversation directly; a working old run gets a concise confirmation after switching: **“New chat ready. Previous work continues in the background.”** This is not a link to an old chat and does not imply a return interface exists. No previous-chat list, recent-chat menu, “resume” button or Ground substitute is added.

With a nonempty unsent draft, use a small inline confirmation directly under the Think header: **“Start a new chat and discard this draft?”** Follow with **“Current work will continue. Returning to earlier chats isn’t available here yet.”** Actions: **Keep writing** (safe/default) and **Discard draft & start new chat**. Do not copy the draft into the new conversation, auto-save it as a message or Stop the old run. Escape/Keep writing dismisses and returns focus to the editor; the explicit discard action is the only discard. No modal, typed confirmation or warning for an empty draft. A failed new-conversation creation shows its own retry/check state and never changes the old run's fate; it does not silently fall back to the old identity or resurrect a discarded draft.

The current draft lives in Think presentation memory, keyed by the current conversation, through SPA navigation and browser reconnect. Hard reload/browser closure loses unsent text. **Chat details** says this plainly; no browser draft database, persistent outbox or global leave guard is introduced. Once the New chat discard action is confirmed, the old draft is intentionally discarded.

### Composer interaction

- Label **Message**, placeholder **“Follow the thought…”**. Neither placeholder nor color is its only label. Input, selection, clipboard and ordinary editing remain available while working, waiting, stopping, disconnected, denied or unavailable. Never set the textarea to disabled/read-only because Send is unavailable.
- **Enter inserts a line break everywhere; Shift+Enter also inserts a line break.** Send is an explicit button, with **Ctrl+Enter / Cmd+Enter** as an eligible-Send-only hardware shortcut. This lets the user write freely while the action changes to Stop, avoids guessing keyboard type from viewport width, and makes the phone/IME rule consistent. Respect `isComposing`/composition events and ignore repeated shortcut keydowns; the Enter ending IME composition never sends. Neither Enter nor the Send shortcut ever activates Stop. Show the platform-appropriate shortcut near eligible Send on hardware-keyboard use, not as the only discoverable send method.
- Send requires non-whitespace text, an available current conversation and authoritative eligibility. New chat creation/cold lookup may show Send unavailable without blocking typing. At most one unresolved Send/run per conversation; no follow-up queue, offline sending or auto-send after reconnect/Stop/answer.
- Capture an immutable submission on activation. Show it once as **You** with a receipt status, not a duplicated optimistic/final pair. Clear only the captured draft version when daemon registration is confirmed; retain newer edits. While the receipt is unconfirmed, retain the submitted text and label it **“Checking whether your message was received…”**; newer writing stays a separate draft, not a queued send. If registration is later confirmed, do not delete newer typing or show the same user message twice.
- On definitive rejection, show **“Message wasn’t accepted.”** with a safe reason. If the editor still contains the same submission, leave it there. If the user has written something else, offer **Use unsent message** on that rejected entry: restore only into an empty editor; otherwise ask inline before replacing the newer draft. A deliberate corrected Send uses a new command. Ambiguity never gets a Resend/Retry generation button.
- Activation never moves focus to each incoming message. After Send keep focus in the editor. When Send changes to Stop under a focused control, keep a stable action area but do not let a held/repeated Enter activate Stop: suppress repeat activation and require a fresh explicit Stop press. Stop is never the textarea's Enter action.

## Status language: three facts, not one spinner

The section status combines only necessary known facts. **Admission**, **run state**, and **monitoring** remain separate in the state model; one text line is a presentation, not an overloaded `isLoading` flag. Preview completeness and logging health are separate again. No percentage/countdown guesses or “stopped” inferred from a closed connection.

| State / evidence | Visible treatment and action |
| --- | --- |
| Fresh, usable conversation | **Ready**. Empty invitation, editable editor. Send enabled only for eligible text. Transcript has not started. |
| Creating a new conversation | **Starting chat…**. Editor available, Send unavailable. A lost create response checks the same identity; no second random creation. Creation failure offers explicit **Try starting chat again** for that same create command; New chat remains a separate deliberate action. |
| Cold current-conversation lookup | **Opening current chat…**. Named loading region, no false “no messages” empty state. Composer available, Send unavailable until authoritative state arrives. Never auto-create an unknown existing identity. |
| Send registered / accepted, not yet agent-admitted | **Message received · Waiting to start**. User entry is registered, not “AI read it.” One occupied admission slot. Stop replaces Send for that accepted operation where reachable. |
| Send receipt or upstream admission uncertain | **Checking message receipt…** with **“Your message may already be running. It won’t be sent again.”** Receipt/snapshot checks, no duplicate/resend button. No fresh Send; offer Stop only if a target run is known and the daemon can receive the request. Without a known target show unavailable **Checking…**, not an invented Stop target. |
| Connected, working | **Connected · AI working**, or **AI using tools**. Stop available; editor stays editable with **“You can draft while the AI works.”** Native retry/compaction remain this run, not new user messages. |
| Browser watch reconnecting, last known working | **Reconnecting · Last known: AI working**. **“Work may still be running.”** Keep observed content and draft. Stop remains enabled if the command endpoint is independently reachable/target known; if not, unavailable Stop plus **“Stop is unavailable until the service is reachable.”** Never queue a Stop for automatic delivery. |
| Snapshot resynchronizing | **Catching up…**. Replace/merge authoritative state by stable identities before healthy following; do not append duplicate history. Disable new admission until eligibility is known; target-specific Stop may remain available if the daemon can validate it. Do not replace the whole lane with a spinner or clear the draft. |
| Daemon-to-OpenCode live-preview gap | Part-local **“Partial response · catching up”**. Keep observed text, but never append a suffix as if the gap were continuous. Replace that part with its canonical full value when available. This is not an AI failure, browser disconnection, or proof of logging success. |
| Service missing/incompatible or setup required, before work | **Think is unavailable** plus a safe reason and **Check connection** / operator setup guidance. Editor available; Send unavailable. Recall/global navigation still work. No browser credentials/settings editor or service auto-start. |
| Daemon epoch / upstream process changed; continuity unavailable | **“Chat continuity is unavailable. The service changed, so we can’t confirm the current outcome.”** Keep available text/draft, no fake empty chat, stopped result, automatic attach/create/resend or promise that restart restores work. Stop unavailable unless the service later supplies a valid controllable target. New chat is explicitly a different identity, never disguised recovery. |
| Authorization denied | **“Access to this chat was denied.”** Stop automatic reconnect attempts; retain editor/draft. Explain access must be corrected before **Check access**. Do not mislabel denial as endless reconnecting or expose private diagnostics. |
| Invalid/unknown current conversation | **“This chat couldn’t be opened.”** Explain invalid address/not available safely. Explicit New chat is possible; never create under the supplied existing ID or attach an arbitrary TUI session. |
| Final response / native execution completed | **Response complete**; restore eligible Send, preserve draft. Not **All work finished**: background activity can later update the same conversation. No application turn cap or conversation reset. |
| Run failed | **“Response ended with an error.”** Keep partial text and specific safe failure class. Stop is no longer offered for a confirmed terminal. Any next Send is deliberate; no automatic regeneration or hidden retries beyond native observed behavior. |

### Stop outcomes

Stop is labelled **Stop**, not Cancel all. It targets the current known `runId`, uses a new Stop command identity and never fires on navigation, tab closure, reconnect, a transcript error or New chat.

| Evidence | Treatment |
| --- | --- |
| Explicit request being registered/settling | **Stopping…**; prevent duplicate activation, keep editor usable. Text **“Stop requested. Waiting for confirmation.”** Acknowledged interrupt alone is not Stopped. Lost acknowledgement is checked, not automatically issued against a newer run. |
| Confirmed interruption / cancelled before delivery | **Stopped** / **Stopped before starting**. Preserve observed/canonical text and tool facts. Restore eligible Send; never auto-send the draft. |
| Completion won | **Response complete · Finished before Stop took effect.** Keep the result; do not relabel it Stopped. |
| Stop request definitively failed while same run remains controllable | **“Couldn’t request Stop. Work may still be running.”** Explicit **Retry Stop** targets that same run, after current-state validation. No generic Retry that could restart generation. |
| Outcome or delivery still unknown | **“Stop outcome isn’t confirmed.”** Keep checking authoritative state; no success claim. Offer manual Retry Stop only when the daemon can safely identify/control the target, otherwise an unavailable action with the reason. |

Chat details explains once: **“Stop is best effort. It can’t undo changes already made, and some background work may continue.”** Do not add a confirmation gate to every Stop or promise rollback/killing every descendant.

## Messages, Markdown and agent activity

- Use chronological message articles with stable `messageId`/part keys and explicit **You / AI** text, plus accessible names such as “AI, message 4.” Do not place the whole conversation in an assertive or continuously reread live region. A short polite status announces material state changes/new response availability, not every token/tool tick. `aria-busy` belongs to affected content regions, not the whole app/editor.
- Render full original user text and assistant text with the maintained safe CommonMark/GFM foundation. Cap application-generated message headings below Think's route H1; lists/tasks/tables/code keep native semantics. Escape raw HTML; no automatic remote images/embeds. HTTP(S) links are deliberately opened with a new-tab indication and safe relationships; unsafe/protocol-relative links stay inert. Internal vault/wiki/heading-link resolution is not added by chat. No hidden reasoning, injected instructions, system prompts or raw tool payloads appear as messages.
- **Markdown specifics:** prose 68ch, 17px/1.65; H2/H3/H4–H6 24/20/18px Libre Baskerville; balanced headings only, not streamed paragraphs. Code stays monospace, preserving whitespace in a bounded horizontal scroller with an accessible label and keyboard entry when overflowed. Tables use an accessible horizontal region with full headers and no page-wide overflow. Long URLs/ordinary prose wrap; code does not wrap away meaningful whitespace. Disabled task checkboxes remain read-only. Streaming may display incomplete Markdown plainly until safe parsing catches up; never execute incomplete HTML.
- Do **not** add a code-copy toolbar, message action menu, edit/regenerate/branch, attachments, model picker or feedback buttons in this slice. Native text selection/copy works; code-copy would be a separate convenience, not a dependency for good code rendering.
- Group tools under **AI activity**, tied to the owning assistant message/run, never as user messages. Show safe category, started/working/completed/failed/interrupted/unknown and duration only when supplied. Example: **File read — working**, **File search — completed**. Unknown/plugin tool: **Custom tool**, not a copied arbitrary title. No paths, commands, stdout, URLs, argument/result dump or expandable raw payload in the initial UI.
- A native disclosure summarizes current activity, e.g. **“AI activity · File read working”**. Its expanded list uses stable call IDs; completed earlier activity can stay collapsed. Preserve the user's disclosure choice; new tokens/actions do not repeatedly expand it or steal focus. A small current-run status near the composer remains useful while reading older content. No pretend percent progress or timer unless a real elapsed duration is supported.
- Native background output is **AI activity / Background activity**, attached to its actual message/run; never invent a new user message or receipt. “Response complete” can be followed by later real activity without rewriting old facts. No global “everything stopped/finished” claim.
- Generic tool failure: **“Custom tool failed · Execution error”** (or actual safe category), with cause unknown unless positive public evidence says otherwise. It does not trigger a made-up permission fault, blanket tool shutdown or a tool approval control.

### Paging, streaming and reading older content

The lane is anchored by message/part identity and a visible offset, not array positions. **Load earlier messages** at the top retrieves a page/part continuation and preserves the current reading anchor; never jump to bottom after prepending. A continuation within one message stays in the same article. Do not silently replace full history with compacted context, truncate long messages into summaries, or turn paging into an application turn limit.

Follow the latest output only while the user is already at the bottom and not selecting text, paging or deliberately reading older content. Manual upward scroll, keyboard reading, an open older activity disclosure or a selection suspends following. Show a **Latest response** button in its own small lane row immediately above the composer, never floating over message text. New output does not pull the reader away; activation scrolls to the latest boundary, then restores follow mode without stealing editor focus. If invoked by keyboard, keep the control/appropriate latest boundary focus coherent when the button disappears.

Stable DOM parts are updated in place; preserve text selection and scroll anchor where the same content generation permits. Canonical replacement is a replacement, not append. A replacement that invalidates selected text should wait until selection ends when feasible, marking that newer text is available; do not invent seamless selection preservation across different source bytes.

Body-reference loading is local to its part: **Loading message…**; failure **“This message couldn’t be loaded.” — Retry message**. Preserve already displayed verified text, monitoring, Stop and draft. The retry retrieves content only, not generation. On a superseded generation say **Updating message…**, never concatenate generations or restart the watch for a content error. Oversized/unsupported render resources get an explicit message-level error, with full source still retained/retrievable through the approved seam; no silent clipping or claim of unlimited browser memory. A later source-reading affordance needs an explicit design if implementation demonstrates it is necessary, not an invented download capability in this draft.

## Questions are not tool approvals

Initial full tool mode has **zero approval/reject controls, toggles or permission dialogs**. Chat details states **“Tools have full access. They can run commands, use the network, and read or change files outside your vault under the service account.”** This is information, not a new acknowledgement gate. Working in the vault does not mean all notes were attached or that tools are sandboxed. No automatic vault/Recall/transcript attachment is implied.

For a positively observed incompatible native ask/typed permission rejection, show a plain **“Tool access doesn’t match this chat’s full-access setup.”** Explain **“The service requested permission or refused it. This chat cannot resolve that request here.”** Keep available output/monitoring and best-effort Stop; report setup attention without an Allow/Deny/Always choice, autoapproval, prompt resend or invented tool fallback. Generic unknown execution errors remain ordinary errors, not evidence of that conflict.

Ordinary session-owned agent questions use an inline **AI question** section at their timeline position. Show a short bounded descriptor first; retrieve full authenticated details separately. Supported native fields become ordinary labelled text fields, radio groups/checkboxes/selects as appropriate, fieldsets/legends for groups, and **Send answer**. They are not the freeform composer and not a new form-builder framework. While waiting, the main editor remains editable and its action remains Stop; sending the answer is a decision reply, not a second Send/run.

- Do not render a Submit action until required full details are available. Detail failure shows **Couldn’t load this question — Retry question**, while monitoring/Stop remain usable. Unsupported or too-large details show an explicit error without truncating or guessing an answer.
- Reply targets the exact owned typed decision and current generation. During reply show **Sending answer…**, keep field values on an unconfirmed reply, and query/revalidate instead of duplicating it. A settled/stale question says **“This question was already answered or changed.”** Resync; do not replay the old reply. Reconnect restores currently pending questions, not old popups. Several pending descriptors can be paged with **More questions**, without a global decision inbox.
- Use only supported owned session forms. Unrelated/global MCP/TUI forms are not shown as this conversation's questions. An approval-dependent unsupported integration remains a technical compatibility issue, not a disguised agent question.
- The static board includes a compact ordinary-question specimen, separate from the four main state views. Its form/actions are explicitly samples, not an implemented descriptor renderer.

## Transcript health is independent

One vault Markdown file per conversation; full original user and AI text, conservative tool summaries, no internal reasoning or raw tool dumps. Writes occur at canonical meaningful boundaries, **not token-live**. Sensitive text deliberately written in messages stays in those full logs; no automatic secret-redaction promise. Keep that explanation in Chat details, not a banner before each Send.

| Writer state | Quiet line / warning |
| --- | --- |
| Not started | **Transcript starts with your first message.** No empty-chat file claim. |
| Writing/pending eligible entries | **Transcript: writing finished messages…** A pending state, not All saved. |
| Eligible entries synchronized, open live text pending | **Transcript: live text pending.** Details explain that closed parts are logged while this unfinished text is not yet in the vault. |
| Up to date, no live text pending | **Transcript up to date**; optionally actual **Last written {local time}** from confirmed `last_synced_at`. Not forever-final or a power-loss guarantee. |
| Degraded | **Transcript isn’t up to date. Chat can continue.** Safe reason, e.g. **Couldn’t write to the vault** / **Transcript changed outside this chat** / **Some transcript content is unavailable**. Explicit **Retry logging**; never Retry response/generation. |
| Retrying | **Retrying transcript logging…** Coalesce/disable another retry, not Send/Stop/editor. On success report actual health; conflicts/gaps remain visible, not an automatic overwrite/repair. |

Snapshots also carry an aggregate flag/count of **other background logging failures**. Keep a warning in the same composer footer across New chat and route return: **“A background transcript needs attention.”** or **“This chat and 2 background transcripts need attention.”** The single **Retry logging** action retries affected living writers; it does not open a previous chat, list titles/files, replay tools or send messages. With no service connection show the last-known warning and unavailable retry with its reason; never erase it as part of a new empty state.

An **Open transcript in Recall** link is conditional, not required in these examples: only render it if the daemon supplies a verified ordinary vault-relative note ID for a readable current transcript. Use the existing Recall route and safe ID encoding; no guessed filename/path, generated transcript viewer or implied live updating. This draft does not add prior-chat selection through transcript navigation.

## Native context, compaction and retries

No application turn counter, shrinking quota bar, artificial reset or countdown. Native constraints remain real:

- During native compaction: **AI is making room in its context…**; Stop remains the action, editor usable. A small activity entry later says **Context compacted**. Earlier UI messages and vault entries remain intact; no compaction-summary body is exposed as an AI message.
- During an observed native retry: **The service is retrying the response** plus a safe reason when supplied; no invented countdown/duration/attempt budget. It is the same run, not another user submission.
- On a confirmed native context/step/provider limit: **“The service reached its context limit”**, **“The agent reached its configured step limit”**, or the supported safe category. Preserve output/draft. Explain that the run ended; offer a normal deliberate next message only when the daemon reports eligible, or explicit New chat. Do not automatically restart/reset/retry or mislabel this as Memory Loop's conversation limit.

## Focus, accessibility and transitions

Native links for the four app destinations; actual buttons for New chat, Send/Stop, retries and latest-position actions. All targets minimum 44px; readable text stays at least 14px for status and 16px for input. Native textarea selection/caret, Lantern text selection, Horizon focus on dark contexts, Night focus on Horizon/light surfaces; color is never the sole message-role/error/state cue. Reduced-motion users receive no scroll animation; there is no typewriter entrance, pulsing dot or token-by-token live announcement.

Client route entry focuses Think H1; hard entry does not autofocus or pop the phone keyboard. New chat success focuses the new Think/conversation heading, not the mobile editor automatically; Keep writing explicitly returns to it. Composer stays mounted through state changes and rejected/reconnected requests. Inline errors are associated with the affected control/field, while a concise polite status announces transitions. A Stop failure does not throw focus into a warning. The collapsed details and tool disclosures use native keyboard behavior and keep their own focus.

## Technical seams the builder must preserve

The technical designs already supply the required identities, commands, snapshots, revisions, content generations, history/decision continuations, preview completeness and logging metadata. Consume them rather than inventing UI-owned execution truth or extra state engines. In particular:

- Gate all old snapshots/body loads/form replies by conversation/epoch/watch or request generation. Chat A's late data cannot enter B; New chat does not stop A's daemon monitor/logger.
- Distinguish a failed watch from independently reachable command/receipt endpoints when deciding whether Stop/retries can be activated. Do not assume a socket's presence proves any command will succeed; report its actual attempt/outcome.
- Keep busy enforcement server-side, immutable submission receipts separate from editor versions, command reconciliation separate from manual new Sends, and content retries separate from generation.
- Use exact safe typed causes where supplied; unknown remains unknown. No raw native config, tool payloads, provider exceptions, host paths or service credentials in the UI.
- Preserve browser current-chat recovery through URL/ID pointer, without adding prior-chat navigation. No UI-derived generated filenames, auto-attachment or imported TUI conversations.

No additional product question blocks this bounded draft. Consequential runtime gates remain exactly the existing capability gates: native admission/Stop/decision compatibility, full-allow policy, long-content/history/reconnect behavior and transcript delivery. If a seam cannot supply the states above, report the specific mismatch before implementing a misleading substitute; do not turn that into a speculative new backlog or silently weaken the user's workflow.

## Static examples and validation boundary

The [review page](think-chat-ux/index.html) offers four main labelled sample states: new chat; streaming with tool summaries and a separate draft; browser disconnected with unreachable Stop and editable draft; and logging degraded while chat remains usable. It also contains ordinary-question and reading-older/Latest response specimens. The review state selector navigates within this static artifact, not the product. No Send/Stop/New chat/Retry action calls any service.

Local approved artwork/fonts are referenced read-only from the adjacent approved board; no copies, transformations, downloads or new assets are necessary. The review-only provenance and render evidence are recorded beside the examples. Actual desktop/phone/short-enlarged Chromium captures and their limitations belong to the handoff, not claims of a live Think implementation, real mobile keyboard behavior, assistive-technology certification or independent approval.

Author evidence: [provenance and bounded render record](think-chat-ux/provenance.md), with 20 opened fixture captures and measurements under `/tmp/opencode/think-chat-ux-42j4/`. The detector's reported aliases/palette/type advisories and activity-spacing warning are retained for fresh review rather than described as a clean pass. The static review strip and small-screen page extension are explicitly qualified there. No production runtime or technical capability was validated by these examples.
