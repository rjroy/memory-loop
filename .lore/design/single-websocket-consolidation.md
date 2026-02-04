---
title: Single WebSocket Consolidation
date: 2026-02-03
status: draft
tags: [websocket, architecture, rest-api, migration]
modules: [websocket-handler, app, discussion, session-context]
related: [.lore/specs/session-viewport-separation.md, .lore/reference/_infrastructure/communication-layer.md]
---

# Design: Single WebSocket Consolidation

## Problem

Currently, multiple components create independent WebSocket connections to `/ws`:

1. **MainContent** (App.tsx) - for vault selection, health reports
2. **Discussion** - for AI streaming
3. **VaultSelect** - for vault list, creation
4. **HealthPanel** - for health reports

This causes:
- **Duplicate subscriptions**: Both connections subscribe to ActiveSessionController
- **Race conditions**: If one reconnects during streaming, both receive events
- **Double processing**: Same messages processed by multiple components
- **Wasted resources**: Multiple connections when one would suffice

The recent session-viewport separation work exposed these issues: reconnecting one WebSocket during streaming adds a duplicate subscriber, causing "FourFour score and seven years" duplicates.

## Constraints

- AI streaming MUST use WebSocket (real-time text chunks)
- Tool invocations MUST use WebSocket (interactive approval flow)
- Most other operations have already migrated to REST
- Must not regress existing functionality
- VaultSelect is rendered before vault is selected (needs vault list)

## Approaches Considered

### Option 1: Shared WebSocket via Props

Pass WebSocket connection from a single owner (e.g., App) to all children via props.

**Pros:**
- Clear ownership
- No duplicate connections

**Cons:**
- Prop drilling through many layers
- Components tightly coupled to parent
- VaultSelect, Discussion, PairWritingMode all need props wired

### Option 2: WebSocket Context Provider

Create a WebSocket context that all components access.

**Pros:**
- No prop drilling
- Single source of truth

**Cons:**
- Still one connection doing everything
- Components implicitly depend on context
- Hard to test components in isolation

### Option 3: REST Migration + Single AI WebSocket

Migrate remaining non-streaming operations to REST. Only Discussion creates a WebSocket.

**Pros:**
- Clean separation: REST for CRUD, WebSocket for streaming only
- Follows existing migration pattern
- Components use standard fetch/hooks for non-streaming
- Discussion fully owns its WebSocket
- Easier testing (mock fetch, not WebSocket)

**Cons:**
- Requires REST endpoints for vault list, health
- One-time migration effort

## Decision

**Option 3: REST Migration + Single AI WebSocket**

This aligns with the existing migration direction documented in the communication layer reference. Most operations are already REST. The remaining WebSocket usage in MainContent/VaultSelect is vestigial.

### What Moves to REST

| Operation | Current | New Endpoint |
|-----------|---------|--------------|
| Vault list | WebSocket `vault_list` | `GET /api/vaults` (already exists!) |
| Vault selection context | WebSocket `select_vault` | Not needed - REST is stateless |
| Health reports | WebSocket `health_report` | `GET /api/vaults/:id/health` (polling) |
| Vault creation | WebSocket `create_vault` | `POST /api/vaults` (new) |
| Extraction prompt | WebSocket `get/save/reset_extraction_prompt` | `GET/PUT/DELETE /api/vaults/:id/extraction-prompt` |
| Card generator config | WebSocket `get/save_card_generator_config` | REST (already partially there) |

### What Stays on WebSocket

Only Discussion's AI streaming:
- `discussion_message` / `response_*`
- `tool_*` events
- `tool_permission_*` / `ask_user_question_*`
- `abort`
- `session_ready` (for message history on resume)
- `resume_session` / `new_session`

## Interface/Contract

### Frontend Changes

**App.tsx / MainContent:**
- Remove `useWebSocket()` call entirely
- Remove message handler effect
- Vault selection: Already using REST via existing hook patterns
- Health: Use `useHealth(vaultId)` hook with polling

**VaultSelect:**
- Use `GET /api/vaults` for vault list
- Use `POST /api/vaults` for creation
- No WebSocket needed

**Discussion:**
- Owns sole WebSocket connection
- Unchanged from current implementation
- No more `isSharedConnection` complexity

**PairWritingMode:**
- Receives WebSocket props from BrowseMode (which gets them from Discussion)
- Or: PairWritingMode embeds Discussion, Discussion owns WebSocket

### Backend Changes

**New REST endpoints:**
```
POST /api/vaults
  Body: { title: string }
  Response: VaultInfo

GET /api/vaults/:vaultId/health
  Response: { issues: HealthIssue[] }
```

**WebSocket handler simplification:**
- Remove vault_list send on connect
- Remove select_vault for context (REST handles vault-scoped requests)
- Keep all AI/streaming message types

### Health Polling

Health currently pushes via WebSocket. Options:
1. **Polling**: `GET /health` every 30s
2. **On-demand**: Check health when entering relevant UI
3. **SSE**: Server-sent events for push without full WebSocket

Recommendation: **Polling** (simplest, health issues are not time-critical)

## Edge Cases

1. **Vault creation during AI streaming**: User creates vault in another tab. REST handles this independently of WebSocket. No conflict.

2. **Health check while streaming**: REST health endpoint is independent. No conflict.

3. **Discussion reconnect**: Only one WebSocket exists. Reconnect resubscribes. No duplicate listeners since no other WebSocket exists.

4. **VaultSelect rendered without vault**: VaultSelect fetches vault list via REST. No WebSocket dependency. Simpler component.

5. **PairWritingMode needs WebSocket**: BrowseMode renders PairWritingMode when file is opened for editing. Options:
   - BrowseMode has its own WebSocket when PairWritingMode active
   - PairWritingMode embeds Discussion (Discussion owns WebSocket)

   Recommendation: PairWritingMode embeds Discussion. Discussion's WebSocket handles everything.

## Migration Order

1. Add `GET /api/vaults/:vaultId/health` REST endpoint
2. Add `POST /api/vaults` REST endpoint
3. Create `useVaults()` hook using existing `GET /api/vaults`
4. Update VaultSelect to use REST
5. Create `useHealth(vaultId)` polling hook
6. Update App.tsx to remove WebSocket, use health hook
7. Remove MainContent's `handleServerMessage` for non-streaming types
8. Clean up WebSocket handler (remove vestigial message types)

## Open Questions

1. **Extraction prompt and Card generator**: These are still on WebSocket. Should they migrate as part of this work or separately? (Recommendation: Separately, to reduce scope)

2. **Health polling interval**: 30 seconds? 60 seconds? Configurable?
