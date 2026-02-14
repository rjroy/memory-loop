---
title: CSS Modules migration implementation plan
date: 2026-02-14
status: superseded
tags: [css, css-modules, refactor, implementation-plan, aborted]
modules: [components, styles]
related: [.lore/specs/css-modules-migration.md, .lore/brainstorm/css-modules-migration.md, .lore/retros/css-modules-migration-failure.md]
---

> **Note**: This plan was executed on 2026-02-14 but the migration was aborted due to implementation failures. See `.lore/retros/css-modules-migration-failure.md` for lessons learned.

# Plan: CSS Modules Migration

## Spec Reference

**Spec**: `.lore/specs/css-modules-migration.md`

Requirements addressed:
- REQ-CSS-MOD-1: Rename 45 component CSS files to `.module.css` → Steps 3, 4
- REQ-CSS-MOD-2: Global SCSS unchanged → Step 1 (verification)
- REQ-CSS-MOD-3: Update component imports → Step 4
- REQ-CSS-MOD-4: Flatten BEM to camelCase → Step 3
- REQ-CSS-MOD-5: Convert className usages → Step 5
- REQ-CSS-MOD-6: Adopt clsx utility → Step 2, Step 5
- REQ-CSS-MOD-7: Resolve viewer-mobile-menu-btn pattern → Step 3
- REQ-CSS-MOD-8: No other shared classes (verified) → Codebase Context
- REQ-CSS-MOD-9: Add clsx dependency → Step 2
- REQ-CSS-MOD-10: Dead CSS becomes detectable → Step 7 (verification)
- REQ-CSS-MOD-11: Detection only, no removal → Step 7 (note)

## Codebase Context

From exploration agent findings:

**Current state:**
- 49 total CSS/SCSS files: 45 component CSS + 4 global SCSS
- Zero CSS Modules currently (all plain CSS with BEM)
- TypeScript strict mode enabled (type-safe CSS modules will work)
- No existing CSS tooling (no clsx/classnames)

**Import pattern:**
```tsx
import "./Component.css";  // Plain string import
<div className="component__element--modifier">
```

**Conditional className pattern (20+ instances):**
```tsx
className={`browse-mode ${isCollapsed ? "browse-mode--tree-collapsed" : ""}`}
```

**BEM depth:** Maximum 2 levels (`block__element--modifier`). No deep nesting found.

**Shared class pattern:** Only `viewer-mobile-menu-btn` (and `__icon` variant) defined in `BrowseMode.css`, used in 8 viewer components:
- CsvViewer.tsx
- DownloadViewer.tsx
- ImageViewer.tsx
- JsonViewer.tsx
- MarkdownViewer.tsx
- PdfViewer.tsx
- TxtViewer.tsx
- VideoViewer.tsx

**Global styles (stay global):**
- `styles/index.scss` (744 lines, CSS custom properties)
- `styles/_derived-colors.scss` (146 lines, color derivations)
- `styles/holidays.scss` (134 lines, seasonal themes)
- `styles/App.css` (22 lines, body/html base)

**Component CSS by feature:**
- Browse: 13 files (BrowseMode + FileTree + SearchHeader + SearchResults + TaskList + 8 viewers)
- Discussion: 7 files
- Home: 7 files
- Shared: 7 files
- Vault: 7 files
- Pair Writing: 3 files
- Capture: 1 file

## Implementation Steps

### Step 1: Verify Global SCSS Isolation

**Files**: `styles/index.scss`, `styles/_derived-colors.scss`, `styles/holidays.scss`, `styles/App.css`
**Addresses**: REQ-CSS-MOD-2
**Expertise**: None needed

Confirm that the 4 global SCSS files define only:
- CSS custom properties (`:root` selectors)
- Global resets (html, body)
- CSS @import statements

These files must **not** be converted to modules. Grep for any component-specific classes that shouldn't be global:

```bash
# Search for component-prefixed classes in global files
grep -E '\.(browse-mode|discussion|home-view|vault-select|mode-toggle|note-capture|pair-writing)' styles/*.scss styles/*.css

# Should return zero matches (all component classes should be in component CSS files)
```

If component-specific classes are found in global files, extract them to the appropriate component CSS file before continuing.

### Step 2: Add clsx Dependency

**Files**: `package.json`, `bun.lockb`
**Addresses**: REQ-CSS-MOD-9, REQ-CSS-MOD-6
**Expertise**: None needed

