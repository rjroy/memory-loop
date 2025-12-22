---
version: 1.0.0
status: Approved
created: 2025-12-18
last_updated: 2025-12-18
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Memory Loop Specification

## Executive Summary

Memory Loop is a web application built on the Claude Agent SDK that provides a mobile-friendly interface for interacting with "vaults" (structured note repositories like Obsidian vaults with CLAUDE.md configurations). It serves as a lightweight, always-available gateway to AI-powered knowledge management.

The application addresses the friction of accessing Claude Code capabilities from mobile devices or when a full terminal isn't convenient. By providing two distinct interaction modes—quick note capture and full discussion—it enables both rapid thought capture and deep exploration of vault contents from any device on the local network.

## User Story

As a knowledge worker, I want a mobile-accessible interface to my vault so that I can capture thoughts throughout the day and have meaningful AI-assisted discussions about my notes from anywhere on my home network.

## Stakeholders

- **Primary**: Vault users seeking mobile/tablet access to their knowledge base
- **Secondary**: Developers maintaining or extending the application
- **Tertiary**: Other household members on shared network (resource awareness)

## Success Criteria

1. User can select a vault and interact with it within 5 seconds of page load
2. Note capture round-trip completes in under 3 seconds on LAN
3. Tool use is visible to the user during all operations
4. Session can be resumed after browser refresh or device switch
5. UI is fully functional on mobile viewport (320px minimum width)

## Functional Requirements

### Vault Management

- **REQ-F-1**: Application loads vault list from a server-configured directory path
- **REQ-F-2**: User can select a vault from the list to load
- **REQ-F-3**: Selected vault's directory becomes the working directory for the Claude Agent SDK session
- **REQ-F-4**: Vault's CLAUDE.md and `.claude/` configuration are loaded via `settingSources: ['project']`
- **REQ-F-5**: Skills defined in the vault's `.claude/skills/` directory are automatically loaded and invocable via the Skill tool

### Mode Switching

- **REQ-F-6**: Frontend provides two modes: "Note Adding" and "Discussion"
- **REQ-F-7**: User can switch between modes with a single tap/click
- **REQ-F-8**: Current mode is visually indicated at all times
- **REQ-F-9**: Mode switch preserves the active session context

### Note Adding Mode

- **REQ-F-10**: Simple input interface optimized for quick text entry
- **REQ-F-11**: Submitted text is appended to today's daily note under the `## Capture` section
- **REQ-F-12**: Daily note uses `YYYY-MM-DD.md` naming convention in the vault's inbox location
- **REQ-F-13**: Daily note is created if it doesn't exist; if vault template unavailable, create with `# YYYY-MM-DD` heading and `## Capture` section
- **REQ-F-14**: Confirmation feedback is shown after successful capture
- **REQ-F-15**: Original captured text is preserved verbatim; AI may add wiki-links or formatting below the original text

### Discussion Mode

- **REQ-F-16**: Chat interface for multi-turn conversations
- **REQ-F-17**: Full Claude Agent SDK tool access (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, Skill)
- **REQ-F-18**: Conversation history displayed with clear user/assistant distinction
- **REQ-F-19**: User can issue slash commands from the vault's `.claude/commands/` directory
- **REQ-F-20**: Streaming responses are displayed progressively

### Tool Transparency

- **REQ-F-21**: Tool invocations are displayed to the user with tool name and summary
- **REQ-F-22**: Tool inputs are viewable on expansion/tap
- **REQ-F-23**: Tool outputs are viewable on expansion/tap
- **REQ-F-24**: Active tool execution shows a loading/progress indicator

### Session Management

- **REQ-F-25**: Session ID is captured from the Claude Agent SDK system init message
- **REQ-F-26**: Session metadata is persisted to a `.memory-loop/` directory as JSON files
- **REQ-F-27**: Session can be resumed after page refresh using stored session ID
- **REQ-F-28**: User can start a new session, clearing previous context
- **REQ-F-29**: Session history includes vault identifier for multi-vault support

### Frontend

