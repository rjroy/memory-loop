---
title: Daemon application boundary
date: 2026-03-13
status: implemented
tags: [architecture, daemon, cli, web, agents, skills, unix-socket]
modules: [daemon, web, cli]
related:
  - .lore/specs/infrastructure/guild-hall-system.md
  - .lore/specs/workers/guild-hall-workers.md
  - .lore/specs/workers/worker-domain-plugins.md
  - .lore/research/agent-native-applications.md
  - .lore/research/daemon-rest-api.md
req-prefix: DAB
---

# Spec: Daemon Application Boundary

## Overview

Guild Hall's target architecture treats the daemon as the application. The daemon owns stateful operations and exposes the application's capability surface as REST over a Unix socket. The web layer, CLI, and daemon-managed agents are all clients of that boundary. This spec records that future truth without rewriting current-state specs that describe the system as it exists today.

## Entry Points

- Architecture work needs a clear statement of what counts as the application boundary (from `CLAUDE.md`)
- A new capability is added and must be exposed consistently to humans and agents (from `.lore/research/agent-native-applications.md`)
- Worker execution needs to act on Guild Hall state without creating a separate privileged surface (from [Spec: guild-hall-workers](../workers/guild-hall-workers.md))

## Requirements

- REQ-DAB-1: The daemon is Guild Hall's application runtime and authority boundary. Stateful operations, durable state transitions, and machine-local runtime state are owned by the daemon even when other processes initiate them.

- REQ-DAB-2: Guild Hall's application API is REST over the daemon's Unix socket. Other transports may proxy to this API, but application clients do not define alternate authority paths around the daemon.

- REQ-DAB-3: The web layer is a user experience client, not a parallel application runtime. Web reads and writes that depend on Guild Hall application state must flow through the daemon API rather than reaching into application-owned storage directly.

- REQ-DAB-4: The CLI is a first-class user experience client of the daemon API. CLI commands provide progressive discovery of Guild Hall capabilities and use the same application boundary as other clients.

- REQ-DAB-5: Progressive discovery is an architectural invariant. Capability names, descriptions, and invocation concepts should converge across CLI, web, and agent usage so that humans and agents encounter the same application shape even when their interfaces differ.

- REQ-DAB-6: The daemon can spawn and manage specialist agent sessions. Where those sessions run is an implementation detail; lifecycle ownership, context injection, and side-effect mediation belong to the daemon boundary.

- REQ-DAB-7: Agents interact with the Guild Hall application only through daemon-governed skills with CLI semantics: named capabilities, stable invocation paths, structured arguments, and machine-readable discovery. Agents do not receive a separate privileged application surface that bypasses the daemon's client boundary.

- REQ-DAB-8: A skill is the shared application-facing unit of capability for humans and agents. A skill is a daemon-owned capability contract with a stable name, description, invocation shape, and context rules, defined in terms of an application outcome rather than an internal callback or storage detail. An existing Claude Code plugin skill (SKILL.md) is not itself this contract; it is one way the contract may be projected into an agent session. The daemon-owned contract is the parent concept, and its metadata is defined at the daemon level.

- REQ-DAB-9: The daemon owns canonical skill metadata and discovery. CLI, web, and agent-facing projections may render that metadata differently, but they discover the same underlying skill contract from the daemon rather than inventing parallel capability models.

- REQ-DAB-10: A given application capability has one daemon-governed invocation contract regardless of caller. CLI, web, and agent invocations resolve context, validate inputs, and apply eligibility rules through the same daemon-owned contract even when their presentation differs.

- REQ-DAB-11: Internal tools, toolboxes, SDK integrations, and callbacks may exist inside daemon-managed execution as implementation mechanisms, but they are not the public application boundary. New application capabilities must be expressible as skills even when their implementation uses internal tools.

- REQ-DAB-12: Human-agent parity applies at the application boundary. Any application outcome exposed to humans through the web or CLI should be representable to agents through the same daemon-governed skill surface, and any agent-usable application capability should be discoverable in human-facing surfaces.

- REQ-DAB-13: The daemon's five concerns are internal decomposition rules, not competing application boundaries. Session, Activity, Artifact, Toolbox, and Worker remain useful internal separations within the daemon while the daemon itself remains the external application boundary.

