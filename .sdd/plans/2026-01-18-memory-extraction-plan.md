---
specification: [.sdd/specs/2026-01-18-memory-extraction.md](./../specs/2026-01-18-memory-extraction.md)
status: Draft
version: 1.0.0
created: 2026-01-18
last_updated: 2026-01-18
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Memory Extraction System - Technical Plan

## Overview

The Memory Extraction System enables cross-session continuity by discovering durable facts from conversation transcripts and persisting them for automatic injection into Claude's context. The implementation adds a batch extraction pipeline that runs overnight, a new Settings UI for memory curation, and integrations with both the global Claude rules directory and vault-specific CLAUDE.md files.

The architecture follows the existing Memory Loop patterns: backend modules handle file I/O and LLM calls, the WebSocket protocol coordinates client-server communication, and the React frontend provides the curation interface. The extraction pipeline operates independently of active sessions, reading transcript files directly without affecting the real-time conversation flow.

## Architecture

### System Context

Memory Extraction adds a background processing layer alongside the existing real-time session management:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Memory Loop                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Frontend   │◄──►│   Backend    │◄──►│ Claude Agent │      │
│  │  (React 19)  │    │   (Hono)     │    │     SDK      │      │
│  └──────────────┘    └──────┬───────┘    └──────────────┘      │
│                             │                                    │
│                     ┌───────┴───────┐                           │
│                     │   Extraction   │  (new)                   │
│                     │   Pipeline     │                           │
│                     └───────┬───────┘                           │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Transcripts │    │  memory.md  │    │  CLAUDE.md  │         │
│  │ {inbox}/    │    │ ~/.claude/  │    │  per-vault  │         │
│  │ chats/*.md  │    │  rules/     │    │  insights   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### Components

**Extraction Pipeline** (`backend/src/extraction/`)
- `extraction-manager.ts`: Orchestrates the extraction process, tracks processed files
- `transcript-reader.ts`: Reads and parses transcript markdown files
- `fact-extractor.ts`: Calls Claude Agent SDK to analyze transcripts and extract facts
- `memory-writer.ts`: Writes/merges facts to memory.md and vault CLAUDE.md files
- `extraction-scheduler.ts`: Manages scheduled execution (cron-style)

**Settings UI** (`frontend/src/components/`)
- `SettingsDialog.tsx`: Tabbed dialog with Memory and Extraction Prompt tabs
- `MemoryEditor.tsx`: Text editor for memory.md content
- `ExtractionPromptEditor.tsx`: Text editor for extraction prompt with override detection

**Shared Protocol** (`shared/src/protocol.ts`)
- New message types for memory/prompt read/write operations
- Settings dialog state management messages

## Technical Decisions

### TD-1: Extraction Trigger Mechanism
**Choice**: Scheduled batch via `node-cron` running in the backend process
**Requirements**: REQ-F-4
**Rationale**: The spec requires daily overnight processing. Using `node-cron` keeps the scheduler within the Bun runtime, avoids external dependencies like systemd timers, and allows configurable scheduling. The extraction runs in-process but spawns work asynchronously to avoid blocking the WebSocket handler. Alternative considered: OS-level cron, rejected because it requires deployment configuration outside the application and complicates Docker deployments.

### TD-2: LLM Extraction Approach
**Choice**: Single Claude Agent SDK `query()` call per extraction run using Haiku model
**Requirements**: REQ-F-6, REQ-F-7
**Rationale**: Rather than parallelize or batch transcript processing, we send all unprocessed transcripts to Claude in one call, letting the Agent SDK manage context internally. This simplifies the implementation and allows Claude to synthesize insights across transcripts. The extraction prompt defines categories (REQ-F-10) and Claude writes markdown directly to the memory file.

**Model choice**: Start with Haiku. Extraction is summarization, not complex reasoning. If Haiku misses something, users can manually add it or delete bad extractions. Worst case with Haiku: "not good enough, turn it up." Worst case with Sonnet: "spent all your tokens for nothing." Can upgrade to Sonnet later if quality is insufficient.

**Tools enabled**:
- `Glob`: Find transcript files across vaults
- `Grep`: Search within transcript content
- `Read`: Read transcript and memory file contents
- `Edit`: Update sections of memory.md without rewriting entire file
- `Write`: Write updated memory.md (sandboxed per TD-12)
- `Task`: Spawn sub-agents to process individual transcripts independently, preserving context per transcript

The Task tool is important because transcripts can be large. Processing each in a sub-agent keeps context clean and lets Claude decide whether to parallelize.

### TD-3: Memory File Format and Location
**Choice**: Markdown at `~/.claude/rules/memory.md` with H2 category headers, narrative by default
**Requirements**: REQ-F-1, REQ-F-2, REQ-F-10, REQ-NF-3
**Rationale**: The memory file must be stored at `~/.claude/rules/memory.md` for automatic injection into Claude's context (REQ-F-1). This location is outside vault content, preserving privacy (REQ-NF-3). The file must be human-readable and LLM-optimized (REQ-F-2).

**Format**: Hybrid narrative with lists where appropriate. Identity, goals, and project context are interconnected and read better as narrative. Preferences can mix narrative with bullet lists for truly independent items. The extraction prompt guides Claude to use the right format per section.

Example structure:
```markdown
# Memory

## Identity
Software engineer with 10 years in Python and TypeScript. Works on AI tooling and personal knowledge management.

## Goals
Building Memory Loop for persistent Claude context. Wants accumulated understanding rather than starting fresh each session.

## Preferences
Values concise communication over verbose explanations. When making decisions:
- Show tradeoffs explicitly
- Start simple, add complexity when needed
- Avoid over-engineering

## Project Context
Memory Loop uses Bun + Hono backend with React frontend. Vault data stored locally, never synced to cloud.
```

### TD-4: Duplicate Detection
**Choice**: Normalized text comparison with fuzzy matching
**Requirements**: REQ-F-9, REQ-NF-2
**Rationale**: Simple string equality is too strict (punctuation, capitalization differences would create duplicates). Normalizing text (lowercase, trim whitespace, remove punctuation) before comparison catches near-duplicates. For additional robustness, we use a similarity threshold (e.g., 0.9 Levenshtein ratio) to catch paraphrased duplicates. This runs client-side on the extracted facts before merge, keeping the logic testable without LLM calls. Combined with transcript tracking (TD-5), this ensures idempotent extraction (REQ-NF-2).

### TD-5: Processed Transcript Tracking
**Choice**: JSON manifest file at `~/.config/memory-loop/extraction-state.json`
**Requirements**: REQ-F-5, REQ-F-8, REQ-NF-2
**Rationale**: We need to track which transcripts have been processed to avoid reprocessing. Transcripts are read from `{inbox}/chats/` directories (REQ-F-5). Storing a JSON manifest with file paths and checksums (SHA-256 of content) allows detecting both new files and modified files, ensuring idempotent extraction (REQ-NF-2). The manifest lives in the user config directory (not in vaults) because extraction is a global operation. Alternative considered: modification time only, rejected because file timestamps can change without content changes.

### TD-6: Extraction Prompt Location
**Choice**: Default at `backend/src/prompts/extraction-prompt.md`, user override at `~/.config/memory-loop/extraction-prompt.md`
**Requirements**: REQ-F-6, REQ-F-15, REQ-F-16
**Rationale**: Per user feedback, the default prompt should be part of the Memory Loop codebase (visible, versioned, improvable). User customization creates a copy-on-write override in their config directory. The Settings UI shows which is active and enables editing. This follows the same pattern as shell dotfiles (defaults in /etc, overrides in ~/).

### TD-7: Vault CLAUDE.md Integration
**Choice**: Append to dedicated `## Memory Loop Insights` section
**Requirements**: REQ-F-3
**Rationale**: Per user feedback, vault-specific insights should not require approval but must be isolated from manually-authored content. We add or update a dedicated section at the end of CLAUDE.md. The section is clearly marked so users know it's auto-generated and can delete it if unwanted. The extractor never touches content outside this section.

### TD-8: Settings UI Integration
**Choice**: Add Settings button to VaultSelect header, open modal dialog with tabs
**Requirements**: REQ-F-11, REQ-F-12, REQ-F-15
**Rationale**: The spec places the Settings entry point on the vault selection screen near the "Memory Loop" title. A tabbed dialog (similar to existing ConfigEditorDialog) keeps the UI consistent. Tab 1: Memory Editor (simple textarea for memory.md). Tab 2: Extraction Prompt Editor (textarea with override indicator). This matches the existing pattern for vault configuration editing.

### TD-9: Memory Size Management
**Choice**: Prune oldest entries when approaching 50KB limit
**Requirements**: REQ-NF-1, REQ-NF-4
**Rationale**: The spec sets a hard 50KB limit to preserve context window budget. When extraction would exceed this limit, we prune the oldest entries (by insertion order, tracked via simple timestamps or line ordering). The UI shows current size and warns when approaching the limit, supporting transparency (REQ-NF-4) by letting users see exactly how much context is being used. Alternative considered: prune by "relevance score," rejected as too complex and subjective for v1.

### TD-10: WebSocket Protocol Extension
**Choice**: Add memory-specific message types to existing protocol
**Requirements**: REQ-F-12, REQ-F-13, REQ-F-15

New client messages:
- `get_memory`: Request current memory.md content
- `save_memory`: Write updated memory content
- `get_extraction_prompt`: Request current extraction prompt (with override status)
- `save_extraction_prompt`: Write extraction prompt (creates override if needed)
- `trigger_extraction`: Manually trigger extraction (for testing/debug)

New server messages:
- `memory_content`: Response with memory text and metadata
- `extraction_prompt_content`: Response with prompt text and override status
- `memory_saved`: Confirmation of memory write
- `extraction_prompt_saved`: Confirmation of prompt write
- `extraction_status`: Progress/completion of extraction run

### TD-11: Memory Editing and Deletion
**Choice**: Plain textarea for markdown editing
**Requirements**: REQ-F-14, REQ-NF-4
**Rationale**: The memory file is markdown. Users edit it in a textarea. To delete an entry, they delete the line. No special UI needed.

### TD-12: Claude Agent SDK Sandboxing
**Choice**: Copy memory.md into VAULTS_DIR sandbox, run extraction, copy back
**Requirements**: REQ-NF-3 (privacy/safety)
**Rationale**: Claude Agent SDK needs Glob, Grep, Read, and Task (sub-agents) to process potentially large transcripts. This requires filesystem access. To protect the user from an AI gone rogue, the SDK working directory is constrained to VAULTS_DIR. Since `~/.claude/rules/memory.md` is outside this sandbox, we:

1. Before extraction: copy `~/.claude/rules/memory.md` to `VAULTS_DIR/.memory-extraction/memory.md`
2. Run extraction with SDK sandboxed to VAULTS_DIR
3. Claude uses tools freely within sandbox, writes to sandboxed memory.md
4. After extraction: copy result back to `~/.claude/rules/memory.md`
5. Clean up sandbox copy

**Recovery logic** (on Memory Loop startup):
- Check if `VAULTS_DIR/.memory-extraction/memory.md` exists
- If exists and newer than `~/.claude/rules/memory.md`: previous extraction crashed after write but before copy-back
- Recovery: complete the copy-back, then clean up
- If exists and older/same: stale file from aborted run, delete it

Vault CLAUDE.md files are already within VAULTS_DIR, so no special handling needed for those.

## Data Model

### Extraction State
```typescript
interface ExtractionState {
  lastRunAt: string | null;  // ISO 8601 timestamp
  processedTranscripts: ProcessedTranscript[];
}

interface ProcessedTranscript {
  path: string;           // Relative path from vault root
  vaultId: string;        // Source vault
  checksum: string;       // SHA-256 of content
  processedAt: string;    // ISO 8601 timestamp
}
```

This tracks which transcripts have been processed to avoid reprocessing. The memory file itself is just markdown text with no structured metadata.

## Integration Points

### Transcript Manager
- **Integration**: Read-only access to transcript files
- **Data flow**: `getTranscriptsDirectory(vault)` provides base path, extraction reads `*.md` files
- **Dependencies**: Uses existing `VaultInfo.inboxPath` to locate transcripts

### Claude Agent SDK
- **Integration**: `query()` call for LLM-based extraction
- **Data flow**: Send transcript content + extraction prompt, receive structured JSON with facts
- **Dependencies**: Same SDK setup as session-manager, but with extraction-specific options (lower cost cap, no tools needed)

### Vault Manager
- **Integration**: Enumerate vaults for cross-vault extraction
- **Data flow**: `discoverVaults()` returns all vaults, extraction processes each
- **Dependencies**: Uses existing vault discovery, adds CLAUDE.md write capability

### VaultSelect UI
- **Integration**: Add Settings button to header
- **Data flow**: Button click opens SettingsDialog
- **Dependencies**: New component, follows existing modal patterns

### WebSocket Handler
- **Integration**: Route new memory/extraction message types
- **Data flow**: Client sends get/save messages, server reads/writes files
- **Dependencies**: Follows existing handler extraction pattern (`handlers/memory-handlers.ts`)

## Error Handling, Performance, Security

### Error Strategy
- **File errors**: Log and continue, report via health collector for UI visibility
- **LLM errors**: Retry once with backoff, then mark transcript as "failed" for next run
- **Parse errors**: Skip malformed transcripts, log warning, don't block other transcripts
- **Size limit errors**: Prune oldest facts until under limit, log what was removed

### Performance Targets
The spec explicitly removed performance requirements. The extraction runs overnight when the user isn't actively using the app. No specific latency or throughput targets. Memory file reads for the Settings UI should be fast (file I/O), but there's no streaming requirement.

### Security Measures
- **Path validation**: Memory file path is hardcoded (`~/.claude/rules/memory.md`), no user input for paths
- **Extraction prompt path**: Either codebase default or user config directory, validated before read/write
- **No secrets in memory**: Extraction prompt includes explicit instruction to never extract credentials, API keys, passwords
- **Vault isolation**: Each vault's CLAUDE.md is modified only within the designated section

## Testing Strategy

### Unit Tests
- `extraction-manager.test.ts`: Schedule triggers, state tracking, vault enumeration
- `transcript-reader.test.ts`: Parse various transcript formats, handle malformed files
- `fact-extractor.test.ts`: Mock SDK responses, verify JSON parsing, test category classification
- `memory-writer.test.ts`: Merge logic, duplicate detection, size limit enforcement, CLAUDE.md section isolation
- `extraction-scheduler.test.ts`: Cron expression parsing, next run calculation

**Coverage target**: 80% line coverage for extraction module

### Integration Tests
- End-to-end extraction flow with mock SDK
- Settings UI interaction with backend
- Memory file persistence across restarts
- CLAUDE.md section preservation (don't clobber manual content)

### Acceptance Tests (from spec)
1. First extraction with 5 transcripts creates memory.md
2. Incremental extraction processes only new transcripts
3. Duplicate facts are merged, not duplicated
4. Settings UI edits persist to file
5. Context injection verified in new session
6. Size limit triggers pruning
7. Custom extraction prompt affects category extraction
8. Vault CLAUDE.md isolation: extraction modifies only `## Memory Loop Insights` section, manual content preserved

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM extracts incorrect facts | M | M | User can edit/delete via Settings UI; facts are isolated from manual content |
| Extraction takes too long | L | L | Runs overnight; no SLA; user can view progress in logs |
| Memory file corruption | L | H | Atomic writes (write to temp, rename); backup before modification |
| CLAUDE.md section overlap | L | M | Use unique section header; never modify content outside section |
| Transcript format changes | M | L | Robust parser with fallbacks; log warnings for unexpected formats |

## Dependencies

### Technical
- `node-cron`: Scheduling library (MIT license, widely used, TypeScript types available)
- Existing: Claude Agent SDK, Zod, Hono

### Team
- No external approvals needed
- Frontend changes follow existing patterns

## Open Questions

- [ ] Should extraction run on server startup if the last scheduled run was missed? (Leaning yes, with a "catch-up" flag)
- [ ] Should the Settings UI show extraction history/logs? (Leaning no for v1, add later if users request)

---

**Next Phase**: Once approved, use `/spiral-grove:task-breakdown` to decompose into implementable tasks.
