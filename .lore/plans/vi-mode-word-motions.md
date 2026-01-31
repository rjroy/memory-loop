---
title: Vi mode word motions and operators
date: 2026-01-30
status: executed
tags: [vi-mode, pair-writing, word-motions, operators]
modules: [use-vi-mode]
related: [.lore/retros/vi-mode-word-motions.md, .lore/plans/vi-mode-pair-writing.md]
---

# Plan: Vi Mode Word Motions and Operators

**Issue:** #435 - high impact additions for vi mode
**Related:** `.lore/plans/vi-mode-pair-writing.md`, `.lore/retros/vi-mode-pair-writing.md`

## Context

The vi mode v1 implementation explicitly deferred word motions (`w`, `b`, `e`) to keep scope focused. The `pendingOperator` state infrastructure already exists for `d`/`y` operators but currently only handles the double-press pattern (`dd`, `yy`). This work extends that pattern to support operator+motion combinations.

## Approach

Extend the existing `useViMode` hook with:
1. Word boundary detection helpers
2. Word motion commands (`w`, `b`)
3. Operator+motion combinations (`dw`, `yw`, `db`, `yb`)
4. `D` command (delete to end of line)

The numeric prefix system already works, so `#w`, `#b`, `#dw`, `#yw` will work automatically once base commands are implemented.

## Steps

### 1. Add word boundary helpers

Create two helper functions in `useViMode.ts`:

```typescript
function findNextWordStart(text: string, position: number): number
function findPrevWordStart(text: string, position: number): number
```

Word definition (vim-like):
- A "word" is a sequence of word characters (`[a-zA-Z0-9_]`) OR a sequence of non-whitespace punctuation
- `w` moves to the start of the next word
- `b` moves to the start of the previous word

### 2. Add `w` and `b` to movement commands

1. Add `"w"` and `"b"` to `MOVEMENT_KEYS` set
2. Add cases in `executeMovementCommand` switch:
   - `w`: call `findNextWordStart` count times
   - `b`: call `findPrevWordStart` count times

### 3. Add operator+motion handling

Modify `handleNormalModeKey` to check if `pendingOperator` is set when a motion key is pressed:

```typescript
// Before executing regular movement
if (pendingOperator && MOTION_KEYS.has(key) && textarea) {
  e.preventDefault();
  if (pendingOperator === "d") {
    executeOperatorMotion("d", key, textarea, count, ...);
  } else if (pendingOperator === "y") {
    executeOperatorMotion("y", key, textarea, count, ...);
  }
  setPendingOperator(null);
  clearPendingCount();
  return;
}
```

Create `executeOperatorMotion` that:
- Calculates the motion range (from current position to where motion would land)
- For `d`: deletes that range
- For `y`: yanks that range to clipboard

This enables: `dw`, `db`, `d$`, `d0`, `yw`, `yb`, `y$`, `y0`

### 4. Add `D` command

Add standalone `D` key handler (equivalent to `d$`):

```typescript
if (key === "D" && textarea) {
  e.preventDefault();
  clearPendingCount();
  executeDeleteToEndOfLine(textarea, onContentChange, pushUndoState);
  return;
}
```

`D` deletes from cursor to end of line (does not delete the newline itself).

### 5. Write tests

Add test cases for:
- `w` motion: forward word, across lines, at end of text, with count
- `b` motion: backward word, across lines, at start of text, with count
- `dw`: delete word, with count, at end of line
- `yw`: yank word, paste verification
- `db`, `yb`: backward variants
- `d$`, `y$`: to end of line (enabled by operator+motion)
- `D`: delete to end of line

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/hooks/useViMode.ts` | Add word helpers, extend movement switch, add operator+motion dispatch, add D command |
| `frontend/src/hooks/__tests__/useViMode.test.ts` | Add test sections for word motions, operator+motion, D command |

## Considerations

**Word boundary definition:** Using vim's simplified model where a word is alphanumeric+underscore or punctuation sequence. Not implementing `W`/`B` (WORD motion using only whitespace boundaries) in this iteration.

**Edge cases to handle:**
- Cursor at end of text (motions should not error)
- Empty lines (word motion should skip them)
- Multiple spaces between words
- Punctuation handling (e.g., `foo.bar` has 3 words: `foo`, `.`, `bar`)

**Operator+motion with existing motions:** This automatically enables `d$` (delete to end of line), `d0` (delete to start of line), `dh`, `dl`, `dj`, `dk` and their yank equivalents. The operator+motion pattern is general.

## AI Validation

**Defaults:**
- Unit tests with mocked textarea (no real DOM needed beyond createElement)
- 90%+ coverage on new code paths
- Code review by fresh-context sub-agent

**Custom:**
- Manual test in Pair Writing mode: type text, use `w`/`b` to navigate, `dw`/`yw` to edit
- Verify numeric prefixes: `3w`, `2dw`, `5b` all work correctly
- Verify `D` deletes to end of line without removing newline

## Post-Execution Notes

**Scope recovered during implementation:** `^` (first non-whitespace) and `J` (join lines) were discussed during issue review but missing from this plan. They were added during implementation. See `.lore/retros/vi-mode-word-motions.md` for lessons learned about plan-to-implementation drift.
