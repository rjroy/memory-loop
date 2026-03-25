---
title: "Vision Stretch: What Could Be"
date: 2026-03-24
status: active
tags: [vision, architecture, gctr, daemon, extraction, agents, mcp, memory]
related:
  - .lore/vision.md
  - .lore/specs/daemon-application-boundary.md
  - .lore/retros/daemon-migration-and-ephemeral-sessions.md
  - .lore/retros/ephemeral-sdk-sessions.md
  - .lore/retros/daily-prep-system.md
  - .lore/reference/_infrastructure/extraction.md
  - .lore/reference/_infrastructure/card-generator.md
---

# Vision Stretch: What Could Be

## Context

**Vision status:** Approved (2026-03-23)

**Context scanned:**
- Vision document (.lore/vision.md)
- Daemon application boundary spec (REQ-DAB-1 through REQ-DAB-25)
- All 6 existing brainstorms (all resolved, no overlap with proposals below)
- 20 retros (patterns: "perfect code, broken product" x3, silent error handling x3, implicit requirements)
- Full daemon API surface (60+ routes across vault, session, extraction, card, config domains)
- Extraction pipeline (daemon/src/extraction/), card pipeline (daemon/src/spaced-repetition/)
- Session model (daemon/src/session-manager.ts, active-session-controller.ts)
- CLI client (cli/src/, 14 commands, MCP projection stubs)
- Recent git history (30 commits, SSE reconnect through daemon extraction)

**Recent brainstorm check:** All 6 prior brainstorms are resolved. No active proposals to avoid repeating.

**Commission prompt:** "Go beyond 'what's next?' Go beyond 'what should be extended?' What stretches the limits of what the vision suggests?"

---

## 1. Memory Loop as Claude's Memory Layer

### Evidence

The extraction pipeline (`daemon/src/extraction/extraction-manager.ts`) writes to `~/.claude/rules/memory.md`. This is not a Memory Loop file. It's Claude's global rules directory, read by every Claude Code session on the machine. Memory Loop is already the process that decides what Claude remembers about you, not just in Memory Loop conversations, but everywhere.

Three pipelines observe vault content independently:
- Extraction (Haiku, file tools, writes global memory)
- Card generation (Sonnet, no tools, writes vault metadata)
- Daily prep (interactive, reads task state, produces self-assessment)

Each produces a different kind of knowledge about the user. None feed into each other.

### Proposal

Name this responsibility. Memory Loop is not just a vault interface with AI features. It is the memory layer between you and every Claude-powered tool on your machine. The daemon is the process that curates what Claude knows about you, whether the conversation happens in Memory Loop, Claude Code, or a future agent.

This reframes the extraction pipeline from "overnight batch job that writes a file" to "the canonical memory curation service." The daemon could serve memory queries (what do I know about this topic?) to any MCP client, not just render them in the Ground tab. The `~/.claude/rules/memory.md` file becomes an output artifact of the memory service, not the service itself.

The card system and extraction system currently share no state. But cards represent "what the user should remember" and extracted facts represent "what Claude should remember about the user." These are two sides of the same coin. A unified observation layer would notice when a fact extracted from a transcript also appears in a card, or when a card's source material has been updated since the card was generated.

### Vision Alignment

- **Anti-goal check:** Does not introduce multi-user, cloud, or Obsidian-replacement scope. Memory curation remains personal, single-machine, vault-grounded.
- **Principle alignment:** "Vault as source of truth" holds. The daemon reads vault content and produces derivative knowledge. "Human-agent parity" is extended: agents anywhere on the machine get the same curated memory, not just Memory Loop's own sessions.
- **Tension resolution:** "Automation vs user agency" applies. The system proposes what to remember; the user curates. This is already the vision's stated resolution for extraction surfacing.
- **Constraint check:** The strategic question "How should extraction results surface to the user?" becomes more urgent under this framing, because the audience expands from "Memory Loop user" to "every Claude session."

### Scope: Large

---

## 2. Event-Driven Vault Observation

