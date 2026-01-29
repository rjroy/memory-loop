# Infrastructure: Extraction Pipeline

## What It Does

Extraction is an automated overnight batch system that reads conversation transcripts, uses Claude to identify durable facts, and writes them to `~/.claude/rules/memory.md` where they become context for all future Claude interactions.

The goal: Claude remembers what matters about you without you repeating it every session.

## Pipeline Overview

```
Transcripts         Claude SDK           Global Memory
(per vault)         (Haiku model)        (~/.claude/rules/)
     │                    │                    │
     ▼                    │                    │
┌─────────────┐           │                    │
│ {inbox}/    │           │                    │
│ chats/*.md  │───────────┼───────────────────▶│ memory.md
└─────────────┘    Extract facts,             │ (≤50KB)
                   merge with existing         │
```

## Trigger: When Does It Run?

### Scheduled (Primary)
- **Default**: 3am daily (`EXTRACTION_SCHEDULE=0 3 * * *`)
- **Catch-up**: If last run was >24h ago, runs immediately on server start
- **Production only**: Disabled when `NODE_ENV=development`

### Manual
- **Settings Dialog** → Extraction Prompt tab → "Run Extraction" button
- Sends `trigger_extraction` WebSocket message
- Same pipeline as scheduled, just user-initiated

## Pipeline Steps

### 1. Discovery
Find unprocessed transcripts across all vaults:
- Location: `{vault}/{inbox}/chats/*.md`
- Calculate SHA-256 checksum of each file
- Compare against `extraction-state.json` to find new/changed transcripts

### 2. Sandbox Setup
Isolate the memory file for safe SDK access:
- Create `{VAULTS_DIR}/.memory-extraction/` directory
- Copy `~/.claude/rules/memory.md` → sandbox
- SDK operates in sandbox, never touches global file directly

### 3. Extraction (Claude SDK)
Run Haiku model with extraction prompt:
- **Model**: Haiku (cost-efficient for batch work)
- **Budget**: $0.50 max per run
- **Tools**: Glob, Grep, Read, Edit, Write
- **Working dir**: `VAULTS_DIR` (sandbox accessible)

The SDK:
1. Reads each transcript
2. Identifies facts matching configured categories
3. Merges with existing memory (add new, update refined, remove outdated)
4. Writes updated sandbox/memory.md

### 4. Commit
Apply sandbox changes to global file:
- Read sandbox/memory.md
- Enforce 50KB limit (prune oldest entries if over)
- Atomic write to `~/.claude/rules/memory.md`

### 5. Update State
Mark transcripts as processed:
- Store checksum for each processed transcript
- Update `lastRunAt` timestamp
- Write `extraction-state.json`

### 6. Cleanup
Remove sandbox directory.

## What Gets Extracted

The extraction prompt defines categories. Default categories:

| Category | Purpose | Example |
|----------|---------|---------|
| **Identity** | Calibrate technical depth | "Senior engineer, 20 years in games" |
| **Goals** | Active projects for context | "Building Memory Loop" |
| **Preferences** | Communication style | "Prefers direct feedback" |
| **Project Context** | Technical decisions | "Uses bun, not npm" |
| **Patterns** | Recurring themes | "Rejects over-engineering" |

**The test**: "Would knowing this fact change how an AI responds?"

## Storage

### Global Memory File
**Path**: `~/.claude/rules/memory.md`

Claude reads this file as context. Format:
```markdown
# Memory

## Identity
Senior engineering manager, 20 years in game industry.

## Goals
Building Memory Loop (mobile web interface for Obsidian vaults).

## Preferences
Values direct communication. Start simple, add complexity only when needed.

## Patterns
Rejects over-engineering. Thinks out loud, externalizes reasoning.
```

### Size Enforcement
- **Limit**: 50KB hard, 45KB warning
- **Pruning**: When over limit, remove oldest entries from largest section
- **Why top-of-section**: SDK adds new facts at bottom; oldest facts at top are most likely stale

### Extraction State
**Path**: `~/.config/memory-loop/extraction-state.json`

