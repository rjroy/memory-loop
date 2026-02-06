---
title: Collapse backend and shared workspaces into Next.js
date: 2026-02-06
status: executed
tags: [refactor, monorepo, simplification, next-js, workspace-collapse]
modules: [backend, shared, nextjs]
related:
  - .lore/brainstorm/collapse-workspaces.md
  - .lore/plans/nextjs-consolidation.md
  - .lore/retros/next-js-migration.md
  - .lore/retros/systemd-service-post-migration.md
---

# Plan: Collapse Workspaces

## Goal

Eliminate the three-workspace monorepo structure. Move all code from `backend/` and `shared/` into `nextjs/`, producing a single Next.js application with no workspace indirection.

After this work:
- No `transpilePackages`, no `.js` extension alias hack, no `externalDir`
- One `tsconfig.json`, one test run, one lint pass
- All imports use standard Next.js `@/` paths
- `backend/` and `shared/` directories are gone
- Every existing test passes without behavior change

## Codebase Context

**Current structure:**
- `backend/` — 44 source files, 38 test files. Domain logic library with 28 named exports. Dependencies: claude-agent-sdk, cron, minisearch, gray-matter, lodash-es, and others.
- `shared/` — 4 source files, 1 test file. Zod schemas and TypeScript types. Only dependency: zod.
- `nextjs/` — The application. 36 files import backend (49 statements), 75 files import shared (78 statements). Already has `lib/controller.ts` and `lib/vault-helpers.ts`.

**Workspace costs being eliminated:**
- `next.config.ts`: `transpilePackages`, `externalDir: true`, webpack `extensionAlias` hack
- `tsconfig.json`: path aliases pointing outside project (`../backend/src/*`, `../shared/src/index.ts`)
- Three separate typecheck/lint/test passes in CI, pre-commit, and root scripts
- `workspace:*` dependency wiring across three `package.json` files

**Zod version mismatch:** `shared` and `backend` use `zod@^4.0.0`, `nextjs` uses `zod@^3.24.4`. Must resolve to zod 4 during dependency merge.

