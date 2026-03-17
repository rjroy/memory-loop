---
title: Ephemeral SDK sessions
date: 2026-03-15
status: approved
tags: [sdk, agent-sdk, session, streaming, architecture, subprocess]
modules: [session-manager, active-session-controller, session-streamer, sdk-provider]
related:
  - .lore/specs/daemon-application-boundary.md
  - .lore/specs/server-driven-chat.md
  - .lore/retros/discussion-multi-turn-resume.md
  - .lore/retros/server-driven-chat.md
  - .lore/_archive/daemon-session-lifecycle-chat.md
  - .lore/research/claude-agent-sdk.md
  - .lore/brainstorm/daemon-migration-stages.md
req-prefix: ESS
---

# Spec: Ephemeral SDK Sessions

## Overview

Replace Memory Loop's long-lived SDK subprocess model with ephemeral per-turn subprocesses. The current implementation holds an SDK subprocess alive for the entire session (potentially hours). When that subprocess crashes, the session dies silently. The new model spawns a subprocess for each user message, processes it to completion (including any tool permission or user question callbacks), then lets the subprocess exit. Conversation continuity is maintained through the SDK's `resume` token, not through a persistent process.

Guild Hall's `sdk-runner.ts` is the reference implementation for this pattern. It has been running reliably across commissions and meetings.

## Entry Points

- User sends a message in the Think tab (from server-driven-chat spec)
- User reconnects to a session that was processing (SSE snapshot-on-connect)
- SDK requests tool permission or asks a user question during processing (pending prompts)

## Requirements

### Subprocess Lifecycle

- REQ-ESS-1: Each user message spawns a new SDK subprocess. The subprocess lives for the duration of that one turn (from message submission through response completion). No subprocess persists between turns.

- REQ-ESS-2: Conversation continuity uses the SDK's `resume` option with the SDK session ID (resume token) from the previous turn. The daemon stores this SDK session ID in the session metadata file, not in a live process.

- REQ-ESS-3: If `resume` fails, the daemon reports the failure as an explicit `error` SSE event with `code: "RESUME_FAILED"` and a human-readable message. It does not silently migrate metadata or adapt. The user decides whether to start a new conversation. Resume failure manifests as either an exception from the SDK (detected via `isSessionExpiryError()` style string matching) or a silently different session ID (detected by comparing the returned session ID to the one passed). Both must be detected and treated as failure.

### Event Translation

- REQ-ESS-4: SDK messages (`SDKMessage`) are translated to an intermediate event schema before being mapped to SSE events. The translator is a stateless function (no side effects, no persistence). Guild Hall's `SdkRunnerEvent` is the reference for the intermediate schema.

- REQ-ESS-5: The intermediate event types are: `session` (session ID from SDK), `text_delta` (streaming text), `tool_use` (tool invocation started), `tool_input` (accumulated tool input), `tool_result` (tool completed), `turn_end` (SDK turn finished, includes cost), `error` (SDK error), `aborted` (user-initiated abort).

- REQ-ESS-6: The event translator accumulates `input_json_delta` chunks and emits a single `tool_input` event when the content block completes. This matches Guild Hall's `createStreamTranslator` pattern.

### Pending Prompts (Tool Permission, AskUserQuestion)

- REQ-ESS-7: Pending prompts (tool permission requests, AskUserQuestion) work within the per-turn subprocess model. The SDK's `canUseTool` callback blocks the subprocess until the user responds. The subprocess remains alive while waiting. This is scoped to the current turn only.

- REQ-ESS-8: When a pending prompt is active, the daemon holds the prompt in memory and emits it as a `prompt_pending` SSE event. If the user disconnects and reconnects, the snapshot includes the pending prompt. The subprocess is still alive, waiting for the response.

- REQ-ESS-9: When the user responds to a pending prompt, the daemon resolves the blocked callback. The subprocess continues processing. When processing completes, the subprocess exits.

- REQ-ESS-10: If the subprocess crashes while waiting for a pending prompt response, the daemon emits an error event and clears the pending prompt. The user sees an error, not a hung interface.

### Controller State

- REQ-ESS-11: The active session controller tracks: whether processing is in progress, the current session ID, the current vault ID, pending prompts, and a subscriber list for SSE events. It does NOT hold a reference to a persistent SDK subprocess or query result between turns.

- REQ-ESS-12: Between turns (no active processing), the controller holds only the session ID and vault ID. All other state (subprocess, event generator, streaming state) is gone.