Add clsx for conditional class composition:
```bash
bun add clsx
```

Verify installation:
```bash
bun run typecheck  # Should resolve clsx types
```

### Step 3: Create Shared Module for viewer-mobile-menu-btn

**Files**: `components/browse/shared-viewer-styles.module.css` (new)
**Addresses**: REQ-CSS-MOD-7
**Expertise**: None needed

Extract `viewer-mobile-menu-btn` from `BrowseMode.css` to a new shared module:

**New file: `components/browse/shared-viewer-styles.module.css`**
```css
/* Shared styles for all viewer components */
.viewerMobileMenuBtn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.3s ease;
}

.viewerMobileMenuBtn:hover {
  background: var(--color-accent-primary-a10);
  border-color: var(--glass-border);
  box-shadow: 0 0 12px var(--color-accent-primary-a15);
}

@media (hover: none) {
  .viewerMobileMenuBtn:hover {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
}

.viewerMobileMenuBtnIcon {
  width: 20px;
  height: 20px;
}

@media (max-width: 767px) {
  .viewerMobileMenuBtn {
    display: flex;
  }
}
```

Remove all `.viewer-mobile-menu-btn` and `.viewer-mobile-menu-btn__icon` class definitions from `BrowseMode.css`:

```bash
# Verify the classes to remove
grep -n 'viewer-mobile-menu-btn' components/browse/BrowseMode.css
```

Delete the class definitions and their associated rules (including hover states and media queries). Keep all other BrowseMode classes intact.

Do not convert BrowseMode.css to modules yet - that happens in Step 4.

### Step 4: Convert All Component CSS Files to Modules

**Files**: All 45 component `.css` files
**Addresses**: REQ-CSS-MOD-1, REQ-CSS-MOD-3, REQ-CSS-MOD-4
**Expertise**: None needed (mechanical conversion)

For each of the 45 component CSS files:

1. **Rename** `.css` → `.module.css`
2. **Flatten BEM to camelCase** in CSS:
   - `.component-name` → `.componentName`
   - `.component-name__element` → `.element`
   - `.component-name__element--modifier` → `.elementModifier`
   - `.component-name--modifier` → `.modifier`

**Example transformation (BrowseMode.css → BrowseMode.module.css):**
```css
/* Before */
.browse-mode { ... }
.browse-mode--tree-collapsed { ... }
.browse-mode__tree-pane { ... }
.browse-mode__tree-header { ... }
.browse-mode__tree-title--clickable { ... }

/* After */
.browseMode { ... }
.treeCollapsed { ... }
.treePane { ... }
.treeHeader { ... }
.treeTitleClickable { ... }
```

**Naming rules:**
- Remove component name prefix (redundant in scoped module)
- Kebab-case → camelCase
- `__` separators → word boundaries
- `--` separators → word boundaries
- BEM hierarchy flattens to single-level

**Batching strategy:**

Convert files in feature groups with validation checkpoints between batches. After each group, run `bun run typecheck` to catch errors early before proceeding.

**Files to convert (45 total, in 7 batches):**

**Browse (13):**
- `components/browse/BrowseMode.css`
- `components/browse/FileTree.css`
- `components/browse/SearchHeader.css`
- `components/browse/SearchResults.css`
- `components/browse/TaskList.css`
- `components/browse/viewers/CsvViewer.css`
- `components/browse/viewers/DownloadViewer.css`
- `components/browse/viewers/ImageViewer.css`
- `components/browse/viewers/JsonViewer.css`
- `components/browse/viewers/MarkdownViewer.css`
- `components/browse/viewers/PdfViewer.css`
- `components/browse/viewers/TxtViewer.css`
- `components/browse/viewers/VideoViewer.css`

**Discussion (7):**
- `components/discussion/AskUserQuestionDialog.css`
- `components/discussion/Discussion.css`
- `components/discussion/FileAttachButton.css`
- `components/discussion/MessageBubble.css`
- `components/discussion/SlashCommandAutocomplete.css`
- `components/discussion/ToolDisplay.css`
- `components/discussion/ToolPermissionDialog.css`

**Home (7):**
- `components/home/GoalsCard.css`
- `components/home/HomeView.css`
- `components/home/InspirationCard.css`
- `components/home/RecentActivity.css`
- `components/home/SessionActionsCard.css`
- `components/home/SpacedRepetitionWidget.css`
- `components/home/VaultInfoCard.css`

