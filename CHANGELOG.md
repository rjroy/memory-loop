# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-01

### Added

- **Tool Permission Dialog** — Interactive `canUseTool` permission prompts for tool invocations (#128)
- **Delete Session** — Added delete button to Ground tab (#126)
- **Inline Tool Display** — Show tool invocations inline with messages (#109)
- **Task List** — Added Task List to Recall tab with sticky headers, sorting, and collapse (#104, #106, #111)
- **Session Controls** — Expanded permissions and turn limit configuration (#108)
- **Stop Button** — Abort AI response streaming mid-generation (#84)
- **Inline Editing** — Adjust mode in Recall tab for markdown editing (#88)
- **File Tree Reload** — Reload button for Recall tab file browser (#87)
- **Per-Vault Config** — Support `.memory-loop.json` configuration files (#81)
- **Expanded Chat Input** — Input expands on focus for longer messages (#73)
- **Task Checkbox Parsing** — Support task checkbox format in recent notes (#98)
- **Frontmatter Rendering** — Display markdown frontmatter as GitHub-style table (#97)
- **Glassmorphism** — Added blur effects to message bubbles and markdown viewer (#93)
- **Background Images** — Subtle background images on cards (#64)
- **Weekend Prompts** — Creative prompts for weekends (#63)
- **Decorative HR Images** — Horizontal rules use decorative images in Discussion (#132)

### Changed

- **Gradient Colors** — Changed primary-dim gradient to orange (#134)
- **Mode Toggle Sigils** — Added background sigils to mode toggle buttons (#133)
- **Message Bubbles** — Adjusted border thickness and added ornate borders (#130, #124)
- **New Session Button** — Floated over discussion content (#129)
- **Glass Opacity** — Reduced opacity to show more background (#94)
- **Mode Toggle Labels** — Action-oriented labels (#72)
- **Orange Quote Styling** — Added orange accent for quotes (#79)
- **WEBP Images** — Replaced PNG images with WEBP for smaller files (#68)
- **Background Images** — Updated and adjusted opacity (#121, #99, #100, #127)
- **ConfirmDialog Component** — Extracted reusable dialog component (#122)

### Fixed

- **Tool Spinner** — Fixed spinner persisting due to race conditions (#116, #120)
- **Session Race Conditions** — Prevented race conditions when starting/resuming sessions (#114, #115, #78)
- **New Session Dialog** — Persist dialog state across tab switches (#112)
- **Streaming Issues** — Fixed duplicate text, corruption, and out-of-order chunks (#59, #58, #65)
- **Auto-Resume** — Sessions now auto-resume on page refresh (#60)
- **WebSocket Reconnect** — Defer reconnect until browser visible, reset isSubmitting (#92)
- **Wikilinks** — Treat wikilinks with paths as absolute from vault root (#91)
- **Recall Tab** — Use contentRoot for file browsing (#90)
- **Vault Selection** — Added scroll when vault list overflows (#95)
- **Missing Response Start** — Handle missing response_start on session resume (#77)
- **LocalStorage** — Clear localStorage when input is emptied (#76)
- **Touch Devices** — Disable Enter-to-submit on touch devices (#74)
- **Server Launch** — Ensure server launches and ignores SIGHUP (#66)
- **Font Styling** — Updated font size/style for inspiration card (#62)
- **iOS Context Menu** — Prevent native menu from obscuring custom menu (#57)

### Documentation

- **SDD Specs** — Reorganized and updated specs to match GitHub issues (#123)
- **README** — Added `.memory-loop.json` configuration documentation (#83)

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
