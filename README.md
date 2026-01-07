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

### Per-Vault Configuration

Create a `.memory-loop.json` file at the vault root to customize paths:

```json
{
  "contentRoot": "content",
  "inboxPath": "journal",
  "metadataPath": "meta/memory-loop"
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `contentRoot` | Subdirectory containing vault content (useful for Quartz sites) | `""` (vault root) |
| `inboxPath` | Directory for daily notes, relative to contentRoot | Auto-detected or `00_Inbox` |
| `metadataPath` | Directory for inspiration sources, relative to contentRoot | `06_Metadata/memory-loop` |

All paths are relative to the vault root. Path traversal outside the vault is rejected for security.

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

## HTTPS/TLS Setup

For secure access (required for some mobile browsers and recommended for remote access), configure TLS certificates.

### Environment Variables

```bash
# Both required to enable HTTPS
TLS_CERT=/path/to/certificate.pem
TLS_KEY=/path/to/private-key.pem

# Optional: passphrase for encrypted private keys
TLS_PASSPHRASE=your-passphrase
```

### Option 1: Self-Signed Certificate (Local Network)

For local network access where you control all devices:

```bash
# Generate a self-signed certificate (valid 365 days)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/CN=memory-loop" \
  -addext "subjectAltName=DNS:localhost,IP:YOUR_LOCAL_IP"

# Set environment variables
export TLS_CERT=/path/to/cert.pem
export TLS_KEY=/path/to/key.pem
```

You'll need to accept the browser security warning on first visit, or add the certificate to your device's trusted store.

### Option 2: Let's Encrypt (Public Domain)

For a publicly accessible domain with automatic certificate renewal:

```bash
# Install certbot
sudo apt install certbot  # Debian/Ubuntu

# Get a certificate (standalone mode)
sudo certbot certonly --standalone -d yourdomain.com

# Certificates are stored in /etc/letsencrypt/live/yourdomain.com/
export TLS_CERT=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
export TLS_KEY=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

Note: Let's Encrypt certificates need renewal every 90 days. Set up a cron job or systemd timer for `certbot renew`.

### Option 3: mkcert (Development)

For development with locally-trusted certificates:

```bash
# Install mkcert (https://github.com/FiloSottile/mkcert)
# macOS: brew install mkcert
# Linux: see mkcert GitHub for installation

# Create and install local CA
mkcert -install

# Generate certificate for your domains
mkcert localhost 192.168.1.100 memory-loop.local

# Use the generated files
export TLS_CERT=./localhost+2.pem
export TLS_KEY=./localhost+2-key.pem
```

mkcert certificates are trusted by browsers on machines where you ran `mkcert -install`.

### Verifying HTTPS

After starting the server with TLS configured, you should see:

```
Memory Loop Backend running at https://localhost:3000
WebSocket available at wss://localhost:3000/ws
TLS enabled - connections are encrypted
```

## Running as a Service (systemd)

To run Memory Loop automatically on boot (Linux with systemd):

```bash
# Copy the example service file
mkdir -p ~/.config/systemd/user
cp scripts/memory-loop.service.example ~/.config/systemd/user/memory-loop.service

# Edit the service file with your paths
# - Set WorkingDirectory to your memory-loop location
# - Set VAULTS_DIR to your vaults directory
# - Uncomment PATH line if bun isn't in /usr/bin
nano ~/.config/systemd/user/memory-loop.service

# Enable and start the service
systemctl --user daemon-reload
systemctl --user enable --now memory-loop

# Start at boot without requiring login
loginctl enable-linger $USER
```

Useful commands:

```bash
systemctl --user status memory-loop   # Check status
systemctl --user restart memory-loop  # Restart
journalctl --user -u memory-loop -f   # View logs
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
