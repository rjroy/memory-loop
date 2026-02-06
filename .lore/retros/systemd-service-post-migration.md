---
title: webpackIgnore bypasses extension resolution at runtime
date: 2026-02-05
status: complete
tags: [deployment, systemd, webpack, next-js, module-resolution, infrastructure]
modules: [instrumentation, next-config, service-file]
related: [.lore/retros/next-js-migration.md]
---

# Retro: Systemd Service Post-Migration Fix

## Summary

After the Next.js migration (PR #458), the systemd service and background schedulers were broken. The service file still referenced the old `frontend`/`backend` directory structure. The schedulers (extraction, card discovery) failed at runtime with `ERR_MODULE_NOT_FOUND` because `webpackIgnore: true` on dynamic imports bypassed webpack's `.js` → `.ts` extension alias, leaving Node.js to resolve extensions it couldn't find.

## What Went Well

- **Root cause was clean once identified.** The error pointed directly at the problem: `.js` file not found at a path where only `.ts` exists. The connection to `webpackIgnore` was straightforward once you understand what it actually does (skip webpack entirely, not just skip bundling).
- **Fix was minimal and correct.** Adding `serverExternalPackages: ["cron"]` to next.config.ts solved the original problem (`cron` → `child_process` can't be bundled) while letting webpack process the rest of the import chain normally. Removed the `webpackIgnore` hack entirely.

## What Could Improve

- **Service file wasn't part of the migration checklist.** The migration PR touched every component of the application but didn't update the deployed service. Deployment artifacts (systemd units, docker-compose, nginx configs) need to be on the migration checklist alongside code.
- **`bun install` wasn't run after migration.** The new `nextjs` workspace dependencies (specifically `next` itself) weren't installed on the machine. The service failed with exit code 127 (`next` not found) before the scheduler issue even surfaced. Migration PRs that change workspace structure need a `bun install` step.
- **The `webpackIgnore` workaround was brittle from the start.** It solved one problem (webpack can't bundle `child_process`) by creating another (runtime can't resolve `.js` → `.ts`). It only appeared to work because the schedulers silently caught and logged the error rather than crashing the server. `serverExternalPackages` is the intended mechanism for this exact scenario.

## Lessons Learned

- `webpackIgnore: true` in Next.js dynamic imports means webpack never touches the import chain. Any build-time resolution (like `extensionAlias` for `.js` → `.ts`) won't apply. The import becomes a raw runtime `import()` that the server's module system must resolve on its own.
- `serverExternalPackages` is the correct Next.js escape hatch for packages that can't be bundled (native modules, `child_process` users). It keeps webpack in the loop for everything else in the import chain while leaving the problematic package as a runtime dependency.
- Deployment artifacts are part of the codebase. When a migration changes directory structure, server entry points, or environment variable names, check every file that references the old paths: service files, CI configs, deployment scripts, reverse proxy configs.

## Artifacts

- `nextjs/next.config.ts` - Added `serverExternalPackages: ["cron"]`
- `nextjs/instrumentation.ts` - Removed `webpackIgnore: true` from scheduler imports
- `~/.config/systemd/user/memory-loop.service` - Updated for Next.js architecture
- `scripts/memory-loop.service.example` - Already correct (updated in migration PR)
