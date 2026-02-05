---
title: Next.js + SSE Migration Plan
date: 2026-02-05
status: draft
tags: [migration, next-js, sse, websocket, architecture]
modules: [websocket-handler, session-manager, frontend]
related:
  - .lore/brainstorm/next-js-migration.md
  - .lore/specs/session-viewport-separation.md
  - .lore/design/active-session-controller.md
---

# Plan: Next.js + SSE Migration

## Spec Reference

Read first: `.lore/specs/session-viewport-separation.md`

Key requirements this plan must satisfy:
- REQ-6: WebSocket handler contains no AI state
- REQ-1: Active session persists when connection disconnects
- REQ-3: Pending prompts wait until discarded (no timeout)

The existing spec and design documents define an `ActiveSessionController` interface that aligns with our SSE architecture. This plan implements that interface.

## Overview

Replace WebSocket streaming with SSE + REST. Migrate from Hono to Next.js App Router.

**Why SSE over WebSocket:**
- ChatGPT and Claude web use SSE, not WebSocket
- Mid-stream interactions (permissions, answers) are POST requests resolving server-side promises
- Next.js Route Handlers support SSE natively
- Built-in browser reconnection via EventSource

## Phase 1: Extract Streaming Logic (Backend)

**Goal:** Create transport-agnostic module that both WebSocket and SSE can use.

### 1.1 Create ActiveSessionController

Implement the interface from `.lore/design/active-session-controller.md`:

```
backend/src/streaming/
├── active-session-controller.ts   # Owns SDK connection, pending prompts
├── session-streamer.ts            # Transform SDK events to protocol events
├── types.ts                       # SessionEvent, PendingPrompt types
└── index.ts                       # Re-exports
```

**Key responsibilities:**
- Hold `queryResult` (live SDK connection)
- Manage `pendingPermissions` and `pendingQuestions` maps
- Track `cumulativeTokens`, `contextWindow`, `activeModel`
- Emit events to subscribers (WebSocket or SSE handler)

**Reuse from existing code:**
- `session-manager.ts`: `createSession()`, `resumeSession()`, `SessionQueryResult` - unchanged
- `websocket-handler.ts` lines 981-1228: streaming logic to extract

### 1.2 Update WebSocket Handler

Modify `websocket-handler.ts` to use `ActiveSessionController`:

```typescript
// Before: handler owns queryResult and streaming
this.state.activeQuery = queryResult;
for await (const event of queryResult.events) { ... }

// After: handler subscribes to controller
const unsubscribe = activeSessionController.subscribe((event) => {
  this.send(ws, event);
});
```

**Files modified:**
- `backend/src/websocket-handler.ts` - shrinks significantly

**Test:** Existing WebSocket functionality unchanged.

---

## Phase 2: Create Next.js App

**Goal:** SSE endpoints alongside existing Hono server.

### 2.1 Next.js Project Structure

```
nextjs/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       ├── vaults/route.ts
│       ├── chat/
│       │   ├── route.ts                    # POST -> SSE stream
│       │   └── [sessionId]/
│       │       ├── resume/route.ts         # POST -> SSE stream
│       │       ├── abort/route.ts          # POST
│       │       ├── permission/
│       │       │   └── [toolUseId]/route.ts
│       │       └── answer/
│       │           └── [toolUseId]/route.ts
│       └── vaults/
│           └── [vaultId]/
│               └── [...rest]/route.ts      # Proxy existing Hono routes
├── lib/
│   └── active-session-controller.ts        # Import from backend
├── package.json
├── next.config.ts
└── tsconfig.json
```

### 2.2 SSE Chat Endpoint

```typescript
// nextjs/app/api/chat/route.ts
export async function POST(request: NextRequest) {
  const { vaultId, prompt } = await request.json();

  const controller = getActiveSessionController();
  await controller.startSession(vault, prompt);

  const stream = new ReadableStream({
    start(streamController) {
      const encoder = new TextEncoder();

      const unsubscribe = controller.subscribe((event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        streamController.enqueue(encoder.encode(data));

        if (event.type === 'response_end' || event.type === 'error') {
          unsubscribe();
          streamController.close();
        }
      });
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

### 2.3 Permission Resolution Endpoint

```typescript
// nextjs/app/api/chat/[sessionId]/permission/[toolUseId]/route.ts
export async function POST(request: NextRequest, { params }) {
  const { allowed } = await request.json();

  getActiveSessionController().respondToPrompt(params.toolUseId, {
    type: 'tool_permission',
    allowed
  });

  return Response.json({ success: true });
}
```

**Test:** `curl -N -X POST http://localhost:3001/api/chat -d '{"vaultId":"test","prompt":"hello"}'`