### Evidence

Card discovery (`daemon/src/spaced-repetition/card-discovery-scheduler.ts`) runs nightly and checks modification timestamps against a `processedFiles` map. Extraction (`daemon/src/extraction/extraction-manager.ts`) runs nightly and checks checksums. Both are batch processes with catch-up logic on startup.

The daemon already runs continuously. It has the lifecycle to host file watchers. The vault layout encodes structural meaning: `06_Metadata/` is excluded from card generation, `inbox/chats/` is excluded, hidden directories are excluded. These exclusion rules are knowledge about what different vault regions mean.

### Proposal

Replace batch polling with filesystem event observation. When the daemon detects a file change in a vault, it classifies the change: is this a daily note append (capture)? A transcript write (think)? A file edit from Obsidian (external modification)? A card review state change (recall)?

The classification doesn't trigger immediate processing. It enriches a lightweight event log that the nightly pipelines can consume instead of scanning the entire vault. But the event stream itself becomes a first-class concept. The Ground tab's "recent activity" widget currently queries the filesystem for recent modifications. An event stream would make this instantaneous and richer: not just "this file changed" but "you captured 4 notes, had 2 conversations, and reviewed 6 cards today."

The deeper possibility: an event stream at the vault level means the GCTR framework can observe itself. How much time do you spend in each mode? Which captures lead to thinking sessions? Which thinking sessions produce recalls? The framework currently teaches a practice by naming the modes. With observation, it could also show you how you practice.

### Vision Alignment

- **Anti-goal check:** Not optimizing for speed of generation. Event observation is about awareness, not triggering real-time extraction.
- **Principle alignment:** "Teach the practice, not just provide the tool." Observing GCTR patterns across time is the framework teaching at a higher level. "Vault as source of truth" holds; events are derived from filesystem state.
- **Tension resolution:** "Automation vs user agency" applies. The system observes and reports. It does not auto-act. The user sees "you captured but rarely think" and decides what that means.
- **Constraint check:** File watching adds a daemon subsystem. Platform differences exist (inotify on Linux, FSEvents on macOS). The daemon already runs per-platform; this extends platform-specific behavior.

### Scope: Medium

---

## 3. Cross-Temporal GCTR

### Evidence

The daily prep system (`daemon/src/routes/daily-prep.ts`) surfaces today's context: energy, calendar shape, pressure/slipping/quick-win tasks. The user's note processing workflow spans daily captures through weekly debriefs, monthly summaries, and yearly archives. The extraction pipeline distills conversations into durable facts. The card system schedules review across days and weeks using SM-2 intervals.

Four systems operate on different time horizons. None synthesize across them. The Ground tab shows today. Nothing shows this week's arc, this month's themes, or the trajectory of your attention over time.

### Proposal

Extend the Ground tab (or introduce a Ground sub-view) that shows GCTR patterns across time. Not a dashboard of metrics, but a narrative surface: "This week you captured 23 notes, mostly about SDK performance testing. You had 4 thinking sessions, 3 about the same topic. You haven't recalled any files older than last week."

The raw data already exists. Daily notes are timestamped. Transcripts record conversation topics. Cards track review frequency. Extraction tracks which transcripts produced which facts. The missing piece is a periodic synthesis that reads these signals and produces a brief, human-readable observation about the shape of your attention.

This is different from analytics. Analytics tells you "you spent 40 minutes in Think mode." Cross-temporal GCTR tells you "you keep returning to the same question without resolving it" or "you captured extensively this week but haven't processed any of it into thinking sessions." It's the framework observing whether you're actually practicing what it teaches.

The daily prep system's "Slipping" category is the closest ancestor. It surfaces tasks going cold. Cross-temporal GCTR would surface attention going cold, or going circular, or going deep.

### Vision Alignment