```json
{
  "lastRunAt": "2026-01-28T03:00:00.000Z",
  "processedTranscripts": [
    {
      "path": "00_Inbox/chats/2026-01-27.md",
      "vaultId": "work-vault",
      "checksum": "abc123...",
      "processedAt": "2026-01-28T03:00:05.000Z"
    }
  ]
}
```

Checksums enable idempotent processing: same content won't be reprocessed.

## User Customization

### Extraction Prompt
Users can customize what categories to extract:

**Default**: `backend/src/prompts/durable-facts.md` (checked into code)
**Override**: `~/.config/memory-loop/durable-facts.md` (user-writable)

Access via Settings Dialog → Extraction Prompt tab:
- View current prompt (shows "Custom" or "Default" badge)
- Edit and save (creates override file)
- Reset to default (deletes override)

### Memory File
Users can directly edit `~/.claude/rules/memory.md`:
- Manual edits survive extraction (merge behavior preserves existing content)
- Settings Dialog → Memory tab provides safer editing interface

## Implementation

### Files Involved

| File | Role |
|------|------|
| `backend/src/index.ts` | Scheduler initialization on startup |
| `backend/src/extraction/extraction-manager.ts` | Pipeline orchestration, scheduling |
| `backend/src/extraction/fact-extractor.ts` | Claude SDK interaction, prompt building |
| `backend/src/extraction/memory-writer.ts` | Sandbox ops, size enforcement, atomic writes |
| `backend/src/extraction/extraction-state.ts` | State persistence, checksum tracking |
| `backend/src/extraction/transcript-reader.ts` | Transcript discovery, frontmatter parsing |
| `backend/src/handlers/memory-handlers.ts` | WebSocket handlers for manual trigger |
| `backend/src/prompts/durable-facts.md` | Default extraction prompt |

### WebSocket Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `trigger_extraction` | Client → Server | Manual extraction run |
| `extraction_status` | Server → Client | Progress/completion/error updates |
| `get_extraction_prompt` | Client → Server | Load current prompt |
| `extraction_prompt_content` | Server → Client | Return prompt content |
| `save_extraction_prompt` | Client → Server | Save custom prompt |
| `reset_extraction_prompt` | Client → Server | Delete override, use default |

### Configuration (Environment)

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXTRACTION_SCHEDULE` | `0 3 * * *` | Cron schedule |
| `EXTRACTION_CATCHUP_HOURS` | `24` | Catch-up threshold |
| `EXTRACTION_TIMEZONE` | server local | Cron timezone |
| `NODE_ENV` | - | If `development`, scheduler disabled |

## Design Decisions

### Sandbox Pattern
**Problem**: Can't give SDK write access to `~/.claude/rules/`.
**Solution**: Copy to sandbox in VAULTS_DIR, run SDK there, copy back.
**Recovery**: On startup, if sandbox exists from crash, complete the copy-back.

### Checksum-Based Idempotency
**Problem**: Don't want to reprocess unchanged transcripts.
**Solution**: SHA-256 of content. Only process if checksum differs from last run.

### Haiku Model
**Problem**: Extraction is batch work; Sonnet/Opus would be expensive.
**Solution**: Use Haiku with $0.50 budget. Good enough for fact extraction.

### Prune Oldest from Largest
**Problem**: Memory file could grow unbounded.
**Solution**: 50KB limit. When over, remove oldest entries from largest section.
**Assumption**: SDK adds new at bottom, so top-of-section is oldest.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [System Settings](./system-settings.md) | Extraction Prompt tab, Memory Editor tab |
| [Think](../think.md) | Produces transcripts that get extracted |
| All conversations | Memory.md injected as Claude context |

## Not Yet Implemented

- **Vault-specific insights**: Code exists in memory-writer.ts to update `{vault}/CLAUDE.md` with vault-specific facts, but pipeline doesn't call it
- **Duplicate tracking**: `duplicatesFiltered` always returns 0; dedup functions exist but aren't wired up
- **Granular progress**: Manual trigger only shows start/complete, no "processing 3 of 10"
