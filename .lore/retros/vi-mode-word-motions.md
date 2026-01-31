---
title: Plan-to-implementation drift in vi mode word motions
date: 2026-01-31
status: complete
tags: [vi-mode, planning, scope-management, llm-limitations]
modules: [use-vi-mode]
related: [.lore/retros/vi-mode-pair-writing.md, .lore/plans/vi-mode-pair-writing.md]
---

# Retro: Vi Mode Word Motions (#435)

## Summary

Extended vi mode with word motions (`w`, `b`), operator+motion combinations (`dw`, `yw`, etc.), `D` command, `J` (join lines), and `^` (first non-whitespace). All commands support numeric prefixes and integrate with undo.

## What Went Well

- **Operator+motion pattern was general**: Building `executeOperatorMotion` enabled many commands beyond just `dw`/`yw`. The pattern automatically gave us `d$`, `d0`, `d^`, `y$`, `y0`, `y^` and existing motion combinations (`dh`, `dl`).

- **Existing infrastructure held up**: The `pendingOperator` state and numeric prefix system from v1 worked exactly as expected. No refactoring needed to support the new patterns.

- **Tests caught edge cases**: Word boundary detection across lines, empty lines, multiple spaces, punctuation boundaries. 250+ tests covering the combinations.

- **Implementation recovered missing scope**: `^` and `J` were discussed during issue review but missing from the written plan. They were added during implementation anyway, showing the implementation process surfaced the gap.

## What Could Improve

- **Features discussed got lost before planning**: When reviewing issue #435 via compass-rose, we discussed `^` (first non-whitespace) and `J` (join lines) as high-impact additions. These didn't make it into the plan document (`encapsulated-crunching-metcalfe.md`). The PR shows they were implemented, so they were recovered during execution, but the plan was incomplete.

- **Root cause unclear**: This could be:
  1. Context window limits during plan generation (likely given plan was detailed)
  2. Prioritization judgment (plan focused on word motions as the primary scope)
  3. Transition friction between "discussion phase" and "planning phase"

- **Plan document not versioned**: The plan file was a scratchpad document, not committed to the repo. No way to trace what was captured vs what was discussed.

## Lessons Learned

1. **LLMs can lose context between phases**: Transitioning from "brainstorm/discuss" to "write detailed plan" is a context switch. Information can be lost, especially with complex conversations. Explicit handoff artifacts (a feature list) reduce this risk.

2. **Review plan against original discussion**: Before approving a plan, explicitly compare it against the issue and any discussion notes. "Does this plan cover everything we said we'd do?" *(Graduated to universal)*

3. **Scratchpad plans should still be captured**: Even throwaway plan files should be snapshot somewhere (commit, paste into issue, whatever) so drift can be detected. *(Graduated to universal)*

## Artifacts

- Issue: #435
- PR: #438
- Plan: `.lore/plans/vi-mode-word-motions.md`
- Prior retro: `.lore/retros/vi-mode-pair-writing.md`
