---
title: Collapse backend and shared workspaces into Next.js
date: 2026-02-05
status: open
tags: [architecture, refactor, next-js, monorepo, simplification]
modules: [backend, shared, nextjs]
related: [.lore/brainstorm/next-js-migration.md, .lore/retros/next-js-migration.md]
---

# Brainstorm: Collapse Workspaces

## Context

After the Next.js migration, the three-workspace monorepo structure (backend, shared, nextjs) no longer serves a purpose. Backend is a library imported by exactly one thing. Shared enforces a contract between two workspaces that have a single consumer. This is a folder problem dressed up as a workspace problem.

## What Exists Today

```
backend/   # Library: domain logic (vault ops, SDK, schedulers, streaming)
shared/    # Zod schemas and TypeScript types
nextjs/    # Next.js App Router (the only consumer of both)
```

## What It Should Look Like

```
nextjs/
  lib/           # Domain logic (what backend/ is today)
  lib/schemas/   # Zod schemas (what shared/ is today)
```

Or possibly `server/` instead of `lib/` for the domain logic, following Next.js convention that server-only code lives in a `server/` directory.

## What the Workspaces Cost

- `transpilePackages` and `.js` extension alias webpack hack in `next.config.ts`
- Three separate typecheck/lint/test passes
- "Where does this go?" friction for every new module
- `@memory-loop/backend` and `@memory-loop/shared` import paths instead of `@/lib/...`
- `package.json` dependency wiring between workspaces

## What the Collapse Gives

- One tsconfig, one test run, one lint pass
- Standard Next.js `@/` import paths
- No transpilePackages config
- No webpack extension alias hack
- Simpler mental model: it's a Next.js app

## Scope

Big mechanical refactor. ~40+ files move, every import path changes. No behavior change. Tests should pass identically before and after.

## Open Questions

- `lib/` vs `server/` for domain logic? Next.js convention leans `server/` for server-only code, but `lib/` is more common in practice.
- Do Zod schemas stay in their own directory or get colocated with the API routes that use them? Colocation is idiomatic but the schemas are shared between API routes and frontend components.
- Should this be done incrementally (move one module at a time) or all at once? All at once is cleaner but riskier.
