---
title: Session viewport separation
date: 2026-02-03
status: draft
tags: [architecture, websocket, session-management, separation-of-concerns, refactor]
modules: [websocket-handler, session-manager, active-session-controller]
related: [.lore/brainstorm/session-viewport-separation.md]
---

# Spec: Session Viewport Separation

## Overview

Separate session lifecycle from WebSocket connection lifecycle. Sessions exist independently; WebSocket connections are viewports that attach/detach. Enables switching machines mid-conversation.

## Entry Points

- WebSocket connects (from any client, any machine)
- User sends message while no session exists (creates new)
- User clicks [+] button (clears active session)

## Requirements

- REQ-1: Active session persists when WebSocket disconnects
- REQ-2: WebSocket reconnect attaches to existing active session automatically
- REQ-3: Pending prompts (tool permissions, questions) wait until discarded by other events (no timeout)
- REQ-4: Only one active session exists at a time per server
- REQ-5: New session creation clears any existing active session (calls `interrupt()`) and discards pending prompts
- REQ-6: WebSocket handler contains no AI state (`queryResult` and direct SDK callbacks live in Active Session Controller)

## Architecture

Three distinct components with clear ownership:

**Session Manager** (persistence)
- Save/load session metadata to JSON files
- Message history append
- Session discovery (list, find by vault)

**Active Session Controller** (runtime) - NEW
- Holds `queryResult` (live SDK connection)
- Manages streaming state and event buffer
- Handles result event aggregation
- Owns pending prompts queue
- Tracks tokens, context usage, model
- Emits events for subscribers

**WebSocket Handler** (transport)
- Routes messages between client and active session controller
- Subscribes/unsubscribes from active session events
- Pure pass-through, holds no AI state

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Session cleared | User clicks [+] button | Active session destroyed, prompts discarded |
| Viewport attached | WebSocket connects | [STUB: frontend-reconnect-behavior] |
| Viewport detached | WebSocket disconnects | Session continues, events buffer |
| Events buffered | Viewport disconnects mid-stream | [STUB: event-buffering-strategy] |

## Success Criteria

- [ ] WebSocket disconnect does not interrupt active SDK query
- [ ] Reconnecting client receives pending prompts if any exist
- [ ] Reconnecting client can resume receiving streamed response
- [ ] New session clears all prior state without sending deny to SDK
- [ ] WebSocket handler has zero AI-related state fields
- [ ] All existing Discussion functionality preserved

## AI Validation

**Defaults** (apply unless overridden):
- Unit tests with mocked time/network/filesystem/LLM calls (including Agent SDK `query()`)
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

## Constraints

- Single-user server assumption (one active session is sufficient)
- SDK must support continued event consumption without connected client
- Pending prompts are in-memory only; server restart clears them (acceptable)

## Context

- [Brainstorm: Session and Viewport Separation](/.lore/brainstorm/session-viewport-separation.md)
- [Diagram: WebSocket Connection Lifecycle](/.lore/diagrams/websocket-connection-lifecycle.md)
- [Reference: Communication Layer](/.lore/reference/_infrastructure/communication-layer.md)
