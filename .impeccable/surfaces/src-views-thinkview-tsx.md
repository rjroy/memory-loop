---
version: 1
slug: "src-views-thinkview-tsx"
primary_target: "src/views/ThinkView.tsx"
related_targets: ["src/think/ThinkConversation.tsx","src/think/ThinkComposer.tsx","src/think/ThinkQuestion.tsx","src/think/ThinkNewChatButton.tsx","src/think/think.css","src/shell/NextShell.tsx"]
---

# Think — room for the next thought

Implemented Phase 5 surface; independent technical and visual reviews accepted the fixture implementation after corrections. Operate while drafting/controlling a run; Read while following or revisiting output. One personal user on desktop/phone. Authority: [approved UX and board](../../.lore/work/design/think-chat-ux.md), [intent](../../.lore/work/intents/think.md), [execution contract](../../.lore/work/design/think-execution-reconnect.md), incumbent [character board](../../.lore/work/design/memory-loop-character/index.html) and [DESIGN.md](../../DESIGN.md).

## Direction contract

THESIS: Give the dialogue the workspace. Refuse a chat-management rail, visible Think section bar, details panel and routine status/helper footer.

OWN-WORLD: Keep the local Guide/IM Fell identity and horizontal top navigation. Cool Horizon/Night field and quiet user tint remain. Approved kqk dark-first refinement uses Weathered Ivory prose, Parchment heading/identity accents, bright Horizon links/focus and dark secondary hover; Source Sans controls and Libre Baskerville Markdown headings remain. No new assets or theme.

STORY: Write freely, send deliberately once, distinguish You from AI/activity, keep drafting while work continues, and reconnect without resubmitting. New chat changes context, never stops prior work.

FIRST VIEWPORT: Conversation directly below the banner; centered 52rem lane, compact one-line growing editor and right-hand Send/Stop. One New chat uses the spare desktop gutter or existing banner. Empty invitation disappears once messages arrive. Short/enlarged layouts use page flow, not clipped miniature panes.

FORM: Brief-pinned, code-led extension of the approved space-first board; no new concept selection. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Interaction boundaries

- Hidden registered route H1, visible/accessibly named You/AI articles, unchanged safe `MarkdownDocument`, native activity disclosures and owned ordinary question forms; no tool approvals or raw payloads.
- Editor always editable. Enter sends when eligible; Shift+Enter inserts a line; Ctrl/Cmd+Enter also sends. Editor shortcuts never stop; respect IME/repeats and captured draft versions. Stop is exact-target, explicit and best effort.
- URL-first current conversation plus one opaque per-tab ID pointer; volatile SPA/reconnect draft, hard-reload draft loss, no prior-chat list. Initial bare Think creates once. Inline draft discard safeguard only when needed.
- Consume authoritative snapshots/SSE signals and separately loaded body references. Content retries are not generation retries. Quiet automatic logging; only meaningful server warnings, including background issues across New chat.
- Preserve selection/reading anchors; Latest floats over the conversation above the composer, outside layout flow, without moving or resizing transcript/editor/Send/Stop. Reader resizing reveals focused controls without moving a pointer target before activation completes. Native page-flow/focus scrolling remains available when space is insufficient.

## Evidence and unresolved boundary

Independent focused UI/native and acknowledgement/background-warning checks: `/tmp/opencode/think-phase5-actual-ui-verified.log`, `/tmp/opencode/think-phase5-ack-background-acceptance.log`. Integrated 48-unit/TypeScript evidence: `/tmp/opencode/think-phase5-integrated-unit-green.log`. These are not whole-phase acceptance.

Opened author captures and geometry: `/tmp/opencode/think-phase5-refinement-after-v2/`, all four target sizes at 100%/200% text. Compact document height is 568px, without the former 177px surplus; focused question bounds remain within its reader. Native answered state, replied receipt, settled UI, continued generation, Stop/draft retention, offline editing and nonblocking logging warning were observed.

Fresh visual review shipped after V1–V3 corrections. A nonblocking Message placeholder truncation at 320px/200% is tracked as `memory-loop-2sj`; its accessible label remains complete. Phase 6 private-path/personal activation remains outstanding. Physical keyboard/IME, safe-area and assistive-technology behavior is not certified by Chromium captures.

kqk palette refinement: retains the conversation fields/layout while updating prose, links, focus, boundaries and dark secondary hover. Author controlled-component before/after and enabled-action/focus captures are in `/tmp/opencode/kqk-dark-first/`; independent regression and fresh visual review remain pending for this refinement.
