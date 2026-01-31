---
title: WebSocket Connection Lifecycle
date: 2026-01-28
status: current
tags: [architecture, websocket, connection, reconnect]
modules: [websocket-handler, use-websocket]
---

# Diagram: WebSocket Connection Lifecycle

## Context

Memory Loop uses WebSocket for real-time communication: AI streaming, tool execution display, and session state. This diagram shows the full lifecycle from connection to cleanup, including the auto-reconnect behavior that makes the app resilient to network issues.

## Diagram

```mermaid
sequenceDiagram
    participant Browser
    participant useWebSocket as useWebSocket.ts
    participant Hono as server.ts
    participant Handler as WebSocketHandler

    Note over Browser,Handler: Initial Connection

    Browser->>useWebSocket: Component mounts
    useWebSocket->>useWebSocket: connect()
    useWebSocket->>Hono: GET /ws (upgrade)
    Hono->>Handler: createWebSocketHandler()
    Note over Handler: Initialize ConnectionState<br/>(vault=null, session=null)

    Hono-->>useWebSocket: WebSocket connected
    useWebSocket->>useWebSocket: status = "connected"<br/>resetReconnectDelay()

    Hono->>Handler: onOpen(ws)
    Handler->>Handler: discoverVaults()
    Handler-->>Browser: vault_list { vaults[] }

    Note over Browser,Handler: Normal Operation

    Browser->>useWebSocket: sendMessage(msg)
    useWebSocket->>Hono: ws.send(JSON)
    Hono->>Handler: onMessage(ws, data)
    Handler->>Handler: safeParseClientMessage()
    Handler->>Handler: Route to handler

    alt Valid message
        Handler-->>Browser: ServerMessage
        useWebSocket->>useWebSocket: safeParseServerMessage()<br/>setLastMessage()
    else Invalid JSON/schema
        Handler-->>Browser: error { VALIDATION_ERROR }
    end

    Note over Browser,Handler: Connection Lost

    Hono-->>useWebSocket: onclose event
    useWebSocket->>useWebSocket: status = "disconnected"
    Hono->>Handler: onClose()
    Handler->>Handler: Interrupt activeQuery<br/>Reset ConnectionState

    alt Page visible
        useWebSocket->>useWebSocket: scheduleReconnect()<br/>delay = 1s → 2s → 4s → ... → 30s max
        useWebSocket->>Hono: Reconnect after delay
        Note over useWebSocket: On success: onReconnect callback,<br/>resetReconnectDelay()
    else Page hidden
        useWebSocket->>useWebSocket: pendingReconnect = true
        Note over useWebSocket: Wait for visibilitychange
        Browser->>useWebSocket: Page becomes visible
        useWebSocket->>Hono: Reconnect immediately
    end

    Note over Browser,Handler: Intentional Cleanup

    Browser->>useWebSocket: Component unmounts
    useWebSocket->>useWebSocket: mountedRef = false<br/>clearReconnectTimeout()
    useWebSocket->>Hono: ws.close()
    Note over useWebSocket: onclose = null<br/>(prevent reconnect)
```

## Reading the Diagram

The lifecycle has four phases:

**1. Initial Connection**
- React component mounts, `useWebSocket` calls `connect()`
- Hono upgrades HTTP to WebSocket, creates a fresh `WebSocketHandler` instance
- Handler initializes empty `ConnectionState` and sends `vault_list` on open
- Client sets status to "connected" and resets reconnect delay

**2. Normal Operation**
- Client sends `ClientMessage` via `sendMessage()`
- Handler validates JSON and schema with `safeParseClientMessage()`
- Routes to appropriate handler (select_vault, discussion_message, etc.)
- Client validates responses with `safeParseServerMessage()`

**3. Connection Lost (Auto-Reconnect)**
- On close, handler interrupts any active SDK query and resets state
- Client schedules reconnect with exponential backoff (1s → 2s → 4s → max 30s)
- If page is hidden, defers reconnect until visible (saves battery on mobile)
- On reconnect success, fires `onReconnect` callback and resets delay

**4. Intentional Cleanup**
- On unmount, client sets `onclose = null` to prevent reconnect loop
- Closes WebSocket cleanly without triggering retry logic

## Key Insights

- **State isolation**: Each connection gets its own `WebSocketHandler` instance with independent `ConnectionState`. No shared state between connections.
- **Visibility-aware**: Reconnection pauses when the browser tab is hidden, resuming immediately when visible. This prevents battery drain on mobile.
- **Graceful degradation**: Invalid messages return `VALIDATION_ERROR` but don't close the connection. The client can retry.
- **No session persistence in WebSocket**: The WebSocket itself doesn't persist sessions. Session resumption requires the [auto-resume flow](./session-auto-resume.md) via REST + WebSocket.

## ConnectionState Contents

Each WebSocket connection maintains:

| Field | Purpose |
|-------|---------|
| `currentVault` | Selected vault (null until select_vault) |
| `currentSessionId` | Active session ID (null until first discussion) |
| `activeQuery` | Running SDK query with interrupt() method |
| `pendingPermissions` | Tool permission requests awaiting user response |
| `healthCollector` | Tracks backend issues for health_report |
| `cumulativeTokens` | Token usage across session turns |
| `activeMeeting` | In-progress meeting capture state |

## Not Shown

- **Message routing details**: The handler's switch statement covers 20+ message types
- **SDK streaming**: How `discussion_message` streams response_chunk events
- **Health reporting**: How healthCollector subscribes to issues and pushes updates
- **Mock mode**: When `MOCK_SDK=true`, SDK interactions are simulated

## Related

- [Session Auto-Resume](./session-auto-resume.md) - How sessions are restored after reconnect
- [Communication Layer](../reference/_infrastructure/communication-layer.md) - Protocol details
- `frontend/src/hooks/useWebSocket.ts` - Client implementation
- `backend/src/websocket-handler.ts` - Server implementation
- `backend/src/handlers/types.ts:181-204` - ConnectionState interface
