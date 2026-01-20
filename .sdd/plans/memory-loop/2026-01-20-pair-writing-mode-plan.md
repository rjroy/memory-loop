---
version: 1.1.0
status: Approved
created: 2026-01-20
last_updated: 2026-01-20
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
spec: .sdd/specs/memory-loop/2026-01-20-pair-writing-mode.md
---

# Pair Writing Mode Technical Plan

## Overview

This plan addresses spec v1.1.0 requirements for two complementary capabilities:

1. **Quick Actions**: Transformative text actions (Tighten, Embellish, Correct, Polish) available in Browse mode's editor, working on both desktop and mobile via context menu
2. **Pair Writing Mode**: Desktop-only split-screen with advisory actions (Validate, Critique), freeform chat, and snapshot comparison

## Architecture

### High-Level Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         BrowseMode                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    MemoryEditor                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              EditorContextMenu                       │  │  │
│  │  │  (Quick Actions: Tighten, Embellish, Correct, Polish)│  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                    [Enter Pair Writing]                          │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   PairWritingMode (Desktop Only)           │  │
│  │  ┌─────────────────┐     ┌─────────────────────────────┐  │  │
│  │  │   Editor Pane    │     │    Conversation Pane        │  │  │
│  │  │  (MemoryEditor)  │     │  (Reuses Discussion UI)     │  │  │
│  │  │  + Snapshot btn  │     │  + Freeform chat input      │  │  │
│  │  │  + Full context  │     │  + Selection context        │  │  │
│  │  │    menu (6 items)│     │                             │  │  │
│  │  └─────────────────┘     └─────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow: Quick Actions

```
User selects text → Right-click/Long-press → Context menu appears
        │
        ▼
    Select action (e.g., "Tighten")
        │
        ▼
    Frontend extracts:
      - File path, selection text, line numbers
      - Paragraph context (before/after)
        │
        ▼
    Send `quick_action_request` via WebSocket
        │
        ▼
    Backend creates task-scoped Claude session:
      - System prompt: Action-specific instructions (be efficient)
      - Read + Edit tools available (scoped to vault)
        │
        ▼
    Claude executes (typically 3-5 turns):
      Turn 1: "I'll tighten this." → Read tool
      Turn 2: "I see the text." → Edit tool
      Turn 3: "Done. Removed 3 filler phrases."
        │
        ▼
    Backend streams events to frontend:
      - tool_start/tool_end (Read)
      - tool_start/tool_end (Edit - file written)
      - response_chunk (brief confirmation)
      - response_end
        │
        ▼
    File is already updated on disk
    Frontend reloads file content, shows toast with confirmation
```

### Data Flow: Advisory Actions (Pair Writing Mode)

```
User selects text → Right-click → Choose "Validate" or "Critique"
        │
        ▼
    Frontend extracts selection + context
        │
        ▼
    Send `advisory_action_request` via WebSocket
        │
        ▼
    Backend creates Claude request (streamed):
      - System prompt: Advisory instructions
      - User message: Selection + context
        │
        ▼
    Stream response chunks to conversation pane
        │
        ▼
    User reads feedback, manually edits document
```

## Technical Decisions

### TD-1: Context Menu Implementation

**Decision**: Create a new `EditorContextMenu` component rather than extending FileTree's menu.

**Rationale**: FileTree's menu operates on file paths; editor menu operates on text selections. Different data models and positioning logic. The long-press timer pattern from FileTree (500ms timeout, touch event handling) will be extracted into a reusable hook.

**Implementation**:
- New `useLongPress` hook in `frontend/src/hooks/useLongPress.ts`
- New `EditorContextMenu.tsx` component with portal rendering
- Position calculated from Selection API's `getBoundingClientRect()`

*Addresses*: REQ-F-2, REQ-F-3, REQ-NF-3, REQ-NF-6

### TD-2: Quick Actions via Claude Tool Use

**Decision**: Quick Actions use Claude's Read and Edit tools to modify the file directly, leveraging the existing SDK streaming infrastructure.

**Rationale**:
- Claude already knows how to use file editing tools
- Tool use pattern is already implemented in the Discussion flow
- Claude handles the complexity of determining exact edit boundaries
- Consistent mental model: "Claude edits your file" (not "Claude suggests, you apply")
- File is immediately persisted - no "unsaved changes" state for Quick Actions