**Shared (7):**
- `components/shared/ConfirmDialog.css`
- `components/shared/ConversationPane.css`
- `components/shared/EditorContextMenu.css`
- `components/shared/InputDialog.css`
- `components/shared/ModeToggle.css`
- `components/shared/MoveDialog.css`
- `components/shared/Toast.css`

**Vault (7):**
- `components/vault/AddVaultDialog.css`
- `components/vault/CardGeneratorEditor.css`
- `components/vault/ConfigEditorDialog.css`
- `components/vault/ExtractionPromptEditor.css`
- `components/vault/MemoryEditor.css`
- `components/vault/SettingsDialog.css`
- `components/vault/VaultSelect.css`

**Pair Writing (3):**
- `components/pair-writing/PairWritingEditor.css`
- `components/pair-writing/PairWritingMode.css`
- `components/pair-writing/vi-mode.css`

**Capture (1):**
- `components/capture/NoteCapture.css`

**Do not rename or modify:**
- `styles/index.scss`
- `styles/_derived-colors.scss`
- `styles/holidays.scss`
- `styles/App.css`

**After each batch:** Run `bun run typecheck` to verify CSS module imports are syntactically valid before continuing to the next batch. This creates checkpoints and makes errors easier to isolate.

### Step 5: Update Component Imports and className Usages

**Files**: All 45 component `.tsx` files
**Addresses**: REQ-CSS-MOD-3, REQ-CSS-MOD-5, REQ-CSS-MOD-6
**Expertise**: None needed (semi-mechanical, needs review)

For each component `.tsx` file:

1. **Update import:**
   ```tsx
   // Before
   import "./Component.css";

   // After
   import styles from "./Component.module.css";
   ```

2. **Update static className:**
   ```tsx
   // Before
   <div className="component-name__element">

   // After
   <div className={styles.element}>
   ```

3. **Update conditional className with clsx:**
   ```tsx
   // Before
   className={`browse-mode ${isCollapsed ? "browse-mode--tree-collapsed" : ""}`}

   // After
   import clsx from "clsx";
   className={clsx(styles.browseMode, isCollapsed && styles.treeCollapsed)}
   ```

4. **For the 8 viewer components**, add shared styles import:
   ```tsx
   import sharedStyles from "../shared-viewer-styles.module.css";

   // Update usage:
   <button className={sharedStyles.viewerMobileMenuBtn}>
     <svg className={sharedStyles.viewerMobileMenuBtnIcon}>
   ```

**Pattern conversion reference:**

| Before | After |
|--------|-------|
| `className="static"` | `className={styles.static}` |
| `className="a b"` (multiple independent styles) | `className={clsx(styles.a, styles.b)}` |
| `className={\`a ${cond ? "b" : ""}\`}` | `className={clsx(styles.a, cond && styles.b)}` |
| `className={\`a ${cond ? "b" : "c"}\`}` | `className={clsx(styles.a, cond ? styles.b : styles.c)}` |

**Note:** The `className="a b"` pattern refers to applying multiple independent styles (e.g., layout + theme classes from different modules), not BEM compound classes. BEM always uses single class names per element.

