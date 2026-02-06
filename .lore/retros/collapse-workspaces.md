---
title: Workspace collapse validated the plan but exposed CI blind spots
date: 2026-02-06
status: complete
tags: [refactor, monorepo, workspace-collapse, ci, turbopack, bundler, deployment]
modules: [nextjs, backend, shared, ci, instrumentation]
related:
  - .lore/brainstorm/collapse-workspaces.md
  - .lore/plans/collapse-workspaces.md
  - .lore/notes/collapse-workspaces.md
  - .lore/retros/next-js-migration.md
---

# Retro: Workspace Collapse

## Summary

Collapsed the three-workspace monorepo (backend/, shared/, nextjs/) into a single Next.js application. 218 files changed, 127 import statements rewritten, zero behavior changes. 4,109 tests pass identically before and after. PR #461.

## What Went Well

- **The plan was accurate.** 11 steps, executed in order, no architectural surprises. The brainstorm correctly identified this as a mechanical refactor. Open questions (lib/ vs server/, schema placement, incremental vs all-at-once) were resolved before the plan was written, so execution was unambiguous.
- **Prior retro lessons applied.** The next-js-migration retro flagged "update deployment artifacts as part of the plan, not an afterthought." This plan included CI, pre-commit, CLAUDE.md, launch script, and systemd service as explicit steps. The systemd service check turned out unnecessary (entry point didn't change), but checking was cheap.
- **Plan reviewer caught real gaps.** The fresh-context reviewer flagged three items: test discovery verification, concrete sed scripts, and baseline test count recording. All three proved useful during execution. Step 2.5 (test discovery) and the baseline count were essential for confidence.
- **git mv preserved history.** Git detected all moves as renames (96-100% similarity), so `git log --follow` works on any file. The diff shows 698 insertions vs 1232 deletions, mostly from the import rewrites, not from actual code changes.

## What Could Improve

- **Validation didn't test `next dev`.** The plan validated typecheck, lint, tests, build, and reference checks. All passed. But `next dev` uses turbopack (not webpack), which doesn't respect `serverExternalPackages` the same way. The dev server errored on `cron`'s `child_process` dependency. This was caught by manual testing after the commit, not by the validation step.
- **.js extension stripping was scoped too narrowly.** The plan targeted `nextjs/lib/` for .js extension removal (where backend code landed). But the webpack `extensionAlias` hack had been resolving .js imports project-wide, including in `contexts/`, `components/`, and `hooks/`. The build caught this, but the plan should have grepped for .js imports across all of nextjs/ from the start.
- **Root `bun install` didn't install nextjs dependencies.** Removing the `workspaces` field from root `package.json` meant `bun install` from root only installed root devDependencies. This passed locally (nextjs/node_modules was already populated) but failed in CI (clean checkout). The fix was restoring `"workspaces": ["nextjs"]`. The plan said "remove workspaces entirely" without considering that the root install command needs workspace awareness to resolve the nested package.json.
- **"Pre-existing" was used as a deflection.** When the dev server failed, initial response was to check if it was pre-existing on main. While technically true that main also had a dev-mode error (different error: can't resolve 'cron' at all), the collapse changed the error surface. The right response was to fix it, not to classify it.

## Lessons Learned

- Validate the dev server, not just the production build. Turbopack (dev) and webpack (build) resolve modules differently. `serverExternalPackages` works for webpack but not turbopack. `webpackIgnore` comments on dynamic imports are the correct fix for instrumentation files that import modules with Node.js built-in dependencies.
- When removing workspace config, trace the dependency installation path end-to-end. "Where do dependencies come from?" is a deployment question, not just a development question. If CI runs `bun install` from root, root must be able to resolve all nested dependencies.
- Scope sed operations by grepping for the pattern first, not by assuming where it lives. `grep -r "\.js\"" --include="*.ts" nextjs/` would have shown .js imports in contexts/ and hooks/ before the sed step targeted only lib/.
- When something breaks after your change, fix it. Checking if it was pre-existing is fine for understanding, but the user sees a broken dev server after your commit. That's your problem now.

## Artifacts

- `.lore/brainstorm/collapse-workspaces.md` - Original analysis
- `.lore/plans/collapse-workspaces.md` - Execution plan (11 steps)
- `.lore/notes/collapse-workspaces.md` - Implementation notes with divergences
- PR #461 - The collapse PR
