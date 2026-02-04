---
title: Active Session Controller interface
date: 2026-02-03
status: draft
tags: [architecture, interface-design, session-management, pub-sub]
modules: [active-session-controller, websocket-handler, session-manager]
related: [.lore/specs/session-viewport-separation.md]
---

# Design: Active Session Controller Interface

## Problem

Design the interface for Active Session Controller - the new component that owns the live SDK connection and lets viewports (WebSocket connections) subscribe/unsubscribe.

See [Spec: session-viewport-separation](.lore/specs/session-viewport-separation.md) for requirements.

## Constraints

- Single active session at a time (REQ-4)
- WebSocket handler must contain no AI state (REQ-6)
- Pending prompts wait until discarded, no timeout (REQ-3)
- New session clears existing session via `interrupt()` (REQ-5)
- Follow existing patterns where possible (HealthCollector)

## Approaches Considered

### Option 1: Event Emitter Pattern (like HealthCollector)

Subscribers register callbacks. Controller calls all callbacks when events occur.

**Pros:**
- Familiar pattern (HealthCollector exists)
- Simple to understand
- Unsubscribe is clean (returns function)

**Cons:**
- All events go to all subscribers (fine for single-user, but less flexible)
- Callback-based means error handling is awkward
- No backpressure if subscriber is slow

### Option 2: Pull-based with State Query

Controller buffers events. Subscribers poll or request current state.

**Pros:**
- Simpler - no subscription management
- Easy to "catch up" on reconnect
- No callback error handling

**Cons:**
- Polling is wasteful
- Doesn't push updates - viewport needs to know when to check
- Buffer management complexity

### Option 3: Hybrid - Event Emitter + State Snapshot

Push events to subscribers, but also expose state queries for reconnect scenarios.

**Pros:**
- Best of both: real-time push + reconnect catch-up
- Consistent with existing HealthCollector pattern
- State queries are cheap (no buffer management)

**Cons:**
- Slightly more API surface
- Need to define what "catch up" means for reconnect (stubbed as event-buffering-strategy)

## Decision

**Option 3: Hybrid approach.** Combines real-time event push with state queries for reconnect. Uses HealthCollector's subscribe pattern, extends it with state queries for reconnect scenarios.

**Note on state queries:** Currently, event buffering is stubbed, so state queries (`getState()`, `getPendingPrompts()`) have limited immediate use. They're included as forward-looking API surface for when buffering is designed. In the meantime, they enable viewports to check for pending prompts on reconnect without requiring buffered events.

## Interface/Contract

### Controller Interface

```typescript
interface ActiveSessionController {
  // Lifecycle
  startSession(vault: VaultInfo, prompt: string): Promise<void>;
  resumeSession(vaultPath: string, sessionId: string, prompt: string): Promise<void>;
  clearSession(): Promise<void>;

  // Subscription (push)
  subscribe(callback: (event: SessionEvent) => void): () => void;

  // State queries (pull, for reconnect)
  getPendingPrompts(): PendingPrompt[];
  getState(): SessionState;
  isStreaming(): boolean;

  // Prompts
  respondToPrompt(promptId: string, response: PromptResponse): void;
}
```

### Event Types

```typescript
type SessionEvent =
  | { type: "response_start"; messageId: string }
  | { type: "response_chunk"; messageId: string; content: string }
  | { type: "response_end"; messageId: string; contextUsage?: number; durationMs: number }
  | { type: "tool_start"; toolUseId: string; toolName: string }
  | { type: "tool_input"; toolUseId: string; input: unknown }
  | { type: "tool_end"; toolUseId: string; output: unknown }
  | { type: "prompt_pending"; prompt: PendingPrompt }
  | { type: "prompt_resolved"; promptId: string }
  | { type: "prompt_response_rejected"; promptId: string; reason: "not_found" | "already_resolved" }
  | { type: "error"; code: string; message: string }
  | { type: "session_cleared" };
```

### Supporting Types

```typescript
interface PendingPrompt {
  id: string;
  type: "tool_permission" | "ask_user_question";
  toolName?: string;
  input?: unknown;
  questions?: AskUserQuestionItem[];
}

type PromptResponse =
  | { type: "tool_permission"; allowed: boolean }
  | { type: "ask_user_question"; answers: Record<string, string> };

interface SessionState {
  sessionId: string | null;
  vaultId: string | null;
  cumulativeTokens: number;
  contextWindow: number | null;
  activeModel: string | null;
  isStreaming: boolean;
}
```

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Subscribe while streaming | Subscriber receives from current point, no past events |
| Respond to nonexistent prompt | Emits `prompt_response_rejected` with reason `not_found` |
| Respond to already-resolved prompt | Emits `prompt_response_rejected` with reason `already_resolved` |
| Start session while one exists | Awaits `clearSession()` first, then creates new session. Subscribers see `session_cleared`, then `response_start` |
| Clear session while streaming | Calls `interrupt()` on SDK, discards prompts, emits `session_cleared` |
| Subscriber callback throws | Wrap in try/catch, log error, continue to other subscribers (insertion order) |
| No subscribers when event occurs | Event is lost (buffer stub handles this later) |

## Open Questions

- Event buffering strategy for reconnect is stubbed - will be designed separately
- Frontend reconnect behavior is stubbed - will be designed separately
