---
title: Next.js migration and WebSocket architecture rethink
date: 2026-02-05
status: resolved
tags: [architecture, next-js, websocket, sse, refactor, claude-sdk]
modules: [websocket-handler, session-manager, backend]
---

# Brainstorm: Next.js Migration and WebSocket Architecture

## Context

The question started as "what steps to convert from Hono to Next.js?" but the real issue surfaced: the problem isn't Hono's lack of opinion, it's that the WebSocket handler architecture is fundamentally wrong.

Hono being lightweight meant every feature required inventing patterns. The accumulation of custom implementations created maintenance burden. But migrating frameworks wouldn't fix the core architectural problem.

## The Real Problem: websocket-handler.ts

The 1400-line WebSocket handler conflates three different connection lifecycles:

1. **WebSocket connection** - Browser <-> Server (can disconnect, reconnect, multiple tabs)
2. **SDK query** - Server <-> Claude (streaming, interruptible, has its own state machine)
3. **Session** - Logical conversation (persisted to disk, survives both of the above)

All jammed into one class with `this.state.activeQuery` (live SDK handle) sitting next to `this.state.currentVault` and `this.state.pendingPermissions`.

### Specific Problems Identified

1. **God object** - Handles vault selection, session lifecycle, message routing, SDK streaming, tool permissions, ask-user-question callbacks, health collection, mock mode, slash commands caching, meeting state

2. **REST migration scar tissue** - Stub functions (`notImplemented`) for handlers that moved to REST. `createContext()` builds a frankenstein deps object. Half the message types commented as "not yet migrated"

3. **State coupling** - `ConnectionState` mixes transport concerns (activeQuery, pendingPermissions) with domain concerns (currentVault, currentSessionId, healthCollector, activeMeeting)

4. **Streaming logic maze** - `streamEvents()` -> `handleStreamEvent()` -> `handleResultEvent()` -> `handleUserEvent()` with maps tracking content blocks, tools, cumulative tokens

5. **Two responsibilities fighting** - Both a message router AND the implementation of those messages in the same class

6. **queryResult is a live SDK connection** - The WebSocket handler holds a live wire to Claude while trying to be everything else

## Key Insight: WebSocket Is Unnecessary

ChatGPT and Claude web use **Server-Sent Events (SSE)**, not WebSocket.

### What WebSocket Provides
- Bidirectional: server and client can send at any time

### What We Actually Need
- **Server → Client**: Streaming AI responses (SSE handles this)
- **Client → Server during stream**: Permission responses, answers, abort

The mid-stream interactions can be **regular POST requests**. The server holds pending promises; POST endpoints resolve them. No WebSocket required.

### Why SSE + REST Is Better

| Concern | WebSocket | SSE + REST |
|---------|-----------|------------|
| Streaming | Custom handling | Native browser API |
| Reconnection | Built it ourselves | Built into EventSource |
| Mid-stream interaction | Complex state management | Simple POST resolves promise |
| Proxy/firewall support | Often blocked | Standard HTTP |
| Next.js compatibility | Requires custom server | Route Handlers work natively |
| Testing | Mock WebSocket lifecycle | Mock fetch |

## Target Architecture: SSE + REST

### Endpoints

```
POST   /api/chat                    Start conversation, returns SSE stream
POST   /api/chat/:sessionId/resume  Continue conversation, returns SSE stream
POST   /api/chat/:sessionId/abort   Cancel in-progress query
POST   /api/chat/:sessionId/permission/:toolUseId   Respond to tool permission
POST   /api/chat/:sessionId/answer/:toolUseId       Respond to AskUserQuestion

GET    /api/vaults                  List vaults (already REST)
POST   /api/vaults                  Create vault (already REST)
GET    /api/sessions/:vaultId       List sessions for vault
```

