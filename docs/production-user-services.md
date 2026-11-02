---
title: Production user-service setup
date: 2026-11-02
status: draft
tags: [deployment, systemd, configuration]
---

# Production user-service setup

## Purpose and boundaries

Run the current Memory Loop architecture as two systemd **user** services: a
Bun/Hono daemon and a Next.js web server. Production lives at
`~/Applications/memory-loop`, separate from the development checkout.

This is an operator/agent handoff note, not authorization to install, stop, or
modify services. Follow active agent restrictions. In particular, agents in this
project must not edit `~/Applications/`; provide production changes for the
operator to apply. Do not use sudo or change proxy, Tailscale, or OpenCode service
configuration as part of this setup.

`bun run restart` and `scripts/restart.ts` are checkout-testing conveniences.
Production services must not invoke them. Production lifecycle belongs to
systemd; production builds are an explicit deployment step.

## Evidence and preflight

These instructions were derived from the restart checkout on 2026-11-02. The
existing `~/.config/systemd/user/memory-loop.service` used an older single-service
arrangement, web port 5000, a startup build, and legacy `MEMORY_LOOP_CONFIG` and
`VAULTS_DIR` variables. Those variables do not select configuration in the current
loader. Production application files and configuration were not inspected.

Before applying anything:

- Confirm production contains the current daemon/Next architecture, including the
  OpenCode minimum-version fix. Do not apply these commands to a legacy release.
- Inspect existing user units and preserve unrelated deployment settings. Back up
  unit files and private configuration without exposing credentials.
- Confirm the intended vault, OpenCode registration path, and available ports.
  Examples use web port 5000 and daemon port 5001; neither is mandatory. Development
  currently uses port 3001, so sharing that daemon port would conflict.
- Confirm `/usr/bin/bun` and `/usr/bin/node` exist and meet the installed release's
  requirements. The web wrapper launches `node` through PATH. User services do not
  inherit an interactive shell's version-manager setup.
- Keep the existing external routing solution unchanged. Loopback web binding in
  the example assumes a local reverse proxy; retain the listener your deployment
  actually needs rather than introducing a proxy requirement.

Relevant implementation: `backend/config.ts`, `backend/runtime.ts`,
`backend/runtime-options.ts`, `backend/setup-transport.ts`, `backend/transport.ts`,
and `src/web/start.ts`.

## Configuration and transport

With `--project-root /home/rjroy/Applications/memory-loop`, the daemon reads:

```text
/home/rjroy/Applications/memory-loop/.memory-loop/config.json
```

Preserve existing supported settings. This example includes Recall and Think:

```json
{
  "vaultDirectory": "/absolute/path/to/your/vault",
  "think": {
    "service": {
      "registrationFile": "/absolute/path/to/existing/opencode-registration.json",
      "requiredVersion": "2.2.2"
    },
    "location": { "kind": "vault" },
    "permissionMode": "full",
    "transcriptDirectory": "Conversations/Memory Loop"
  }
}
```

Replace placeholder paths. The vault must already exist. Use the actual working
OpenCode registration-file path, not a guessed filename. `requiredVersion` is a
minimum, not an exact match or upper bound; the current default is 2.2.2. The
selected OpenCode service must already be running. These units do not start or
restart it. Omitting Think configuration does not configure chat automatically.

Do not copy the development `.memory-loop` directory wholesale. Production needs
its own transport credentials, and development `restart.json` is not production
configuration. Preserve any existing production runtime data.

Operator commands after creating/editing production `config.json`:

```sh
cd ~/Applications/memory-loop
mkdir -p .memory-loop
chmod 700 .memory-loop
chmod 600 .memory-loop/config.json
```

Initialize transport **once**, only if it has not already been initialized:

```sh
/usr/bin/bun --no-env-file backend/setup-transport.ts --project-root "$PWD"
```

Setup creates `.memory-loop/transport.json` and `.memory-loop/service.token` with
mode 0600. The metadata directory must be owned by the service user with mode
0700. Setup refuses to overwrite existing files. Do not delete existing tokens to
make setup pass, print tokens, or commit this private directory.

