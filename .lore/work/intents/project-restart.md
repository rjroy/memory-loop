---
title: Memory Loop restart brief
date: 2026-10-29
status: draft
tags: [restart, product, features, intent]
---

# Memory Loop restart brief

## Purpose

Memory Loop is a personal web interface for working with local Obsidian vaults: capturing thoughts, discussing ideas with AI using vault context, and finding or editing existing material. It should be convenient on a phone as well as a desktop.

This document is the complete starting brief. It assumes no access to a previous implementation, repository, or supporting documentation.

The intended deployment is personal, single-user access from a desktop and phone on the home network. Public hosting, access away from home, and multi-user accounts are not current requirements. Authentication and network exposure still need deliberate choices for that deployment.

## Starting point

**Quick capture is the core feature.** Record a thought with minimal friction and save it as a timestamped entry in a daily Markdown note. Keep capture available independently of dashboard configuration.

The dashboard direction is **interchangeable dashboard panels**, not plugins for every feature throughout the application. The panel contents are not yet settled.

## Application areas

The application has four tabs:

| Tab | Purpose |
|---|---|
| Ground | Dashboard composed of interchangeable panels. |
| Capture | Quick note capture, available independently of Ground's panel configuration. |
| Think | AI chat interface. |
| Recall | Vault file access. |

These areas establish the product structure, not the full feature depth of each area. The four-tab placeholder shell is implemented. The next functional layer is [read-only Recall](recall.md), establishing JSON vault configuration, daemon file retrieval, and Markdown rendering before Think needs vault-backed chat history.

## Feature inventory for the restart

| Feature | What it does | Restart position |
|---|---|---|
| Quick capture | Saves timestamped text into daily Markdown notes in the vault. | Core scope. Prioritize a simple, reliable capture experience. Meeting-specific capture is an optional extension. |
| Dashboard | Provides an opening view of selected information and actions. | Explore independently replaceable panels. Panel contents remain open. |
| AI conversations | Discusses ideas with vault context, streams responses, and persists conversations for later access. | Included as Think; detailed scope remains open. Explore reuse of the existing OpenCode setup. |
| Browse and search | Navigates vault files, searches content, and displays Markdown and other supported media. | File access is included as Recall; search, supported media, and editing scope remain open. |
| Pair writing | Combines document editing with AI transformations, suggestions, and critique. | Candidate capability; desired scope remains open. |
| Inspiration | Offers prompts, questions, and quotes. | Optional candidate for a dashboard panel; usefulness is not confirmed. |
| Multiple vaults and settings | Discovers/selects vaults and configures their paths and behavior. | Supporting capability; exact scope remains open. |
| File uploads and attachments | Adds files to the vault or conversation, with image optimization where useful. | Supporting capability; exact scope remains open. |
| Model selection | Configures the AI model used for discussion. | Supporting capability; provider and configuration design are open. |

## Dashboard direction

Treat the dashboard as a place where panels can be added, removed, or replaced without repeatedly redesigning the whole feature. That is the desired flexibility. It does not yet require an installable third-party plugin ecosystem, marketplace, or generalized extension framework.

Which panels belong there, their configuration, and their implementation remain open. Add panels for concrete needs rather than filling the dashboard by default. Quick capture is a core capability regardless of whether the dashboard also exposes it.

## Data and safety

An Obsidian vault is a local directory of Markdown notes and attachments. Keep these files usable by Obsidian and ordinary filesystem tools. Application behavior should respect configurable vault and content locations.

Save capture notes as ordinary Markdown. Make AI conversation transcripts readable and retain enough session state for the intended continuity. Keep application metadata distinct from user-authored content.

Do not delete or rewrite unrelated vault content. Make any writes outside the selected vault explicit.

For AI interactions, make access to files and execution tools explicit. Local storage does not imply offline model processing. Choose authentication and network exposure deliberately for the intended deployment.

## Architecture and operation lifecycle

Use a daemon for business logic and authoritative application and operation state. The frontend handles presentation and interaction, sends commands, and displays daemon-owned state. Vault writes, capture behavior, and other business rules belong behind that boundary, not in the browser.

Operations that can take time must run asynchronously, independently of the browser connection. In particular:

- Disconnecting or closing the browser must not cancel accepted work.
- Reconnecting must restore operation status, available results, and ongoing monitoring.
- Think must restore conversation state and any pending permission requests or other user decisions, not merely open a new response stream.
- Cancellation is an explicit action, separate from disconnection.

Surviving a browser disconnect is a requirement. Recovery after a Memory Loop daemon or OpenCode service crash/restart is a separate, unresolved durability concern. Do not assume uninterrupted execution or exactly-once tool effects across process failures.

## OpenCode integration direction

The goal is to reuse the existing OpenCode TUI setup in Think as closely as practical, including agents, models, skills, plugins, and permissions. Exact compatibility must be verified, especially for project-specific configuration and plugins. Reusing configuration does not yet settle whether Memory Loop and the TUI should expose the same existing sessions.

The current recommended integration boundary is:

**Browser → Memory Loop daemon → local OpenCode service**

Memory Loop owns its application behavior and reconnect handling. OpenCode owns agent execution and its session state, model access, tools, and permissions. Keep OpenCode access and credentials behind the Memory Loop daemon rather than exposing them directly to the browser.

OpenCode V2 provides an HTTP API and the official `@opencode/client` TypeScript package. The client supports discovery and authentication for the local background service. Its event subscriptions are live-only, without replay or automatic reconnection. Reconnection must therefore refetch authoritative state and resume live monitoring rather than assume that reopening a stream recovers missed events. The exact synchronization mechanism remains an implementation decision.

Configuration discovery depends on the session's working directory/location. Select that context deliberately to reuse the intended global and project setup.

The separate-service approach is the current recommendation, not a completed integration decision. An embedded SDK exists as an alternative. Verify the installed OpenCode version and the required API behavior before implementation; do not mix V1 API examples with V2 contracts.

Research references:

- [OpenCode V2 client](https://opencode.ai/v2/docs/build/client)
- [OpenCode V2 API](https://opencode.ai/v2/docs/api)
- [OpenCode V2 configuration](https://opencode.ai/v2/docs/config)
- [OpenCode V2 embedded SDK](https://opencode.ai/v2/docs/build/sdk)

## Remaining implementation choices

Bun, Hono, React, and Next.js are candidate technologies, not requirements. Choose a stack that fits the daemon/presentation boundary; justify any additional server layer rather than adopting it by default. Application metadata storage, transport, and other implementation details remain open.

## Starting direction

Quick capture remains the core product capability, alongside a dashboard composed of interchangeable panels. Following the completed frontend shell, build read-only Recall next to establish shared vault foundations before implementing Think or Capture. See [the Recall intent](recall.md) for that layer's scope. Treat the remaining optional capabilities as candidates to evaluate, not a mandatory backlog.

Panel contents, detailed feature scope, layer boundaries, phase order, and the remaining technical choices are open decisions. The daemon/presentation split and disconnect-safe asynchronous operation lifecycle are established requirements.
