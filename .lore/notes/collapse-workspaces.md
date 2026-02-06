---
title: Implementation notes: collapse-workspaces
date: 2026-02-06
status: complete
tags: [implementation, notes]
source: .lore/plans/collapse-workspaces.md
modules: [backend, shared, nextjs]
---

# Implementation Notes: Collapse Workspaces

## Baseline

- Backend: 2,071 tests across 38 files
- Next.js: 1,953 tests across 65 files
- Shared: 85 tests across 1 file
- **Total: 4,109 tests across 104 files**

## Progress

- [x] Step 1: Move shared into nextjs/lib/schemas
- [x] Step 2: Move backend into nextjs/lib
- [x] Step 2.5: Verify test discovery
- [x] Step 3: Strip .js extensions (all nextjs/, not just lib/)
- [x] Step 4: Rewrite workspace imports to path aliases
- [x] Step 5: Merge dependencies and clean package.json files
- [x] Step 6: Clean next.config.ts
- [x] Step 7: Clean tsconfig.json
- [x] Step 8: Update infrastructure
- [x] Step 9: Delete workspace remnants
- [x] Step 10: Validate
- [x] Step 11: Validate against goal

## Final Counts

- Tests: 4,109 pass across 104 files (matches baseline exactly)
- Typecheck: 0 errors
- Lint: 0 errors (7 pre-existing warnings)
- Build: success

## Divergences from Plan

1. **Broader .js extension stripping**: Plan targeted only `nextjs/lib/` but .js imports also existed in `nextjs/contexts/`, `nextjs/components/`, and `nextjs/hooks/`. The webpack `extensionAlias` had been resolving these project-wide. Ran sed across all nextjs .ts/.tsx files.

2. **React types conflict in MarkdownViewer.tsx**: Fresh `bun install` resolved `@types/react` to 19.2.x. react-markdown's `Components` type became incompatible with the newer React types on JSX prop spreads. Fixed by adding `Components` return type to `createMarkdownComponents()` and removing explicit `ComponentProps<>` parameter annotations.

3. **Stale .next cache**: After all import rewrites, `next build` failed with a 404 prerender error (null useContext). Caused by stale `.next` cache, not a code issue. Fixed with `rm -rf nextjs/.next`.

4. **Lockfile**: Removed secondary `nextjs/bun.lock` created by `bun install --cwd nextjs`. Root `bun.lock` is canonical.

5. **Leftover node_modules**: `git rm -r backend/ shared/` removed tracked files but left `node_modules/` (gitignored). Cleaned up manually with `rm -rf`.

## Log