Setup currently defaults to `http://127.0.0.1:3001` and has no port-selection flag.
For a different production daemon port, edit `transport.json` while retaining its
permissions, for example:

```json
{
  "daemonOrigin": "http://127.0.0.1:5001"
}
```

The daemon derives its port from this file. Both units below explicitly select
this same production file through `MEMORY_LOOP_TRANSPORT_FILE`. The token is
loaded privately from the same directory; do not place it in the units.

## User units

Save the daemon unit as `~/.config/systemd/user/memory-loop-daemon.service`:

```ini
[Unit]
Description=Memory Loop daemon

[Service]
Type=simple
WorkingDirectory=%h/Applications/memory-loop
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=MEMORY_LOOP_TRANSPORT_FILE=%h/Applications/memory-loop/.memory-loop/transport.json
ExecStart=/usr/bin/bun --no-env-file %h/Applications/memory-loop/backend/runtime.ts --project-root %h/Applications/memory-loop
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0077

[Install]
WantedBy=default.target
```

Replace the old web unit at `~/.config/systemd/user/memory-loop.service`, preserving
any intentional deployment-specific settings:

```ini
[Unit]
Description=Memory Loop web
Wants=memory-loop-daemon.service
After=memory-loop-daemon.service

[Service]
Type=simple
WorkingDirectory=%h/Applications/memory-loop
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=MEMORY_LOOP_TRANSPORT_FILE=%h/Applications/memory-loop/.memory-loop/transport.json
ExecStart=/usr/bin/bun --no-env-file %h/Applications/memory-loop/src/web/start.ts start --hostname 127.0.0.1 --port 5000
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0077

[Install]
WantedBy=default.target
```

`%h` is expanded by systemd to the user's home. `After=` orders process startup;
it is not an application-readiness check. `Wants=` brings up the daemon without
forcing the web process to stop whenever the daemon restarts. Requests can fail
temporarily while the daemon is recovering.

## Build and activate

Arrange an interruption before replacing code or rebuilding a running production
installation. Do not overwrite the `.next` build while its web process is serving.
The following commands are for the operator, after the production release,
configuration, and unit files have been prepared:

```sh
systemctl --user stop memory-loop.service
# Stop an existing daemon before replacing its running application files.
# On an initial install there may be no daemon unit yet.
# systemctl --user stop memory-loop-daemon.service

cd ~/Applications/memory-loop
PATH=/usr/bin:$PATH /usr/bin/bun install --frozen-lockfile
PATH=/usr/bin:$PATH /usr/bin/bun run build
```

Stop on install/build failure; do not start a failed or partially prepared release.
After a successful build:

```sh
systemctl --user daemon-reload
systemctl --user enable memory-loop-daemon.service memory-loop.service
systemctl --user restart memory-loop-daemon.service
systemctl --user restart memory-loop.service
```

For later configuration changes, restart the daemon. For application releases,
build and restart the affected units through the deployment process. A normal
service start or reboot does not build the application.

## Verify and hand off

```sh
systemctl --user status memory-loop-daemon.service memory-loop.service
journalctl --user -u memory-loop-daemon.service -u memory-loop.service -n 100
```

Check that:

- Both units run from the production directory and use production transport.
- No listener conflicts with development or another deployment.
- The daemon loads the intended vault and reports Think setup ready when enabled,
  not a missing-config or registry-only fallback. Redact logs before sharing.
- The existing public route serves the intended production instance.
- Recall opens a known file; Capture and Think are tested deliberately by the user
  because they write vault content or can invoke a model. An HTTP 200 root page
  alone does not establish daemon or chat health.

For startup before login, user lingering must be enabled. Inspect
`loginctl show-user "$USER" -p Linger`; arrange any necessary account-policy change
with the operator. Do not assume enabling a user unit alone provides boot-time
startup when no user session exists.

Record the deployed commit, selected ports, unit names, and validation outcomes.
Do not report deployment complete based only on these templates or unit syntax.
