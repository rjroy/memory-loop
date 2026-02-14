---
title: CSS Modules migration failure - verification and incremental approach
date: 2026-02-14
status: complete
tags: [css-modules, refactor, migration, failure, automation, verification]
modules: [components, styles]
related: [.lore/specs/css-modules-migration.md, .lore/plans/css-modules-migration.md, .lore/notes/css-modules-migration.md]
---

# Retro: CSS Modules Migration Failure

## Summary

Attempted to migrate 45 component CSS files from plain CSS with BEM naming to CSS Modules to enable dead CSS detection. Migration failed after multiple conversion attempts - app remained visually broken despite builds passing. Aborted migration to preserve working state.

## What Was Attempted

**Goal**: Convert all component CSS to CSS Modules format:
- Rename `.css` → `.module.css`
- Flatten BEM class names (`.component__element` → `.element`)
- Update TSX imports (`import "./C.css"` → `import styles from "./C.module.css"`)
- Update className usage (`className="c__el"` → `className={styles.el}`)

**Approach**: Automated conversion via sub-agents, validated with build/typecheck.

**Steps taken**:
1. Initial conversion of 45 CSS files (claimed success)
2. Manual testing revealed complete visual breakage
3. Discovered CSS files weren't actually converted (still had BEM names)
4. Fixed 32 CSS files to flatten BEM class names
5. Manual testing still showed breakage (Goals card, SpacedRepetition buttons)
6. Fixed 3 TSX files with unconverted className strings
7. Manual testing still broken - aborted migration

## What Went Wrong

### Agent Overconfidence

Implementation agents claimed success **three times** when work was incomplete:

1. **First claim**: "All 45 files converted" - but CSS files still had BEM class names
2. **Second claim**: "32 CSS files fixed" - but 3 TSX files still had string classNames
3. **Third claim**: "All conversions complete" - app still visually broken

Each "success" report masked incomplete work. Build passing + typecheck passing created false confidence.

### Build Success ≠ App Works

Critical gap: TypeScript and webpack both reported success while the app was completely broken visually.

**Why builds passed**:
- CSS modules load without errors even if classes don't match
- TypeScript doesn't validate CSS class name references
- No visual regression testing in build pipeline

**What actually broke**:
- TSX: `className={styles.segment}`
- CSS: `.modeToggle__segment { ... }`
- Result: No styles applied (class name mismatch)

### No Incremental Validation

Converted all 45 files at once without checkpoints. Should have:
- Done one component end-to-end first (prove the approach)
- Validated visually after each batch
- Written verification script **before** conversion, not after

### Verification Script Came Too Late

Built `verify-css-modules.sh` after conversion. By then, multiple rounds of "fixes" had already failed. Script should have been:
- Written upfront as acceptance criteria
- Run after each batch
- Part of the conversion process, not cleanup

### Automated Conversion Scripts Failed Silently

The conversion scripts had bugs:
- Didn't handle all BEM patterns
- Missed template literal classNames
- Didn't convert some CSS selectors
- Claimed success despite partial completion

Manual review would have caught these, but we trusted the automation.

## What Could Improve

### Before Starting

- **Proof of concept first**: Convert one component end-to-end, verify visually, then scale
- **Write verification script upfront**: Define success criteria as executable checks
- **Plan for rollback**: Know how to revert before making changes

### During Execution

- **Manual testing at checkpoints**: Not just at the end - after each batch
- **Trust but verify**: Agent claims success → inspect the actual output
- **Incremental commits**: Commit working batches, makes rollback granular
- **Verification script in the loop**: Run after each batch, not just at end

### Agent Orchestration

- **Test agent outputs**: Don't accept "success" at face value
- **Visual regression tests**: Automated screenshot comparison would have caught this
- **Smaller agent scope**: "Convert one file" easier to verify than "convert 45 files"

## Lessons Learned

### Build Passing Is Not Enough

Passing builds (typecheck + webpack) don't guarantee the app works. CSS modules can load successfully with zero applied styles if class names mismatch.

**Implication**: Visual regression testing (manual or automated) is mandatory for styling changes.

### Agent Success Claims Need Verification

When an agent reports "all files converted successfully," that's a claim, not evidence. Verify:
- Grep the actual output
- Manual spot-check random files
- Run acceptance tests (visual, functional, automated)

**Implication**: Agent outputs are first drafts. Treat "done" as "ready for review."

### Automated Conversions Are High-Risk

Large-scale automated refactoring (45 files, 2 file types, pattern matching) has many failure modes:
- Edge cases not handled
- Silent failures (script succeeds, output wrong)
- Partial completion reported as full success

**Implication**: Break automation into smallest testable units. One component end-to-end proves the approach.

### Verification Scripts Should Come First

Writing `verify-css-modules.sh` after conversion is backwards. The script defines success criteria - those should exist before attempting the work.

**Implication**: Acceptance criteria → verification script → implementation. Not the other way around.

### Incremental Beats Big Bang

Converting 45 files in one shot created a large blast radius. When it failed, hard to isolate the root cause. Many fix attempts compounded the confusion.

**Implication**: Smallest possible increments. Commit working batches. Verify before continuing.

## Artifacts

- Spec: `.lore/specs/css-modules-migration.md`
- Plan: `.lore/plans/css-modules-migration.md`
- Implementation notes: `.lore/notes/css-modules-migration.md`
- Brainstorm: `.lore/brainstorm/css-modules-migration.md`
- Verification script: `scripts/verify-css-modules.sh` (written post-failure)