**Special cases:**
- External libraries passing className props: Keep as-is (passthrough)
- Dynamic class names from variables:
  - **Safe (use `styles[variableName]`)**: Variable is a known constant set of values (e.g., `variant` that's always "primary" | "secondary" | "tertiary")
  - **Unsafe (document as technical debt)**: Variable contains user input, external data, or arbitrary strings that don't map to known CSS classes
  - **Check first**: Grep for `styles[` patterns to identify if any dynamic access exists before starting Step 5

### Step 6: Validate Builds

**Files**: N/A (validation step)
**Addresses**: AI Validation (custom)
**Expertise**: None needed

Run both Next.js runtimes to catch different build behavior:

```bash
# Turbopack (dev runtime)
bun run --cwd nextjs dev
# Should start without errors
# Verify localhost:3000 loads

# Webpack (prod runtime)
bun run --cwd nextjs build
# Should complete without errors
# Check build output for CSS bundle size

# Production preview
bun run --cwd nextjs start
# Should serve without errors
```

Verify:
- No TypeScript errors (strict mode will catch undefined class names)
- No "Module not found" errors for CSS imports
- No console warnings about missing classes
- CSS bundle size similar to pre-migration (slight increase expected from module hashing)

**If build fails:**
1. Identify the specific error from the build output
2. Check for common issues:
   - Missed `.css` → `.module.css` renames
   - Typos in camelCase class names (e.g., `styles.treepane` vs `styles.treePane`)
   - Missing `clsx` imports where conditional classes are used
3. Fix the error before continuing
4. Re-run both `bun run --cwd nextjs dev` and `bun run --cwd nextjs build`
5. **Do not proceed to Step 7 until both dev and build succeed without errors**

### Step 7: Manual Smoke Test

**Files**: N/A (validation step)
**Addresses**: Success Criteria (visual parity)
**Expertise**: None needed

Test all 4 modes on desktop browser to confirm visual parity:

1. **Ground (home-view):**
   - Vault info card displays correctly
   - Session actions card displays correctly
   - Inspiration card loads
   - Spaced repetition widget (if cards exist)
   - Recent activity list

2. **Capture (note-capture):**
   - Note input area renders
   - Capture button styled correctly
   - Date navigation works

3. **Think (discussion):**
   - Message bubbles render correctly
   - Input area styling preserved
   - Tool displays expand/collapse
   - Ask question dialog (if triggered)
   - Slash command autocomplete (type `/`)

4. **Recall (browse-mode):**
   - File tree renders and collapses
   - Search header opens/closes
   - All 8 viewer types:
     - Markdown viewer
     - Image viewer
     - Video viewer
     - PDF viewer
     - JSON viewer
     - Text viewer
     - CSV viewer
     - Download viewer (for unsupported types)
   - **Critical:** Mobile menu button renders on viewers (check responsive at <768px width if possible)

5. **Pair Writing:**
   - Editor renders correctly
   - Toolbar displays and functions
   - Vi-mode indicators (if enabled)

**Pass criteria:** No visual regressions, all styling matches pre-migration.

**Document any findings** in implementation notes for retro.

### Step 8: Verify Dead CSS Detection

**Files**: N/A (verification step)
**Addresses**: REQ-CSS-MOD-10, REQ-CSS-MOD-11
**Expertise**: None needed

Demonstrate that dead CSS is now detectable:

1. Pick a test class (e.g., `styles.treePane` in BrowseMode.module.css)
2. In VSCode or editor, use "Find All References" on the class name
3. Should show both definition (CSS file) and usages (TSX file)
4. Comment out a usage in TSX, re-run "Find All References"
5. Should show definition but zero usages (detectable dead CSS)

**Success:** Unused classes are now findable via tooling (editor + potential ESLint plugin).

**Note:** Do not remove dead CSS during this migration. Detection capability is the goal, cleanup is future work.

### Step 9: Validate Against Spec

**Files**: `.lore/specs/css-modules-migration.md` (read-only)
**Addresses**: All requirements
**Expertise**: Fresh-context review (sub-agent)

Launch a sub-agent that:
1. Reads the spec at `.lore/specs/css-modules-migration.md`
2. Reviews the implementation with these concrete checks:
   - `grep -r 'import.*\.css"' nextjs/components/` → Should return zero matches (all should be `.module.css`)
   - `grep -r 'className="[a-z-]*__' nextjs/components/` → Should return zero BEM separators (`__` or `--`)
   - `grep -r 'from "clsx"' nextjs/components/` → Should find imports in files with conditional classes
   - `find nextjs/components -name "*.css" ! -name "*.module.css"` → Should return zero component CSS files
3. Flags any requirements not met

This step is not optional.

**Expected outcome:** All 11 requirements satisfied.

## Delegation Guide

Steps requiring specialized expertise:
- None needed

All steps are mechanical conversions or standard validation. No domain-specific expertise required (no security, performance, accessibility concerns).

## Open Questions

**Resolved during planning:**
- Shared `viewer-mobile-menu-btn` pattern: Extract to `shared-viewer-styles.module.css` (Step 3)
- BEM flattening approach: Remove component prefix, convert to camelCase (Step 4)
- Conditional class handling: Adopt clsx (Step 2, Step 5)

**To resolve during implementation:**
- If any dynamic class names from variables exist (e.g., `className={styles[varName]}`), handle case-by-case
- If any external library className props break, document and adjust (unlikely with passthrough props)
