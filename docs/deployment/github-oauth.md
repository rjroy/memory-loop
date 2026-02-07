# GitHub OAuth Setup

Memory Loop uses GitHub OAuth via Auth.js v5 to restrict access. Only GitHub usernames listed in `AUTH_ALLOWED_USERS` can sign in.

## Create GitHub OAuth Apps

You need two OAuth Apps: one for local development, one for production. Each takes about 30 seconds.

Go to **GitHub > Settings > Developer settings > OAuth Apps > New OAuth App**.

### Development App

| Field | Value |
|-------|-------|
| Application name | Memory Loop (dev) |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

### Production App

| Field | Value |
|-------|-------|
| Application name | Memory Loop |
| Homepage URL | `http://192.168.x.x:3000` |
| Authorization callback URL | `http://192.168.x.x:3000/api/auth/callback/github` |

Use **OAuth Apps**, not GitHub Apps. OAuth Apps allow `http://` callback URLs, which is necessary for LAN deployments without TLS.

## Generate AUTH_SECRET

```bash
openssl rand -base64 33
```

Use the same secret for both dev and production, or generate separate ones.

## Environment Variables

### Local Development (.env.local)

```bash
AUTH_SECRET=<your-secret>
AUTH_GITHUB_ID=<dev-app-client-id>
AUTH_GITHUB_SECRET=<dev-app-client-secret>
AUTH_ALLOWED_USERS=your-github-username
```

`AUTH_URL` and `AUTH_TRUST_HOST` are not needed for localhost.

### Production (systemd environment)

Add to your `memory-loop.service` environment:

```bash
AUTH_SECRET=<your-secret>
AUTH_GITHUB_ID=<prod-app-client-id>
AUTH_GITHUB_SECRET=<prod-app-client-secret>
AUTH_ALLOWED_USERS=your-github-username
AUTH_URL=http://192.168.x.x:3000
AUTH_TRUST_HOST=true
```

`AUTH_URL` tells Auth.js its own base URL (required for non-localhost). `AUTH_TRUST_HOST` is required because the server isn't behind a verified proxy.

## How It Works

The OAuth flow works on LAN because redirects happen in the browser (your phone can reach the LAN IP). Only the token exchange is server-to-server (the server needs internet access to call GitHub's API).

1. User visits Memory Loop, middleware redirects to GitHub sign-in
2. User authenticates with GitHub, GitHub redirects back to the callback URL
3. Auth.js exchanges the code for a token (server-to-server, needs internet)
4. Auth.js checks the GitHub username against `AUTH_ALLOWED_USERS`
5. If allowed, sets a session cookie. If not, shows an error page.

## Verifying

```bash
# Should return 200 without auth
curl http://localhost:3000/api/health

# Should return 401 JSON without auth
curl http://localhost:3000/api/vaults
```

In a browser, navigating to the app should redirect to GitHub sign-in.
