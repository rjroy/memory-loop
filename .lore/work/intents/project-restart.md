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

## Starting point

**Quick capture is the core feature.** Record a thought with minimal friction and save it as a timestamped entry in a daily Markdown note. Keep capture available independently of dashboard configuration.

The dashboard direction is **interchangeable dashboard panels**, not plugins for every feature throughout the application. The panel contents are not yet settled.

## Feature inventory for the restart

| Feature | What it does | Restart position |
|---|---|---|
| Quick capture | Saves timestamped text into daily Markdown notes in the vault. | Core scope. Prioritize a simple, reliable capture experience. Meeting-specific capture is an optional extension. |
| Dashboard | Provides an opening view of selected information and actions. | Explore independently replaceable panels. Panel contents remain open. |
| AI conversations | Discusses ideas with vault context, streams responses, and persists conversations for later access. | Candidate capability; desired scope remains open. |
| Browse and search | Navigates vault files, searches content, and displays Markdown and other supported media. | Candidate capability; desired scope remains open. |
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

Save capture notes as ordinary Markdown. If AI conversations are included, make their transcripts readable and retain enough session state for the intended continuity. Keep application metadata distinct from user-authored content.

Do not delete or rewrite unrelated vault content. Make any writes outside the selected vault explicit.

For AI interactions, make access to files and execution tools explicit. Local storage does not imply offline model processing. Choose authentication and network exposure deliberately for the intended deployment.

## Implementation freedom

Frameworks, process boundaries, storage for application metadata, and AI libraries are open implementation choices. No particular web framework, daemon architecture, or AI SDK is required.

If conversations are included, address conversation continuity, mobile disconnect/reconnect behavior, and safe tool execution as user-visible needs.

## Starting direction

Start with quick capture and a dashboard composed of interchangeable panels. Treat the remaining capabilities as candidates to evaluate, not a mandatory backlog. Build the smallest useful product around those needs.

Panel contents, candidate-feature scope, and technical architecture remain open decisions.
