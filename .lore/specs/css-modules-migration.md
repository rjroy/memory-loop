---
title: CSS Modules migration for Memory Loop
date: 2026-02-14
status: draft
tags: [css, css-modules, styling, refactor, dead-css-detection]
modules: [components, styles]
related: [.lore/brainstorm/css-modules-migration.md]
req-prefix: CSS-MOD
---

# Spec: CSS Modules Migration

## Overview

Convert all component CSS files from plain CSS with BEM naming to CSS Modules. The primary goal is making dead CSS detectable through tooling-visible dependencies. CSS Modules turn `className="string"` into `styles.property`, making unused classes findable via editor "find all references" and lintable via ESLint plugins.

## Entry Points

N/A - This is an internal refactoring with no user-facing entry points.

## Requirements

### File Conversion

- REQ-CSS-MOD-1: All 45 component CSS files rename from `Component.css` to `Component.module.css`
- REQ-CSS-MOD-2: Global SCSS files (`styles/index.scss`, `styles/_derived-colors.scss`, `styles/holidays.scss`) remain unchanged (they define CSS custom properties, which CSS Modules don't scope)
- REQ-CSS-MOD-3: All component TypeScript files update CSS imports from `import "./Component.css"` to `import styles from "./Component.module.css"`

### Class Name Flattening

- REQ-CSS-MOD-4: All BEM class names flatten to camelCase (`.mode-toggle__segment--selected` → `.segmentSelected`)
- REQ-CSS-MOD-5: All `className="bem-string"` usages convert to `className={styles.camelCase}`
- REQ-CSS-MOD-6: Conditional class patterns adopt `clsx` utility for clean composition

### Shared Styles

- REQ-CSS-MOD-7: The `viewer-mobile-menu-btn` class (defined in `BrowseMode.css`, used in 8 viewer components) moves to a shared module or component composition pattern
- REQ-CSS-MOD-8: No other shared cross-component classes exist (verified via grep)

### Dependencies

- REQ-CSS-MOD-9: Add `clsx` package dependency (234 bytes, standard CSS Modules companion)

### Dead CSS Detection

- REQ-CSS-MOD-10: After conversion, unused CSS classes become detectable via "find all references" in editors
- REQ-CSS-MOD-11: Migration makes dead CSS *detectable* but does not require actively removing it (cleanup is future work)

## Exit Points

N/A - This is an internal refactoring with no user-facing exit points.

## Success Criteria

How we know this is done:

- [ ] All 45 component `.css` files converted to `.module.css`
- [ ] All component imports updated to `import styles from "./Component.module.css"`
- [ ] All BEM class names flattened to camelCase in CSS
- [ ] All `className` usages updated to `styles.property` or `clsx(...)` patterns
- [ ] `clsx` package added to dependencies
- [ ] Shared `viewer-mobile-menu-btn` pattern resolved (shared module or composition)
- [ ] `bun run --cwd nextjs dev` starts without errors
- [ ] `bun run --cwd nextjs build` completes without errors
- [ ] Manual smoke test of all 4 modes (Ground, Capture, Think, Recall) on desktop browser shows visual parity with pre-migration

## AI Validation

How the AI verifies completion before declaring done.

**Defaults** (apply unless overridden):
- Unit tests with mocked time/network/filesystem/LLM calls (including Agent SDK `query()`)
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom** (feature-specific):
- Grep confirms zero `.css` imports in component files (all use `.module.css`)
- Grep confirms zero BEM class names in component `.tsx` files (all use `styles.x`)
- Both `next dev` (turbopack) and `next build` (webpack) succeed (lesson from workspace collapse retro)
- Visual smoke test confirms no styling regressions

**Not required:**
- Automated visual regression tests (manual smoke test sufficient per user preference)
- Mobile browser testing (desktop sufficient per user preference)

## Constraints

- Single PR delivery (no incremental migration to avoid two conventions coexisting)
- Zero user-facing behavior changes (pure internal refactor)
- Design token system (CSS custom properties) remains unchanged
- Holiday theme system (`[data-holiday]` attribute) remains unchanged
- Responsive breakpoint patterns (`@media` queries) remain unchanged
- 1:1 component-to-CSS-file relationship remains unchanged

## Context

**From `.lore/brainstorm/css-modules-migration.md`:**

The brainstorm established that the primary motivation is dead CSS detection, not scoping (BEM already handles that). With side-effect imports, every class ships to the browser whether used or not, and no tooling can identify unreferenced classes. CSS Modules make the CSS-to-component relationship a real import dependency that editors and linters can analyze.

Key decisions from brainstorm:
- Flatten BEM inside modules (scoping redundancy)
- Adopt `clsx` for conditional class composition
- Global SCSS and CSS custom properties survive unchanged
- Holiday themes unaffected
- Incremental migration technically possible but creates cognitive overhead (two conventions coexisting)

**From `.lore/retros/collapse-workspaces.md`:**

Relevant lessons for this migration:
- Scope operations by grepping first (grep for all className patterns before scoping find/replace operations)
- Validation must cover all runtimes (`next dev` with turbopack AND `next build` with webpack behave differently)
- Fresh-context review catches gaps the implementer misses

**From lore-researcher findings:**

The current structure (consolidated Next.js application from workspace collapse) has components in `nextjs/components/`, hooks in `nextjs/hooks/`, and global styles in `nextjs/styles/`. The CSS migration operates within this consolidated structure.

Shared class analysis: Only `viewer-mobile-menu-btn` (and its `__icon` variant) are shared across component boundaries (8 viewer files use classes defined in `BrowseMode.css`). All other classes are component-scoped.
