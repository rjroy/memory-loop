# Memory Loop

<img src="docs/logo.webp" alt="Memory Loop logo" width="150" align="right">

![Version](https://img.shields.io/badge/version-1.3.21-blue.svg)
[![codecov](https://codecov.io/gh/rjroy/memory-loop/graph/badge.svg?token=qD1xMP4hrR)](https://codecov.io/gh/rjroy/memory-loop)
![License](https://img.shields.io/badge/license-MIT-green.svg)
<br>
![Claude](https://img.shields.io/badge/Powered_by-Claude-cc785c?logo=anthropic&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.3-fbf0df?logo=bun&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)

A mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. Capture thoughts, have AI-powered conversations, and browse your notes from any device.

## Features

The app is organized around four modes (the GCTR framework), each named for what you *do*:

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/ground.webp" width="180"><br><b>🪨 Ground</b></td>
    <td align="center"><img src="docs/screenshots/capture.webp" width="180"><br><b>🪶 Capture</b></td>
    <td align="center"><img src="docs/screenshots/think.webp" width="180"><br><b>✨ Think</b></td>
    <td align="center"><img src="docs/screenshots/recall.webp" width="180"><br><b>🪞 Recall</b></td>
  </tr>
</table>

- **Ground** — Orient yourself. Dashboard with goals, AI-generated inspiration, and spaced repetition review
- **Capture** — Record thoughts before they vanish. Quick notes append to daily files with timestamps
- **Think** — Process ideas with AI as thinking partner. Conversations with full vault access and image upload
- **Recall** — Find and review what you've stored. Browse files, manage tasks, search, pair-write with AI

**Designed for mobile:**

- Touch-friendly UI with 44px+ tap targets
- Works on any screen size (320px and up)
- Draft persistence across sessions

**Security:** Path traversal protection, symlink blocking, and SDK permission controls keep operations within your vault. AI sessions have a 50-turn limit and $2 USD spending cap.

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) v1.1+, one or more Obsidian vaults (or directories with `CLAUDE.md`), Claude Code CLI configured (for AI features via OAuth)

```bash
git clone <repo-url>
cd memory-loop
bun install

cp .env.example .env
# Optionally edit .env to set VAULTS_DIR (defaults to ./vaults)

bun run dev
```

Open <http://localhost:5173> in your browser.

## Configuration

### Environment Variables

```bash
VAULTS_DIR=/path/to/vaults  # Optional: defaults to ./vaults at project root
PORT=3000                   # Backend port (default: 3000)
HOST=0.0.0.0                # Bind address (default: 0.0.0.0)
MOCK_SDK=true               # Test without API calls
```

### Vault Requirements

Each vault needs a `CLAUDE.md` file at its root. Optional structure for full feature support:

- `00_Inbox/` — Daily notes location (configurable)
- Goals section in `CLAUDE.md` — Displayed on Ground dashboard
- `06_Metadata/memory-loop/` — Inspiration prompt sources

### Per-Vault Configuration

Create a `.memory-loop.json` file at the vault root to customize paths:

```json
{
  "contentRoot": "content",
  "inboxPath": "journal",
  "metadataPath": "meta/memory-loop"
}
```

| Option         | Description                                                     | Default                     |
| -------------- | --------------------------------------------------------------- | --------------------------- |
| `contentRoot`  | Subdirectory containing vault content (useful for Quartz sites) | `""` (vault root)           |
| `inboxPath`    | Directory for daily notes, relative to contentRoot              | Auto-detected or `00_Inbox` |
| `metadataPath` | Directory for inspiration sources, relative to contentRoot      | `06_Metadata/memory-loop`   |

All paths are relative to the vault root. Path traversal outside the vault is rejected for security.

## Commands

```bash
bun run dev        # Start dev servers (backend + frontend)
bun run build      # Build for production
bun run test       # Run tests
bun run typecheck  # TypeScript checking
bun run lint       # ESLint
```

### Production

```bash
bun run build
./scripts/launch.sh
```

The backend runs from TypeScript source (not bundled) because Claude Agent SDK requires it.

## Network Access

Access from other devices on your network:

```bash
# Find your local IP
hostname -I | awk '{print $1}'

# Access from phone/tablet
http://YOUR_IP:5173
```

## Documentation

- [System Overview](.lore/reference/_overview.md) — Architecture, design decisions, and feature reference
- [Usage Guide](docs/usage/README.md) — How to use each tab (Ground, Capture, Think, Recall)

### Deployment

- [HTTPS/TLS Setup](docs/deployment/https-setup.md) — Certificate configuration for secure access
- [systemd Service](docs/deployment/systemd.md) — Run Memory Loop automatically on boot

## Architecture

```
memory-loop/
├── backend/        # Hono server + Claude Agent SDK
├── frontend/       # React 19 + Vite
└── shared/         # Zod schemas for type-safe messages
```

Two communication channels: REST API for stateless operations (file CRUD, search, config) and WebSocket for streaming (AI responses, tool execution, session state). Both use Zod-validated message schemas.

## License

MIT
