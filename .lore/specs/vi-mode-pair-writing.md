---
title: Vi Mode for Pair Writing
date: 2026-01-29
status: implemented
tags: [vi-mode, pair-writing, modal-editing, keyboard, requirements]
modules: [pair-writing-editor, use-vi-mode, vault-config]
related: [.lore/_archive/vi-mode-implementation.md]
---

# Spec: Vi Mode for Pair Writing

## Overview

Add vi-style modal editing to Pair Writing mode. When enabled via vault configuration, the editor operates in Normal mode by default where keystrokes execute navigation and editing commands rather than inserting text. Users enter Insert mode to type, and use ex commands (`:w`, `:wq`) to save and exit.

## Requirements

### Configuration
- REQ-1: Add `viMode?: boolean` to VaultConfig interface
- REQ-2: Vi mode setting read when entering Pair Writing (not live-monitored)
- REQ-3: Vi mode only available when physical keyboard detected; disabled on touch-only devices

### Modes
- REQ-4: Support three modes: Normal (default), Insert, and Command
- REQ-5: Mode indicator visible when vi mode enabled (e.g., "-- NORMAL --", "-- INSERT --")
- REQ-6: Esc returns to Normal mode from Insert or Command mode

### Normal Mode Commands
- REQ-7: Movement: `h` (left), `j` (down), `k` (up), `l` (right)
- REQ-8: Line movement: `0` (start of line), `$` (end of line)
- REQ-9: Insert mode entry: `i` (before cursor), `a` (after cursor), `A` (end of line), `o` (new line below), `O` (new line above)
- REQ-10: Delete: `x` (character), `dd` (line)
- REQ-11: Yank/put: `yy` (copy line), `p` (paste after), `P` (paste before)
- REQ-12: Undo: `u` undoes last edit operation (maintains internal undo stack)
- REQ-13: Numeric prefixes: `[count]` before commands (e.g., `5j` moves 5 lines)

### Command Mode
- REQ-14: `:` in Normal mode opens command input
- REQ-15: `:w` saves file, remains in Pair Writing
- REQ-16: `:wq` saves file and exits Pair Writing
- REQ-17: `:q` exits if no unsaved changes; shows confirmation dialog if unsaved
- REQ-18: `:q!` exits without saving (discards changes)
- REQ-19: `Esc` or empty input cancels command mode

### Internal Clipboard
- REQ-20: Yank/put operations use internal clipboard (separate from system)
- REQ-21: Clipboard persists within Pair Writing session

## Success Criteria

- [ ] Vi mode toggle in `.memory-loop.json` enables modal editing
- [ ] Mode indicator displays current mode
- [ ] `hjkl` navigation works in Normal mode
- [ ] `i`, `a`, `A`, `o`, `O` enter Insert mode at correct positions
- [ ] Typing in Insert mode inserts text normally
- [ ] Esc returns to Normal mode
- [ ] `dd` deletes current line, `yy` copies it, `p` pastes
- [ ] `u` undoes last edit operation
- [ ] `5j` moves cursor down 5 lines
- [ ] `:w` saves, `:wq` saves and exits, `:q` prompts if unsaved
- [ ] Touch-only devices bypass vi mode (standard editing)

## Constraints

- No Visual mode in v1 (selection via standard touch/mouse)
- No word motions (`w`, `b`, `e`) in v1
- No search (`/`, `?`) in v1
- No repeat command (`.`) in v1
- Keyboard detection may not be 100% reliable; acceptable to have edge cases

## Context

- Research: `.lore/_archive/vi-mode-implementation.md`
- Issue: #394
