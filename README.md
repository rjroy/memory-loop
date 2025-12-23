# Memory Loop

A mobile-friendly web interface for interacting with your Obsidian vaults via Claude AI. Capture thoughts quickly or have deep discussions about your notes—from any device on your local network.

## What is it?

Memory Loop is a lightweight web application that connects your Obsidian vaults (or any directory with a `CLAUDE.md` configuration) to Claude AI. It provides two interaction modes:

- **Note Mode**: Quick capture of thoughts that get appended to your daily note
- **Discussion Mode**: Full conversational AI with access to read, search, and modify your vault

The app runs on your local network and works great on phones, tablets, and desktops.

## Why use it?

- **Mobile access to Claude Code capabilities** without needing a terminal
- **Quick thought capture** that automatically goes to the right place in your vault
- **Full AI-powered discussions** about your notes, with tool transparency
- **Session persistence** - pick up where you left off, even after switching devices
- **Vault-aware** - respects your `CLAUDE.md` instructions and `.claude/` configurations

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- One or more directories with `CLAUDE.md` files (e.g., Obsidian vaults)

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required: Path to directory containing your vaults
VAULTS_DIR=/path/to/your/vaults

# Optional: Server port (default: 3000)
PORT=3000
```

### Vault Structure

Each vault should be a subdirectory of `VAULTS_DIR` containing a `CLAUDE.md` file:

```
/path/to/your/vaults/
├── personal-notes/
│   ├── CLAUDE.md          # Required - vault instructions for Claude
│   ├── .claude/           # Optional - commands, skills, settings
│   └── ...your notes...
├── work-vault/
│   ├── CLAUDE.md
│   └── ...
```

The `CLAUDE.md` file tells Claude how to interact with your vault. Memory Loop will respect these instructions.

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd memory-loop

# Install dependencies
bun install

# Set up environment
cp .env.example .env  # Then edit with your values
```

## Running

### Development

```bash
bun run dev
```

This starts both the backend (port 3000) and frontend (port 5173) with hot reload.

Open http://localhost:5173 in your browser.

### Development with Mock AI

To test without using API credits:

```bash
MOCK_SDK=true bun run dev
```

### Production

```bash
# Type-check and build frontend
bun run build

# Start server (runs backend from source, serves built frontend)
./scripts/launch.sh
```

**Note:** The backend runs directly from TypeScript source (not bundled). This is required because the Claude Agent SDK resolves paths relative to the running script location.

### Other Commands

```bash
bun run test       # Run all tests (339 tests)
bun run typecheck  # TypeScript type checking
bun run lint       # ESLint
```

## Usage

### 1. Select a Vault

On load, you'll see a list of available vaults (directories with `CLAUDE.md` in your `VAULTS_DIR`). Tap one to connect.

### 2. Note Mode (Default)

- Type your thought in the text area
- Tap "Capture" to append it to today's daily note
- Notes go to `YYYY-MM-DD.md` under the `## Capture` section
- The daily note is created automatically if it doesn't exist

### 3. Discussion Mode

- Tap "Discussion" to switch modes
- Have a full conversation with Claude about your vault
- Claude can read, search, and modify files
- Tool usage is shown transparently (expand to see details)
- Use slash commands from your vault's `.claude/commands/` directory

### 4. Session Management

- Your session persists across page refreshes
- Tap "New Session" to start fresh
- Sessions are stored in `.memory-loop/` in your vault

## Architecture

```
memory-loop/
├── backend/          # Hono server + Claude Agent SDK
│   └── src/
│       ├── index.ts              # Server entry point
│       ├── websocket-handler.ts  # WebSocket message handling
│       ├── vault-manager.ts      # Vault discovery and validation
│       ├── session-manager.ts    # Session persistence
│       └── note-capture.ts       # Daily note operations
├── frontend/         # React + Vite
│   └── src/
│       ├── App.tsx               # Main app shell
│       ├── components/           # UI components
│       ├── context/              # Session state management
│       └── hooks/                # WebSocket hook
└── shared/           # Shared types and protocol
    └── src/
        └── protocol.ts           # Zod schemas for messages
```

## Network Access

To access from other devices on your network, find your machine's local IP:

```bash
# Linux/macOS
ip addr | grep "inet " | grep -v 127.0.0.1

# Then access from phone/tablet
http://YOUR_IP:5173
```

## License

MIT
