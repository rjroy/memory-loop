---
title: webpackIgnore silently broke instrumentation; turbopack branch elimination matters
date: 2026-02-06
status: complete
tags: [bug, bundler, turbopack, webpack, instrumentation, search, content-root]
modules: [search-routes, instrumentation, scheduler-bootstrap]
related: [.lore/plans/content-root-search-fix.md, .lore/notes/content-root-search-fix.md]
---

# Retro: contentRoot search fix + instrumentation repair

## Summary

Two fixes shipped in one PR. The planned work (issue #449, three one-word edits to search routes) went exactly as designed. The unplanned work (discovering and fixing silently broken instrumentation) took most of the session and required three failed approaches before landing on the right one.

## What Went Well

- **Issue #449 was textbook**: Plan identified three files, implementation was three one-word edits, fresh-context validation confirmed no remaining instances. The lore workflow (prep-plan, implement, validate) worked exactly as intended for a well-scoped bug.
- **Root cause found quickly**: The instrumentation error the user reported traced directly to commit 92141cd. Reading the commit diff made the mechanism clear: `webpackIgnore` prevents webpack from resolving `@/` aliases, so the import failed at runtime.
- **Discovery of a deeper problem**: The investigation revealed that schedulers were never running in production since the workspace collapse. The `webpackIgnore` approach was silently failing inside try/catch blocks. This was a bigger win than just fixing the immediate error.

## What Could Improve

- **Three failed approaches before the right one**: (1) Changed `@/` to `./` paths, which don't exist from `.next/server/`. (2) Removed `webpackIgnore` entirely, which fixed production but caused turbopack dev warnings. (3) Used expression imports (`const mod = "cron"; import(mod)`), which caused "Critical dependency" warnings. The winning approach (NODE_ENV === "production" branch for dead-code elimination) should have been the first attempt.
- **Commit 92141cd should have been caught at merge time**: The PR that added `webpackIgnore` to the logger import outside try/catch was never tested in production. The CLAUDE.md lesson about "validate the dev server, not just the production build" already existed but wasn't sufficient. The reverse also matters: validate production, not just the dev server.
- **Understanding bundler semantics before attempting fixes**: Each failed approach came from an incomplete mental model of how turbopack and webpack handle imports. Time spent reading the actual bundler behavior would have been faster than trial-and-error.

## Lessons Learned

- `webpackIgnore: true` on dynamic imports prevents webpack from resolving path aliases (`@/`). The import becomes a raw runtime `require()` with the literal string `@/lib/...`, which doesn't exist on disk. Never use `webpackIgnore` with aliased paths.
- Turbopack dead-code-eliminates `if (NODE_ENV === "production") { ... }` branches in dev mode, including dynamic imports inside the branch. But it does NOT eliminate code after an early `return` in a `if (NODE_ENV === "development") { return; }` guard. Use positive production checks, not negative development guards, when you need bundler-level elimination.
- `serverExternalPackages` in next.config.ts works for webpack (production builds) but turbopack (dev) still traces into those packages and warns about unresolvable dependencies like `child_process`. The `NODE_ENV` branch approach is the correct way to keep those imports out of turbopack's static analysis.
- Silent failures in try/catch blocks can mask fundamental breakage for weeks. The schedulers appeared to "start" (no crash) but the imports inside try/catch were failing every time. When a catch block logs and continues, the system looks healthy while core functionality is missing.

## Artifacts

- Plan: `.lore/plans/content-root-search-fix.md`
- Notes: `.lore/notes/content-root-search-fix.md`
- PR: [#465](https://github.com/rjroy/memory-loop/pull/465)
- Issue: [#449](https://github.com/rjroy/memory-loop/issues/449)
