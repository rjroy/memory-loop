# Plan: Clean Up Next.js Migration

The Hono-to-Next.js and WebSocket-to-SSE migration is functionally complete. What remains is configuration debt and dead code that's blocking the pre-commit hook and hiding real issues. This plan works from the outside in: fix the tooling first (so we can see what's actually broken), then remove dead code, then fix functional issues exposed along the way.

## Phase 1: Fix ESLint + TypeScript Config (unblock pre-commit)

The ~15,000 lint errors are almost entirely configuration problems, not code bugs. Fix these first so the pre-commit hook becomes useful again.

### 1a. Create `nextjs/eslint.config.mjs`

No ESLint config exists in the nextjs workspace. ESLint falls back to the root config, which doesn't ignore `.next/` build output. Create a proper config that:
- Extends root config
- Ignores `.next/` directory
- Ignores `**/__tests__/**` from type-checked rules (test files can't resolve `bun:test` through projectService)

**File:** `nextjs/eslint.config.mjs` (new)

### 1b. Fix `nextjs/tsconfig.json` for test files

The `bun:test` module can't be resolved because `nextjs/tsconfig.json` doesn't include `bun-types`. Two fixes:
- Add `"types": ["bun-types"]` to compilerOptions (the package is already in devDependencies)
- Exclude `**/__tests__/**` from the main tsconfig include (tests don't need to be part of the typecheck that Next.js runs)

**File:** `nextjs/tsconfig.json` (edit)

### 1c. Fix the one real backend lint error

`backend/src/streaming/session-streamer.ts:121` has an unnecessary type assertion flagged by eslint. Remove the `as SDKAssistantMessage` cast.

**File:** `backend/src/streaming/session-streamer.ts` (edit)

### 1d. Update `nextjs/package.json` lint script

The current lint script uses `--ext .ts,.tsx` which is the old eslint format. With flat config, this flag doesn't apply. Update to just `eslint .`.

**File:** `nextjs/package.json` (edit)

### Verification

Run `./git-hooks/pre-commit.sh` and confirm backend + nextjs pass typecheck and lint. Expect some remaining real errors in test files (props mismatches, missing test-helpers), which we'll handle separately.

---

## Phase 2: Remove Dead Code

### 2a. Remove Hono REST routes from `backend/src/server.ts`

All REST routes (lines ~246-463) have been replicated in Next.js API routes. Strip them. Keep only:
- The WebSocket `/ws` upgrade handler (still referenced by `backend/src/index.ts`)
- Static config (port, host, TLS) since it's used by `index.ts`
- The health collector if still needed

This is a big file reduction. The WebSocket handler itself stays for now (it's dead code from the Next.js perspective, but removing it is a separate concern from removing the duplicated REST routes).

**File:** `backend/src/server.ts` (edit)

### 2b. Move schedulers to Next.js instrumentation

The backend `index.ts` starts two schedulers (extraction at 3am, card discovery at 4am). These won't run when Next.js is the only process. Move them:

1. Create `nextjs/instrumentation.ts` with a `register()` export. Next.js calls this once on server startup. Port the scheduler init logic from `backend/src/index.ts` (lines 56-89).
2. Enable instrumentation in `next.config.ts` if needed (Next.js 15 may have it on by default).
3. SDK initialization is already handled lazily in `nextjs/lib/controller.ts`, so no conflict.

**Files:** `nextjs/instrumentation.ts` (new), `nextjs/next.config.ts` (edit if needed)

### 2c. Update `scripts/launch.sh`

With schedulers in Next.js, launch.sh becomes simple:
1. Build Next.js: `bun run --cwd nextjs build`
2. Start Next.js: `exec bun run --cwd nextjs start`

The backend Hono server is no longer needed in production.

**File:** `scripts/launch.sh` (edit)

### 2d. Update systemd service if referenced

Check if `memory-loop.service` needs updating to start Next.js instead of the backend.

### 2e. Clean up stale WebSocket comments

Remove misleading "still uses WebSocket" comments from:
- `nextjs/app/api/vaults/[vaultId]/health-issues/[issueId]/route.ts`
- `nextjs/app/api/vaults/[vaultId]/sessions/route.ts`

**Files:** 2 route files (edit)

---

## Phase 3: Fix Remaining Functional Issues

After Phase 1-2, run the pre-commit hook again. Whatever real errors remain (test prop mismatches, missing imports) get fixed here. These will be visible once the config noise is cleared.

### 3a. Fix test files with broken imports

- Missing `test-helpers` module referenced by `FileAttachButton.test.tsx`
- Bad path `../@/lib/api/types` in `useCapture.test.ts`
- Props mismatches in tests where components were refactored but tests weren't updated

These get fixed based on what the linter and typecheck actually report after Phase 1.

### 3b. Remove debug console.log statements

Multiple hooks have debug logging (`[useHome]`, `[useCapture]`, `[Session]`). Remove or gate behind a debug flag.

### 3c. Update CLAUDE.md

The project CLAUDE.md still describes three workspaces (backend/frontend/shared) and WebSocket protocol. Update to reflect the actual architecture: backend (library), nextjs (app), shared (types).

---

## Verification

1. `./git-hooks/pre-commit.sh` passes (typecheck, lint, build for all workspaces)
2. `bun run --cwd nextjs dev` starts without errors
3. Discussion mode loads and can send a message (SSE stream works)
4. No WebSocket connection attempts visible in browser devtools
