# Memory Loop

<!-- impeccable:product-schema 1 -->

## Authority

Product context captured from [the restart intent](.lore/work/intents/project-restart.md), [Recall intent](.lore/work/intents/recall.md), and current user decisions. This is a fresh restart; old implementation/design are not requirements. Phase 1 established the shell; the user subsequently approved and authorized the read-only Recall design.

## Platform

web

## Stack

The accepted [phase-1 plan](.lore/work/plans/phase-1-shell.md) established Bun-managed React, TypeScript, Vite and React Router. Read-only Recall adds a Bun Request/Response daemon serving the built frontend and two same-origin read endpoints, without Next.js or Hono. Development uses the Vite loopback proxy; standalone preview stays static-only. Maintained react-markdown/remark-gfm supply rendering. This settles the current slice, not AI integration or remote production hosting.

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

Phase 1 was a frontend-only shell with four placeholders; it and the dark-default refinement passed their independent checks/reviews. The subsequent [approved Recall design](.lore/work/design/recall-read-only.md) is implemented and accepted: one JSON-configured vault, daemon-owned listing/note reads, a native folder hierarchy, and safe read-only CommonMark/GFM. The read-only slice is complete with visual **ship** and technical **Accept**. This does not activate a real vault or remote API.

Ground/Capture/Think remain disposable placeholders. Recall's task-specific Files/reader interior replaces its placeholder without constraining future replacements. Preserve the four destinations, not a shared card layout. Recall has no search, editing, media, config editor or vault writes. Capture, AI and dashboard contents remain unimplemented; no fake conversations or invented activity are supplied.

Local config is already set and ignored, but only test-owned vaults were read during implementation/verification. Real-vault daemon activation requires explicit approval. The existing Tailscale static preview serves the built UI with no vault API. Remote real-note access requires a separately approved and reviewed authenticated private transport; loopback alone is not authentication against local processes.

Long term, a daemon owns business logic and authoritative operation state; the frontend presents state and sends commands. Accepted asynchronous work must survive browser disconnection, and reconnecting must recover authoritative state and outstanding decisions. Cancellation is explicit, not a side effect of disconnection. These are future requirements, not phase-1 work. Process-crash durability remains unresolved.

The intended AI direction is Browser → Memory Loop daemon → local OpenCode service, keeping service access and credentials behind the daemon. Compatibility, configuration context, and session sharing need verification; integration is not settled by the shell.

Respect configurable vault/content locations. Do not delete or rewrite unrelated vault content. Make writes outside the selected vault explicit. Keep application metadata distinct from user-authored content. File/tool permissions and network exposure need deliberate choices.

## Brand Commitments

The name is **Memory Loop**. No old application design is inherited. The user approved **The Guide** personal-brand palette and Source Sans 3/Semibold interface typography, then authorized planning and implementing the shell. Dark is now the approved default: Night workspace/navigation, Parchment readable text, restrained Lantern selection, and Horizon reserved for purposeful information. This does not request a theme switch or new behavior. The [local guidance snapshot](.lore/work/design/personal-brand-snapshot.md) records the exact palette roles and source provenance. Keep the interface task-focused: no hero art, taglines, or decorative brand motifs. Approval is not evidence of tested contrast/accessibility or authorization for later product phases.

## Evidence on Hand

The intents and current user decisions establish product truth. Approved brand guidance, two local Source Sans 3 files and OFL hashes retain their recorded provenance; no artwork was copied/generated. Shell and Recall screenshots cover desktop, phone, narrow and landscape. Recall inspection/tests use clearly test-owned fixtures, never personal notes. Final independent frontend unit **24**, Recall browser **17/17 in one run**, typecheck/build and technical **Accept** join visual **ship**; prior backend **87** and legacy browser **18** remain valid unchanged. Evidence and verification limits are recorded in the local handoff. Do not manufacture live activity or infer activation from test fixtures.

## Product Principles

- Keep quick capture independent of dashboard choices.
- Preserve ordinary, usable vault files and explicit write boundaries.
- Separate presentation from authoritative business and operation state.
- Make absence of functionality honest; a shell must not imply saved notes, connected services, or live data.
- Keep the four views replaceable without turning the whole application into a plugin framework.

## Open Decisions

No implementation findings remain open for read-only Recall; UI-001/002/003 are independently verified and technically accepted. Real-note local activation and authenticated remote transport remain deployment choices, not implementation blockers. Panel contents, Capture/AI integration, future operation metadata/durability, and later feature order remain undecided. The current Bun daemon/config contract is selected; broader daemon/AI architecture is not. No product-specific accessibility needs were supplied; WCAG 2.2 AA targets do not substitute for actual verification or manual assistive-technology testing.
