---
title: Vi Mode for Pair Writing
date: 2026-01-29
status: executed
tags: [vi-mode, pair-writing, modal-editing, keyboard]
modules: [pair-writing-editor, use-vi-mode]
related: [.lore/specs/vi-mode-pair-writing.md, .lore/_archive/vi-mode-implementation.md]
---

# Plan: Vi Mode for Pair Writing

## Context

- **Spec**: `.lore/specs/vi-mode-pair-writing.md`
- **Research**: `.lore/_archive/vi-mode-implementation.md`
- **Integration target**: `PairWritingMode.tsx` and `PairWritingEditor.tsx`

## Approach

The vi mode implementation follows a **layered architecture** with clear separation:

1. **Configuration layer** - Vault config addition, keyboard detection
2. **State machine layer** - Mode management, key sequence buffering
3. **Command execution layer** - Cursor manipulation, text operations
4. **UI layer** - Mode indicator, command input

The core abstraction is a `useViMode` hook that encapsulates all vi behavior and integrates with the existing `PairWritingEditor` via props.

## Technical Decisions

**TD-1: Hook-based architecture**

Create `useViMode(textareaRef, options)` hook that returns:
- `mode`: current mode (normal/insert/command)
- `handleKeyDown`: event handler to attach to textarea
- `commandBuffer`: current ex command being typed
- `pendingCount`: numeric prefix being accumulated
- `pendingOperator`: buffered operator awaiting motion (`d`, `y`, or null)
- `clipboard`: internal yank buffer
- `undoStack`: array of content snapshots for `u` command

This keeps vi logic isolated and testable independent of React rendering.

**TD-2: Keyboard detection via matchMedia**

Use `window.matchMedia('(pointer: fine)')` combined with `navigator.maxTouchPoints` to detect keyboard availability:
```typescript
const hasKeyboard =
  window.matchMedia('(pointer: fine)').matches ||
  navigator.maxTouchPoints === 0;
```

This isn't perfect but catches most cases. If detection fails, user gets standard editing (safe fallback).

**TD-3: Textarea cursor manipulation**

Use `selectionStart`/`selectionEnd` properties to track and move cursor:
- Normal mode: collapse selection to single point (cursor)
- Movement commands: update `selectionStart` and `selectionEnd`
- Insert mode: let browser handle naturally

Line-based operations parse content by newlines to find line boundaries.

**TD-4: Key event handling strategy**

In Normal mode, `onKeyDown` handler:
1. Check for numeric digit → accumulate in `pendingCount`
2. Check for operator key (`d`, `y`) → set pending operator
3. Check for motion/action → execute with count
4. `preventDefault()` to stop character insertion

In Insert mode:
- Only intercept `Escape` → return to Normal
- All other keys pass through naturally

**TD-5: Command mode UI**

When `:` pressed, render a small input field at bottom of editor (vim-style command line). This is a controlled input that:
- Captures text until Enter or Escape
- On Enter, parses and executes command
- On Escape, dismisses without action

Rendered conditionally within `PairWritingEditor` when mode is 'command'.

**TD-6: Integration with existing save/exit**

The hook accepts callbacks for save and exit:
```typescript
useViMode(textareaRef, {
  enabled: viModeEnabled && hasKeyboard,
  onSave: () => handleSave(),
  onExit: () => handleExitClick(),
  onQuitWithUnsaved: () => setShowExitConfirm(true),
});
```

`:w` calls `onSave`, `:wq` calls both, `:q` checks `hasUnsavedChanges` and either exits or triggers confirmation.

**TD-7: Line operations implementation**

For `dd`, `yy`, `p`, `P`:
- Parse content into lines array
- Find current line by counting newlines before cursor
- Splice/insert lines as needed
- Reconstruct content string
- Update cursor position appropriately

**TD-8: Numeric prefix handling**

Buffer digits in state until a command key arrives.

Note: `0` is special - it's "start of line" when no count is pending, but a digit when accumulating (e.g., `10j`).

**TD-9: Undo stack**

Maintain internal undo stack since programmatic `textarea.value` changes don't create browser undo history:
- Push content snapshot before each edit operation (`dd`, `x`, `p`, Insert mode exit)
- `u` command pops and restores previous state
- Stack has reasonable depth limit (e.g., 100 entries)
- Insert mode batches changes into single undo entry (snapshot on mode enter, not per keystroke)

**TD-10: Cursor rendering with overlay**