**Expected turn sequence** (typically 3-5 turns):
1. User message with prompt + context
2. Claude acknowledges task, uses Read tool to see current file
3. Claude confirms what it sees, uses Edit tool to make change
4. Claude confirms completion (brief)

**Backend Flow**:
1. Receive `quick_action_request` with action type, file path, selection, line numbers
2. Create task-scoped Claude session with Read/Edit tools available
3. System prompt instructs Claude to work efficiently (read → edit → confirm)
4. Stream tool_start/tool_end events to frontend (reuse existing infrastructure)
5. Claude's Edit tool invocation writes directly to vault file
6. Session ends; optional commentary shown as toast

**Why not one-shot text-in/text-out**:
- Would require backend to apply the edit (duplicating Edit tool logic)
- Loses Claude's reasoning about edit boundaries and context
- Misses opportunity to show tool use in UI (transparency)

*Addresses*: REQ-F-4, REQ-F-5, REQ-F-6

### TD-3: Action-Specific System Prompts

**Decision**: Store action prompts in a configuration object on the backend, not in the vault.

**Rationale**:
- Spec requires fixed actions (no user customization in v1)
- Backend control ensures consistent behavior across vaults
- Easy to tune prompts without user intervention
- Future: could expose in vault config when customization is added

**Prompt Structure** (example for "Tighten"):
```
You are a writing assistant performing a Quick Action. Be efficient: read the file, make the edit, confirm briefly.

Task: Tighten the selected text in "{filePath}" (lines {startLine}-{endLine}).

Rules for "Tighten":
- Preserve the core meaning
- Remove filler words, redundant phrases, unnecessary qualifiers
- Maintain the author's voice and the document's tone

Selected text to revise:
{selectedText}

Surrounding context (for tone matching - do not modify this):
{contextBefore}
[SELECTION TO EDIT]
{contextAfter}

Workflow:
1. Read the file to see current state
2. Use Edit tool to replace the selection with tightened version
3. Confirm with one sentence (e.g., "Removed 3 filler phrases.")

Keep responses brief. No lengthy explanations.
```

**Efficiency guidance in prompt**:
- Explicitly states "be efficient" and "keep responses brief"
- Provides workflow steps to minimize wandering
- Asks for one-sentence confirmation, not paragraphs

**Position hint logic**: Based on line numbers relative to document length:
- Lines 1-20% → "near the beginning of"
- Lines 20-80% → "in the middle of"
- Lines 80-100% → "near the end of"

**Tool availability**: Quick Action requests provide Claude with Read and Edit tools scoped to the current vault.

*Addresses*: REQ-F-1, REQ-F-4

### TD-4: Selection Context Extraction

**Decision**: Extract one paragraph before and after the selection, where paragraphs are delimited by double newlines (`\n\n`).

**Rationale**:
- Spec explicitly defines paragraph boundaries as blank lines (REQ-F-4)
- One paragraph provides sufficient context for tone/style matching
- Prevents sending entire document to Claude (cost, latency, privacy)
- Consistent behavior regardless of document size

**Implementation**:
```typescript
interface SelectionContext {
  before: string;      // Paragraph before selection
  selection: string;   // Selected text
  after: string;       // Paragraph after selection
  startLine: number;   // 1-indexed line number of selection start
  endLine: number;     // 1-indexed line number of selection end
  totalLines: number;  // Total lines in document
}

function extractContext(content: string, selectionStart: number, selectionEnd: number): SelectionContext {
  // Find paragraph boundaries using \n\n as delimiter
  // Count newlines to determine line numbers
  // Return context with text and line metadata
}
```

*Addresses*: REQ-F-4, REQ-F-8

### TD-5: Pair Writing Mode State Management

**Decision**: Pair Writing Mode state managed in BrowseMode component, not in SessionContext.

**Rationale**:
- Pair Writing is a Browse sub-mode, not a top-level mode
- Session-scoped state (conversation, snapshot) fits naturally in component state
- SessionContext manages cross-mode concerns (vault, session ID); Pair Writing is single-mode
- Simplifies cleanup: unmounting PairWritingMode clears all state

