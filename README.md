# Memory Loop

A mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. Capture thoughts, have AI-powered conversations, and browse your notes—from any device.

## Features

**Four integrated modes:**

- **Home** — Dashboard showing your goals, AI-generated inspiration, and recent activity
- **Note** — Quick capture that appends to daily notes with timestamps
- **Chat** — AI conversations powered by Claude, with full vault access
- **View** — Browse and read your vault's markdown files

**Designed for mobile:**

- Touch-friendly UI with 44px+ tap targets
- Works on any screen size (320px and up)
- Draft persistence across sessions
- Responsive navigation bar

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- One or more Obsidian vaults (or directories with `CLAUDE.md`)
- Claude Code CLI configured (for AI features via OAuth)

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd memory-loop
bun install

# Configure
cp .env.example .env
# Edit .env with your VAULTS_DIR path

# Run
bun run dev
```

Open http://localhost:5173 in your browser.

## Configuration

### Environment Variables

```bash
# Required: Directory containing your vaults
VAULTS_DIR=/path/to/vaults

# Optional
PORT=3000              # Backend port (default: 3000)
HOST=0.0.0.0           # Bind address (default: 0.0.0.0)
MOCK_SDK=true          # Test without API calls
```

### Vault Requirements

Each vault needs a `CLAUDE.md` file at its root:

```
/path/to/vaults/
├── my-vault/
│   ├── CLAUDE.md              # Required
│   ├── 00_Inbox/              # Where daily notes go
│   └── ...
└── another-vault/
    └── CLAUDE.md
```

Optional vault structure for full feature support:
- `00_Inbox/` — Daily notes location (configurable)
- Goals section in `CLAUDE.md` — Displayed on Home dashboard
- `06_Metadata/memory-loop/` — Inspiration prompt sources

## Usage

### Select a Vault

On first load, choose which vault to work with. Only vaults with `CLAUDE.md` appear.

### Home Dashboard

After selecting a vault, you land on Home:
- **Goals** — Extracted from your `CLAUDE.md`
- **Inspiration** — AI-generated prompts and curated quotes
- **Recent Activity** — Quick access to recent captures and discussions

Tap any item in Recent Activity to jump directly to it.

### Note Capture

Quick capture for fleeting thoughts:
- Type and tap Capture (or press Enter)
- Notes append to `YYYY-MM-DD.md` with `HH:MM` timestamps
- Draft persists if you navigate away

### Chat

AI-powered discussions about your vault:
- Claude can read, search, and reference your files
- Tool usage displayed inline (expandable)
- Sessions persist and can be resumed
- Tap "New" for a fresh session

### View

Browse your vault's file structure:
- Navigate folders, read markdown files
- Wiki-links work (click to navigate)
- Syntax highlighting for code blocks

## Commands

```bash
bun run dev        # Start dev servers (backend + frontend)
bun run build      # Build for production
bun run test       # Run tests (339 tests)
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

## Architecture

```
memory-loop/
├── backend/        # Hono server + Claude Agent SDK
├── frontend/       # React 19 + Vite
└── shared/         # Zod schemas for WebSocket protocol
```

Communication happens over WebSocket with typed message schemas.

## License

MIT