---

## Phase 3: Migrate Frontend

**Goal:** Replace `useWebSocket` with `useChat` for AI conversations.

### 3.1 Create useChat Hook

```typescript
// frontend/src/hooks/useChat.ts
interface UseChatResult {
  sendMessage: (text: string) => Promise<void>;
  abort: () => void;
  resolvePermission: (toolUseId: string, allowed: boolean) => Promise<void>;
  resolveQuestion: (toolUseId: string, answers: Record<string, string>) => Promise<void>;
  isStreaming: boolean;
}

export function useChat({ vaultId, sessionId, onMessage }): UseChatResult {
  const sendMessage = useCallback(async (text: string) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ vaultId, sessionId, prompt: text })
    });

    // Read SSE stream
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const event of parseSSE(decode(value))) {
        onMessage(event);
      }
    }
  }, [vaultId, sessionId, onMessage]);

  // ... abort, resolvePermission, resolveQuestion
}
```

### 3.2 Update Components

**Discussion.tsx:**
- Replace `useWebSocket` with `useChat`
- Permission/question dialogs work unchanged (same event types)

**PairWritingMode.tsx:**
- Quick/Advisory actions become POST requests
- Responses stream via same SSE pattern

**SessionContext.tsx:**
- Remove WebSocket message handlers
- `useServerMessageHandler` adapts to SSE events (same shape)

---

## Phase 4: Validate and Cutover

### 4.1 Parallel Operation

- Hono on port 3000 (existing)
- Next.js on port 3001 (new)
- Feature flag: `USE_SSE=true` in localStorage

### 4.2 Validation Checklist

- [ ] New session creation streams responses
- [ ] Session resume works
- [ ] Tool permission dialogs function mid-stream
- [ ] AskUserQuestion dialogs function mid-stream
- [ ] Abort cancels in-flight requests
- [ ] Pair Writing Quick Actions work
- [ ] Context usage tracking accurate
- [ ] Session persistence unchanged

### 4.3 Cutover

1. Update `scripts/launch.sh` to start Next.js
2. Update systemd service
3. Remove WebSocket code from server
4. Delete `useWebSocket` hook (or keep for non-AI features)

---

## Critical Files

| File | Role |
|------|------|
| `backend/src/websocket-handler.ts` | Extract streaming (lines 981-1228) |
| `backend/src/session-manager.ts` | Reuse unchanged |
| `frontend/src/hooks/useWebSocket.ts` | Pattern for useChat |
| `frontend/src/components/discussion/Discussion.tsx` | Update to useChat |
| `shared/src/protocol.ts` | SSE events use same types |

## Reusable Code

| Module | Location | Reuse |
|--------|----------|-------|
| Session create/resume | `session-manager.ts` | As-is |
| Message persistence | `session-manager.ts#appendMessage` | As-is |
| Vault operations | `vault-manager.ts` | As-is |
| Protocol types | `shared/src/protocol.ts` | As-is |
| Streaming transform | `websocket-handler.ts#handleStreamEvent` | Extract to `session-streamer.ts` |

## Timeline

| Phase | Tasks | Effort |
|-------|-------|--------|
| 1 | ActiveSessionController, extract streaming | 2 days |
| 2 | Next.js app, SSE endpoints | 2-3 days |
| 3 | useChat hook, component updates | 3-4 days |
| 4 | Validation, cutover | 1-2 days |

**Total: 8-11 days**

## Verification

1. **Unit tests:** Mock SDK, test ActiveSessionController methods
2. **Integration tests:** Start SSE stream, verify events received
3. **E2E tests:** Full conversation with tool permissions
4. **Manual test:** Use app on phone, verify streaming works

## Rollback

Each phase is independently reversible:
- Phase 1: WebSocket handler still works (uses new module)
- Phase 2: Next.js runs on different port, can be stopped
- Phase 3: Feature flag switches frontend back to WebSocket
- Phase 4: Revert launch scripts, restart Hono
