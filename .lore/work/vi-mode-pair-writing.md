# Work Breakdown: Vi Mode for Pair Writing

Spec: `.lore/specs/vi-mode-pair-writing.md`
Plan: `.lore/plans/vi-mode-pair-writing.md`

## Chunks

### 1. Configuration Layer
**What**: Add `viMode` to VaultConfig and flow it through to frontend
**Delivers**: Config toggle that can be read in PairWritingEditor (no behavior change yet)
**Depends on**: Nothing

Tasks:
- Add `viMode?: boolean` to `VaultConfig` interface (backend)
- Add `viMode?: boolean` to `VaultInfo` type (shared)
- Add to `EditableVaultConfig` schema if user-editable, or just config file
- Flow through vault discovery to API response
- Verify config is accessible in `PairWritingMode` component

### 2. Keyboard Detection
**What**: Detect physical keyboard presence, gate vi mode on it
**Delivers**: `useHasKeyboard` hook that returns boolean; vi mode disabled on touch-only
**Depends on**: Nothing (can parallel with Chunk 1)

Tasks:
- Create `useHasKeyboard.ts` hook using matchMedia + maxTouchPoints
- Add tests for detection logic (mock matchMedia)
- Export from hooks index

### 3. Vi Mode State Machine (Core)
**What**: Mode state management (normal/insert/command) and transitions
**Delivers**: `useViMode` hook with mode state, no commands yet
**Depends on**: Nothing (can parallel)

Tasks:
- Create `useViMode.ts` with mode enum and state
- Implement mode transitions: Normal↔Insert, Normal↔Command
- Handle Esc key to return to Normal from any mode
- Add `enabled` option to bypass when vi mode off
- Unit tests for state transitions

### 4. Cursor Overlay System
**What**: Block cursor rendering using mirror element technique
**Delivers**: `useViCursor` hook + `ViCursor` component showing cursor position
**Depends on**: Chunk 3 (needs mode to toggle cursor style)

Tasks:
- Create `useViCursor.ts` with mirror element position calculation
- Create `ViCursor.tsx` overlay component
- Add `vi-mode.css` with cursor styles (block, blink animation)
- Toggle `caret-color: transparent` based on mode
- Handle scroll synchronization
- Unit tests for position calculation

### 5. Mode Indicator UI
**What**: Display current mode ("-- NORMAL --", "-- INSERT --", etc.)
**Delivers**: `ViModeIndicator` component visible in editor
**Depends on**: Chunk 3 (needs mode state)

Tasks:
- Create `ViModeIndicator.tsx` component
- Style to appear at bottom of editor (vim-style)
- Show/hide based on vi mode enabled
- Add to `vi-mode.css`

### 6. Basic Movement Commands
**What**: `h`, `j`, `k`, `l`, `0`, `$` cursor movement
**Delivers**: Navigation works in Normal mode
**Depends on**: Chunks 3, 4 (need mode + cursor)