- **REQ-F-30**: Responsive design supporting desktop (1024px+), tablet (768px), and mobile (320px) viewports
- **REQ-F-31**: Touch-friendly UI elements with appropriate tap targets (minimum 44px)
- **REQ-F-32**: Works in modern browsers (Chrome, Safari, Firefox)

### Error Handling

- **REQ-F-33**: Inaccessible vault directory displays error with path and troubleshooting guidance
- **REQ-F-34**: Claude API errors display user-friendly message and preserve unsent user input
- **REQ-F-35**: Note capture retries up to 3 times on network failure before showing error
- **REQ-F-36**: Empty vault list (no configured vaults) displays setup instructions

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Initial page load under 2 seconds on LAN
- **REQ-NF-2** (Performance): Note capture response under 3 seconds
- **REQ-NF-3** (Performance): Discussion message round-trip under 10 seconds for typical queries
- **REQ-NF-4** (Latency): Streaming responses begin within 1 second of submission
- **REQ-NF-5** (Reliability): No data loss on network interruption during note capture
- **REQ-NF-6** (Usability): Mode switch requires single interaction (tap or click)
- **REQ-NF-7** (Usability): Primary actions accessible without scrolling on mobile
- **REQ-NF-8** (Security): LAN-only access (no authentication required)
- **REQ-NF-9** (Maintainability): TypeScript with strict mode enabled
- **REQ-NF-10** (Maintainability): Frontend and backend in same repository

## Explicit Constraints (DO NOT)

- Do NOT implement user authentication or multi-user support
- Do NOT expose the application beyond the local network
- Do NOT store conversation content in external services
- Do NOT modify vault files in note-adding mode beyond appending to daily notes
- Do NOT implement real-time collaboration features
- Do NOT create a native mobile app; web-only
- Do NOT implement offline functionality; LAN connection required

## Technical Context

- **Existing Stack**: This is a new application in the forge-keep monorepo
- **SDK**: Claude Agent SDK TypeScript (`@anthropic-ai/claude-agent-sdk`)
- **Runtime**: Node.js 18+ or Bun
- **Integration Points**:
  - Vault filesystems (read/write markdown files)
  - Claude Agent SDK (session management, tool execution)
  - Vault's MCP servers (if configured in `.claude/settings.json`)
- **Patterns to Respect**:
  - Vault's CLAUDE.md conventions
  - Daily note format (`YYYY-MM-DD.md`)
  - PARA folder structure awareness

## Acceptance Tests

1. **Vault Selection**: Given the server has 2 configured vaults, when the user loads the app, they see both vaults listed and can select one to load
2. **Note Capture**: Given a vault is loaded, when the user enters "Meeting with Bob about project X" in note-adding mode and submits, the text appears in `00_Inbox/YYYY-MM-DD.md` under `## Capture`
3. **Discussion Query**: Given a vault with existing notes, when the user asks "What did I capture last week?", Claude uses Read/Glob tools and returns relevant note content
4. **Tool Transparency**: Given a discussion query that invokes Grep, the user can see "Grep" tool usage with expandable input/output
5. **Session Resume**: Given a session with 3 exchanges, when the user refreshes the page, conversation history is restored and can be continued
6. **Mode Switch**: Given the user is in discussion mode with an active session, when they switch to note-adding mode and capture a note, the session context is preserved for when they return to discussion
7. **Mobile Layout**: Given a 375px viewport, the mode toggle, input area, and submit button are all visible without horizontal scrolling
8. **Slash Command**: Given a vault with `/daily-debrief` command, when the user types `/daily-debrief` in discussion mode, the command executes with vault context

## Open Questions

*All resolved - see below*

~~Should note-adding mode support voice input on mobile?~~ → Out of scope for v1
~~Should there be a "recent sessions" list for switching between vaults?~~ → Out of scope for v1
~~What happens if the vault's daily note template can't be found?~~ → Resolved in REQ-F-13

## Out of Scope

- Multi-user support or user accounts
- Authentication/authorization
- Offline functionality or PWA features
- Native mobile applications
- Real-time collaboration
- End-to-end encryption
- Public internet deployment
- Automatic vault syncing (user manages with git/Obsidian Sync)
- Custom theming or branding
- Voice input for note capture (v1)
- Recent sessions list across vaults (v1)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
