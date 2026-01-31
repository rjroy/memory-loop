---
title: Memory Loop System Overview
date: 2026-01-28
status: current
tags: [architecture, gctr, overview, onboarding]
modules: [backend, frontend, shared]
---

# Memory Loop: System Overview

## What It Is

Memory Loop is a mobile-friendly web interface for interacting with Obsidian vaults via Claude AI. It runs as a local server you access from your phone or tablet, giving you a touch-optimized way to capture notes, have AI conversations, and browse your vault on the go.

## The Problem

Obsidian is excellent on desktop but limited on mobile. The official mobile app works, but it's not designed for quick capture or AI-assisted thinking. Meanwhile, Claude is excellent for processing and connecting ideas, but it can't see your vault.

Memory Loop bridges both gaps: it gives Claude access to your vault while providing a mobile interface designed for how knowledge work actually happens.

## The GCTR Framework

The app is organized around four modes, each named for what you *do* rather than what the app *implements*:

| Mode | What You Do | Internal Name |
|------|-------------|---------------|
| **Ground** | Orient yourself. See what matters today. | `home` |
| **Capture** | Record fleeting thoughts before they vanish. | `note` |
| **Think** | Process ideas with AI as thinking partner. | `discussion` |
| **Recall** | Find and review what you've stored. | `browse` |

This isn't arbitrary branding. The names teach a practice:

- **Ground** before doing. Check your goals, see recent activity, notice what needs attention.
- **Capture** when ideas arrive. Don't curate, just record. Daily notes accumulate raw material.
- **Think** when ready to process. Claude helps expand, question, connect. Conversations become transcripts.
- **Recall** when you need something. Browse, search, edit. The vault is your external memory.

The sigils reinforce the metaphors: 🪨 solid foundation, 🪶 light writing tool, ✨ spark of insight, 🪞 reflective surface.

See [Navigation Bar](./navigation-bar.md) for implementation details and [GCTR Mode Transitions](../diagrams/gctr-mode-transitions.md) for a visual map of how modes connect.

## Architecture

### Monorepo Structure

```
backend/     # Hono server + Claude Agent SDK
frontend/    # React 19 + Vite SPA
shared/      # Zod schemas for type-safe messages
```

The backend runs from TypeScript source (no build step). The frontend builds to static files served by the backend.

### Communication

Two channels connect frontend and backend:

| Channel | Used For |
|---------|----------|
| **REST API** | Stateless operations: file CRUD, search, config, cards |
| **WebSocket** | Streaming: AI responses, tool execution display, session state |

This split is deliberate. REST handles most operations cleanly. WebSocket handles the cases where you need real-time feedback (watching Claude think) or bidirectional communication (session establishment).

See [Communication Layer](./_infrastructure/communication-layer.md) for protocol details.

### Vaults

Memory Loop discovers vaults from a configured directory. Each vault is an Obsidian vault with a `CLAUDE.md` file at root. The CLAUDE.md serves double duty: it provides context to Claude during conversations and configures Memory Loop behavior.

Vaults store their own metadata (sessions, cards, transcripts) in a metadata directory, keeping the main vault structure clean.

See [Vault Selection](./_infrastructure/vault-selection.md) and [Configuration](./_infrastructure/configuration.md) for details.

## Reading Path

### Start Here

1. **This document** - You're reading it
2. **[Navigation Bar](./navigation-bar.md)** - The GCTR framework in code
3. **[Communication Layer](./_infrastructure/communication-layer.md)** - How frontend/backend talk

### The Four Modes

Each mode has its own spec. Read in GCTR order to follow the knowledge work flow:

4. **[Ground (Home Dashboard)](./home-dashboard.md)** - The landing view with widgets
5. **[Capture](./capture.md)** - Quick notes to daily files
6. **[Think](./think.md)** - AI conversation interface
7. **[Recall](./recall.md)** - File browser and viewer

### Sub-features

These are embedded in or extend the main modes:

| Feature | Parent | Purpose |
|---------|--------|---------|
| [Spaced Repetition](./spaced-repetition.md) | Ground | Flashcard review queue |
| [Inspiration](./inspiration.md) | Ground | Daily prompts and quotes |
| [Task List](./task-list.md) | Recall | Checkbox aggregation across vault |
| [Pair Writing](./pair-writing.md) | Recall | AI-assisted editing |

### Infrastructure

These specs cover cross-cutting concerns:

| Spec | What It Covers |
|------|----------------|
| [Vault Selection](./_infrastructure/vault-selection.md) | Vault discovery, setup wizard |
| [Configuration](./_infrastructure/configuration.md) | CLAUDE.md parsing, settings |
| [System Settings](./_infrastructure/system-settings.md) | Per-vault preferences |
| [Extraction](./_infrastructure/extraction.md) | Transcript → memory pipeline |
| [Card Generator](./_infrastructure/card-generator.md) | Spaced repetition card creation |

## Key Patterns

### State Lives in React

Frontend state is managed by `SessionContext` using `useReducer`. There's no Redux, no external state library. The reducer pattern keeps state transitions predictable and testable.

Mode switches don't clear state. You can start a conversation in Think, switch to Recall to find a file, switch back to Think, and your conversation is still there.

### Claude Agent SDK

AI conversations use Anthropic's Agent SDK, not raw API calls. The SDK handles:
- Conversation threading and context management
- Tool definitions and execution
- Streaming response handling
- Session persistence

The backend wraps the SDK in a session manager that handles lifecycle (create, resume, save) and routes tool calls to appropriate handlers.

### Vault as Source of Truth

User data lives in the vault, not in a database. Notes are markdown files. Cards are markdown files. Transcripts are markdown files. Memory Loop reads and writes to the filesystem.

This means:
- Everything is portable (it's just files)
- Obsidian can open the same vault
- Git can version control everything
- Backup is just file backup

## What's Not Documented Yet

The excavation is ongoing. Gaps include:

- **File Upload** - How attachments work in Think mode
- **Meeting Capture** - Live note-taking mode
- **Search** - File and content search in Recall
- **Holiday Themes** - Seasonal visual variations

Check [excavations/index.md](../excavations/index.md) for current status.