- **Anti-goal check:** Not general-purpose AI chat. Every observation is grounded in vault activity. Not optimizing for speed; synthesis can run nightly like extraction.
- **Principle alignment:** "Teach the practice, not just provide the tool" is the direct alignment. This is the framework teaching at the level of weeks and months, not just within a session. "Server processes to completion" holds; synthesis is a batch process like extraction.
- **Tension resolution:** "Automation vs user agency" is central. The system observes and narrates. The user decides what to do about it. This follows the daily prep pattern exactly: surface, don't prescribe.
- **Constraint check:** Depends on having structured observation data. If Proposal 2 (event-driven observation) exists, cross-temporal GCTR consumes its event log. Without it, synthesis must scan the filesystem like extraction does today.

### Scope: Large

---

## 4. Composable Sessions

### Evidence

The active session controller (`daemon/src/streaming/active-session-controller.ts`) is a module-level singleton. One live SDK connection at a time. But the daemon already runs three concurrent SDK consumers: interactive discussion, extraction (separate `getSdkQuery()` in `extraction-manager.ts` with Haiku model), and card generation (separate `getSdkQuery()` in `card-generator.ts` with Sonnet model).

The singleton constraint applies to interactive sessions, not to all SDK usage. Extraction and card generation already bypass it. The ephemeral per-turn model (fresh subprocess per message) means each turn is architecturally independent. The constraint is the controller's assumption that only one human conversation exists, not a fundamental SDK limitation.

The vision says "Human-agent parity at the application boundary." The MCP integration (REQ-DAB-11 through REQ-DAB-15) says agents use CLI commands. But if an agent calls `chat send` while a human has an active session, the agent blocks or fails. Human-agent parity breaks at the session layer.

### Proposal

Allow the daemon to host multiple concurrent sessions with different priorities. The human's interactive session is primary (lowest latency, Opus model, full tool access). Background sessions are secondary (higher latency acceptable, lighter models, scoped tools). An agent requesting a search-and-summarize operation doesn't need to wait for the human to finish their conversation.

This doesn't mean multiplexing SDK connections. Each session is still ephemeral per-turn. It means the session controller manages a queue of session contexts, dispatching turns to the SDK one at a time but allowing multiple logical sessions to coexist. The human's turn always preempts a background turn.

The practical shape: an agent calls `chat send --background` (or the MCP equivalent), and the daemon queues the turn. When the human's current turn completes, the background turn runs. If the human sends another message, the background turn yields. This is cooperative multitasking at the session level.

### Vision Alignment

- **Anti-goal check:** Not multi-user. Multiple sessions serve one user through different interfaces (web, CLI, agent). Not cloud. All sessions are local.
- **Principle alignment:** "Human-agent parity at the application boundary" is the direct driver. Parity requires that agents can actually use the boundary, not just that the boundary exists. "Server processes to completion" extends naturally: background turns also process to completion, they just yield priority.
- **Tension resolution:** "CLI completeness vs web completeness" applies. The CLI (and agents) need session access that doesn't conflict with the web. The resolution is priority-based: web is primary for interactive use, CLI/agents accept queuing.
- **Constraint check:** Requires refactoring `active-session-controller.ts` from singleton to session registry. The ephemeral per-turn model makes this feasible. The hard part is state isolation between concurrent sessions.

### Scope: Large

---

## 5. The Daemon as MCP Composition Layer

### Evidence

The CLI already projects its command registry into MCP tool definitions (`cli/src/commands/mcp.ts`). The `mcp config` command outputs configuration pointing to `memory-loop mcp serve`. This command appears in config output but has no executor implementation yet, indicating it's a forward-looking stub.

Separately, every discussion session gets a `vault-transfer` MCP server injected (`daemon/src/vault-transfer.ts`), giving Claude the ability to move content between vaults. The daemon is already an MCP server host.

The vision frames MCP as "CLI commands projected as tool definitions" (REQ-DAB-13). But the daemon already hosts MCP servers that aren't CLI projections (vault-transfer). The architecture is reaching toward a role the vision doesn't name: the daemon as a composition layer where multiple tool servers meet vault context.

### Proposal