Use hybrid approach: textarea for content, overlay div for block cursor in Normal mode.

Architecture:
```
┌─────────────────────────────────────┐
│ PairWritingEditor                   │
│  ┌───────────────────────────────┐  │
│  │ textarea (content)            │  │
│  │  caret-color: transparent     │  │
│  │  when Normal mode             │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ .vi-cursor (overlay)          │  │
│  │  position: absolute           │  │
│  │  pointer-events: none         │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ .vi-cursor-mirror (off-screen)│  │
│  │  visibility: hidden           │  │
│  │  copies textarea styles       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Mirror element technique for cursor position:
1. Create off-screen div with identical styling (font, padding, line-height, word-wrap)
2. Split content at cursor position into before/after text nodes
3. Insert span marker between them
4. Measure span's `getBoundingClientRect()` for pixel coordinates
5. Position overlay at those coordinates, adjusted for textarea scroll

Mode-specific behavior:
- **Normal mode**: Hide native caret (`caret-color: transparent`), show block cursor overlay
- **Insert mode**: Hide overlay, show native caret (standard textarea behavior)
- **Command mode**: Same as Normal (cursor stays visible while typing ex command)

Scroll synchronization:
```typescript
// On textarea scroll, offset overlay position
const updateCursorPosition = () => {
  const pos = calculateCursorPixelPosition(textarea, cursorIndex);
  overlay.style.left = `${pos.left - textarea.scrollLeft}px`;
  overlay.style.top = `${pos.top - textarea.scrollTop}px`;
};

textarea.addEventListener('scroll', updateCursorPosition);
```

Cursor appearance by mode:
- Normal: Block cursor (width ~0.6em, height ~1.2em, semi-transparent background)
- Insert: Native line cursor (overlay hidden)
- Command: Block cursor (same as Normal)

Dependencies:
- Can use `textarea-caret-position` npm package or implement core algorithm (~50 lines)
- Prefer implementing core algorithm to avoid dependency for small feature

**TD-8 implementation:**
```typescript
// State
pendingCount: number | null

// On digit
if (/[0-9]/.test(key) && mode === 'normal') {
  pendingCount = (pendingCount ?? 0) * 10 + parseInt(key);
  return;
}

// On command
const count = pendingCount ?? 1;
pendingCount = null;
executeCommand(key, count);
```

## Component Structure

```
frontend/src/
├── hooks/
│   ├── useViMode.ts              # Core vi mode hook (state machine, commands)
│   ├── useViMode.test.ts         # Unit tests for vi logic
│   ├── useViCursor.ts            # Cursor position calculation and overlay management
│   └── useViCursor.test.ts       # Unit tests for cursor positioning
├── components/
│   └── pair-writing/
│       ├── PairWritingEditor.tsx # Modified to integrate useViMode + cursor overlay
│       ├── ViModeIndicator.tsx   # Mode display component ("-- NORMAL --", etc.)
│       ├── ViCommandLine.tsx     # Ex command input component
│       ├── ViCursor.tsx          # Block cursor overlay component
│       └── vi-mode.css           # Styles for vi UI elements (cursor, indicator, command line)
```

## Data Flow

```
VaultConfig.viMode (backend)
        ↓
VaultInfo.viMode (shared type, API response)
        ↓
PairWritingMode reads from vault context
        ↓
useViMode(enabled: viMode && hasKeyboard)
        ↓
handleKeyDown attached to textarea
        ↓
State changes → re-render with mode indicator
```

## Considerations

**Cursor rendering**: Uses overlay approach (TD-10) with mirror element technique. This provides vim-authentic block cursor in Normal mode while preserving native textarea behavior in Insert mode. The `useViCursor` hook encapsulates position calculation and can be tested independently.

**Testing strategy**: The `useViMode` hook should be tested in isolation using a mock textarea ref. Test each command produces expected cursor position and content changes. `useViCursor` tests verify pixel position calculations. Integration tests verify the full flow in `PairWritingEditor`.

**Undo behavior**: Internal undo stack (TD-9) handles `u` command. Browser `Ctrl+Z` may not work reliably for programmatic changes, so the internal stack is the primary undo mechanism. Insert mode batches all keystrokes into one undo entry.

**Performance**: Line operations on large files could be slow. For v1, accept this limitation. If needed later, consider rope data structure or virtual DOM for content.

**Future extensibility**: The command dispatch pattern makes adding new commands straightforward. Visual mode would add another mode state and selection tracking.
