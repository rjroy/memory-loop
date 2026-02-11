# Remove Auth Layer from Memory Loop

## Context

Memory Loop runs on a private network behind a UniFi VPN. The GitHub OAuth auth layer (Auth.js v5) adds friction (callback URL configuration, GitHub dependency, env var management) with no security value. If someone is on the VPN, they're already trusted. Removing auth simplifies the app and eliminates the access issues caused by OAuth redirects and hostname mismatches.

## Plan

### Delete 5 files

| File | What it does |
|------|-------------|
| `nextjs/auth.ts` | Auth.js config, GitHub provider, allowlist |
| `nextjs/middleware.ts` | Route protection (auth only, no other logic) |
| `nextjs/app/api/auth/[...nextauth]/route.ts` | Auth.js route handler |
| `nextjs/components/AuthProvider.tsx` | next-auth SessionProvider wrapper |
| `nextjs/lib/__tests__/auth.test.ts` | Tests for auth functions |

### Modify 3 files

**`nextjs/app/layout.tsx`** - Remove AuthProvider import and wrapper, keep children directly in body.

**`nextjs/package.json`** - Remove `next-auth` dependency.

**`.env.example`** - Remove AUTH_* section (lines 12-19).

### Update documentation

**`CLAUDE.md`** - Remove the Authentication section, AUTH_* env vars from Environment section, and any references to auth middleware.

### Post-change

Run `bun install` to update lockfile after removing next-auth.

## Verification

1. `bun run --cwd nextjs build` succeeds
2. `bun run test` passes (auth tests deleted, no other tests reference auth)
3. `bun run typecheck` clean
4. `bun run lint` clean
5. `curl http://localhost:3000/` returns 200 (no redirect)
6. `curl http://localhost:3000/api/health` returns 200
