---
title: "Guild Hall Daemon REST API (reference design, not Memory Loop)"
date: 2026-03-13
status: reference
tags: [architecture, daemon, rest-api, cli, discovery, skills, guild-hall, external-reference]
source-project: guild-hall
modules: [daemon, cli, web]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/brainstorm/daemon-migration-stages.md
note: >
  This design was written for the Guild Hall project, not Memory Loop.
  It is stored here as reference material for Memory Loop's daemon API design.
  All references to "Guild Hall", workers, commissions, meetings, toolboxes,
  and skills describe Guild Hall's domain, not Memory Loop's.
  Memory Loop should adapt patterns (capability-oriented URLs, help discovery,
  streaming conventions, error formats) without adopting Guild Hall's domain model.
---

# Design: Daemon REST API (Guild Hall Reference)

> **Source:** Guild Hall project. This document describes Guild Hall's daemon API design.
> It is kept here as reference material for Memory Loop's daemon API conventions.
> Guild Hall concepts (workers, commissions, meetings, toolboxes, skills, coordination)
> are Guild Hall domain terms and do not map directly to Memory Loop.
> See `.lore/specs/daemon-application-boundary.md` for Memory Loop's own daemon spec.

## Problem

Guild Hall's current daemon API is a conventional collection of feature routes such as `/meetings`, `/commissions`, and `/workers`. That shape is serviceable for implementation, but it is not the right public contract for the target architecture where progressive discovery starts at the daemon boundary and the CLI becomes a thin translation layer over the same capability model.

The target architecture says the daemon is the application, the web and CLI are clients of that application, and agents should interact through daemon-governed skills with CLI semantics. The REST API therefore needs to become a discoverable capability surface rather than a bag of ad hoc feature routes.

## Goals

- Make the daemon REST API the canonical capability catalog for Guild Hall.
- Support progressive discovery through the API itself.
- Align human and agent interaction around the same named capabilities.
- Let the CLI map directly onto daemon capabilities rather than inventing its own command model.
- Prefer a stable capability grammar over backward compatibility with current route shapes.

## Non-Goals

- Preserving current route paths for compatibility.
- Defining every endpoint payload in this document.
- Reproducing daemon-internal toolbox wiring in the public API one-for-one.
- Turning the design into an implementation plan.

## Design Summary

The public daemon API is organized as:

`/<toolbox>/<feature>/<object>/<operation>`

This is a capability-oriented HTTP API, not a classic resource-oriented REST design. The path identifies a discoverable skill contract. HTTP is the transport. The daemon owns the authoritative meaning of each capability.

In this document, the first segment is still called `toolbox` to match the intended URL grammar, but conceptually it is a **public capability root**, not a projection of a daemon-internal toolbox.

Progressive discovery is built into the hierarchy through standard `help` operations:

- `GET /help`
- `GET /<toolbox>/help`
- `GET /<toolbox>/<feature>/help`
- `GET /<toolbox>/<feature>/<object>/help`
- `GET /<toolbox>/<feature>/<object>/<operation>/help`

The CLI should mostly translate user commands into these daemon capability paths plus arguments.

## Key Decisions

### 1. Public API toolboxes are not identical to daemon-internal toolboxes

The existing internal toolbox model is useful inside daemon-managed worker execution, but it is the wrong level of abstraction for the public API. Public API toolboxes should be shaped around discoverable application capabilities, not around implementation artifacts.

In particular:

- `base` stays internal.
- `system` is a public root for daemon/runtime/application concerns.
- `workspace` is a public root for project-scoped work such as git/worktrees, lore artifacts, and other workspace-owned operations.
- Existing public-facing domains such as `meeting` and `commission` remain sensible public roots, while role-shaped or mechanism-shaped names should be normalized into more durable public domains.
- Domain capability sets become public roots in their own right when they expose application capabilities. They should not be hidden behind a generic `/domain/...` prefix unless there is a strong multi-tenant naming reason later.

This keeps the public surface legible while preserving freedom to reorganize internal daemon tool composition.

### 2. `help` is the canonical discovery primitive

Progressive discovery should not depend on out-of-band docs. Every layer of the API hierarchy should answer "what exists here?" through a standard `help` operation.

This makes discovery uniform for:

- humans via CLI
- web clients building navigation
- daemon-managed agents
- automated tooling

`GET /help` is the canonical machine-readable discovery root for the whole public API. Clients may traverse recursively through child links; no separate discovery authority should exist outside the `help` hierarchy.