**Retro lessons applied:**
- Update deployment artifacts (systemd, CI, launch script) as part of the plan, not an afterthought
- `serverExternalPackages: ["cron"]` must stay (cron uses child_process, can't be bundled)
- Dynamic imports in `instrumentation.ts` still needed for cron-dependent modules

## Target Structure

```
nextjs/
  lib/
    controller.ts              # existing
    vault-helpers.ts           # existing
    schemas/                   # from shared/src/
      index.ts
      protocol.ts
      types.ts
    vault-manager.ts           # from backend/src/
    session-manager.ts
    note-capture.ts
    file-browser.ts
    ... (remaining top-level backend files)
    streaming/                 # from backend/src/streaming/
    extraction/                # from backend/src/extraction/
    spaced-repetition/         # from backend/src/spaced-repetition/
    search/                    # from backend/src/search/
    handlers/                  # from backend/src/handlers/
    skills/                    # from backend/src/skills/
    prompts/                   # from backend/src/prompts/
    commands/                  # from backend/src/commands/
    __tests__/                 # from backend/src/__tests__/
```

## Implementation Steps

### Step 1: Move shared into nextjs/lib/schemas

**Files**: `shared/src/index.ts`, `shared/src/protocol.ts`, `shared/src/types.ts`, `shared/src/__tests__/protocol.test.ts`
**Delegation**: inline

Create `nextjs/lib/schemas/` and `git mv` the 4 files:
- `shared/src/index.ts` → `nextjs/lib/schemas/index.ts`
- `shared/src/protocol.ts` → `nextjs/lib/schemas/protocol.ts`
- `shared/src/types.ts` → `nextjs/lib/schemas/types.ts`
- `shared/src/__tests__/protocol.test.ts` → `nextjs/lib/schemas/__tests__/protocol.test.ts`

Update internal imports within these files: `./protocol.js` → `./protocol`, `./types.js` → `./types` (strip `.js` extensions).

### Step 2: Move backend into nextjs/lib

**Files**: 44 source files, 38 test files from `backend/src/`
**Delegation**: inline

`git mv backend/src/* nextjs/lib/` preserving the existing directory structure. Backend subdirectories (streaming/, extraction/, spaced-repetition/, search/, handlers/, skills/, prompts/, commands/) move as-is. Test directories (`__tests__/` at each level) move with their code.

Files that conflict with existing `nextjs/lib/` contents: none. `controller.ts` and `vault-helpers.ts` are unique to nextjs.

### Step 2.5: Verify test discovery

**Delegation**: inline

Before rewriting imports, confirm bun finds the moved test files:

```bash
cd nextjs && bun test --dry-run 2>&1 | grep -c "\.test\.ts"
```

Compare against the pre-move count. If tests aren't discovered (bun may not search `lib/` by default), add a `preload` or `testMatch` config to `nextjs/package.json` before proceeding. This must pass before Step 3.

### Step 3: Strip .js extensions from moved backend imports

**Files**: All files moved from backend (source + tests)
**Delegation**: inline (scripted)

Backend code was written as ESM TypeScript, using `.js` extensions in import specifiers (e.g., `from "./vault-manager.js"`). Next.js bundler moduleResolution resolves extensionless imports natively. Strip all `.js` import extensions from relative imports only:

```bash
# Strip .js from relative imports in moved backend files
find nextjs/lib -name "*.ts" -not -path "*/node_modules/*" \
  -exec sed -i 's/from "\(\.\.[^"]*\)\.js"/from "\1"/g' {} +
find nextjs/lib -name "*.ts" -not -path "*/node_modules/*" \
  -exec sed -i "s/from '\(\.\.[^']*\)\.js'/from '\1'/g" {} +
```

This handles both `./` and `../` relative imports. Does not touch `@memory-loop/*` imports (those are rewritten in Step 4).

### Step 4: Rewrite workspace imports to path aliases

**Files**: All files in `nextjs/` (source + tests, ~127 import statements)
**Delegation**: inline (scripted)

Two patterns to rewrite:

**`@memory-loop/shared` → `@/lib/schemas`** (78 statements across 75 files)

```bash
find nextjs -name "*.ts" -o -name "*.tsx" | xargs \
  sed -i 's|@memory-loop/shared|@/lib/schemas|g'
```

**`@memory-loop/backend/*` → `@/lib/*`** (49 statements across 36 files)

```bash
find nextjs -name "*.ts" -o -name "*.tsx" | xargs \
  sed -i 's|@memory-loop/backend/|@/lib/|g'
```

Examples of what this produces:
- `from "@memory-loop/backend/vault-manager"` → `from "@/lib/vault-manager"`
- `from "@memory-loop/backend/streaming"` → `from "@/lib/streaming"`
- `from "@memory-loop/backend/extraction/extraction-manager"` → `from "@/lib/extraction/extraction-manager"`

For files that were in backend (now in lib/) and imported `@memory-loop/shared`: same rewrite applies (the shared sed covers all files under `nextjs/`).

### Step 5: Merge dependencies and clean package.json files

**Files**: `nextjs/package.json`, `package.json` (root)
**Delegation**: inline

**Merge into nextjs/package.json:**
- Move backend `dependencies` into nextjs `dependencies` (claude-agent-sdk, cron, chokidar, expr-eval, fast-xml-parser, gray-matter, lodash-es, minisearch, picomatch, yaml)
- Move backend `devDependencies` into nextjs `devDependencies` (@types/cron, @types/expr-eval, @types/js-yaml, @types/lodash-es, @types/picomatch)
- Remove duplicate `js-yaml` (already in nextjs)
- Upgrade `zod` from `^3.24.4` to `^4.0.0` (match what schemas use)
- Remove `@memory-loop/shared: "workspace:*"` and `@memory-loop/backend: "workspace:*"`

**Simplify root package.json** (stays as a convenience wrapper so CI and scripts can run from repo root):
- Remove `"workspaces"` field entirely
- Update scripts to delegate to the single workspace:
  - `"test"` → `"bun run --cwd nextjs test"`
  - `"test:coverage"` → `"bun run --cwd nextjs test:coverage"`
  - `"typecheck"` → `"bun run --cwd nextjs typecheck"`
  - `"lint"` → `"bun run --cwd nextjs lint"`
- Remove `"dev:all"` script (was for multi-workspace parallel dev, no longer applies)

### Step 6: Clean next.config.ts

**Files**: `nextjs/next.config.ts`
**Delegation**: inline

Remove:
- `transpilePackages` (no workspace packages to transpile)
- `experimental.externalDir` (no external directories to resolve)
- `webpack.resolve.extensionAlias` (no `.js` → `.ts` mapping needed)

Keep:
- `serverExternalPackages: ["cron"]` (cron uses child_process, still can't bundle)
- `env.NEXT_PUBLIC_APP_VERSION` (git hash, unrelated)
- `eslint.ignoreDuringBuilds` (still run lint separately)

### Step 7: Clean tsconfig.json

**Files**: `nextjs/tsconfig.json`
**Delegation**: inline

Remove workspace path aliases:
- `"@memory-loop/shared": ["../shared/src/index.ts"]`
- `"@memory-loop/backend/*": ["../backend/src/*"]`

Keep existing `@/*` aliases (they now resolve everything, including `@/lib/schemas` and `@/lib/vault-manager`).

### Step 8: Update infrastructure

**Files**: `.github/workflows/ci.yml`, `git-hooks/pre-commit.sh`, `scripts/launch.sh`, `CLAUDE.md`, `.lore/lore-agents.md`
**Delegation**: inline

**CI workflow (`.github/workflows/ci.yml`):**
- Remove separate backend and shared test/coverage steps
- Single test run: `bun run --cwd nextjs test:coverage`
- Single coverage upload (remove separate backend/shared flags, or adjust Codecov config)

**Pre-commit hook (`git-hooks/pre-commit.sh`):**
- Remove Backend and Shared sections
- Single pass: typecheck, lint, test, build from nextjs directory
- Significantly simpler script

**Launch script (`scripts/launch.sh`):**
- No changes needed (already targets nextjs/ directory only)

**Systemd service (`memory-loop.service`):**
- Verify no changes needed (entry point unchanged, still runs `scripts/launch.sh`)
- The retro from the last migration flagged this as a common miss

**CLAUDE.md:**
- Update architecture section (single workspace, not three)
- Update commands section (single test/lint/typecheck)
- Remove workspace-specific instructions
- Update "Key Backend Modules" paths from `backend/src/` to `nextjs/lib/`

**Lore agents registry (`.lore/lore-agents.md`):**
- Update "Monorepo context" note (no longer three workspaces)

### Step 9: Delete workspace remnants

**Files**: `backend/`, `shared/`, `backend/package.json`, `backend/tsconfig.json`, `backend/eslint.config.js`, `shared/package.json`, `shared/tsconfig.json`, `shared/eslint.config.js`
**Delegation**: inline

Delete `backend/` and `shared/` directories entirely. All code has been moved. All config has been merged. Run `bun install` to regenerate the lockfile without workspace resolution.

### Step 10: Validate

**Delegation**: inline

Record baseline test count before starting (run `bun run --cwd backend test`, `bun run --cwd nextjs test`, `bun run --cwd shared test` and sum passing tests). Then verify sequentially:

1. `bun run --cwd nextjs typecheck` — all types resolve
2. `bun run --cwd nextjs lint` — no import errors
3. `bun run --cwd nextjs test` — all tests pass (count matches baseline)
4. `bun run --cwd nextjs build` — production build succeeds
5. Verify no remaining references:
   ```bash
   grep -r "@memory-loop/\(backend\|shared\)" \
     --include="*.ts" --include="*.tsx" --include="*.json" \
     --exclude-dir=node_modules --exclude-dir=.lore --exclude=bun.lock .
   ```
   Should return zero results (`.lore/` excluded because the plan itself references these paths).

### Step 11: Validate against goal

**Delegation**: fresh-context sub-agent (required)

Launch a sub-agent that reads the Goal section above, reviews the implementation, and confirms:
- No workspace indirection remains
- `transpilePackages` and extension alias hacks are gone
- All imports use `@/` paths
- Tests pass with same count as before
- No `backend/` or `shared/` directories exist
- Deployment artifacts (CI, pre-commit, launch script) are updated

## Delegation Guide

**Steps safe to run inline (all of them except validation):**
Steps 1-9 are mechanical file moves, scripted import rewrites, and config edits. No ambiguity, no design decisions. The context stays clean because each step is straightforward.

**Steps requiring fresh-context sub-agent:**
- Step 11: Post-implementation validation. By this point, context will be saturated with 127+ import rewrites. A fresh reader catches what the implementer misses.

## Risks

**Zod 4 upgrade:** Upgrading nextjs from zod 3 to zod 4 could break frontend code that uses zod APIs differently between versions. Mitigation: zod 4 is largely backwards-compatible for schema definition; test suite will catch breakage.

**Dynamic imports in instrumentation.ts:** Path changes from `@memory-loop/backend/...` to `@/lib/...`. If path aliases don't resolve in dynamic `import()` calls, fall back to relative paths. Verify by running the production build.

**Test discovery:** Backend tests moved to `nextjs/lib/__tests__/` must be found by `bun test` from the nextjs directory. Verify bun's test discovery pattern includes `lib/` subdirectories.

## Open Questions

None that block starting. The brainstorm's three open questions are resolved:
- **lib/ vs server/**: `lib/` (already has server-side code, conventional for Next.js catch-all)
- **Schema placement**: `lib/schemas/` (shared between API routes and frontend)
- **Incremental vs all-at-once**: All at once (mechanical rename, no behavior change)
