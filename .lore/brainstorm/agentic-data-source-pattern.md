---
title: Agentic data source integration pattern for Memory Loop
date: 2026-02-07
status: open
tags: [architecture, integration, mcp, services, pattern]
modules: [session-manager, vault-config]
---

# Brainstorm: Agentic Data Source Pattern

## Context

Memory Loop has stabilized on Next.js + REST + SSE after migrating from Hono + WebSocket. The question now is: as new capabilities get added (email management, project development, unified chat), what's the repeatable pattern for connecting an external agentic service to Memory Loop?

The core model: Memory Loop is the context hub. Vaults are the system of record. External services own their domains completely. MCP is the integration protocol during AI discussions.

## First Pass (Over-Engineered)

Initial exploration assumed Memory Loop needed to:
- Ingest and store events from services into the vault
- Manage tool permissions for external MCP servers
- Build a generic "context bridge" framework

User correction: all three are wrong.

- **Push path is just a notification.** "You got mail." The service holds its own data. Memory Loop doesn't need to ingest, store, or schema-ify anything. It needs to know something is waiting.
- **Tool permissions belong to the service.** The MCP server declares what needs approval. Memory Loop passes it through. Not its problem.
- **Context bridge can't be generic.** The shape of the prompt is per-service. All Memory Loop needs is a place to plug one in later. A hook point, not a framework.

## The Actual Pattern

A new agentic data source integration is four things:

### 1. MCP Server Config

The service exposes an MCP server. Memory Loop registers it when creating a Claude SDK session. Tools become available during discussions. Transcripts capture tool usage automatically. Extraction picks up facts from transcripts on the daily run.

This path works today with zero new code. Add an MCP server to the session options, done.

Config lives in `.memory-loop.json` per vault:

```json
{
  "integrations": {
    "aegis-email": {
      "url": "http://localhost:3001",
      "mcpTransport": "http"
    }
  }
}
```

Per-vault because different vaults serve different purposes. Work vault has email. Personal vault might not.

### 2. Notification Channel

The service tells Memory Loop "something is ready." Memory Loop shows a badge. That's it.

Not a scheduled ingestion pipeline. Not structured events in the vault. Just: "hey user, you should look at this." The notification carries enough to render a badge ("3 unread", "1 urgent") and nothing more. The data stays in the service.

Implementation could be as simple as a polling endpoint or a lightweight push (SSE from service to Memory Loop).

### 3. Frontend Route

Each integration gets a detail view. A route in Next.js that talks to the service directly. Browse emails, manage threads, take actions. This doesn't go through Claude or the vault. It's the service's own UX, hosted in Memory Loop's shell.

Home/Ground view shows notification badges from active integrations. Clicking navigates to the detail route.

### 4. Context Hook (Future)

A place to inject per-service context into discussions. Not designed now. When the first integration needs it, the shape will be obvious. All that's needed is the awareness that the extension point exists.

The concept: Memory Loop knows what the user cares about (from vault context). A context hook lets that knowledge improve how Claude uses a service's MCP tools. "User is focused on the EOS release. Prioritize related email threads."

This is where the flywheel lives, but it's a prompt design problem solved per-service, not a framework problem solved generically.

## Where the Seams Already Exist

| Seam | Current State | Extension |
|------|---------------|-----------|
| `session-manager.ts` mcpServers | Accepts additional servers beyond vault-transfer | Add per-integration MCP servers from vault config |
| `vault-config.ts` | Schema-based with resolve helpers | Add `integrations` field |
| `SessionContext.tsx` AppMode | Extensible union type | Add mode per integration's detail view |
| Home/Ground view | Shows recent notes and discussions | Add notification badges from active integrations |

No scheduler changes needed. No extraction pipeline changes. No note-capture changes.

## The Email Example (Aegis of Focus)

Walking through the pattern:

1. **MCP config**: Vault config registers Aegis at localhost:3001. When a discussion starts, `search_emails`, `get_thread`, `summarize_inbox` are available as tools.
2. **Notification**: Memory Loop polls Aegis status endpoint. Badge on home view: "5 unread, 1 urgent from Daniel re: PS5 timeline."
3. **Detail view**: Email tab in Memory Loop. Full inbox UI talking to Aegis API directly. Read, flag, reply, all through the service.
4. **Context hook** (future): Before a discussion, Memory Loop could inject "user's current priorities" into the session, making email tool usage more relevant. Not built now.

During a discussion, the user says "I'm preparing for Monday's meeting." Claude has vault context about the meeting AND can search emails via Aegis MCP tools. The transcript captures everything. Extraction picks up facts later. The vault gets richer without Memory Loop managing any email data.

## Open Questions

1. **Notification transport**: Polling vs. push? Polling is simpler (service doesn't need to know about Memory Loop). Push (SSE from service) is fresher. Polling is probably fine to start.

2. **Service health**: If an MCP server is unreachable when a discussion starts, proceed without it. But how does the user know? A notice in the UI, or a system message at discussion start?

3. **MCP transport**: stdio for local, HTTP for remote. Support both from the start, or pick one? HTTP is more general.

4. **Auth lifecycle**: Service manages its own auth. Memory Loop needs to surface "your connection to X is broken, re-authenticate there." Part of the notification channel, maybe a special notification type.

## Next Steps

- Build the vault config `integrations` field and wire it into session MCP server registration
- Design the notification polling pattern (simple REST)
- Pick the first real integration and let it drive the detail view and context hook design
