# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-01-15

### Added

**Meeting Capture Mode**
- Dedicated meeting notes with start/stop controls (#306)
- Meeting files stored in `00_Inbox/meetings/` with YAML frontmatter (date, title, attendees)
- Timestamped entries with `[HH:MM]` format during active meetings
- Meeting status bar in Note Capture UI (#307)

**Vault Widgets**
- Computed frontmatter aggregation and similarity widgets (#241)
- DAG-based dependency resolution for widget fields (#249)
- Similarity aggregator for weighted average computation (#292)
- Cross-widget references via `includes` field (#261)
- Expression language: `normalize` and `lerp` functions (#257)
- Block expression support for multi-line JavaScript-like syntax (#296)
- Context prefix support for widget aggregators (#254)
- Enhanced widget layout in BrowseMode for responsiveness (#263)

**External Data Sync**
- BoardGameGeek integration for syncing collection data (#302)

**AI Conversation Enhancements**
- AskUserQuestion tool for clarifying questions with multiple-choice prompts (#299)
- Turn limit removed in favor of cancel and permission dialogs (#290)
- Context window usage percentage displayed in assistant messages (#229)
- 'Think about' file context menu option for quick file-based prompts (#226)
- Markdown rendering in user message bubbles (#224)
- Configurable discussion model via `.memory-loop.json` (#284)
- Local source option in discussion mode settings (#305)

**Vault Configuration**
- Visual configuration editor for vault settings (#287)
- Custom vault display ordering (#300, #301)
- Pinned assets persisted in vault config instead of localStorage (#259)
- Configurable recent activity limits and per-vault session storage (#265)

**Task List**
- Grouping by Inbox, Projects, and Areas categories (#272)
- Collapsible category headers (#273)

**Theming & Display**
- Holiday tint applied to bubble images (#228)
- Wiki-link image syntax support in messages (`![[image.png]]`) (#294)
- Clickable goals card with `/review-goals` command (#240)

**Infrastructure**
- Health panel for backend error display (#248)
- `.gitignore` for SQLite cache files during vault setup (#244)

### Changed

- Slash command cache moved to `.memory-loop/slash-commands.json` (#271)
- Widget computation logic simplified and unified for Ground and Recall widgets (#291)
- GoalsCard now renders raw markdown directly (#252)
- Large modules refactored into modular structure (#247)
- Model configuration uses generic names to spread API costs (#253)
- SDK types replace `Record<string, unknown>` in WebSocket handler (#233)

### Fixed

- Image transformation skipped for paths inside inline code (#298)
- Muted color values corrected (#295)
- Badge order in VaultSelect adjusted for visibility (#289)
- VaultId included when saving config from within vault (#288)
- Widget computation order with cycle detection in WidgetEngine (#281)
- `recentDiscussions` config honored when pruning old sessions (#275)
- Background color transparency in MarkdownViewer (#274)
- Session resume after vault selection for per-vault storage (#269)
- Image width constrained in message bubbles (#268)
- SDK errors surfaced to frontend instead of blank responses (#256)
- Date comparison logic for contextual generation checks (#255)
- Vault Widgets edge cases and initialization bugs (#243)
- Zod upgraded to v4 and claude-agent-sdk to 0.2.4 (#235)
- SDK system/init event used for reliable context usage calculation (#234)
- Context usage sent to frontend during streaming response (#232)
- Cursor filter applied correctly (#231)
- Holiday background selectors updated for root-level attribute (#230)
- Holiday theming applied to portaled dialogs (#225)
- Order field passed to config editor initialConfig (#304)

### Documentation

- Usage documentation added for all four tabs (Ground, Capture, Think, Recall) (#293)
- Meeting capture mode guide (#308)
- Widget `includes` field documentation (#262)
- Expression language included context documentation (#285)
- README improved with visuals and streamlined content (#222)
- Images added for documentation (#309)

## [1.2.0] - 2026-01-09

### Added

**Browse Mode Enhancements**
- Download option for unsupported file types (#219)
- Upload support for additional file types (#217)
- File deletion via context menu (#215)
- CSV/TSV files rendered as tables (#213)
- TXT file viewing (#212)
- JSON, video, and PDF file viewing (#210)
- Image rendering when file selected (#206)

**Discussion Mode**
- Image upload capability (#201)
- Slash command autocomplete with cached commands for immediate availability (#157, #159)
- Vault transfer MCP tool for cross-vault file operations (#154)

**Vault Configuration**
- Custom badges for vault cards (#194)
- Vault title and subtitle parsing with config overrides (#181, #193)
- Setup button on vault select screen (#168)
- Configurable generation settings for inspiration content (#182)

**Search & Task Management**
- Search functionality in Recall tab (#191)
- Right-click context menu for task state selection (#167)

**Infrastructure**
- HTTPS/TLS support via environment variables (#188)
- HTTP to HTTPS redirect server when TLS enabled (#189)
- Version watermark showing git commit hash in header (#216)

**Theming**
- Seasonal holiday theming system with SCSS (#197)
- St. Patrick's Day holiday theme (#199)
- Hue-rotate filters for background images on holidays (#198)
- Holiday-themed backgrounds and logos (#156)
- Debrief action buttons replacing vault stats (#146)

**Usability**
- Enter key submission for NoteCapture (#176)
- Recency-weighted selection for contextual prompts (#180)

### Changed

- Note capture placeholder now shows destination (#155)
- Updated logo to match Sunset Sky theme (#149)
- WCAG color system improvements with Sunset Sky theme (#148)
- Streaming cursor replaced with pulsing orb (#141)
- Increased font size for InspirationCard text (#140)
- Capture button moved above textarea for iOS keyboard visibility (#138)
- Updated font usage with 3 additional fonts (#137)
- Added glass background to empty-state, improved contrast on inspiration (#136)
- Debrief color adjusted (#147)
- Text gradient corrected (#150)

### Fixed

- Span wrappers on plain text in list items with links (#220)
- VaultId missing from image asset URLs (#205)
- Slash commands missing from new_session response (#196)
- Fuzzy-only matches with zero exact matches appearing in search (#192)
- PWA meta tags and manifest for iOS home screen icon (#190)
- Focus not restoring to textarea after note capture (#186)
- Race condition in vault card setup update (#173)
- Archive directory name (plural to singular) (#172)
- Task toggle and context menu state inconsistency (#170)
- Task toggle when WebSocket disconnected (#166)
- Refresh button not refreshing task list (#165)
- Cached slash commands missing from resume_session response (#161)
- Cached slash commands not restoring after vault selection (#160)
- Missing line break after tool completion in messages (#153)
- ConfirmDialog positioning (now rendered via portal) (#139)

### Documentation

- Added systemd service example for running as user service (#175)

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
