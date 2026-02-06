---
title: Vi Mode Implementation for Pair Writing
date: 2026-01-29
status: archived
tags: [vi-mode, modal-editing, cursor-rendering, textarea]
modules: [pair-writing-editor]
related: [.lore/specs/vi-mode-pair-writing.md]
---

# Research: Vi Mode Implementation for Pair Writing

## Summary

Vi/Vim is a modal text editor where keystrokes have different meanings depending on the current mode. Implementing vi mode for Pair Writing requires a state machine managing mode transitions and a key handler that interprets input based on current mode. Several JavaScript libraries exist that implement vi for textareas, providing proven patterns.

## Key Findings

### Modal Architecture

Vi operates in distinct modes:

| Mode | Purpose | Entry | Exit |
|------|---------|-------|------|
| **Normal** | Navigation and commands | Default, `Esc` from other modes | `i`, `a`, `o`, `v`, `:` |
| **Insert** | Text entry | `i`, `I`, `a`, `A`, `o`, `O` | `Esc` |
| **Visual** | Selection | `v` (char), `V` (line) | `Esc`, action completion |
| **Command** | Ex commands (`:w`, `:q`) | `:` from Normal | `Enter`, `Esc` |

### Essential Commands (Minimum Viable)

**Movement (Normal mode):**
- `h`, `j`, `k`, `l` - Character/line movement (left, down, up, right)
- `w`, `b` - Word forward/backward
- `0`, `$` - Line start/end
- `gg`, `G` - Document start/end

**Mode switching:**
- `i` - Insert before cursor
- `I` - Insert at line start
- `a` - Append after cursor
- `A` - Append at line end
- `o` - Open line below
- `O` - Open line above
- `Esc` - Return to Normal mode

**Editing (Normal mode):**
- `x` - Delete character
- `dd` - Delete line
- `yy` - Yank (copy) line
- `p` - Put (paste) after cursor
- `P` - Put before cursor
- `u` - Undo

**Ex commands:**
- `:w` - Write (save)
- `:q` - Quit
- `:wq` or `:x` - Write and quit

### Implementation Patterns from Existing Libraries

**Vim.js** (~19KB, no dependencies):
- Mode-based state machine
- Event-driven keyboard handling
- Numeric prefix support (`5j` = move 5 lines)
- Dual-key sequences (`dd`, `yy`)
- Separate clipboard/register for yank/put

**VimMotions browser extension:**
- Uses backtick (`) instead of Esc for mode exit (mobile-friendly)
- Visual feedback via highlighting system for mode indication
- Supports textarea, input, and contenteditable

**Key architectural decisions:**
1. State machine with explicit mode transitions
2. Key handler dispatches to mode-specific handlers
3. Clipboard is internal (separate from system clipboard)
4. Visual feedback for current mode is essential
5. Numeric prefixes require buffering keystrokes

### Integration Points for Memory Loop

**Current Pair Writing architecture:**
- `PairWritingEditor.tsx` - Textarea-based editor component
- `usePairWritingState.ts` - State hook (content, snapshot, unsaved changes)
- `useTextSelection.ts` - Selection tracking for context menu
- Vault config in `vault-config.ts` - No vi mode setting yet

**Required additions:**
1. `viMode?: boolean` in `VaultConfig` interface
2. Vi mode state hook or integration into existing state
3. Key event handler for Normal mode
4. Mode indicator UI component
5. Internal clipboard for yank/put operations

**Configuration flow:**
- User enables vi mode in vault config (`.memory-loop.json`)
- Config change triggers editor behavior change
- Editor shows mode indicator when vi mode enabled

### Escape Key Alternatives for Mobile

Traditional Esc is awkward on mobile keyboards. Options:
- Backtick (`) - Used by VimMotions extension
- `jj` or `jk` sequence - Common vim mapping
- Swipe gesture - Native mobile feel
- On-screen mode button - Most accessible

### Scope Considerations

**Minimal viable implementation:**
- Normal and Insert modes only (no Visual initially)
- Basic movement: `h`, `j`, `k`, `l`, `0`, `$`
- Insert commands: `i`, `a`, `o`
- Exit insert: `Esc` (or alternative)
- Basic editing: `x`, `dd`
- Yank/put: `yy`, `p`
- Ex commands: `:w`, `:q`, `:wq`

**Deferred for later:**
- Visual mode selection
- Word motions (`w`, `b`, `e`)
- Change commands (`c`, `cw`, `cc`)
- Search (`/`, `?`, `n`, `N`)
- Marks and jumps
- Macros and registers

## Sources