- REQ-ESS-13: Cumulative token counts and context window information are accumulated across turns in the controller's in-memory state and included in SSE snapshots. Token and cost data is sourced from the `turn_end` intermediate event (which carries the SDK's reported cost). Loss of this data on daemon restart is acceptable (it's observational, not functional).

### Streaming and SSE

- REQ-ESS-14: The two-phase chat contract is preserved unchanged. POST `/session/chat/send` submits a message and returns `{ sessionId }`. GET `/session/chat/stream` opens an SSE viewport. The daemon processes each message to completion regardless of client connectivity.

- REQ-ESS-15: The SSE stream sends a snapshot on connect, then live events during processing, then closes on terminal events (response_end, error, session_cleared). This behavior is unchanged from the current implementation.

- REQ-ESS-16: The `sendMessage` operation creates the subprocess, starts processing, and returns immediately (fire-and-forget). The caller connects to the SSE stream to observe progress. This is unchanged.

### Session Metadata

- REQ-ESS-17: Session metadata files (transcript, messages, session ID) are persisted to disk after each turn completes. This is unchanged from the current implementation.

- REQ-ESS-18: The session ID stored in metadata is the SDK session ID from the most recent successful turn. On the next turn, this ID is passed as the `resume` option.

### Abort

- REQ-ESS-19: Aborting processing kills the current turn's subprocess via the abort controller. The session ID remains valid for future turns (the user can send another message to resume). If a pending prompt is active when the user aborts, the pending prompt is cleared and an `aborted` event is emitted (not `error`). This is distinguishable from a subprocess crash during a pending prompt (REQ-ESS-10), which emits `error`.

### Per-Turn Session Preparation

- REQ-ESS-20: Each turn assembles a fresh SDK query options object. The inputs are:

  | Input | Source | Notes |
  |-------|--------|-------|
  | `model` | Vault config (`discussionModel`) | "opus", "sonnet", or "haiku". Default "opus". |
  | `cwd` | `vault.path` | Vault root directory. SDK discovers vault's CLAUDE.md via settingSources. |
  | `resume` | Session metadata file | SDK session ID from previous turn. Omitted for first message. |
  | `mcpServers` | `createVaultTransferServer()` | vault-transfer MCP server, created fresh per turn. Provides `transfer_file` and `list_vaults` tools. |
  | `canUseTool` | Controller callbacks | Wraps tool permission and AskUserQuestion into SDK's callback interface. |
  | `allowedTools` | Static list | Read, Glob, Grep, AskUserQuestion, WebFetch, WebSearch, Task, TodoWrite, TodoRead. |
  | `permissionMode` | Static | "acceptEdits" |
  | `maxBudgetUsd` | Static | 2.0 |
  | `settingSources` | Static | ["local", "project", "user"] |

  This is a pure function: given a vault and an optional session ID, it returns an options object. No side effects, no persistent state.

- REQ-ESS-21: The session preparation function is the single place where SDK query options are constructed. Both new sessions and resumed sessions use the same function. The only difference is whether `resume` is present.

## Exit Points

None. All stubs resolved.

## Success Criteria

- [ ] Chat works: user sends message, sees streaming response, can send follow-up messages
- [ ] Tool permissions work: SDK requests permission, user sees prompt, responds, processing continues
- [ ] AskUserQuestion works: SDK asks question, user sees form, responds, processing continues
- [ ] Disconnect/reconnect works: close browser during processing, reopen, see current state including any pending prompts
- [ ] Abort works: user aborts, subprocess dies, session remains resumable
- [ ] Abort during pending prompt works: user aborts while permission/question is waiting, prompt clears, `aborted` event emitted (not `error`)
- [ ] Session clear during processing works: starting a new session kills the current subprocess without corrupting controller state
- [ ] Resume works: multi-turn conversations maintain context through SDK resume
- [ ] Resume failure is loud: if SDK can't find the session, user sees an error message, not silent degradation
- [ ] No subprocess leak: after each turn completes, no orphaned processes remain
- [ ] Daemon restart is clean: restarting the daemon loses in-flight processing but not session history

## AI Validation

**Defaults** (apply unless overridden):
- Unit tests with mocked SDK `query()` calls
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**
- Integration test: multi-turn conversation (send, get response, send follow-up, verify resume works)
- Integration test: pending prompt lifecycle (trigger permission request, respond, verify processing continues)
- Integration test: subprocess cleanup (send message, wait for completion, verify no orphaned processes)
- Integration test: abort during processing (send message, abort, verify subprocess exits, verify session remains resumable)

## Constraints

- The Claude Agent SDK's `query()` function is the only entry point. We don't use `ClaudeSDKClient` or the V2 preview.
- The SDK subprocess is opaque. We can't inspect its internal state. We only observe `SDKMessage` events.
- `resume` is SDK-managed. We pass the session ID; the SDK decides whether it can resume. We handle failure, not recovery.
- The frontend contract (two-phase chat, SSE events, snapshot-on-connect) is unchanged. This is a daemon-internal rewrite.
- The daemon API routes (`/session/chat/send`, `/session/chat/stream`, etc.) are unchanged. The Next.js proxy layer is not affected.
- Pending prompts require the subprocess to stay alive during a turn. This is inherent to the SDK's callback model and cannot be changed without SDK changes.

## Context

- **Daemon Application Boundary spec** (`.lore/specs/daemon-application-boundary.md`): REQ-DAB-19 says the daemon holds "in-memory state for active sessions." This spec refines what that means: in-memory state is the controller's session ID, pending prompts, and subscriber list. It is NOT a persistent subprocess.
- **Server-Driven Chat spec** (`.lore/specs/server-driven-chat.md`): REQ-SDC-5 (single active session), REQ-SDC-7 (unified sendMessage), REQ-SDC-11 through REQ-SDC-14 (pending prompts) all remain valid. The processing model is preserved. What changes is the subprocess lifetime, not the processing semantics.
- **Stage 5 plan** (`.lore/_archive/daemon-session-lifecycle-chat.md`): This plan was written around the long-lived subprocess model. The session lifecycle parts (init, lookup, delete routes) remain valid. The active-session-controller internals need to be replanned.
- **Multi-turn resume retro** (`.lore/retros/discussion-multi-turn-resume.md`): Documents four wasted debugging sessions caused by SDK resume interacting with vault settings hooks. The ephemeral model doesn't eliminate resume, but REQ-ESS-3 (loud failure on resume mismatch) would have surfaced this bug immediately instead of silently adapting.
- **Guild Hall's sdk-runner.ts**: The reference implementation. `runSdkSession()` is the stateless event generator. `prepareSdkSession()` is the per-turn setup. `createStreamTranslator()` is the event translator. `drainSdkSession()` is the generator consumer for non-interactive use cases (commissions). Memory Loop's interactive use case (pending prompts) means we can't drain; we need to yield events and handle prompts inline.
- **SDK concurrency**: The daemon migration brainstorm confirmed `query()` handles concurrent calls safely. Per-turn subprocess creation doesn't conflict with background SDK usage (extraction, card generation).