- REQ-DAB-14: Migration toward this architecture must reduce boundary bypasses rather than deepen them. New work should move capability exposure toward daemon API calls and shared skills rather than creating new client-side authority paths.

- REQ-DAB-15: Migration guidance belongs in principles, not in shadow implementations. Temporary adapters are acceptable when they preserve parity and move clients toward the daemon boundary, but they must be understood as transitional rather than architectural end state.

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Daemon route and payload details | Need the concrete REST resource model, request/response shapes, and streaming rules | [Design: daemon-rest-api](../../design/daemon-rest-api.md) |
| CLI discovery and invocation UX | Need the exact command grammar and discovery model for daemon capabilities | [Spec: cli-progressive-discovery](cli-progressive-discovery.md) |
| Worker package and runtime model | Need worker metadata, runtime configuration, and internal tool resolution | [Spec: guild-hall-workers](../workers/guild-hall-workers.md) |
| Meetings and commissions | Need orchestration rules for interactive and autonomous daemon-managed work | [Spec: guild-hall-commissions](../commissions/guild-hall-commissions.md) |

## Success Criteria

- [ ] The daemon is stated as the sole application boundary in architecture docs for future-state work
- [ ] The spec clearly distinguishes current implementation from target architecture
- [ ] Web is defined as a client of the daemon API rather than a parallel filesystem-facing runtime
- [ ] CLI is defined as a first-class daemon client with progressive discovery
- [ ] Agent interaction is defined in terms of CLI-shaped skills rather than a separate privileged surface
- [ ] Skills are distinguished from internal tools and toolboxes
- [ ] Human-agent parity is stated as an application-boundary invariant
- [ ] The daemon serves canonical capability metadata; clients discover skills from the daemon rather than from static client-side configuration
- [ ] Migration principles are documented without turning this spec into an implementation plan
- [ ] New work governed by this spec does not introduce client-side authority paths that bypass the daemon API

## AI Validation

This is a target-architecture spec with no implementation deliverable. Standard test defaults do not apply.

**Validation approach:**
- Implementing work governed by this spec must satisfy the standard defaults (unit tests, 90%+ coverage, fresh-context review)
- Each implementing spec or plan must verify that no new client-side authority paths were introduced
- The spec itself is validated by its success criteria and by fresh-context spec review

## Constraints

- This spec defines the target architecture, not the currently implemented behavior.
- This spec does not define rollout order, endpoint catalogs, or transport payload formats.
- This spec does not prohibit daemon-internal SDK tools or toolbox implementations as long as they do not replace the public application boundary.
- Files, git worktrees, and machine-local state remain part of Guild Hall's storage model, but this spec treats them as daemon-owned infrastructure rather than direct client surfaces.
- This spec uses "skill" to mean a daemon-owned application capability contract. Claude Code plugin skills may be one projection or implementation vehicle during transition, but they are not the canonical architectural definition on their own.

## Context

- `CLAUDE.md` currently documents the five concerns and the present system shape. This spec adds the stronger boundary statement that those concerns are internal to the daemon rather than alternative surfaces.
- `.lore/specs/infrastructure/guild-hall-system.md` defines the current system primitives, storage model, and package architecture. It still reflects the current file-first and direct-edit parity model.
- `.lore/specs/workers/guild-hall-workers.md` defines worker packages, toolbox resolution, and SDK runtime behavior. This spec does not replace that model; it constrains how application-facing capability should be exposed and treats current toolboxes as daemon-internal mechanisms rather than the long-term application contract.
- `.lore/specs/workers/worker-domain-plugins.md` shows that skills already exist as a concept in the codebase. In this architecture, plugin skills are one possible projection of the daemon-owned skill contract rather than the contract itself.
- `.lore/research/agent-native-applications.md` contributes the parity and progressive discovery principles, but this spec redirects them from MCP-shaped tooling toward a daemon-owned CLI skill surface.
- Lore survey findings for this spec: current documentation still describes the web as reading from the filesystem, the CLI as performing direct filesystem and git operations outside the daemon API, and direct file editing as a parity mechanism. Those documents are intentionally left as current-state references while this spec records the target direction and supersedes that direct-edit parity model for future-state architecture.
