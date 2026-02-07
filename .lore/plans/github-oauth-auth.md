# Add GitHub OAuth Authentication (Single-User Door Lock)

## Context

Memory Loop runs as a systemd service accessible over the network. Currently all routes are public. This adds a "door lock": GitHub OAuth via Auth.js v5 that only allows sign-in if the GitHub username matches an env var allowlist. No database, no multi-user, no per-user vault isolation. Just a gate.

## Approach

Auth.js v5 (`next-auth@beta`) with GitHub provider. Middleware-based route protection means zero changes to existing API route handlers. Cookie-based JWT sessions, no database adapter needed.

## New Dependencies

```bash
bun add --cwd nextjs next-auth@beta
```

## New Environment Variables

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Signs/encrypts session cookies (generate with `bunx auth secret`) |
| `AUTH_GITHUB_ID` | GitHub OAuth App Client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App Client Secret |
| `AUTH_ALLOWED_USERS` | Comma-separated GitHub usernames |
| `AUTH_URL` | Base URL for OAuth callbacks (e.g. `http://192.168.1.50:3000`) |
| `AUTH_TRUST_HOST` | `true` (required for non-localhost deployments) |

## Files to Create

### 1. `nextjs/auth.ts` — Auth.js config

- GitHub provider (auto-detects `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`)
- `signIn` callback: check `profile.login` against `AUTH_ALLOWED_USERS`, fail closed if empty
- `jwt` callback: attach GitHub username to token
- `session` callback: expose username on session object
- Export `parseAllowedUsers()` and `isUserAllowed()` as named functions for testability
- Cookie-based JWT strategy (no database)

### 2. `nextjs/app/api/auth/[...nextauth]/route.ts` — Route handler

Two-line file re-exporting `GET` and `POST` from `auth.ts` handlers.

### 3. `nextjs/middleware.ts` — Route protection

- Public routes (no auth): `/api/health`, `/api/auth/*`
- Unauthenticated API requests (`/api/*`): return 401 JSON matching existing `{ error: { code, message } }` format
- Unauthenticated page requests: redirect to Auth.js sign-in page
- Matcher excludes `_next/static`, `_next/image`, `images/`, `favicon.ico`
- Extract routing decision into a pure `getAuthAction()` function for testability

### 4. `nextjs/components/AuthProvider.tsx` — Client wrapper

"use client" component wrapping `next-auth/react`'s `SessionProvider`. Isolates it from Memory Loop's existing `SessionProvider` (contexts/SessionContext.tsx) which manages app state.

### 5. `nextjs/lib/__tests__/auth.test.ts` — Unit tests

- `parseAllowedUsers()`: comma parsing, trim, lowercase, empty string, undefined
- `isUserAllowed()`: allowed user, denied user, empty allowlist (fail closed), case insensitivity, null/undefined login
- `getAuthAction()`: health endpoint public, auth endpoints public, API 401 vs page redirect, authenticated passthrough

## Files to Modify

### 6. `nextjs/app/layout.tsx` — Add AuthProvider

Wrap `{children}` with `<AuthProvider>`. One import, one element.

### 7. `.env.example` — Document new variables

Add auth section with commented-out variables.

### 8. `CLAUDE.md` — Document auth architecture

Add Authentication section covering Auth.js v5, middleware protection, and env vars.

## What Does NOT Change

- All 40+ existing API route handlers (middleware handles auth before they run)
- `contexts/SessionContext.tsx` (app state, not user auth)
- `components/App.tsx` and the rest of the UI
- `hooks/useChat.ts` (SSE streams work, cookies travel with the request)
- `lib/api/client.ts` (already handles non-2xx as `ApiError`)
- `instrumentation.ts` (schedulers run server-side, not through HTTP)
- `next.config.ts` (no config changes needed)

## Deployment (LAN with Static IP)

1. Create a GitHub OAuth App (Settings > Developer settings > OAuth Apps)
   - Homepage URL: `http://192.168.x.x:3000`
   - Callback URL: `http://192.168.x.x:3000/api/auth/callback/github`
   - GitHub OAuth Apps (not GitHub Apps) allow `http://` callback URLs
2. Add env vars to systemd service environment:
   - `AUTH_URL=http://192.168.x.x:3000` (tells Auth.js its own base URL)
   - `AUTH_TRUST_HOST=true`
   - `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWED_USERS`
3. Build and restart
4. The OAuth flow works on LAN because redirects happen in the browser (phone can reach the LAN IP). Only the token exchange is server-to-server (server needs internet to call GitHub API).

## Verification

- `bun run --cwd nextjs build` succeeds
- `bun run --cwd nextjs dev` works (turbopack compatibility)
- `bun run test` passes (new + existing tests)
- `curl /api/health` returns 200 without auth
- `curl /api/vaults` returns 401 JSON without auth
- Browser: redirected to GitHub sign-in, then back to app after auth
- Unauthorized GitHub user: Auth.js error page after OAuth
