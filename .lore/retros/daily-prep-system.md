---
title: Emergent requirements in daily prep implementation
date: 2026-02-02
status: complete
tags: [skill-development, ui-component, iterative-design, lore-workflow]
modules: [daily-prep-manager, session-actions-card, ask-user-question-dialog, home-view]
related: [.lore/brainstorm/daily-prep-system.md, .lore/research/daily-planning-science.md, .lore/specs/daily-prep.md, .lore/plans/daily-prep-system.md]
---

# Retro: Daily Prep System (#443)

## Summary

Built a skill-based bookend planning system for morning commitment and evening reflection. Includes Ground tab restructure (VaultInfoCard + SessionActionsCard), REST endpoint for prep status, daily-prep skill with file format documentation, and an emergent AskUserQuestion minimize feature.

## What Went Well

- **Brainstorm → Research → Spec cycle worked**: The brainstorm captured the core insight ("evaluable contract with yourself"), research validated it with psychology literature (implementation intentions, Zeigarnik effect, commitment devices), and spec translated that into requirements. Each phase refined the previous one.

- **Research prevented over-engineering**: The psychology research explicitly warned against over-planning ("1-3 items, not a detailed schedule"). This constraint made it into the spec and skill. Without the research phase, the skill might have tried to do too much.

- **Skill-based architecture avoided custom UI**: Original brainstorm explored complex surfacing endpoints and filtering algorithms. The insight that "this is a Claude skill that uses AskUserQuestion" dramatically simplified the implementation. No custom React components for the flow itself.

- **Spec was detailed enough for implementation**: Requirements were numbered, data models were explicit, exit points were defined. Implementation could proceed without ambiguity about what "done" meant.

- **Emergent feature caught during use**: The AskUserQuestion minimize feature wasn't in the spec. It emerged when using the daily-prep skill: "wait, I need to see my previous messages to know what I'm committing to." The need was discovered during implementation, not planning.

## What Could Improve

- **Plan document was not in .lore/**: The plan was originally captured in `~/.claude/plans/` (Claude Code's native plan mode location), not committed to the repo. Moved to `.lore/plans/daily-prep-system.md` during this retro. This is the same issue identified in the vi-mode retro: scratchpad plans aren't visible for drift detection unless explicitly preserved.

- **Brainstorm/research required refinement passes**: The commit message notes "required refinement." The initial brainstorm was more scattered, and research needed curation to extract actionable insights. This is normal for the process but worth noting: first drafts of lore documents aren't final.

- **Spec status not updated**: The spec still shows `status: approved` but should be `implemented` now that the work is complete. Lore hygiene slipped.

## Lessons Learned

1. **Research phase prevents scope creep**: External validation (psychology literature) provided constraints ("1-3 items") that shaped the design. Without research, the implementation might have gold-plated features that users don't need.

2. **Skill-first thinking simplifies architecture**: Asking "can this be a Claude skill using existing tools?" before designing custom endpoints/components reduces implementation complexity. The daily-prep skill uses AskUserQuestion, Grep, Read, Write (standard tools) instead of custom surfacing APIs.

3. **Use during implementation surfaces requirements**: The AskUserQuestion minimize feature was discovered by actually using the daily-prep skill. Some requirements only become visible when you try to use what you built.

4. **Lore documents need refinement**: First drafts of brainstorms and research are raw material. Expect to iterate. The value is in the refinement, not the first pass.

5. **Update spec status after implementation**: When work completes, update the spec's frontmatter status from `approved` to `implemented`. This is part of the definition of done.

## Artifacts

- Issue/PR: #443
- Plan: `.lore/plans/daily-prep-system.md`
- Brainstorm: `.lore/brainstorm/daily-prep-system.md`
- Research: `.lore/research/daily-planning-science.md`
- Spec: `.lore/specs/daily-prep.md`
- Skill: `backend/src/skills/daily-prep/SKILL.md`
