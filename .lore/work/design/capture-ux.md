---
title: Capture — room to write, one deliberate save
date: 2026-10-31
status: draft
tags: [capture, ux, responsive, accessibility, design]
related: [.lore/work/intents/capture.md, .lore/local/plans/capture-implementation.md]
---

# Capture: room to write

Focused design for `memory-loop-i6j.1`, under the approved Capture implementation
plan. This brief specifies the production UI to build next; it does not implement
it or constitute independent design acceptance. No new artwork, mockup images,
service activation or private-vault access is involved.

## Direction and boundaries

**Mode: Operate.** One personal user writes a thought on desktop or phone, then
saves it as a timestamped entry in the configured vault. Ground configuration and
Think availability are irrelevant to this task.

**Thesis:** the writing area owns the workspace. One compact action sits above it
at the right; actual save exceptions earn space, routine explanations do not.

**Visual authority:** preserve the approved four-mode identity in `DESIGN.md`,
the character board and the actual shared shell. Capture is warm Parchment and
Night, complementary to cool Think. Keep the unchanged A.5/IM Fell identity and
horizontal Ground/Capture/Think/Recall navigation. No global shell redesign,
theme switch, illustration, texture, animation or new palette is needed.

The current Capture placeholder's composition is disposable. Do not copy the
character board's older bottom Save note action or Think's bottom composer:
the current intent explicitly puts **Capture at the top**.

## Exact composition

1. Existing app banner, unchanged: identity, four native navigation links and the
   Horizon current-location underline. Preserve wrapping and 44px link targets.
2. Accessible **Capture** H1 registered through `RouteHeading`, visually hidden
   locally without reserving a heading row. Keep route-focus semantics; do not
   globally hide route headings or place focus in the editor on entry.
3. Compact action row immediately below the banner, with the one **Capture**
   button aligned to the editor's right edge. Feedback uses the spare space to
   its left when it fits. No visible label, purpose paragraph or secondary toolbar.
4. One native multiline textarea fills the remaining width and height. It is not
   an expanding one-line composer and has no 64rem maximum-width lane. A visually
   hidden native label reads **Thought**; the empty editor has no placeholder.

Use 32px workspace side gutters on desktop and safe-area-aware 20px gutters below
56rem, matching the established task surfaces. Vertical workspace insets are
12px above the action and 16px below the editor (safe-area-aware at the bottom);
the action/editor gap is 8px. These are Capture-local overrides, not global token
changes. There is no permanent footer clearance or reserved empty status row.

The action has a minimum 44px height, 4px corners and a fixed **8.5rem** inline
size across **Capture** and **Saving…**. Text remains 16px-equivalent
Source Sans semibold and scales with user text size. At extreme enlargement,
allow the button to use the available width and wrap instead of overflowing;
never truncate its label or shrink the font. Its top and right edges stay fixed
as feedback changes. No spinner, icon or changing-width success badge is needed.

## A warm writing surface, not a sterile form

- Continue Parchment `#fef6e1` through the workspace and editor, with Night
  `#031315` ink/caret and Source Sans 3 at **1.0625rem / 1.6**. Do not put the
  writing area inside a white card or introduce a contrasting grey input fill.
- Give the editor a quiet 1px Night boundary, 4px corners and 12px internal
  padding. It is clearly editable without heavy chrome. Use a distinct 2px Night
  focus outline with sufficient inset/gutter clearance; the boundary alone is
  not its focus indicator. Native selection remains Lantern/Night.
- The action is Night with Parchment text. Hover reverses the pair with a Night
  boundary; pressed uses Lantern with Night text. Focus is a separate Night
  outline against Parchment. Disabled uses Muted Night text on Parchment with a
  quiet boundary, `aria-disabled="true"` and no opacity wash over the editor.
  Keep the native button mounted/focusable across state changes; unavailable
  activation is guarded for pointer, button keys and textarea shortcuts alike.
- Supporting feedback is 0.875rem / 1.5 Source Sans in Muted Night `#344548`.
  State words, not color, communicate outcomes. No new red/green status system.
- Keep IM Fell in the shared identity; do not turn the action, textarea or status
  into display typography. Warmth comes from the existing material color and
  typography relationships, not ornamental paper, rules across the page or art.

## Layout, scrolling and responsive behavior

At ordinary desktop/portrait heights, use the actual banner height followed by
the remaining workspace: an auto action row and a flexible editor row. Use a
dynamic-viewport layout with fallback, not a subtraction of guessed banner
pixels. The editor owns vertical text overflow; native text wraps and long words
must not create horizontal document scrolling. Disable manual textarea resizing
because layout owns its dimensions. Empty and short drafts occupy the same area.