Frame the daemon as an MCP host that composes tool servers around vault context. The CLI projection is one tool server. Vault transfer is another. But the daemon could also host tool servers for extraction queries ("what do I know about X?"), card management ("generate cards from this file now"), or vault-aware web search ("search for context related to my current thinking session").

The key insight: every tool server the daemon hosts automatically gets vault context. A generic web search tool knows nothing about you. A web search tool hosted by the daemon knows what vault you're working in, what your recent captures contain, what your current thinking session is about. Context injection at the tool-server level is more powerful than context injection at the prompt level, because it shapes what the tool does, not just what the model says.

This also resolves the strategic question about CLI-MCP relationship. The MCP server is neither a thin wrapper that shells out to the CLI nor a daemon endpoint that duplicates CLI logic. It's a composition layer. CLI commands are one input. Native daemon capabilities are another. External tool servers could be a third. The daemon hosts them all and injects vault context into each.

### Vision Alignment

- **Anti-goal check:** Not cloud (all local). Not general-purpose AI (tools are vault-grounded). Not replacing Obsidian (tools enhance, don't replace).
- **Principle alignment:** "Human-agent parity" is strengthened: agents get the same rich tool environment that interactive sessions get. "Vault as source of truth" holds: context injection reads from the vault, doesn't create a parallel data store.
- **Tension resolution:** "Architectural purity vs shipping" applies. The daemon is already an MCP host (vault-transfer). This proposal names and extends that role rather than introducing a new architectural concept.
- **Constraint check:** MCP server hosting is technically solved (vault-transfer exists). The composition layer is the new concept. The strategic question about CLI-MCP relationship (vision line 126-129) gets a resolution: they coexist in the composition layer, not compete.

### Scope: Medium

---

## 6. Derived Views as First-Class Concept ("Lenses")

### Evidence

Three systems produce derived views of vault content, each with different storage, update schedules, and UI surfaces:

| System | Source | Output | Storage | Schedule | UI |
|--------|--------|--------|---------|----------|-----|
| Cards | Vault markdown files | Q&A flashcards | `{vault}/06_Metadata/cards/*.md` | Nightly (daily + weekly) | Ground tab review queue |
| Extraction | Conversation transcripts | Durable facts | `~/.claude/rules/memory.md` | Nightly (3am) | None (invisible to user) |
| Tasks | Vault markdown files | Checkbox aggregation | Computed on request | On demand | Recall tab task list |

Each was built independently. Each reimplements: source scanning, change detection (checksums or timestamps), deduplication (Levenshtein in both cards and extraction), state tracking (JSON state files with processedFiles maps). The card dedup logic (`daemon/src/spaced-repetition/card-dedup.ts`) and extraction dedup logic (`daemon/src/extraction/memory-writer.ts`) are structurally identical patterns applied to different content.

### Proposal

Name what these systems share: they are lenses. A lens is a derived view of vault content that stays in sync with its source. Each lens has a source selector (which files to observe), a transform (what to produce), a dedup strategy (how to avoid redundancy), a storage location, and an update schedule.

Making lenses explicit doesn't mean building a plugin system. It means recognizing the shared abstraction and making it available for composition. A user who wants "extract key quotes from my reading notes" shouldn't need a new feature. They need a new lens definition: source = `03_Resources/reading/**/*.md`, transform = "identify memorable quotes," output = `06_Metadata/quotes/*.md`, schedule = weekly.

The vision's strategic question about extraction surfacing becomes a lens concern: how does any lens surface its output to the user? Cards have a review queue. Tasks have a list. Extraction has nothing. A unified lens surface on the Ground tab would show: "3 new cards generated, 5 facts extracted, 2 quotes discovered" with drill-through to each.

### Vision Alignment

- **Anti-goal check:** Not replacing Obsidian (lenses produce metadata, not content). Not optimizing for speed (lenses run on schedules, not real-time). Not general-purpose AI (every lens is vault-grounded).
- **Principle alignment:** "Vault as source of truth" is strengthened: lenses are explicitly derivative. The source markdown is authoritative; the lens output is computed. "Teach the practice" extends: lenses show you what your vault contains from different angles.
- **Tension resolution:** "Automation vs user agency" applies. Lenses observe and produce. The user reviews, corrects, and curates lens output.
- **Constraint check:** Requires abstracting the shared patterns from card-discovery and extraction into a common lens runtime. The patterns are already structurally identical (source scan, change detection, dedup, state tracking). The abstraction is hovering just beneath the surface.

### Scope: Large

---

## 7. The Unasked Question in the Strategic Questions

### Evidence

The vision lists four strategic questions. Three are architectural (extraction surfacing, CLI-MCP relationship, proxy vs direct). One is product-level (mobile UX investment). None ask the question the user's own workflow implies.

The user's note processing workflow: daily notes, expand-note, daily debrief, weekly debrief, weekly synthesis, monthly summary, archive. Memory Loop implements Capture (daily notes), Think (expand-note, debriefs), and Recall (archive lookup). But the synthesis steps (weekly synthesis, monthly summary) happen outside Memory Loop, likely in Obsidian or Claude Code directly.

The daily prep system surfaces today's commitments. Nothing surfaces this week's themes or this month's arc. The extraction pipeline finds durable facts in individual transcripts. Nothing finds durable patterns across transcripts.

### Proposal

The fifth strategic question: **Should Memory Loop own the synthesis layer of the user's workflow, or remain a capture-and-think tool that feeds into external synthesis?**

If Memory Loop owns synthesis, the daemon needs periodic aggregation skills: weekly digests that read the week's captures and conversations, identify themes, surface unresolved threads. Monthly summaries that read weekly digests and find the through-lines. These would be new slash commands (like `/daily-debrief` but at longer cadences) or new scheduled pipelines (like extraction but producing synthesis artifacts instead of fact lists).

If Memory Loop doesn't own synthesis, it should at least prepare for it. The daemon API should expose the raw signals that an external synthesis tool would need: captures by date range, conversation topics by date range, card review patterns, extracted facts timeline. The CLI commands for this exist partially (`search`, `browse`, `chat history`), but there's no "give me everything that happened this week in structured form" endpoint.

This question matters because the user's workflow already spans both tools. The gap between "Memory Loop captures and thinks" and "something synthesizes" is where context gets lost between sessions. Closing it is where Memory Loop either becomes a complete knowledge operating system or remains a very good mobile capture and conversation tool.

### Vision Alignment

- **Anti-goal check:** Not general-purpose AI. Synthesis is grounded in vault content and user activity. Not replacing Obsidian. Synthesis could produce vault-native artifacts (markdown files in a synthesis directory) that Obsidian can open and edit.
- **Principle alignment:** "Teach the practice" is the direct alignment. The GCTR framework teaches within a session. Synthesis teaches across sessions. "Vault as source of truth" holds: synthesis reads from and writes to the vault.
- **Tension resolution:** "Mobile UX vs feature richness" applies. Synthesis is probably a desktop/CLI feature. The tension resolution table says don't degrade desktop to force mobile parity. This follows that precedent.
- **Constraint check:** Depends on whether the user wants Memory Loop to own this. The daily prep system suggests yes (it already does daily-scale synthesis). But weekly/monthly synthesis may belong in the user's Obsidian workflow, not in Memory Loop. This needs resolution before implementation.

### Scope: Medium (if feeding external synthesis), Large (if owning synthesis)

---

## Issues Spotted

### Stale reference document

`.lore/reference/_overview.md` still describes the pre-daemon architecture (lines 44-55: "The backend is a library consumed by Next.js API routes. It contains domain logic but no HTTP server of its own."). The daemon migration completed in March 2026. This document's `status: current` is incorrect. Should be updated or archived.

### MCP serve stub

The CLI's `mcp config` command outputs a configuration block referencing `memory-loop mcp serve`, but this command has no executor implementation. It's a forward-looking stub, but it's not documented as such anywhere. A reader encountering it would expect it to work.
