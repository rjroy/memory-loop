---
version: 1.2.0
status: Approved
created: 2026-01-20
last_updated: 2026-01-20
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Pair Writing Mode Specification

## Executive Summary

This feature adds AI-assisted text revision to Memory Loop through two complementary capabilities:

1. **Quick Actions** (all platforms): Four transformative actions (Tighten, Embellish, Correct, Polish) available via context menu when editing any markdown file. AI directly replaces the selected text with the improved version.

2. **Pair Writing Mode** (desktop only): A split-screen editor with conversation pane for advisory actions (Validate, Critique), freeform chat about selections, and "What Changed?" comparisons.

Quick Actions reduce friction for common revision tasks. Pair Writing Mode enables deeper collaboration where the user reads AI feedback and manually applies changes, preserving the learning loop.

## User Story

As a writer using Memory Loop, I want AI to help me revise text in place for quick edits, and provide advisory feedback in a side-by-side view for deeper revision, so that I can choose the right level of AI involvement for each situation.

## Stakeholders

- **Primary**: Writers using Memory Loop for knowledge work and drafting
- **Secondary**: Memory Loop maintainers (new component patterns, state management)

## Success Criteria

1. User can invoke Quick Actions on selected text in any markdown file (desktop and mobile)
2. AI directly replaces selected text for transformative actions
3. User can enter Pair Writing Mode for advisory actions and freeform chat (desktop)
4. User can snapshot and compare edits in Pair Writing Mode

## Functional Requirements

### Quick Actions (All Platforms)

- **REQ-F-1**: When editing a markdown file in Browse mode, provide context menu with four transformative actions:
  - **Tighten**: Make more concise without losing meaning
  - **Embellish**: Add detail, nuance, or context
  - **Correct**: Fix typos and grammar only
  - **Polish**: Correct + improve prose (controlled improvements)
- **REQ-F-2**: On desktop, context menu appears on right-click when text is selected
- **REQ-F-3**: On mobile, context menu appears on long-press when text is selected (prevent system context menu)
- **REQ-F-4**: Invoking a Quick Action sends selection + surrounding context to Claude. Context includes the paragraph containing the selection plus one paragraph before and after (paragraphs delimited by blank lines)
- **REQ-F-5**: Claude returns revised text; system replaces the selection with the revised text in-place
- **REQ-F-6**: If Claude includes commentary, display as toast notification
- **REQ-F-7**: Show loading indicator on the selection while AI is processing
- **REQ-F-8**: Quick Action edits persist immediately to disk (Claude uses Edit tool directly); no explicit save required for Quick Actions

### Pair Writing Mode Entry and Layout (Desktop Only)

- **REQ-F-9**: When viewing a markdown file in Browse mode on desktop, display "Pair Writing" button to enter the mode
- **REQ-F-10**: Hide "Pair Writing" button on mobile/touch devices
- **REQ-F-11**: Pair Writing Mode displays split-screen layout: left pane (editor), right pane (conversation)
- **REQ-F-12**: Left pane contains an editable markdown editor with the current file content
- **REQ-F-13**: Right pane contains a conversation log and chat input
- **REQ-F-14**: Provide "Exit" button to return to standard Browse view, with warning if manual edits are unsaved

### Advisory Actions (Desktop Only, Pair Writing Mode)

- **REQ-F-15**: In Pair Writing Mode, context menu includes two additional advisory actions:
  - **Validate**: Fact-check the claim
  - **Critique**: Analyze clarity, voice, structure
- **REQ-F-16**: Advisory actions send selection + context to Claude; response appears in conversation pane
- **REQ-F-17**: User reads feedback and manually applies changes by editing the document
- **REQ-F-18**: Quick Actions (Tighten, Embellish, Correct, Polish) also available in Pair Writing Mode context menu, behaving the same as in Browse mode (direct replacement)

### Freeform Chat (Desktop Only, Pair Writing Mode)

- **REQ-F-19**: User can highlight text and press a hotkey to jump to chat input
- **REQ-F-20**: When chat input is focused with a selection, display the selection as a quoted block above the input
- **REQ-F-21**: User types a freeform question; Claude responds with selection context attached
- **REQ-F-22**: Conversation history persists for the session (lost on exit or file switch)

### Shadow Versioning (Desktop Only, Pair Writing Mode)

- **REQ-F-23**: Provide "Snapshot" button to manually capture the current document state
- **REQ-F-24**: Only one snapshot exists at a time; new snapshot replaces previous
- **REQ-F-25**: When a snapshot exists and text is selected, enable "Compare to snapshot" action in context menu
- **REQ-F-26**: "Compare to snapshot" displays a diff in the conversation pane showing:
  - BEFORE (snapshot): original text at that location
  - AFTER (current): user's current text
  - ANALYSIS: Claude's description of what changed (objective, not judgmental)
  - If selection location has no corresponding text in snapshot (new content), display "No corresponding text in snapshot" message