Tasks:
- Add command dispatch to `useViMode`
- Implement character movement (h, l) via selectionStart manipulation
- Implement line movement (j, k) with line boundary detection
- Implement line start/end (0, $)
- Handle document boundaries (clamp, don't wrap)
- Unit tests for each movement command

### 7. Insert Mode Entry Commands
**What**: `i`, `a`, `A`, `o`, `O` to enter Insert mode
**Delivers**: Can enter Insert mode at various positions
**Depends on**: Chunk 6 (builds on cursor manipulation)

Tasks:
- `i`: enter Insert at cursor
- `a`: move right one, enter Insert
- `A`: move to end of line, enter Insert
- `o`: insert newline below, enter Insert
- `O`: insert newline above, enter Insert
- Unit tests for cursor position after each

### 8. Undo Stack
**What**: Internal undo history for `u` command
**Delivers**: Can undo edit operations
**Depends on**: Chunk 3 (needs to hook into content changes)

Tasks:
- Add undo stack to `useViMode` state
- Push snapshot before edit operations
- Implement `u` command to pop and restore
- Batch Insert mode into single undo entry
- Limit stack depth (100 entries)
- Unit tests for undo behavior

### 9. Delete Commands
**What**: `x` (character) and `dd` (line) deletion
**Delivers**: Can delete content in Normal mode
**Depends on**: Chunks 6, 8 (movement + undo)

Tasks:
- Implement `x`: delete character at cursor
- Implement `dd`: delete current line
- Push to undo stack before delete
- Update cursor position after delete
- Handle edge cases (empty line, end of doc)
- Unit tests

### 10. Yank/Put Commands
**What**: `yy`, `p`, `P` with internal clipboard
**Delivers**: Copy/paste lines within editor
**Depends on**: Chunks 6, 8, 9 (movement, undo, line operations)

Tasks:
- Add clipboard state to `useViMode`
- Implement `yy`: copy current line to clipboard
- Implement `p`: paste after cursor line
- Implement `P`: paste before cursor line
- Push to undo stack before paste
- Unit tests

### 11. Numeric Prefixes
**What**: Count prefix for commands (e.g., `5j`, `3dd`)
**Delivers**: Commands can be repeated with count
**Depends on**: Chunks 6, 9, 10 (needs commands to prefix)

Tasks:
- Add `pendingCount` state to `useViMode`
- Accumulate digits before command
- Handle `0` special case (command vs. digit)
- Pass count to command execution
- Clear count after command or Esc
- Unit tests for count accumulation and execution

### 12. Command Mode UI
**What**: `:` command input field and parsing
**Delivers**: Can type ex commands
**Depends on**: Chunk 3 (needs Command mode state)

Tasks:
- Create `ViCommandLine.tsx` component
- Render at bottom of editor when mode is 'command'
- Capture input until Enter or Esc
- Focus management (focus input on enter, return on exit)
- Add to `vi-mode.css`

### 13. Ex Commands
**What**: `:w`, `:wq`, `:q`, `:q!` implementation
**Delivers**: Can save and exit via commands
**Depends on**: Chunk 12 (needs command input)

Tasks:
- Parse command string in `useViMode`
- `:w` → call `onSave` callback
- `:wq` → call `onSave` then `onExit`
- `:q` → check unsaved, call `onExit` or `onQuitWithUnsaved`
- `:q!` → call `onExit` (discard)
- Handle unknown commands (no-op or error indicator)
- Unit tests for each command

### 14. Integration
**What**: Wire everything into `PairWritingEditor`
**Delivers**: Full vi mode working in Pair Writing
**Depends on**: All previous chunks

Tasks:
- Integrate `useViMode` into `PairWritingEditor`
- Integrate `useViCursor` and `ViCursor`
- Add `ViModeIndicator` and `ViCommandLine`
- Pass callbacks (onSave, onExit, onQuitWithUnsaved)
- Gate on `viMode` config + `hasKeyboard`
- Integration tests

### 15. Polish and Edge Cases
**What**: Handle remaining edge cases from review
**Delivers**: Robust implementation
**Depends on**: Chunk 14

Tasks:
- Esc in Normal mode cancels pending operator/count
- Cursor boundary clamping (h at start, l at end)
- `dd` on empty document
- `p` with empty clipboard
- Interaction with `isProcessingQuickAction` state
- Manual testing on various content sizes

## Suggested Order

1. **Chunk 1** (Configuration) - Foundation, quick win
2. **Chunk 2** (Keyboard Detection) - Can parallel with 1
3. **Chunk 3** (State Machine) - Core architecture, can parallel
4. **Chunk 4** (Cursor Overlay) - Visual feedback, depends on 3
5. **Chunk 5** (Mode Indicator) - Quick UI win, depends on 3
6. **Chunk 6** (Basic Movement) - First real vi behavior
7. **Chunk 7** (Insert Entry) - Can now edit text
8. **Chunk 8** (Undo Stack) - Safety net before destructive commands
9. **Chunk 9** (Delete) - First destructive command
10. **Chunk 10** (Yank/Put) - Copy/paste
11. **Chunk 11** (Numeric Prefixes) - Power user feature
12. **Chunk 12** (Command Mode UI) - Needed for ex commands
13. **Chunk 13** (Ex Commands) - Save/exit flow
14. **Chunk 14** (Integration) - Wire it all together
15. **Chunk 15** (Polish) - Edge cases and hardening

## Release Points

**Milestone A (Chunks 1-5)**: Vi mode toggle works, shows mode indicator and block cursor. No commands yet, but visual infrastructure complete.

**Milestone B (Chunks 6-7)**: Navigation and insert mode work. Can move around and type text.

**Milestone C (Chunks 8-11)**: Full Normal mode editing. Delete, yank, put, undo, counts all work.

**Milestone D (Chunks 12-15)**: Complete feature. Ex commands for save/exit, full integration, polished.
