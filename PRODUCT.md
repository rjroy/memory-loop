# Memory Loop

<!-- impeccable:product-schema 1 -->

## Authority

Product context captured on 2026-10-29 from [the restart intent](.lore/work/intents/project-restart.md) and the current conversation. This is a fresh restart; previous implementation and design are not requirements. The conversation narrows phase 1 to a frontend shell.

## Platform

web

## Stack

Unsettled. Bun, Hono, React, and Next.js are candidates, not requirements. Prefer a lightweight shell; an additional application server needs justification. Visual design guesses are delegated for proposal, not approval to implement or settle architecture.

## Users

One personal user on a phone and desktop, accessing the application on a home LAN. Public hosting, access away from home, and multi-user accounts are not current requirements.

## Product Purpose

A personal interface to local Obsidian vaults: capture thoughts, discuss ideas with AI using vault context, and find or edit existing material. Quick capture is the core capability: save timestamped text in a daily Markdown note with minimal friction.

## Operating Context

Vaults remain ordinary local Markdown files and attachments, usable by Obsidian and filesystem tools. Capture stays available independently of dashboard configuration. Local file storage does not imply offline AI processing.

## Capabilities and Constraints

The four application areas are fixed and ordered:

1. **Ground:** dashboard with interchangeable panels; panel contents remain open.
2. **Capture:** quick note capture, independent of Ground.
3. **Think:** AI chat.
4. **Recall:** vault file access.

Phase 1 is only a frontend shell with four independently replaceable placeholder views, proposed and reviewed before implementation. No daemon, vault access, AI, business logic, fake conversations, or invented dashboard data. Functional capture is not part of this phase.

Long term, a daemon owns business logic and authoritative operation state; the frontend presents state and sends commands. Accepted asynchronous work must survive browser disconnection, and reconnecting must recover authoritative state and outstanding decisions. Cancellation is explicit, not a side effect of disconnection. These are future requirements, not phase-1 work. Process-crash durability remains unresolved.

The intended AI direction is Browser → Memory Loop daemon → local OpenCode service, keeping service access and credentials behind the daemon. Compatibility, configuration context, and session sharing need verification; integration is not settled by the shell.

Respect configurable vault/content locations. Do not delete or rewrite unrelated vault content. Make writes outside the selected vault explicit. Keep application metadata distinct from user-authored content. File/tool permissions and network exposure need deliberate choices.

## Brand Commitments

The name is **Memory Loop**. No old application design is inherited. The user approved applying **The Guide** personal-brand palette and Source Sans 3/Semibold interface typography to the shell design proposal. The [local guidance snapshot](.lore/work/design/personal-brand-snapshot.md) records the exact palette roles and source provenance. Keep the interface task-focused: no hero art, taglines, or decorative brand motifs. This direction approval is not implementation authorization or approval of every layout, accessibility, or technical detail; responsive navigation and detailed shell behavior remain documented proposals.

## Evidence on Hand

The restart intent and current conversation establish product truth. Approved personal-brand guidance is captured locally with source revision and clean-worktree provenance; no fonts or artwork have been copied. No vault files, real conversations, panel content, product screenshots, or visual assets are supplied for this phase. Do not manufacture examples to make a placeholder look active.

## Product Principles

- Keep quick capture independent of dashboard choices.
- Preserve ordinary, usable vault files and explicit write boundaries.
- Separate presentation from authoritative business and operation state.
- Make absence of functionality honest; a shell must not imply saved notes, connected services, or live data.
- Keep the four views replaceable without turning the whole application into a plugin framework.

## Open Decisions

Stack, authentication and LAN exposure, panel contents/configuration, AI integration details, metadata storage and transport, process-crash durability, and the depth/order of future features remain open. No product-specific accessibility needs have been supplied; the shape brief proposes an accessibility baseline for approval.
