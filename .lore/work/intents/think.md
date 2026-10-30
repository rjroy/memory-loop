---
title: Think chat foundation
date: 2026-10-30
status: draft
tags: [think, chat, intent, opencode, continuity]
related: [.lore/work/intents/project-restart.md, .lore/work/intents/recall.md]
---

# Think chat foundation

## Why this layer

Think is the next foundational capability after read-only Recall. Recall has established vault configuration, daemon file access, and Markdown presentation. Think adds an ongoing AI conversation that remains dependable when a phone disconnects, rather than tying agent execution to an open browser connection.

This captures present intent, not authorization to implement or a completed technical plan. Open behavior and integration choices are tracked in `memory-loop-42j`.

## Conversation experience

- Provide a clear New chat action to start a fresh conversation. An existing run continues in the background; starting another chat does not cancel it. Returning to other conversations is a future capability, not a chat-switching interface required in this layer.
- Keep the composer available for writing even when sending is unavailable. Do not disable or remove the editing surface merely because the AI is working or the connection is unavailable. Whether drafts are queued or persisted remains open.
- While the AI is working, replace Send with Stop. This is an explicit cancellation action, not a consequence of disconnecting. Cancellation semantics for running tools and partial responses need definition.
- Clearly distinguish user messages from AI messages, using accessible identification rather than color alone.
- Render conversation Markdown well, including ordinary prose, lists, code, and other supported structures. Reuse established rendering foundations where appropriate; chat-specific formatting and link/media behavior need design.
- Do not impose an application turn limit. Provider limits and finite model context still exist; make their handling explicit rather than promising unlimited context.

Think should receive a deliberate Impeccable interaction and responsive design pass before implementation. Preserve the current branded shell and four-tab top navigation; the placeholder chat layout is not a fixed design.

### Proportionate Stop behavior

Stop is a practical, best-effort control using the agent service's supported cancellation behavior, not a promise of perfect cancellation. If submission failed or execution has already ended, there may be nothing to stop. Show an honest result rather than treating that as a defect requiring new coordination machinery. If a Stop request fails, make the failure understandable and allow an explicit retry where applicable.

Prefer the maintained service's existing behavior and ordinary error handling over bespoke mechanisms for speculative timing cases. Add complexity only for a demonstrated problem with a meaningful user consequence. This does not weaken the requirement that accepted work survive browser disconnection or justify claiming work stopped without confirmation.

## Execution and reconnect

Carry forward daemon-owned asynchronous execution. Accepted work continues when a browser loses connectivity, closes, or moves away from Think. Reconnecting restores the authoritative conversation, operation status, available output, and pending decisions, then resumes monitoring.

Reopening a live event stream alone is not recovery. Missed output must be recovered without presenting duplicate messages or accidentally submitting accepted work again. The interface must make connection and execution state understandable and must not equate a transport failure with an agent failure.

These requirements concern browser disconnection. Recovery from daemon or OpenCode process failure, and exactly-once tool effects across those failures, are not settled by this intent.

### Ground owns the future chat list

The list of conversations to resume belongs on Ground, not Think. This layer does not implement that list or user-driven selection and resumption of a previous conversation.

Keep conversation identity and daemon-owned session state independent of the currently mounted Think view. A future Ground entry should be able to identify a conversation and open it in Think without replacing the execution or persistence foundation. The precise navigation and listing API belong in later planning; this is not a request for a generalized framework or unfinished resume controls now.

This scope boundary does not remove reconnect handling for the current conversation: losing and restoring the browser connection must still recover that conversation's state and monitoring. Existing runs also continue when New chat is selected, even though the Ground interface for finding and returning to them is deferred. Do not imply that this layer already provides that return interface.

## Vault transcript

Log the conversation to a file within the configured vault so it is available for future analysis and ordinary file-based use. Keep the transcript human-readable, with clear user/AI attribution. Do not mistake a readable transcript alone for all runtime state required to resume an agent session.

Save full user and AI messages, with summaries of tool activity rather than complete tool arguments and results. Do not silently truncate conversation messages into summaries. Whether detailed tool payloads are retained separately as runtime state is an implementation choice, not authorization to export them into the vault transcript.

Format, configurable location, naming, timing of writes, and representation of timestamps, errors, and interrupted turns remain open. A reasonable direction to evaluate is ordinary Markdown plus clearly structured metadata, not an opaque export requiring Memory Loop to read it.

Avoid rewriting unrelated content. Transcript writes belong in the daemon, and storage failures must not be silently presented as successful logging. Detailed recovery behavior needs planning.

## Tools, permissions, and OpenCode

Allow full tool use, controlled by a configurable permission system whose initial setting is fully permissive. In this initial mode, tool permission checks must allow tools without asking the user for approval or rejecting them. Do not silently substitute a restricted tool set, confirmation prompts, or inherited permission rules that defeat this setting. Determine how to express the effective allow-all policy through the chosen OpenCode permission model and verify its precedence before activation.

Permission-request presentation and reconnect recovery prepare for a future restrictive configuration; they must not introduce permission gates into the initial permissive experience. Ordinary agent questions are distinct from requests for tool permission. Permissive permissions do not promise that tools cannot encounter execution errors, operating-system restrictions, or provider limits.

Fully permissive execution is not a vault sandbox: enabled tools may execute commands, access networks, and modify or delete files outside the vault, subject to their process privileges. Record and surface that scope explicitly. This future tool setting does not authorize development-time destructive actions or changes to this repository's operating rules.

The established direction is to reuse the user's OpenCode TUI setup as closely as practical, including agents, models, skills, plugins, and permissions, behind the Memory Loop daemon. Verify the installed version, maintained client/API, configuration discovery, working directory, tool behavior, and permission precedence before committing to an integration approach. Sharing configuration does not automatically mean sharing existing TUI sessions.

Keep OpenCode access and credentials server-side. Preserve the current private Tailscale deployment and Next.js presentation/BFF plus Bun/Hono daemon foundation.

## Questions to resolve in shaping and planning

The following are unresolved choices, not an additional approved feature backlog:

- What survives refresh versus service restart, how the current conversation is identified during reconnect, and whether TUI and Think expose shared sessions. The future chat list and user-driven resume interface belong on Ground and are outside this layer.
- What Stop can guarantee for generation, active tools, already completed side effects, and transcript preservation.
- Draft retention, sending while disconnected, follow-up messages during a run, and retry behavior after uncertain submission.
- Transcript location/format and sensitive tool-summary handling, preserving the settled full-message/tool-summary distinction.
- Model context exhaustion and compaction, without an arbitrary application turn cap.
- Which vault context is supplied automatically versus accessed through tools, and which working directory selects the intended OpenCode setup.
- Tool activity visibility and how future restrictive permission configurations present pending decisions across reconnect.

These choices remain attached to `memory-loop-42j`; implementation and any agreed deferrals must be tracked in Beads rather than disappearing into document comments.
