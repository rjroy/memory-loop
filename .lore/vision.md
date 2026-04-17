---
title: Memory Loop Vision
date: 2026-03-23
status: approved
review_trigger: quarterly or after major architectural milestone
last_reviewed: 2026-03-23
tags: [vision, architecture, gctr, daemon, cli, agents]
---

# Vision: Memory Loop

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults through Claude AI. It runs as a local service on your machine and gives you a touch-optimized way to capture notes, have AI conversations with full vault context, and browse your knowledge base from any device.

The interface is organized around the GCTR framework: Ground (orient yourself), Capture (record fleeting thoughts), Think (process ideas with AI), Recall (find and review what you've stored). These names describe what you do, not what the app implements. They teach a practice of knowledge work while you use the tool.

The core value proposition is straightforward. Obsidian is excellent on desktop but limited on mobile. Claude is excellent for processing and connecting ideas but can't see your vault. Memory Loop bridges both gaps: it gives Claude access to your vault while providing a mobile interface designed for how knowledge work actually happens.

This is a personal tool. Single-user, single-machine, no cloud dependencies. Your data stays in your vault as markdown files. Obsidian can open the same vault. Git can version it. Backup is file backup.

## Where It Is Now

### Architecture

The system is a monorepo with three packages: a Next.js 15 web app (pure frontend proxy), a background daemon process (all domain logic), and a shared package (Zod schemas, types, utilities).

The daemon migration completed in March 2026 across 39 commissions. All domain logic moved from the Next.js `lib/` directory into a standalone daemon that listens on a Unix socket. The Next.js app now contains zero domain logic. Every API route is a thin proxy that forwards requests to the daemon. This was a seven-stage migration (skeleton, vault foundation, stateless file operations, background schedulers, session lifecycle, web conversion, CLI client) and the retro documented both the wins (staged planning, review-after-every-stage) and the gaps (system integration testing, dev server configuration).

Following the daemon extraction, the SDK session model was rewritten from long-lived subprocesses to ephemeral per-turn subprocesses. Each user message spawns a fresh subprocess that exits when the response completes. Conversation continuity is maintained through the SDK's `resume` token. This eliminated the silent-crash failure mode where long-lived subprocesses would die and take the session with them.

### Capabilities

**Ground** surfaces vault context at a glance: goals, recent captures, recent discussions, spaced repetition cards due for review, daily inspiration prompts, and debrief buttons for daily/weekly/monthly reflection.

**Capture** appends timestamped notes to daily files with single-tap submission. Meeting mode routes captures to a dedicated meeting file and auto-transitions to Think with `/expand-note` prefilled when the meeting ends.

**Think** is the AI conversation interface. Streaming responses, inline tool display, slash commands with autocomplete, file attachments, session persistence across refreshes, and a two-phase chat protocol (POST to submit, SSE to observe) that survives connection drops. The server processes each message to completion regardless of client connectivity. Clients can disconnect and reconnect freely.

**Recall** is a file browser with directory navigation, markdown rendering, file/content search, and support for images, video, PDF, and other file types. Mobile gets an overlay tree pane.

**Pair Writing** is a desktop-only AI-assisted editing mode. Select text in the editor, choose a quick action (Tighten, Embellish, Correct, Polish) for direct transformation, or an advisory action (Validate, Critique, Compare, Discuss) for feedback. The editor and conversation share the same session. This feature is actively used by the team.

**Spaced Repetition** auto-generates flashcards from vault notes using Claude Sonnet, schedules them with the SM-2 algorithm, and presents a review queue on the Ground tab. Card generation runs nightly with two-phase deduplication (Jaccard similarity plus LLM verification).

**Memory Extraction** runs overnight, reads conversation transcripts, uses Claude Haiku to identify durable facts, and writes them to `~/.claude/rules/memory.md` so Claude remembers what matters about you across sessions.

**Daily Prep** is a skill-based bookend planning system. Morning: energy check, calendar shape assessment, surfacing of pressure/slipping/quick-win tasks, commitment in your own words. Evening: review morning commitment, per-item assessment, optional reflection. The value is in creating an evaluable contract with yourself, not in filtering algorithms.

### Maturity

The system is in daily use as a personal thinking tool. The architecture has been through two major migrations (Vite+Hono to Next.js, then monolith to daemon+frontend) and one session model rewrite (long-lived to ephemeral). Each left the system more stable than before.

Test infrastructure is solid: Bun test runner, dependency injection over module mocking, colocated `__tests__/` directories, pre-commit hooks running typecheck + lint + tests + build. The ephemeral sessions retro identified a real gap in system integration testing (unit tests and code review passed while the product was broken for end users) that hasn't been formally addressed yet.

The `.lore/` directory carries 7 specs (all implemented), 6 brainstorms, 15 retros, 12 reference docs, 3 research artifacts, and 1 plan. Documentation density is high relative to codebase size. Retros are consistently written and carry lessons forward.

## Where It Should Go

The daemon application boundary spec (REQ-DAB-1 through REQ-DAB-25) describes the target state. It was written before the daemon migration and the migration delivered on most of it. What remains is the completion of the vision it set out: Memory Loop as a personal knowledge operating system where humans, CLI, and AI agents all interact with the same capability surface.

### The CLI as a real interface

The daemon migration included a Stage 7 CLI client, but the spec's full vision (REQ-DAB-7 through REQ-DAB-10) goes further. Progressive discovery means a user who knows nothing can explore the full capability surface by following help text. Machine-readable output (JSON by default, human-friendly with flags) means scripts and agents consume the same interface.

The CLI is not a developer convenience. It's the second half of the application boundary. The web app is optimized for touch and visual context. The CLI is optimized for composition and automation. Both are first-class clients of the same daemon.

### Agent interaction through CLI and MCP

The daemon boundary spec (REQ-DAB-11 through REQ-DAB-15) defines how AI agents interact with Memory Loop: through CLI commands projected as MCP tool definitions. The agent doesn't get a separate privileged API. It uses the same commands a human uses at a terminal. MCP tool definitions are generated from CLI command metadata, not maintained separately.

This means an agent running in Claude Code could capture a note to your vault, search for context, trigger extraction, or start a discussion, all through the same boundary that protects your data. Human-agent parity is an invariant: any operation available to humans is available to agents, and any agent-usable operation is discoverable in human-facing surfaces.

### The extraction loop closing

The extraction pipeline currently writes to `~/.claude/rules/memory.md`, a flat file. The spaced repetition system generates cards from vault notes. These are two separate systems that each read vault content and produce derivative artifacts. Neither feeds back into the other. Neither surfaces what it learned in a way that the user can inspect, correct, or redirect.

"Done" for the next phase means these feedback loops close visibly. The user can see what Memory Loop learned from their conversations, correct misunderstandings, and steer future extraction. The vault becomes not just a container that Claude reads but a living surface that Claude's observations enrich and the user curates.

### System integration testing

The ephemeral sessions retro named the gap precisely: "all components are correct" is not the same as "the product works." The quality pipeline checks spec compliance (review), isolated behavior (unit tests), and intra-package interaction (integration tests). Nothing checks whether a human can use the product.

Closing this gap doesn't require a complex framework. It requires a defined step in the quality pipeline that exercises the running system end-to-end. Start the daemon, start the web app, send a message, verify a response arrives. This step should be automatable and should run before declaring work complete on any change that touches the communication path.

## Principles

These are the commitments that guide decisions when options compete.

**Vault as source of truth.** User data lives in the vault as markdown files. No database. No proprietary format. Everything is portable, versionable, and readable by other tools. The daemon is the process that reads and writes to the vault, not a new storage layer.

**Single-user, single-machine.** Memory Loop is a personal tool. It doesn't implement multi-tenant isolation, user accounts, or cloud deployment. Design decisions optimize for one person's knowledge work, not for scale.

**Server processes to completion.** The two-phase chat pattern is load-bearing. The daemon processes each message to completion regardless of client connectivity. SSE connections are viewports into processing state, not drivers of it. This means mobile connectivity drops don't corrupt sessions. This pattern is non-negotiable.

**Human-agent parity at the application boundary.** Any vault operation available to humans is available to agents through the same CLI commands and daemon API. This is an architectural invariant, not a stretch goal.

**Teach the practice, not just provide the tool.** The GCTR framework isn't branding. The names (Ground, Capture, Think, Recall) describe actions. The sigils reinforce metaphors. The interface teaches a practice of knowledge work. Features that don't fit a GCTR mode need a strong argument for why they exist outside it.

## Anti-Goals

Things this project deliberately does not pursue.

**Multi-user or collaborative features.** Memory Loop is personal. Adding collaboration, shared vaults, or real-time co-editing would fundamentally change what the tool is. Build something else for that.

**Cloud hosting or SaaS deployment.** The daemon runs on your machine. Your vault stays on your filesystem. No remote servers, no sync services, no "bring your own cloud." The complexity of cloud deployment would overwhelm the value proposition for a single-user tool.

**Replacing Obsidian.** Memory Loop is a companion to Obsidian, not a replacement. Obsidian owns the desktop editing experience. Memory Loop owns the mobile capture and AI conversation experience. Building a full markdown editor or plugin system would put the project in competition with a tool it depends on.

**General-purpose AI chat.** Memory Loop is not a ChatGPT alternative. Every AI interaction is grounded in vault context. The Think tab exists to process your knowledge, not to answer arbitrary questions. Features that pull toward "chat with Claude about anything" dilute the tool's purpose.

**Optimizing for speed of generation.** The extraction pipeline, card generation, and daily prep system all use LLMs. The priority is accuracy and relevance, not throughput. Batch processing overnight is fine. Real-time extraction is not a goal.

## Strategic Questions

These are forks in the road where the project hasn't committed yet. Each needs resolution before the work it blocks can proceed.

### How should extraction results surface to the user?

The extraction pipeline writes durable facts to a flat file that Claude reads as context. The user never sees what was extracted unless they open the file manually. This creates a trust problem: if Claude "remembers" something wrong, the user has no path to correct it without knowing the file exists and understanding its format.

Options range from a simple "extraction log" view on the Ground tab to a full curation interface where the user reviews, edits, and approves extracted facts before they become context. The first is cheap but passive. The second is powerful but adds significant UI surface.

The daily prep system's "Slipping" category (tasks going cold) demonstrates that Memory Loop already surfaces vault-derived intelligence. Extraction surfacing would follow the same pattern: the system observes, the user curates.

### What is the relationship between the CLI and MCP tool definitions?

The spec says MCP tool definitions are generated from CLI command metadata (REQ-DAB-13). This means the CLI is the canonical source and MCP is a projection. But the Agent SDK's MCP server model expects tool definitions to be available at session setup time, not generated on the fly from a CLI binary.

The practical question is whether the MCP server is a thin wrapper that shells out to the CLI, or a daemon endpoint that serves tool definitions from the same metadata the CLI uses. The first is simpler but slower and harder to debug. The second is cleaner but means the daemon needs a tool definition registry alongside the CLI command registry.

### Should the web app talk directly to the daemon or continue proxying through Next.js API routes?

The current architecture proxies every request through Next.js: browser calls Next.js API route, API route calls daemon over Unix socket. The spec says the browser doesn't connect to the daemon directly (constraints section of daemon-application-boundary spec).

This proxy layer adds latency (especially for SSE streaming) and complexity (every daemon endpoint needs a corresponding Next.js route). The alternative is exposing the daemon on a localhost TCP port and having the browser call it directly. This eliminates the proxy but means two servers serve the frontend (Next.js for HTML/JS/CSS, daemon for API), which complicates CORS, auth, and deployment.

The daemon migration retro noted that SSE proxy buffering was a potential concern. The SSE auto-reconnect work (PR #489) addressed connection reliability but not the fundamental question of whether the proxy layer should exist long-term.

### Where does mobile-specific UX investment go next?

Pair Writing is desktop-only. The Ground tab's daily prep flow works on mobile but wasn't designed mobile-first. Meeting mode's stop-and-expand flow assumes screen real estate for split panes.

The project started as a mobile interface for Obsidian vaults. The most impactful mobile features (Capture, Think) work well. But the richer features (Pair Writing, Daily Prep surfacing) assume desktop context. The question is whether to invest in mobile adaptations of these features or to accept that some features are desktop-appropriate and focus mobile investment on Capture and Think.

## What's Not In Scope

These boundaries keep the project focused. They aren't anti-goals (things we reject on principle) but scope limits (things we defer to stay coherent).

**Obsidian plugin development.** Memory Loop interacts with vaults through the filesystem, not through the Obsidian API. Building an Obsidian plugin would create a parallel integration path that competes with the daemon boundary.

**Voice input and speech-to-text.** The Capture tab takes text input. Voice capture is a natural extension but introduces audio processing, transcription services, and platform-specific APIs that are orthogonal to the current architecture.

**Calendar integration.** The daily prep system uses self-reported calendar shape (Clear/Scattered/Heavy) rather than calendar API integration. Connecting to Google Calendar or Outlook would add external service dependencies and authentication flows that conflict with the single-machine, no-cloud principle.

**Offline mode.** Memory Loop requires a running daemon and (for AI features) network access to Anthropic's API. Offline capture could work (queue notes locally, flush when connected) but the AI conversation features are inherently online. The complexity of partial-offline doesn't justify the use case frequency.

**Multi-vault simultaneous access.** The system discovers multiple vaults but operates on one at a time. Simultaneous multi-vault access (cross-vault search, unified dashboard across vaults) would require significant architectural changes to the session model and state management.

## Tension Resolution

When principles or goals conflict, these precedents guide resolution.

| Tension | Resolution |
|---------|------------|
| Mobile UX vs feature richness | Mobile gets the core loop (Capture, Think) at full quality. Desktop gets richer features (Pair Writing). Don't degrade desktop to force mobile parity. |
| Automation vs user agency | The system surfaces and suggests. The user decides and commits. Extraction proposes facts; the user curates. Daily prep surfaces tasks; the user writes the commitment. Never auto-act on the user's behalf. |
| CLI completeness vs web completeness | The daemon API is the source of truth. Both CLI and web should cover all operations eventually, but web is primary for interactive use and CLI is primary for scripting and agent use. Ship web first when time-constrained. |
| Architectural purity vs shipping | The daemon boundary is the target. Transitional proxy patterns are acceptable (REQ-DAB-23) as long as each change moves toward the boundary, not away from it. Don't block useful features on migration completion. |
| Test coverage vs integration confidence | Both matter, but if forced to choose, a running system that handles the golden path beats 100% unit coverage on components that aren't wired together. The ephemeral sessions retro made this clear. |