### 3. The path identifies the capability; arguments carry instance context

The capability path should stay stable and descriptive. Instance identifiers, workspace names, artifact paths, filters, and options should usually live in the query string or request body rather than being embedded deeply into the path.

The preferred grammar is four segments, but the API should not force artificial filler nouns. If the `object` segment would merely repeat the toolbox or feature, or would add no meaningful distinction, it may collapse away. The rule is clarity first, slot-count second.

Examples:

- `POST /workspace/artifact/document/read`
- `POST /workspace/git/branch/rebase`
- `POST /commission/run/dispatch`
- `POST /meeting/session/message/send`

with request bodies such as:

```json
{
  "workspace": "guild-hall",
  "commissionId": "abc123"
}
```

This gives the API a clearer capability grammar and keeps discovery from being buried in parameterized path templates.

### 4. One capability contract, many clients

The daemon owns one capability contract for each skill: name, description, invocation method, argument schema, output schema, side effects, and context rules. The CLI, web, and agents are different presentations of that same underlying contract.

That means:

- the CLI should not have privileged commands with no daemon equivalent
- the web should not depend on hidden daemon-only routes
- agents should not get direct application callbacks that bypass the capability contract

Each skill must also have a stable `skillId` owned by the daemon. Paths and transport details may evolve, but `skillId` is the durable identity used by discovery metadata, CLI mapping, and future deprecation/version handling.

### 5. Public roots must be durable application domains

Public capability roots should be named for stable application domains, not for internal roles, actors, or implementation mechanisms.

Guardrails:

- prefer nouns that describe user-visible application areas
- avoid names that expose daemon-internal decomposition
- avoid roots named after one actor when multiple actors can invoke the same capability
- avoid roots that are likely to be renamed if internal orchestration changes

This is why the public API should prefer roots like `coordination` or `communication` over internal names like `manager` when the capability itself is broader than the worker role that often invokes it.

## Public Capability Root Taxonomy

The initial public capability root set should be:

### `system`

System-level concerns not tied to a single project workspace.

Candidate features:

- `runtime`
- `models`
- `packages`
- `config`
- `events`

Examples:

- `GET /system/runtime/daemon/health`
- `GET /system/models/catalog/list`
- `POST /system/config/application/reload`
- `GET /system/events/stream/subscribe`

### `workspace`

Project-scoped operations that act on a registered workspace and its owned assets.

Candidate features:

- `artifact`
- `git`
- `memory`
- `project`

Examples:

- `POST /workspace/artifact/document/read`
- `POST /workspace/artifact/document/write`
- `POST /workspace/git/branch/rebase`
- `POST /workspace/git/integration/sync`
- `GET /workspace/project/registry/list`

This is where today's direct `.lore/` and git-style operations should land in the future architecture.

### `meeting`

Interactive session capabilities.

Candidate features:

- `request`
- `session`
- `message`

Examples:

- `POST /meeting/request/meeting/create`
- `POST /meeting/request/meeting/accept`
- `POST /meeting/request/meeting/decline`
- `POST /meeting/request/meeting/defer`
- `POST /meeting/session/message/send`
- `POST /meeting/session/generation/interrupt`
- `POST /meeting/session/meeting/close`

### `commission`

Autonomous work capabilities.

Candidate features:

- `request`
- `run`
- `schedule`
- `dependency`

Examples:

- `POST /commission/request/commission/create`
- `POST /commission/request/commission/update`
- `POST /commission/request/commission/note`
- `POST /commission/run/dispatch`
- `POST /commission/run/redispatch`
- `POST /commission/run/cancel`
- `POST /commission/run/abandon`
- `POST /commission/schedule/commission/update`
- `POST /commission/dependency/project/check`

### `coordination`

Coordination capabilities that are user-visible and may often be invoked by the Guild Master, but are not named after that role in the public API.

Candidate features:

- `planning`
- `dispatch`
- `review`
- `pull-request`

Examples:

- `POST /coordination/dispatch/commission/create`
- `POST /coordination/dispatch/commission/start`
- `POST /coordination/review/briefing/read`
- `POST /coordination/pull-request/change/create`

### `communication`

Communication capabilities when worker-to-worker or system messaging is part of the public application surface.

Candidate features:

- `message`
- `thread`
- `inbox`

Examples:

- `POST /communication/message/thread/send`
- `POST /communication/inbox/message/list`