**State Shape**:
```typescript
interface PairWritingState {
  isActive: boolean;
  content: string;           // Current editor content
  snapshot: string | null;   // Manual snapshot for comparison
  conversation: Message[];   // Session-scoped chat history
  selection: Selection | null; // Current text selection
  hasUnsavedChanges: boolean;
}
```

*Addresses*: REQ-F-22, REQ-F-23, REQ-F-24, REQ-F-27

### TD-6: Split-Screen Layout

**Decision**: CSS Grid with two columns; no drag-to-resize in v1.

**Rationale**:
- Simpler implementation than draggable divider
- Open question in spec ("Should split be resizable?") leaves room for v1 simplicity
- 50/50 split is reasonable default for editor + conversation
- Can add resize handle in future iteration

**CSS**:
```css
.pair-writing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  height: 100%;
}
```

*Addresses*: REQ-F-11

### TD-7: Conversation Pane Reuse

**Decision**: Extract conversation display logic from Discussion.tsx into a shared `ConversationPane` component.

**Rationale**:
- REQ-NF-4 requires conversation pane styling to match Discussion mode
- Discussion.tsx currently bundles conversation display with mode-specific logic
- Extracting shared component ensures visual consistency and reduces duplication
- Pair Writing conversation is simpler (no tool invocations display needed for advisory actions)

**Extraction**:
```
Discussion.tsx
    ├── uses → ConversationPane (new shared component)
    │              ├── MessageList
    │              ├── ChatInput
    │              └── Streaming indicator
    └── mode-specific logic (slash commands, tool permissions)

PairWritingConversation.tsx
    └── uses → ConversationPane (same shared component)
```

*Addresses*: REQ-F-13, REQ-NF-4

### TD-8: Snapshot Implementation

**Decision**: Store snapshot as a string in PairWritingState; comparison performed client-side with diff sent to Claude for analysis.

**Rationale**:
- Single snapshot (REQ-F-24) simplifies to one string field
- Client has both current and snapshot content; can compute diff without backend
- Send diff (not full documents) to Claude for "what changed" analysis
- Keeps snapshot ephemeral (session-scoped per REQ-F-27)

**Flow**:
1. User clicks "Snapshot" → `snapshot = content`
2. User edits document → `content` changes
3. User selects text, clicks "Compare to snapshot"
4. Frontend finds corresponding region in snapshot (by line numbers or fuzzy match)
5. If found: send before/after to backend for Claude analysis
6. If not found: show "No corresponding text in snapshot" (REQ-F-26)

*Addresses*: REQ-F-23, REQ-F-24, REQ-F-25, REQ-F-26, REQ-F-27

### TD-9: Desktop-Only Detection

**Decision**: Use CSS media query combined with touch event detection.

**Rationale**:
- `@media (hover: hover) and (pointer: fine)` targets devices with mouse
- Additional runtime check for `'ontouchstart' in window` catches edge cases
- Hides "Pair Writing" button via CSS on touch devices (REQ-F-10)
- Touch detection also used to show/hide context menu items appropriately

**Implementation**:
```css
@media (hover: none), (pointer: coarse) {
  .pair-writing-button { display: none; }
  .advisory-actions { display: none; }
}
```

*Addresses*: REQ-F-10, REQ-NF-1

### TD-10: Loading State During Quick Actions

**Decision**: Apply visual indicator (opacity reduction + spinner) to the selected text range while Claude processes.

**Rationale**:
- REQ-F-7 requires loading indicator on selection
- Can't use global spinner (user might think whole app is frozen)
- Selection highlight with reduced opacity + small spinner near cursor provides clear feedback
- Indicator shows during Claude's reasoning + tool execution (typically 2-5 seconds)

**Implementation**:
- On `quick_action_request` send: apply loading state to selection
- Show spinner near selection while streaming (tool_start → tool_end)
- On `response_end`: remove loading state, reload file content from disk
- If error: remove loading state, show error toast

*Addresses*: REQ-F-7

### TD-11: Document Save Flow

**Decision**: Quick Actions are immediately persisted (Claude uses Edit tool). Pair Writing Mode manual edits use existing `write_file` for saving.

