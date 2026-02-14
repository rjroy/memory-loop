---
title: CSS Modules migration for Memory Loop
date: 2026-02-12
status: open
tags: [css, css-modules, styling, dead-css, developer-experience]
modules: [components, styles]
---

# Brainstorm: CSS Modules Migration

## Context

Memory Loop uses 46 plain CSS files with BEM naming, imported as side-effects (`import "./Component.css"`). Global design tokens live in 3 SCSS files using CSS custom properties. The question: what would it look like to convert to CSS Modules, and is it worth it?

## Primary Motivation: Dead CSS Detection

The core problem isn't scoping (BEM already handles that) or maintenance burden (AI writes the CSS). The problem is **dead CSS is invisible.** With side-effect imports, every class ships to the browser whether used or not. No tooling can tell you `.mode-toggle__segment--hover` is unreferenced without grepping, and grep can't distinguish real usage from similar text.

CSS Modules make the CSS-to-component relationship a real, tooling-visible dependency. `styles.segmentHover` is a property access. Editors show zero references for unused classes. ESLint plugins can flag them. The connection between `.tsx` and `.css` becomes an import, not a naming convention.

## Philosophy

Tailwind ties CSS to markup, which is the opposite of why CSS was created. CSS Modules keep styles in separate files but create a direct, explicit connection to the component. Separation of concerns with a real dependency graph.

## Ideas Explored

### Flatten BEM inside modules

BEM solves scoping. CSS Modules solve scoping. Running both is redundant. Inside a module, `.segment` is already scoped to the component.

```css
/* Before: ModeToggle.css */
.mode-toggle__segment--selected { ... }

/* After: ModeToggle.module.css */
.segmentSelected { ... }
```

JSX goes from `"mode-toggle__segment--selected"` to `styles.segmentSelected`. Cleaner on both sides.

### Conditional class patterns need `clsx`

Current pattern:
```tsx
className={`mode-toggle ${isCollapsed ? "mode-toggle--collapsed" : ""}`}
```

With modules, template literals get noisy. `clsx` (234-byte utility) cleans it up:
```tsx
className={clsx(styles.modeToggle, isCollapsed && styles.collapsed)}
```

Standard companion to CSS Modules in React. Small dependency, real ergonomic improvement for conditional classes.

### Design token system survives unchanged

CSS Modules scope class names, not custom properties. `var(--color-accent-primary)` works identically inside `.module.css` files. The entire SCSS token system (base palette, derived colors, glassmorphism, gradients, glow effects) carries over untouched.

### Holiday themes unaffected

`[data-holiday]` selectors override CSS variables on `:root`. Since modules don't touch custom properties, seasonal themes work unchanged.

### Incremental migration is technically possible

Next.js supports `.css` and `.module.css` side by side. Convert one component at a time. Risk: two conventions coexisting indefinitely creates cognitive overhead ("which pattern is this file?").

### `composes` doesn't obviously help

CSS Modules have `composes` for shared styles, but the existing glassmorphism pattern uses CSS custom properties, which is already more composable than `composes` would be.

## What Doesn't Change

- SCSS global files (design tokens, derived colors, holidays)
- CSS custom property usage inside component styles
- Responsive breakpoint patterns (`@media` queries inside module files)
- 1:1 component-to-CSS-file relationship
- Mobile-first responsive approach

## What Changes

- 46 `.css` files rename to `.module.css`
- All BEM class names flatten to camelCase
- All `import "./Component.css"` become `import styles from "./Component.module.css"`
- All `className="string"` become `className={styles.name}`
- All conditional class patterns adopt `clsx`
- New dependency: `clsx`

## Open Questions

- What naming convention for flattened classes? camelCase (`segmentSelected`) seems natural for JS property access.
- Any shared CSS classes across components that would need a shared module?
- Does the conversion reveal dead CSS immediately (classes in CSS not imported in JSX)?

## Next Steps

This is a clear trade: touch 46 files to get tooling-visible CSS-to-component dependencies and dead CSS detection. The design system, theming, and responsive patterns all survive. Candidate for a spec and plan if moving forward.