### Domain roots

A domain capability set that becomes part of the application's discoverable capability surface should receive its own top-level root name.

Examples:

- `/calendar/...`
- `/code/...`
- `/research/...`

The rule is simple: if the capability is part of the application surface, it deserves a first-class namespace.

## `help` Response Model

Each `help` endpoint should return structured metadata, not just prose.

Minimum fields:

```json
{
  "skillId": "workspace.artifact.document",
  "version": "1",
  "path": "/workspace/artifact/document",
  "kind": "object",
  "name": "document",
  "description": "Operations for reading and writing lore documents in a workspace.",
  "visibility": "available",
  "children": [
    {
      "skillId": "workspace.artifact.document.read",
      "name": "read",
      "method": "POST",
      "path": "/workspace/artifact/document/read",
      "summary": "Read a document from a workspace by relative lore path."
    },
    {
      "skillId": "workspace.artifact.document.write",
      "name": "write",
      "method": "POST",
      "path": "/workspace/artifact/document/write",
      "summary": "Write a document in a workspace."
    }
  ]
}
```

At the operation level, `help` must additionally expose:

- `skillId`
- version
- deprecation status when relevant
- request schema
- response schema
- error schema
- whether the operation streams
- streaming protocol/schema when relevant
- required context fields
- side-effect summary
- idempotency hint
- eligibility or visibility metadata
- examples

This metadata is the canonical source for CLI help text and for any future web-based capability browser.

## HTTP Method Guidance

Even though the API is capability-oriented, HTTP methods should still signal intent:

- `GET` for pure discovery and non-mutating reads with simple arguments
- `POST` for capability invocation, especially when context lives in the body
- streaming operations may use `GET` or `POST`, but the `help` metadata must make streaming explicit

In practice, most non-trivial operations will be `POST` because Guild Hall capabilities usually need structured context such as workspace name, artifact path, meeting ID, commission ID, worker name, or model selection.

Each skill has exactly one canonical invocation contract in discovery metadata. If transport aliases exist for practical reasons, they are aliases of that skill rather than distinct public capabilities.

## Streaming Convention

All streaming operations use Server-Sent Events with a consistent wire format:

- Events are sent as unnamed SSE messages (no `event:` header). The event type is a `type` field inside the JSON payload.
- Each SSE frame contains `data: <JSON>` where the JSON object always has a `type` string discriminator.
- Errors during streaming are sent as `{ "type": "error", "reason": "..." }` in the same stream, not as HTTP error responses.
- Streams end by closing the connection after a terminal event (e.g., `turn_end` for meetings, or client disconnect for event subscriptions).

This matches the current implementation, which uses two event families: meeting session events (`session`, `text_delta`, `tool_use`, `tool_result`, `turn_end`, `error`) and system events (`commission_status`, `meeting_started`, etc.). The `type` discriminator is the only dispatching mechanism; clients switch on it to handle each event kind.

When help metadata declares `"streaming": true`, the `streamingSchema` field should list the `type` values the client can expect from that operation.

## Examples

### API root discovery

`GET /help`

Returns the list of public capability roots and a short description of each.

### Discover workspace capabilities

`GET /workspace/help`

Returns child features such as `artifact`, `git`, `memory`, and `project`.

### Discover artifact operations

`GET /workspace/artifact/document/help`

Returns operations such as `read`, `write`, `list`, `move`, `delete`, each with summary metadata.

### Invoke artifact read

`POST /workspace/artifact/document/read`

```json
{
  "workspace": "guild-hall",
  "path": ".lore/specs/infrastructure/guild-hall-system.md"
}
```

### Discover meeting operations

`GET /meeting/session/help`

Returns objects such as `message`, `generation`, and `meeting`.

### Invoke message send

`POST /meeting/session/message/send`

```json
{
  "meetingId": "meeting-123",
  "message": "Please summarize the trade-offs."
}
```

## Mapping from Current API

The current route set maps roughly as follows:

