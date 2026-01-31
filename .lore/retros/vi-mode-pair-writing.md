---
title: Vi Mode for Pair Writing
date: 2026-01-29
status: complete
tags: [vi-mode, pair-writing, implementation, lessons-learned]
modules: [pair-writing-editor, use-vi-mode, use-vi-cursor]
related: [.lore/specs/vi-mode-pair-writing.md, .lore/plans/vi-mode-pair-writing.md]
---

# Retro: Vi Mode for Pair Writing

## Summary

Added vi-style modal editing to Pair Writing mode. Implementation includes Normal/Insert/Command modes, hjkl navigation, line operations (dd, yy, p, P), numeric prefixes, internal undo stack, ex commands (:w, :wq, :q, :q!), block cursor overlay, mode indicator, and auto-scrolling. Feature is gated on vault config toggle + keyboard detection.

## What Went Well

- **Detailed upfront planning paid off**: The 15-chunk breakdown with clear dependencies allowed systematic implementation without backtracking. Each chunk built cleanly on the previous.

- **Hook-based architecture**: Isolating vi logic in `useViMode` and cursor logic in `useViCursor` made unit testing straightforward. 256 tests for the core hook alone.

- **Spec constraints were realistic**: Explicitly scoping out Visual mode, word motions, and search kept the feature focused. No scope creep during implementation.

- **The research phase identified the right approach**: Mirror element technique for cursor positioning was researched beforehand and worked well once correctly implemented.

- **Incremental milestones**: Being able to see mode indicator and block cursor (Milestone A) before any commands worked provided early visual feedback.

## What Could Improve

- **Cursor overlay had multiple bugs**: The mirror element calculation had a fundamental error (measuring viewport-relative instead of mirror-relative), and the color choice made it invisible. Should have tested visually earlier in the process.

- **Config state sync was incomplete**: Adding `viMode` to the schema wasn't enough - had to trace through multiple frontend state sync points (initialConfig in two places, reducer UPDATE_VAULT_CONFIG, VaultSelect setVaults). The data flow for config changes is more complex than the plan acknowledged.

- **Scroll behavior with wrapped lines**: Line-based scroll calculation assumed 1 logical line = 1 visual line. Real documents have wrapped lines. Should have considered this in the plan.

- **Testing in JSDOM vs real browser**: Some issues (cursor visibility, scroll behavior) only surfaced during manual testing. JSDOM tests passed but didn't catch visual/layout bugs.

## Lessons Learned

1. **Visual components need visual testing**: Unit tests for cursor position calculation passed, but the actual cursor was invisible. For overlay/positioning code, add a manual test checkpoint before declaring the chunk complete.

2. **Trace config changes end-to-end**: When adding a new config field, grep for all places the config object is constructed, copied, or merged. In this codebase: shared schema, backend config loading, frontend initialConfig props (multiple components), reducer cases, and post-save state updates.

3. **Text wrapping breaks line math**: Any calculation involving "line N is at position Y pixels" needs to account for soft wrapping. Use the same measurement technique (mirror element) for both cursor rendering and scroll calculations.

4. **Polish emerges from use**: Auto-focus and auto-scroll weren't in the original spec but became obvious needs during real usage. Budget time for this "last 10%" polish.

5. **Color visibility depends on context**: A color that's visible in isolation may not be visible when overlaid on similar colors. The cursor used `--color-text` which matched the text itself. Use accent colors for overlays.

## Artifacts

- Spec: `.lore/specs/vi-mode-pair-writing.md`
- Plan: `.lore/plans/vi-mode-pair-writing.md`
- Work breakdown: `.lore/work/vi-mode-pair-writing.md`
- Research: `.lore/research/vi-mode-implementation.md`
- Issue: #394
- PR: #433
