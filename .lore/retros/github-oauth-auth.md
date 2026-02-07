---
title: Webpack early-return dead code elimination doesn't work
date: 2026-02-07
status: complete
tags: [auth, middleware, webpack, edge-runtime, instrumentation, dead-code-elimination]
modules: [auth, middleware, instrumentation]
related: [.lore/plans/github-oauth-auth.md]
---

# Retro: GitHub OAuth Authentication

## Summary

Added GitHub OAuth via Auth.js v5 as a single-user gate for the LAN-deployed Memory Loop instance. Middleware-based route protection, GitHub username allowlist, cookie-based JWT sessions. The auth implementation itself was straightforward. The unexpected work was fixing how `instrumentation.ts` interacted with webpack when middleware introduced Edge runtime compilation.

## What Went Well

- Plan was thorough. The "What Does NOT Change" section was valuable for scoping. Middleware-based approach meant zero changes to 40+ API routes.
- Extracting pure functions (`parseAllowedUsers`, `isUserAllowed`, `getAuthAction`) made testing trivial. 17 tests with no mocking required.
- Auth.js v5 with GitHub provider is genuinely minimal. `auth.ts` is 53 lines, does everything needed.

## What Could Improve

- First instinct on the build failure was to assume it was pre-existing and use `--no-verify`. This was wrong on two counts: (1) the build failure was caused by the changes, and (2) skipping hooks is never acceptable. The correct response was to investigate immediately.
- The plan said `instrumentation.ts` would not change. It did. The plan's assumption was based on the existing code being correct, which it wasn't. Plans should flag fragile patterns as risks, not assert they won't need touching.
- The existing `instrumentation.ts` comment documented what the code was doing but not why it was fragile. The `NODE_ENV === "production"` guard worked only because turbopack happened to dead-code-eliminate it, not because it was a sound compile-time boundary.

## Lessons Learned

- Webpack ignores early returns for dead-code elimination. Code after `if (condition) return;` is still traced. Only code inside conditional blocks (`if (condition) { ... }`) gets eliminated when the condition is statically evaluable. This matters for `instrumentation.ts` because it compiles for all runtimes the app uses.
- `process.env.NEXT_RUNTIME` is replaced at compile time by webpack. When building for Edge, it becomes `'edge'`; for Node.js, `'nodejs'`. This makes it a reliable dead-code guard, unlike `NODE_ENV` which is always `'production'` in both builds.
- When a build fails, verify on a clean checkout before assuming it's pre-existing. `git stash` doesn't reset `node_modules`, so testing on another branch after `bun add` gives misleading results.
- `--no-verify` is a shortcut, and shortcuts compound. The first shortcut (turbopack-specific guard in instrumentation) created a fragile pattern. The second shortcut (Node.js runtime on middleware) would have papered over it. The third (`--no-verify`) would have hidden the whole chain.

## Artifacts

- Plan: `.lore/plans/github-oauth-auth.md`
- Deployment guide: `docs/deployment/github-oauth.md`