**Rationale**:
- Quick Actions: Claude's Edit tool writes directly to disk - no "unsaved" state
- Manual edits in Pair Writing Mode: User types in editor, needs explicit save
- `hasUnsavedChanges` only tracks manual edits, not Quick Action results
- Last-write-wins per spec (REQ-F-29); no conflict detection needed

**Implementation**:
- Quick Actions: File updated by Claude's tool invocation; frontend reloads content
- Manual edits: PairWritingToolbar Save button calls existing `write_file` handler
- Exit button checks `hasUnsavedChanges` for manual edits only
- After Quick Action completes, editor reloads file from disk (not from response)

**Spec note**: REQ-F-8 states "Quick Action edits are part of unsaved changes" but this conflicts with tool-based approach. Recommend updating spec to clarify Quick Actions persist immediately.

*Addresses*: REQ-F-28, REQ-F-29, REQ-F-30 (REQ-F-8 needs spec revision)

### TD-12: Keyboard Accessibility

**Decision**: EditorContextMenu supports keyboard navigation via arrow keys and Enter/Escape.

**Rationale**:
- REQ-NF-5 requires keyboard-navigable context menu
- Pattern matches native browser context menus and accessibility expectations
- Focus trap while menu is open; Escape dismisses

**Implementation**:
- Menu items are focusable `<button>` elements
- Arrow Up/Down moves focus between items
- Enter activates focused item
- Escape closes menu, returns focus to editor
- `role="menu"` and `role="menuitem"` ARIA attributes

*Addresses*: REQ-NF-5

### TD-13: Snapshot Comparison Logic

**Decision**: Use line-based offset matching for finding corresponding text in snapshot.

**Rationale**:
- Character-based matching breaks when content shifts (adds/deletes)
- Line-based approach: find selection's line range in current, look for similar lines in snapshot
- If exact line content match not found, use fuzzy line matching (Levenshtein within threshold)
- If no match found after fuzzy search, return "no corresponding text" message

**Algorithm**:
1. Get line numbers of current selection (startLine, endLine)
2. Extract those lines from snapshot content
3. If exact match: use snapshot lines as "before"
4. If no exact match: search snapshot for lines with >80% similarity
5. If still no match: return null (triggers "no corresponding text" UI)

**Fallback**: For heavily restructured documents, comparison may not find matches. This is acceptable; user can take new snapshot after major edits.

*Addresses*: REQ-F-26

## WebSocket Protocol Additions

### New Client Messages

```typescript
// Quick Action request (all platforms)
interface QuickActionRequest {
  type: "quick_action_request";
  action: "tighten" | "embellish" | "correct" | "polish";
  selection: string;
  contextBefore: string;
  contextAfter: string;
  filePath: string;           // Included in prompt for document type context
  selectionStartLine: number; // 1-indexed line number
  selectionEndLine: number;   // 1-indexed line number
  totalLines: number;         // For position hint calculation
}

// Advisory Action request (Pair Writing Mode, desktop)
interface AdvisoryActionRequest {
  type: "advisory_action_request";
  action: "validate" | "critique" | "compare";
  selection: string;
  contextBefore: string;
  contextAfter: string;
  filePath: string;
  selectionStartLine: number;
  selectionEndLine: number;
  totalLines: number;
  // For compare action only:
  snapshotSelection?: string;
}

// Freeform chat in Pair Writing (desktop)
interface PairChatRequest {
  type: "pair_chat_request";
  text: string;
  selection?: string;
  contextBefore?: string;
  contextAfter?: string;
  filePath: string;
  selectionStartLine?: number;
  selectionEndLine?: number;
  totalLines?: number;
}
```

### Server Messages

Quick Actions, Advisory Actions, and Pair Chat all use **existing streaming messages**:
- `response_start` - Claude turn begins
- `tool_start` - Tool invocation started (e.g., Edit tool for Quick Actions)
- `tool_input` - Tool parameters
- `tool_end` - Tool completed (file written for Quick Actions)
- `response_chunk` - Text content (commentary for Quick Actions, feedback for Advisory)
- `response_end` - Claude turn complete

No new server message types needed. This reuses the Discussion infrastructure.

### Schema Location

Add to `shared/src/protocol.ts`:
- New message types in `ClientMessageSchema` discriminated union
- New message types in `ServerMessageSchema` discriminated union
- Action type enums for validation