- **REQ-F-27**: Snapshot is session-scoped (cleared on exit or file switch)

### Document Persistence

- **REQ-F-28**: Manual edits in Pair Writing Mode are not auto-saved; Quick Actions persist immediately via Claude's Edit tool
- **REQ-F-29**: Provide "Save" button to write manual edits back to the vault file (last write wins; no conflict detection in v1)
- **REQ-F-30**: Warn user if exiting Pair Writing Mode with unsaved manual edits

## Non-Functional Requirements

- **REQ-NF-1** (Platform): Quick Actions work on desktop and mobile; Pair Writing Mode is desktop-only
- **REQ-NF-2** (Performance): Editor must maintain 60fps (16ms per frame) when typing in files up to 50KB
- **REQ-NF-3** (Responsiveness): Context menu appears within 100ms of trigger (right-click or long-press)
- **REQ-NF-4** (Consistency): Conversation pane styling matches existing Discussion mode
- **REQ-NF-5** (Accessibility): Context menu is keyboard-navigable after opening
- **REQ-NF-6** (Mobile UX): Long-press duration matches platform convention (~500ms)

## Explicit Constraints (DO NOT)

- Do NOT auto-apply advisory action responses (Validate, Critique) to the document
- Do NOT persist conversation history to the vault (session-only)
- Do NOT show Pair Writing Mode entry point on mobile/touch devices
- Do NOT allow custom user-defined actions in v1 (fixed set of 6)
- Do NOT auto-save manual edits (explicit save required); Quick Actions persist immediately by design
- Do NOT support multiple simultaneous snapshots (one snapshot at a time)

## Technical Context

- **Existing Stack**: React 19 frontend, Hono backend, WebSocket communication, Claude Agent SDK
- **Integration Points**:
  - Browse mode adjust/edit flow (entry point for Quick Actions)
  - FileTree context menu pattern (long-press implementation reference)
  - WebSocket protocol (new message types for pair writing actions)
  - Session management (conversation history uses existing patterns)
- **Patterns to Respect**:
  - State management via SessionContext (useReducer pattern)
  - Zod-validated message schemas in shared/
  - CSS modules for component styling

## Acceptance Tests

### Quick Actions (All Platforms)
1. **Desktop Quick Action**: Edit markdown file → select text → right-click → choose "Tighten" → selection replaced with tightened text
2. **Mobile Quick Action**: Edit markdown file → select text → long-press → choose "Polish" → selection replaced with polished text
3. **Quick Action Toast**: Invoke "Correct" → AI includes commentary → toast appears with commentary
4. **Quick Action Loading**: Invoke action → loading indicator visible on selection → indicator clears when complete

### Pair Writing Mode (Desktop Only)
5. **Enter Pair Writing**: Open markdown file on desktop → click "Pair Writing" → split-screen layout appears
6. **Advisory Action**: In Pair Writing Mode → select text → right-click → choose "Validate" → response appears in conversation pane (not inline)
7. **Freeform Chat**: Select text → press hotkey → cursor in chat with selection quoted → type question → response includes selection context
8. **Snapshot + Compare**: Click "Snapshot" → edit text → select edited region → "Compare to snapshot" → diff with analysis appears in conversation pane

### Document Persistence
9. **Quick Action Persistence**: Invoke Quick Action on text → file immediately updated on disk (verify by re-opening file)
10. **Manual Edit Save Flow**: In Pair Writing Mode → type manual edits → click "Save" → changes written to vault
11. **Exit Warning**: In Pair Writing Mode → type manual edits without saving → click "Exit" → confirmation dialog appears

### Platform Behavior
12. **Desktop-Only Pair Writing**: Load Memory Loop on touch device → "Pair Writing" button not visible
13. **Mobile Quick Actions Available**: Load Memory Loop on touch device → edit markdown → select text → long-press → context menu with Quick Actions appears

## Open Questions

- [ ] Exact hotkey for "jump to chat" in Pair Writing Mode (Tab vs Cmd+Enter vs configurable)
- [ ] Should the split be resizable by dragging the divider?

## Out of Scope

- Custom user-defined actions
- Persistent conversation history (stored in vault)
- Multiple snapshots / full version history
- Rich text / WYSIWYG editing (markdown source only)
- Collaborative multi-user editing
- Undo/redo for Quick Action replacements (uses standard editor undo)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