At 390px and 320px widths the topology does not change. Navigation may wrap as it
already does; the action remains above the editor, not inside the banner or at
the bottom. Do not shrink navigation type, add bottom navigation or reserve a
desktop gutter outside the editor.

Feedback never overlays writing. A short status fits beside the action; if its
full text and action do not fit, put feedback beneath the button within the same
action area, spanning the width. The button stays at the original top-right
position. Only a real exception may enlarge this area and reduce editor height;
there is no healthy-state empty row to prevent that necessary reflow.

When available workspace cannot fit the action/feedback plus **six text lines**
and editor padding, allow ordinary page scrolling with that six-line editor
floor. The banner can scroll offscreen; no sticky overlay covers the editor.
Text beyond the textarea's allocated height still scrolls inside it. This
fallback also covers short landscape and enlarged-text layouts; do not squeeze
the editor to zero or insist on a one-screen composition at 200% text.

With a phone keyboard open, prefer browser viewport resizing and native focus
scrolling. The top action must remain reachable by scrolling without requiring
keyboard dismissal. Do not install continuous scroll-to-top/caret behavior or
guess keyboard height. Add VisualViewport handling only if actual device evidence
requires it, without applying keyboard offsets twice. Real-device verification
remains separate from viewport emulation.

## Draft, save and feedback states

Capture is enabled only for a non-whitespace draft when no request is pending.
Do not trim or rewrite meaningful text in the editor. The server owns formatting,
timestamps and the save result; the UI must not infer success from connectivity.

| State | Action and visible feedback | Draft behavior |
| --- | --- | --- |
| Empty | **Capture**, disabled; no status | Full-height editable textarea, no instructions. |
| Writing | **Capture**, enabled; no routine status | Ordinary native text editing, selection, paste and multiline input. |
| Saving | **Saving…**, disabled; no redundant saving line | Keep the submitted text visible and editor editable. One immutable submission/version; no second submission or queued follow-up. |
| Confirmed saved | Restore **Capture** according to eligibility; **Saved** beside it | Clear only if the current draft version is still the submitted version. If any edit occurred, preserve the entire newer draft, even if its string now matches the submitted string. Do not subtract a guessed submitted prefix. |
| Definitely not saved | Restore **Capture** according to eligibility; **Couldn’t save.** plus a short actionable safe reason if supplied | Preserve text, selection and editor scroll. A fresh explicit capture is possible; no automatic retry. Validation such as an exceeded payload limit names the actual constraint. |
| Outcome uncertain | Restore **Capture** according to eligibility. Show **Save unconfirmed. Capturing again may duplicate it.** | Preserve the draft. The request has ended without a known save outcome; neither clear nor automatically retry it. The next deliberate button activation or normal desktop Enter may capture. |

**Success feedback:** show Saved for three seconds or until the next edit or
submission, whichever comes first. No delayed clear, animation or focus move.
For newer writing, the accessible announcement is **“Entry saved. Newer draft
kept.”** rather than implying that everything now visible is saved.

**Uncertainty feedback:** use the ordinary Capture action and the same input
rules regardless of whether the draft changed. Keep the current-attempt message
until the next explicit submission or result replaces it; editing alone does
not hide it. Do not add dismissal, earlier-attempt warning accumulation or a
special repeat-activation mode. Replacing current feedback is not proof that an
earlier uncertain write was resolved, and a later successful save confirms only
that later attempt. Never automatically retry or queue another capture. Pending
and held-key protections still require a fresh deliberate activation.

Definite failure remains until a new submission or a real successful result;
editing alone does not pretend the failure is repaired. Do not expose raw paths,
exceptions, credentials or note contents in feedback. No Retry toast, Check save
control, speculative progress percentage or unsupported recovery promise.

Draft and pending/uncertain presentation state live in memory with persistent
shell ownership across ordinary SPA tab navigation. Navigating away neither
cancels an accepted write nor resubmits on return. A late result updates the
owned Capture state, not another view's focus. Hard reload/browser closure loses
this volatile state; there is no persistent draft store, unload warning, durable
outbox, cross-process exactly-once guarantee or UI mechanism that resolves an
unknown write. The approved technical plan owns write safety and error mapping.

## Keyboard, focus and announcements

- **Desktop textarea:** Enter captures when eligible; Shift+Enter inserts a
  newline. Do not invent Ctrl/Cmd shortcuts. Do not intercept modified Enter
  combinations other than the specified plain Enter behavior.
- **Mobile device, including attached hardware keyboard:** Enter and Shift+Enter
  insert newlines; Capture is the submission control. Resizing a desktop window
  must not change it into the mobile rule. Use the approved plan's isolated
  browser mobile/platform classification with conservative touch-tablet fallback,
  not viewport width or the last pointer event. No input-mode settings UI.