*Addresses*: REQ-F-1 through REQ-F-8, REQ-F-15, REQ-F-16, REQ-F-21

## Backend Handler Structure

### New Handler File: `pair-writing-handlers.ts`

```typescript
// handlers/pair-writing-handlers.ts
export async function handleQuickAction(ctx: HandlerContext, request: QuickActionRequest): Promise<void>
export async function handleAdvisoryAction(ctx: HandlerContext, request: AdvisoryActionRequest): Promise<void>
export async function handlePairChat(ctx: HandlerContext, request: PairChatRequest): Promise<void>
```

### Quick Action Handler Logic

1. Validate request fields (file path within vault, selection not empty)
2. Build system prompt from action-specific template (include file path, selection, context)
3. Create task-scoped Claude session with Read + Edit tools available
4. Claude runs multiple turns (typically 3-5): acknowledge → read → edit → confirm
5. Stream all events to frontend (reuse existing streaming infrastructure)
6. Session auto-terminates after Claude confirms completion
7. `response_end` signals completion; frontend reloads file from disk

### Advisory Action Handler Logic

1. Validate request fields (must have vault selected)
2. Build system prompt for advisory action
3. Use existing streaming infrastructure (similar to Discussion)
4. Stream response to `response_chunk` messages
5. No persistence (conversation is frontend-managed)

*Addresses*: REQ-F-4, REQ-F-5, REQ-F-6, REQ-F-16, REQ-F-17

## Component Structure

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `EditorContextMenu` | `components/EditorContextMenu.tsx` | Context menu for text selections |
| `PairWritingMode` | `components/PairWritingMode.tsx` | Split-screen container (desktop) |
| `PairWritingToolbar` | `components/PairWritingToolbar.tsx` | Snapshot, Save, Exit buttons |
| `ConversationPane` | `components/ConversationPane.tsx` | Shared message display (extracted from Discussion) |
| `SelectionQuote` | `components/SelectionQuote.tsx` | Quoted selection above chat input |

### New Hooks

| Hook | Location | Purpose |
|------|----------|---------|
| `useLongPress` | `hooks/useLongPress.ts` | Long-press detection for mobile context menu |
| `useTextSelection` | `hooks/useTextSelection.ts` | Track current selection in editor (text, start/end line numbers) |
| `usePairWritingState` | `hooks/usePairWritingState.ts` | Manage pair writing session state |

### Modified Components

| Component | Changes |
|-----------|---------|
| `BrowseMode` | Add "Pair Writing" button, render PairWritingMode when active |
| `MemoryEditor` | Add context menu trigger, selection tracking |
| `Discussion` | Extract ConversationPane (no behavior change) |

## Testing Strategy

### Unit Tests

- `useLongPress.test.ts`: Timer behavior, cancel on move/end, 500ms threshold
- `useTextSelection.test.ts`: Selection change detection, range extraction
- `extractContext.test.ts`: Paragraph boundary detection, edge cases
- `pair-writing-handlers.test.ts`: Action dispatch, prompt building, response parsing

### Integration Tests

- Quick Action flow: Select → Menu → Response → Replacement
- Advisory Action flow: Select → Menu → Streaming → Conversation display
- Snapshot flow: Create → Edit → Compare → Analysis display
- Unsaved changes warning: Edit → Exit → Confirm dialog

### Platform Tests

- Desktop: Right-click triggers menu
- Mobile: Long-press triggers menu (Quick Actions only)
- Touch device: "Pair Writing" button hidden

*Addresses*: Acceptance tests 1-12 in spec

## Security Considerations

- **File Path Validation**: Reuse existing `validatePath` from file-browser.ts for `filePath` field
- **Content Size Limits**: Enforce max selection size (e.g., 10KB) to prevent abuse
- **Rate Limiting**: Quick Actions are stateless; consider per-connection rate limit
- **Prompt Injection**: Selection text is inserted into prompts; use clear delimiters and instructions

## Performance Considerations

- **REQ-NF-2**: Editor performance (60fps) maintained by using existing MemoryEditor
- **REQ-NF-3**: Context menu appears <100ms (menu is pre-rendered, shown on trigger)
- **Quick Action Latency**: One-shot requests typically complete in 1-3 seconds
- **Large Files**: Context extraction is O(n) but n is bounded by file size limit (50KB per spec)