- `/health` -> `/system/runtime/daemon/health`
- `/models` -> `/system/models/catalog/list`
- `/events` -> `/system/events/stream/subscribe`
- `/workers` -> `/system/packages/worker/list`
- `/briefing/:projectName` -> `/coordination/review/briefing/read`
- `/meetings` -> `/meeting/request/meeting/create`
- `/meetings/:id/messages` -> `/meeting/session/message/send`
- `/meetings/:id/accept` -> `/meeting/request/meeting/accept`
- `/meetings/:id/decline` -> `/meeting/request/meeting/decline`
- `/meetings/:id/defer` -> `/meeting/request/meeting/defer`
- `/meetings/:id/interrupt` -> `/meeting/session/generation/interrupt`
- `DELETE /meetings/:id` -> `/meeting/session/meeting/close`
- `/commissions` -> `/commission/request/commission/create`
- `/commissions/:id` (PUT) -> `/commission/request/commission/update`
- `DELETE /commissions/:id` -> `/commission/run/cancel`
- `/commissions/:id/dispatch` -> `/commission/run/dispatch`
- `/commissions/:id/redispatch` -> `/commission/run/redispatch`
- `/commissions/:id/abandon` -> `/commission/run/abandon`
- `/commissions/:id/note` -> `/commission/request/commission/note`
- `/commissions/:id/schedule-status` -> `/commission/schedule/commission/update`
- `/commissions/check-dependencies` -> `/commission/dependency/project/check`
- `/admin/reload-config` -> `/system/config/application/reload`

This is intentionally a conceptual mapping, not a promise to preserve old URLs or exact semantics.

### Web routes that bypass the daemon

Two Next.js API routes currently perform application-state operations without going through the daemon, which are boundary violations under REQ-DAB-3:

- `PUT /api/artifacts` writes artifact content directly to the integration worktree filesystem and commits via git. Target: `/workspace/artifact/document/write` with the daemon owning the write and commit.
- `POST /api/meetings/[meetingId]/quick-comment` is a compound action that creates a commission from meeting context and declines the meeting. It reads meeting artifacts from the filesystem and coordinates two daemon calls. Target: either a dedicated `/coordination/dispatch/quick-comment` skill or decomposition into existing daemon skills with the compound logic moved server-side.

These are transitional adapters per REQ-DAB-15. They should be replaced by daemon-owned skills as the API migration progresses, not deepened with additional filesystem logic.

## Trade-Offs

### Benefits

- Strong progressive discovery story
- Cleaner alignment between daemon, CLI, web, and agent usage
- Stable public capability names independent of internal daemon refactors
- Better fit for skill-oriented application design than ad hoc feature routes

### Costs

- Less idiomatic than classic REST resource naming
- More route segments per operation
- Requires the daemon to maintain high-quality capability metadata
- Forces explicit thinking about public namespace boundaries

## Resolved Questions

### Metadata: explicit, co-located with handlers

Capability metadata should be written explicitly alongside route handlers, not generated by introspecting registered routes. The current codebase has zero machine-readable metadata (only JSDoc comments), so there is nothing to introspect. Explicit metadata keeps the source of truth next to the code and is verifiable by review. Existing Zod schemas used for request validation can be reused as the request/response descriptions in help metadata.

The route factory pattern already supports this: factories currently return a `Hono` instance and can be extended to return metadata alongside it.

### Discovery: `help` is canonical, catalog is a convenience

`help` at every hierarchy level is the canonical discovery mechanism. It returns structured JSON, so it is already machine-readable. A flat catalog endpoint (`GET /catalog` or similar) that lists all capabilities without traversal is a valid convenience projection of the same data, not a separate discovery authority. It should be added when a client needs it, not preemptively.

### Worker/package discovery: `system/packages`

Worker and package discovery lives under `system/packages/...`. Workers are installed infrastructure, not a user-facing application domain like meetings or commissions. The `system` root already lists `packages` as a candidate feature, and packages include both workers and toolboxes. A dedicated `worker/...` root would overweight one package type and create a naming asymmetry with toolboxes.

### Streaming discovery: through `help`, not a separate endpoint

Streaming is an attribute of individual operations, not a separate discovery concern. The help metadata for each operation already includes `streaming` (boolean) and `streamingSchema` fields. All Guild Hall streaming operations should use a consistent SSE event format, documented once in this design. That consistency is a convention enforced by implementation, not a separate endpoint to query.

## Recommendation

Adopt the capability-oriented path grammar:

`/<toolbox>/<feature>/<object>/<operation>`

with `help` as a mandatory operation at every hierarchy level.

Start with these public capability roots:

- `system`
- `workspace`
- `meeting`
- `commission`
- `coordination`
- `communication`
- first-class domain toolbox names as needed

Keep `base` internal. Treat `.lore/`, git, config, and runtime concerns as daemon-owned capabilities surfaced through `workspace` and `system`, not as direct client access.