- [Vim Cheat Sheet](https://vim.rtorr.com/) - Comprehensive command reference
- [Vim.js](https://github.com/toplan/Vim.js) - Lightweight textarea vim implementation
- [VimMotions](https://github.com/RonelXavier/VimMotions) - Browser extension with mobile considerations
- [Onivim Modal Editing 101](https://onivim.github.io/docs/getting-started/modal-editing-101) - Modal editing concepts
- [VS Code ModalEdit Tutorial](https://johtela.github.io/vscode-modaledit/docs/tutorial.html) - Implementation patterns
- [nixCraft Vim Save/Quit Guide](https://www.cyberciti.biz/faq/linux-unix-vim-save-and-quit-command/) - Ex command reference

## Notes

### For Issue #394 Specifically

The issue requests:
1. Vi mode based on vault configuration - needs config addition
2. Mode change when config changes - reactive update
3. Basic movement keys - `hjkl`
4. Insert/append mode - `i`, `a`
5. Yank, copy, put - `yy`, `p`
6. `:` for write and quit - exits pair writing

This aligns well with a minimal implementation. The `:wq` behavior mapping to "exit pair writing" is a nice fit since Pair Writing is effectively a modal editing session within the app.

### Architecture Recommendation

Create a `useViMode` hook that:
1. Reads vi mode setting from vault config
2. Manages mode state (normal/insert/command)
3. Provides key event handler to attach to textarea
4. Exposes mode for UI indicator
5. Handles clipboard internally

The hook integrates with `PairWritingEditor` via:
- `onKeyDown` handler override when vi mode enabled
- Mode indicator rendered conditionally
- Modified cursor behavior in Normal mode

## Cursor Rendering Research (Added 2026-01-29)

### The Problem

In Normal mode, we need to:
1. Prevent keystrokes from inserting text
2. Show the cursor position (preferably as a block cursor, vim-style)
3. Handle the cursor visibility on empty lines

Native textarea cursors only appear when focused and accepting input, creating a conflict with Normal mode behavior.

### Approaches Found in Existing Implementations

**Approach A: Hidden Textarea + Custom Rendering (Modern Editors)**

Used by newer editors (not contenteditable-based). The pattern:
1. Hidden/transparent textarea captures keyboard input
2. Visible content rendered separately (div or canvas)
3. Custom cursor element positioned absolutely over content
4. Cursor position calculated via mirror element technique

Pros:
- Full control over cursor appearance (block, line, underline)
- Predictable cross-browser behavior
- Clean separation of input capture vs. display

Cons:
- Significant implementation complexity
- Must sync scroll position, selection, and content between hidden input and visible display
- More code to maintain

**Approach B: Textarea + Overlay Cursor (Hybrid)**

Keep textarea visible for content, add overlay for cursor:
1. Textarea remains the source of truth for content
2. Mirror element technique calculates cursor pixel position
3. Absolutely positioned div renders block cursor over textarea
4. In Normal mode: hide native caret via `caret-color: transparent`, show overlay
5. In Insert mode: hide overlay, show native caret

Mirror element technique (from [textarea-caret-position](https://github.com/component/textarea-caret-position)):
```javascript
// Create off-screen div with identical styling
const mirror = document.createElement('div');
// Copy all relevant CSS properties (font, padding, line-height, etc.)

// Split text at cursor position
const textBefore = textarea.value.substring(0, cursorPos);
const textAfter = textarea.value.substring(cursorPos);

// Build mirror content using safe DOM methods
const cursorSpan = document.createElement('span');
cursorSpan.textContent = '\u00A0'; // non-breaking space

mirror.textContent = ''; // clear
mirror.appendChild(document.createTextNode(textBefore));
mirror.appendChild(cursorSpan);
mirror.appendChild(document.createTextNode(textAfter));

// Get position from span
const rect = cursorSpan.getBoundingClientRect();
// Returns {top, left, height} relative to viewport
```

Pros:
- Leverages native textarea for text handling
- Less complexity than full custom rendering
- Can still use native selection/copy/paste

Cons:
- Must keep overlay in sync with scroll
- Edge cases with wrapped lines
- Two sources of cursor truth (native + overlay)

**Approach C: CodeMirror's Method (for reference)**

CodeMirror uses `doc.markText` to highlight the character under the cursor in Normal mode, creating a visual block effect. However:
- Doesn't work on empty lines (no character to mark)
- Requires CodeMirror's infrastructure
- Not applicable to plain textarea

**Approach D: ContentEditable (Not Recommended)**

Some editors use contenteditable div instead of textarea:
- Known issues with vim mode cursor on empty content
- Inconsistent cross-browser behavior
- DOM mutation complexities
- "DOM is not the perfect tool for this job" - CKEditor team

### CSS Properties for Cursor Control

```css
/* Hide native caret */
textarea {
  caret-color: transparent;
}

/* Block cursor overlay */
.vi-cursor {
  position: absolute;
  background-color: var(--cursor-color);
  opacity: 0.7;
  pointer-events: none;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* Different cursor styles by mode */
.vi-cursor--normal {
  width: 0.6em;  /* block width */
  height: 1.2em;
}

.vi-cursor--insert {
  width: 2px;  /* thin line */
  height: 1.2em;
}
```

### Scroll Synchronization

When textarea scrolls, overlay must follow:
```javascript
textarea.addEventListener('scroll', () => {
  cursorOverlay.style.transform =
    `translate(-${textarea.scrollLeft}px, -${textarea.scrollTop}px)`;
});
```

### Recommendation for Memory Loop

**Approach B (Textarea + Overlay)** is the right balance:
- Keeps existing textarea architecture
- Adds overlay only when vi mode enabled
- Mirror element library is ~2KB, well-tested
- Can use `textarea-caret-position` npm package or implement core algorithm

Implementation steps:
1. Add cursor overlay div inside PairWritingEditor
2. Calculate position on cursor move using mirror technique
3. Toggle `caret-color: transparent` in Normal mode
4. Sync overlay position on scroll
5. Style overlay differently per mode

### Sources

- [textarea-caret-position](https://github.com/component/textarea-caret-position) - Mirror element library
- [DEV.to: Calculate cursor coordinates](https://dev.to/phuocng/calculate-the-coordinates-of-the-current-cursor-in-a-text-area-cle) - Implementation walkthrough
- [CodeMirror vim cursor issues](https://github.com/codemirror/codemirror5/issues/6312) - Empty line problem
- [ContentEditable: The Good, Bad, Ugly](https://medium.com/content-uneditable/contenteditable-the-good-the-bad-and-the-ugly-261a38555e9c) - Why not contenteditable
- [monaco-vim](https://github.com/brijeshb42/monaco-vim) - Monaco editor vim implementation
