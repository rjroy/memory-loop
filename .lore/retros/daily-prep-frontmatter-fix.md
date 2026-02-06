---
title: Passive references fail under context degradation
date: 2026-02-04
status: complete
tags: [skill-development, context-degradation, progressive-disclosure, bug-fix]
modules: [daily-prep-skill]
related: [.lore/specs/daily-prep.md, .lore/retros/daily-prep-system.md]
---

# Retro: Daily Prep Frontmatter Fix (#454)

## Summary

Fixed a bug where the daily-prep skill often failed to write YAML frontmatter. The root cause was a passive reference in step 6 ("For file format details, see `references/file-format.md`") that Claude frequently missed after context degraded through the multi-step flow.

## What Went Well

- **Fast diagnosis**: The problem was immediately clear once observed. The skill's step 6 delegated to a reference document at the exact moment when context was most degraded (after energy question, calendar question, vault search, dialogue). Classic progressive-disclosure failure mode.

- **Minimal fix**: The solution required editing one section of one file. Inlined the critical template, kept the reference for supplementary details. No architecture changes needed.

- **Spec was useful for verification**: REQ-19 explicitly required "YAML frontmatter contains structured data." Having the requirement documented made it easy to identify what was broken and verify the fix.

## What Could Improve

- **Progressive disclosure misapplied**: The daily-prep skill correctly used progressive disclosure (lean SKILL.md, details in references), but misapplied it for write-time requirements. The file format isn't optional context to load when needed; it's a mandatory output format that must be present at save time.

- **No integration test caught this**: The skill's behavior with Claude wasn't tested end-to-end. Unit tests verified the endpoint could read prep files, but nothing verified that Claude would actually write them correctly. This is a gap in validation for LLM-driven workflows.

## Lessons Learned

1. **Critical requirements must be inline at execution time**: Progressive disclosure works for optional context and reference material, but mandatory outputs (like file formats) must be inline at the step where they're needed. Claude can't "remember" to check a reference after several context-heavy steps.

2. **Passive references fail under load**: "See X for details" delegates reading to the LLM, which may skip it when context is saturated. For must-follow requirements, use imperative language ("The file MUST have...") and inline the critical structure.

3. **Skill testing requires LLM-in-the-loop**: Unit tests for supporting code don't catch skill behavior problems. The skill's output depends on Claude following instructions under realistic conditions (long conversations, multiple tool calls). This suggests a gap: skills need integration tests that actually run the skill.

## Artifacts

- PR: #454
- Spec: `.lore/specs/daily-prep.md` (REQ-19)
- Fixed file: `backend/src/skills/daily-prep/SKILL.md` (step 6)
