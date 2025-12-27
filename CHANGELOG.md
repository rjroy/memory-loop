# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-26

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. This initial release provides a complete personal knowledge management companion that understands your vault's context.

### Highlights

- **AI-Powered Conversations** — Chat with Claude using your vault as context. Claude can read, search, and navigate your notes to provide relevant responses.
- **Quick Note Capture** — Capture fleeting thoughts with timestamps appended to daily notes. Drafts persist across sessions.
- **File Browser** — Navigate your vault with a tree-based explorer supporting wiki-links and markdown rendering.
- **Home Dashboard** — See your goals, daily inspiration, and recent activity in one place.

### Added

#### Four Integrated Modes

**Home Dashboard**
- Goals parsed from `goals.md` organized by sections
- Context-aware inspiration prompts (AI-generated on weekdays) with rotating quotes
- Recent activity timeline showing captures and discussions
- One-click session resumption

**Quick Note Capture**
- Multiline input for fleeting thoughts
- Automatic draft persistence in browser storage
- Appends to daily notes with ISO 8601 timestamps
- Retry mechanism with toast notifications

**AI Discussion**
- Real-time streaming responses from Claude
- Full vault access via read tools (Read, Glob, Grep, WebSearch, WebFetch)
- Complete message history with resumable sessions
- Tool invocation display with expandable input/output
- Cost controls: 50-turn limit, $2 USD spending cap

**File Browser**
- Tree-based navigation with lazy-loaded directories
- GitHub Flavored Markdown rendering
- Wiki-link support (`[[note-name]]`) with clickable navigation
- Pinned folders for quick access
- Breadcrumb navigation

#### Technical Stack

- **Frontend:** React 19 + Vite SPA
- **Backend:** Hono server + Claude Agent SDK
- **Protocol:** WebSocket with Zod-validated message schemas
- **Runtime:** Bun

#### Security

- Path traversal protection on all file operations
- Symlink blocking to prevent vault escapes
- SDK permission controls with auto-allowed read tools
- File edit acceptance restricted to user's vault
- Image serving restricted to safe file types

#### Mobile-First Design

- Touch-friendly UI with 44px+ tap targets
- Responsive layout supporting 320px+ screen widths
- Overlay mode for file tree on mobile
- Draft persistence across sessions

### Configuration

**Required:**
```bash
VAULTS_DIR=/path/to/vaults  # Directory containing Obsidian vaults
```

**Optional:**
```bash
PORT=3000         # Backend port (default: 3000)
HOST=0.0.0.0      # Bind address (default: 0.0.0.0)
MOCK_SDK=true     # Test mode without API calls
```

**Vault Structure:**
- `CLAUDE.md` at vault root (required for discovery)
- `00_Inbox/` — Daily note destination (optional)
- `06_Metadata/memory-loop/goals.md` — Goals display (optional)
- `06_Metadata/memory-loop/contextual-prompts.md` — AI prompts (optional)
- `06_Metadata/memory-loop/general-inspiration.md` — Quote rotation (optional)

### Quality

- 250+ passing tests across backend and frontend
- TypeScript strict mode throughout
- ESLint + Prettier for code consistency
- Type-safe protocol validation with Zod