### Flow

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ Browser │                    │  Server │                    │  Claude │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │ POST /api/chat               │                              │
     │ {vaultId, message}           │                              │
     │────────────────────────────►│                              │
     │                              │ sdk.query(message)           │
     │                              │─────────────────────────────►│
     │                              │                              │
     │◄─────── SSE stream ─────────│◄──── streaming events ───────│
     │ event: response_start       │                              │
     │ event: chunk                │                              │
     │                              │                              │
     │ event: permission_request   │◄─ tool wants permission ─────│
     │ {toolUseId: "abc"}          │        (SDK paused)          │
     │                              │                              │
     │ POST /permission/abc        │                              │
     │ {allowed: true}             │                              │
     │────────────────────────────►│                              │
     │◄─────── 200 OK ─────────────│                              │
     │                              │─── resolve callback ────────►│
     │                              │        (SDK resumes)         │
     │                              │                              │
     │◄─────── SSE continues ──────│◄──── more events ────────────│
     │ event: response_end         │                              │
```

### Server-Side Components

**ActiveSessionStore** - Holds state for in-progress streams:
```typescript
interface ActiveSession {
  vaultId: string;
  query: Query | null;  // Live SDK connection
  pendingPermissions: Map<string, PromiseWithResolvers<boolean>>;
  pendingQuestions: Map<string, PromiseWithResolvers<Record<string, string>>>;
  aborted: boolean;
}
```

**SDK Session Manager** - Owns SDK lifecycle, yields events as async iterable:
```typescript
class SdkSessionManager {
  async *stream(vault: VaultInfo, prompt: string): AsyncGenerator<ProtocolEvent>;
  resolvePermission(toolUseId: string, allowed: boolean): void;
  resolveAnswer(toolUseId: string, answers: Record<string, string>): void;
  abort(): void;
}
```

### Client-Side

Replace `useWebSocket` hook with `useChat`:
```typescript
function useChat() {
  const sendMessage = async (vaultId: string, text: string) => {
    const response = await fetch('/api/chat', { ... });
    // Process SSE stream
  };

  const respondToPermission = async (toolUseId: string, allowed: boolean) => {
    await fetch(`/api/chat/${sessionId}/permission/${toolUseId}`, { ... });
  };

  return { messages, sendMessage, respondToPermission, ... };
}
```

## Migration Path: Strangler Fig

Build the new system alongside the old, then switch over.

### Phase 1: Extract SDK Session Manager (1-2 days)
Pull SDK interaction logic out of `websocket-handler.ts` into standalone module. Pure refactor, no behavior change. WebSocket still works.

### Phase 2: Create Next.js SSE Endpoints (2-3 days)
New Next.js app with SSE endpoints using extracted SDK session manager. Test with curl.

### Phase 3: Migrate Frontend Components (3-5 days)
Port React components to Next.js. Replace `useWebSocket` with `useChat`. Port one at a time: HomeView → BrowseMode → NoteCapture → Discussion.

### Phase 4: Parallel Testing (1-2 days)
Run both systems. Validate new system thoroughly before switching.

### Phase 5: Switch & Cleanup (1 day)
Update launch scripts and systemd service. Delete old code.

**Total: ~10-14 days focused work**

### What Stays, What Goes

| Keep | Transform | Delete |
|------|-----------|--------|
| `shared/` Zod schemas | SDK session logic → standalone module | `websocket-handler.ts` |
| Business logic (vault-manager, note-capture, file-browser) | React components → Next.js pages | Hono server setup |
| Session persistence | `useWebSocket` → `useChat` (SSE) | Custom WebSocket reconnect |
| Claude SDK integration | REST routes → Next.js API routes | Vite config |

## Resolution

The path forward is clear:
1. Extract SDK session manager as clean module
2. Build Next.js app with SSE + REST architecture
3. Migrate frontend components
4. Switch over and delete old code

This resolves the original question ("how to migrate to Next.js") by first fixing the underlying architecture problem (WebSocket complexity) and choosing the right transport (SSE) that aligns with Next.js's strengths.