- IME composition/commit Enter never captures. Ignore repeated submission
  keydowns and prevent held keys from triggering another save after completion.
  Pending Enter must not submit now or later; Shift+Enter remains editing.
- Buttons retain native Tab/Shift+Tab, Enter and Space behavior. Keyboard order
  follows the banner, Capture action, then textarea.
  Errors, success and changing button labels do not remount focused controls.
- Route entry uses the registered H1, not textarea autofocus. Hard entry does not
  pop the phone keyboard. After activation, keep focus where the user put it:
  textarea shortcut keeps editor focus; button activation does not force editor
  focus or reopen a dismissed keyboard. Do not steal focus back if the user
  navigated or moved it while waiting.
- Use a small polite live region for material outcome transitions, not a live
  textarea, whole form or repeated timer announcement. Associate current failure
  or uncertainty text with the editor/action via accessible descriptions. Mark
  only the action/save-status group busy while pending, not the editable field
  or app. The unavailable button remains a native focusable button with an
  exposed disabled state, rather than losing focus when saving starts/finishes.
- Existing app Skip to content remains. The locally hidden route heading must
  retain the existing registration/focus contract. When it holds keyboard-origin
  route focus, show a Night outline inset around the Capture workspace rather
  than an invisible 1px focus ring or an extra visible title row. This is a local
  Capture focus treatment, not a claim that Think already renders that outline.

## Before/after evidence: source, not a claimed render

Inspected current sources in the main checkout on `feat/capture-implementation`:
`src/views/CaptureView.tsx`, `src/styles.css`, `src/shell/NextShell.tsx`,
`src/shell/RouteHeading.tsx`, and the existing Think composer/layout guidance.
No current Capture editor or save interaction exists to benchmark.

| Existing source evidence | Specified replacement |
| --- | --- |
| Visible Capture H1, one purpose paragraph, unavailable heading and paragraph (`CaptureView.tsx:6–14`) | Accessible hidden H1; one top action and a real labelled textarea; none of that placeholder prose. |
| 3.5rem top/bottom workspace padding on desktop, 2rem on narrow (`styles.css:147–154,294–304`) | Capture-local 12px top / 16px bottom insets, plus the actual 44px action and 8px editor gap. |
| Capture wrapper capped at 64rem, minimum 24rem, with a 10rem/8rem spacer (`styles.css:230–240,304`) | Full available width; remaining-height editor; no placeholder spacer. Short-height floor derives from six writing lines, not decorative space. |
| Actual shell uses a wrapping banner and main as successive grid rows (`NextShell.tsx:47–61`) | Keep that topology and actual header height; no fixed header deduction or new app rail. |
| Parchment/Night Capture variables and light color scheme already exist (`styles.css:220–228`) | Preserve those exact roles, local fonts and native light controls. |

These are concrete source-to-design changes, not measured pixel gains or
screenshots of an implemented interface. The earlier Think UX document contains
superseded Enter rules; this Capture intent/approved plan controls this surface.

## Acceptance and review boundary

- At **1440×900, 390×844 and 320×568**, confirm the empty/writing editor takes
  the remaining area, top action aligns with its right edge, and no placeholder
  spacing, extra title/status row, footer or horizontal page overflow remains.
- At **844×390**, **200% text** and reduced workspace height, verify the six-line
  fallback, reachable action, complete labels, safe-area/focus clearance and no
  overlap. Errors may reflow below the stable top-right action; healthy state may
  not reserve that space. On ordinary heights, textarea overflow must not scroll
  the entire banner away just because the draft grew.
- Inspect default/hover/focus/pressed/disabled styling and light-context contrast
  in the actual implementation, including forced colors. Use existing palette
  contrast evidence only as a baseline, not proof of new control rendering.
- With controlled delayed responses, test unchanged-save clearing, edited and
  edited-back draft preservation, definite rejection, uncertain feedback and
  deliberate recapture through the ordinary button/desktop Enter behavior.
  Verify no automatic retry, queued or held-key resubmission, and no false claim
  that a later success resolved an earlier uncertain write. Check navigation/
  late results and native focus.
- Verify desktop/mobile input modes separately from viewport sizes, IME and
  repeat protection, plus physical phone keyboard-open and attached-hardware
  behavior if available. Record unavailable physical-device/assistive-technology
  checks as limits; browser emulation cannot certify them.

**This phase's validation:** design consistency checked against the current
source shell, intent, approved plan, complete project design guidance and
applicable Impeccable Shape/Operate guidance. The personal-brand skill was denied
access; the approved local brand records supplied authority instead. No
design-author procedure was found through available procedure discovery; no
unavailable procedure is claimed. No code, tests, runtime, private configuration
or Beads status changed. No rendered result or real save is validated here.
Next gate: fresh read-only designer review of this brief before implementation.