## Migration/Rollout

No database migrations needed. Feature is additive:
1. Deploy backend with new handlers
2. Deploy frontend with new components
3. Feature available immediately; no vault config changes required

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Selection API inconsistencies across browsers | Medium | Medium | Test on Chrome, Firefox, Safari; use Selection polyfill if needed |
| Long-press conflicts with text selection on mobile | Medium | High | Carefully tune timing; test on iOS Safari and Android Chrome |
| Claude returns malformed responses (no text, wrong format) | Low | Medium | Validate response format; fall back to showing raw response |
| Large selections cause slow/expensive Claude calls | Medium | Medium | Enforce selection size limit; show warning for large selections |
| Snapshot comparison fails to find matches after edits | Medium | Low | "No corresponding text" message is acceptable; user can take new snapshot |

## Open Questions Resolution

| Question | Decision | Rationale |
|----------|----------|-----------|
| Hotkey for "jump to chat" | `Tab` when selection exists | Tab is intuitive for "move focus"; already used for form navigation |
| Resizable split? | No in v1 | Simplifies implementation; can add in future iteration |

## Requirements Traceability

| Requirement | Addressed By |
|-------------|--------------|
| REQ-F-1 | TD-3 (Action-specific prompts) |
| REQ-F-2 | TD-1 (Context menu implementation) |
| REQ-F-3 | TD-1 (Long-press via useLongPress hook) |
| REQ-F-4 | TD-2, TD-3, TD-4 (Claude request with context, Edit tool available) |
| REQ-F-5 | TD-2 (Claude Edit tool writes directly to file) |
| REQ-F-6 | TD-2 (Toast for commentary) |
| REQ-F-7 | TD-10 (Loading indicator) |
| REQ-F-8 | **SPEC REVISION NEEDED**: Quick Actions persist immediately via tool use; only manual edits track unsaved state |
| REQ-F-9 | Modified Components: BrowseMode adds "Pair Writing" button |
| REQ-F-10 | TD-9 (Desktop-only detection) |
| REQ-F-11 | TD-6 (Split-screen layout) |
| REQ-F-12 | Component Structure: PairWritingMode uses MemoryEditor |
| REQ-F-13 | TD-7 (ConversationPane reuse) |
| REQ-F-14 | Component Structure: PairWritingToolbar with Exit button |
| REQ-F-15 | WebSocket Protocol: AdvisoryActionRequest |
| REQ-F-16 | Backend Handler: handleAdvisoryAction |
| REQ-F-17 | Data Flow: Advisory Actions (manual editing after feedback) |
| REQ-F-18 | EditorContextMenu shows all 6 actions in Pair Writing Mode |
| REQ-F-19 | Open Questions Resolution: Tab hotkey |
| REQ-F-20 | Component Structure: SelectionQuote component |
| REQ-F-21 | WebSocket Protocol: PairChatRequest |
| REQ-F-22 | TD-5 (Session-scoped conversation) |
| REQ-F-23 | TD-5, TD-8 (Snapshot button and storage) |
| REQ-F-24 | TD-8 (Single snapshot design) |
| REQ-F-25 | TD-8 (Compare action in context menu) |
| REQ-F-26 | TD-8, TD-13 (Comparison logic with fallback) |
| REQ-F-27 | TD-5 (Session-scoped state) |
| REQ-F-28 | TD-11 (No auto-save) |
| REQ-F-29 | TD-11 (Reuse write_file handler) |
| REQ-F-30 | TD-11 (Exit warning via hasUnsavedChanges) |
| REQ-NF-1 | TD-9 (Platform detection) |
| REQ-NF-2 | Performance Considerations (existing MemoryEditor) |
| REQ-NF-3 | TD-1 (Pre-rendered menu), Performance Considerations |
| REQ-NF-4 | TD-7 (Shared ConversationPane) |
| REQ-NF-5 | TD-12 (Keyboard accessibility) |
| REQ-NF-6 | TD-1 (500ms long-press threshold) |

---

**Next Phase**: Once approved, use `/task-breakdown` to decompose into implementable tasks.
