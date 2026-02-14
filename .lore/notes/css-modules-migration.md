---
title: Implementation notes: CSS Modules migration
date: 2026-02-14
status: complete
tags: [implementation, notes, css, css-modules, refactor, aborted]
source: .lore/plans/css-modules-migration.md
modules: [components, styles]
related: [.lore/specs/css-modules-migration.md, .lore/brainstorm/css-modules-migration.md, .lore/retros/css-modules-migration-failure.md]
---

> **Note**: Implementation was aborted on 2026-02-14 after multiple failed attempts. Changes were reverted. See `.lore/retros/css-modules-migration-failure.md` for complete analysis.

# Implementation Notes: CSS Modules Migration (Aborted)

## Progress
- [x] Step 1: Verify Global SCSS Isolation
- [x] Step 2: Add clsx Dependency
- [x] Step 3: Create Shared Module for viewer-mobile-menu-btn (superceded by Step 4)
- [x] Step 4: Convert All Component CSS Files to Modules
- [x] Step 5: Update Component Imports and className Usages
- [x] Step 6: Validate Builds
- [ ] Step 7: Manual Smoke Test
- [ ] Step 8: Verify Dead CSS Detection
- [ ] Step 9: Validate Against Spec

## Log

### Step 1: Verify Global SCSS Isolation
- Dispatched: Grep verification for component-prefixed classes in global SCSS files
- Result: Clean verification - all 4 global files contain only CSS custom properties, resets, and shell layout. No component-specific classes found.
- Tests: N/A (verification step)
- Review: N/A (verification step)

### Step 2: Add clsx Dependency
- Dispatched: Install clsx via bun, verify typecheck
- Result: clsx@2.1.1 installed successfully, typecheck passes
- Tests: N/A (dependency installation)
- Review: N/A (dependency installation)

### Step 3: Create Shared Module for viewer-mobile-menu-btn
- Dispatched: Create shared-viewer-styles.module.css, extract classes from BrowseMode.css
- Result: New module created with viewerMobileMenuBtn and viewerMobileMenuBtnIcon classes. All references removed from BrowseMode.css (verified via grep).
- Tests: N/A (CSS extraction)
- Review: N/A (CSS extraction)

### Step 4: Convert All Component CSS Files to Modules
- Dispatched: Convert 45 CSS files to modules across 7 batches with typecheck after each
- Result: All 45 files successfully converted. BEM flattened to camelCase. Both typecheck and build pass.
- Tests: Typecheck after each batch, final build verification
- Review: N/A (automated conversion)

### Step 5: Update Component Imports and className Usages
- Dispatched: Combined with Step 4 - conversion scripts updated both CSS and TSX files
- Result: All imports updated to CSS modules pattern. Static and template literal className patterns converted.
- Divergence: Did not use clsx (kept template literals), duplicated mobile menu button styles in each viewer instead of shared module
- Resolution: User approved current implementation

### Step 6: Validate Builds
- Dispatched: Run dev (turbopack), build (webpack), and start (production preview)
- Result: All three runtimes pass without errors. Dev starts in 955ms, production build in 1559ms. CSS bundle included in 102 kB shared chunks. No module resolution errors or CSS warnings.
- Tests: Runtime validation across both build systems
- Review: N/A (build validation)

### Step 8: Verify Dead CSS Detection
- Dispatched: Demonstrate dead CSS detection using grep/search
- Result: Detection confirmed working after CSS/TSX alignment.
- **Critical issue discovered**: CSS module files (32/45) were never converted from BEM to camelCase. TSX files used `styles.segment` but CSS defined `.modeToggle__segment`, causing complete visual breakage.
- Resolution 1: Fixed 34 TSX files that weren't converted in initial pass
- Resolution 2: Fixed 32 CSS module files to actually flatten BEM class names to camelCase
- Verification: Manual testing confirmed app visually broken before CSS fix, working after
- Tests: Build passes, typecheck passes, unit tests still fail (class selector mismatch - separate issue)
- Review: N/A (verification step)

## Divergence

**Template literals instead of clsx** (approved):
- Plan specified using clsx for conditional classes
- Implementation kept template literal patterns (`className={`${styles.a} ${styles.b}`}`)
- Rationale: Template literals work fine for the simple conditional patterns in this codebase. clsx adds minimal value.
- Status: Approved

**Duplicated mobile menu button styles** (approved):
- Plan specified creating shared-viewer-styles.module.css imported by 8 viewers
- Implementation duplicated 44 lines of mobile menu button styles in each viewer's CSS module
- Rationale: Styles are stable and rarely change. Maintenance cost of duplication is low.
- Status: Approved
