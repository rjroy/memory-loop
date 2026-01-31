---
title: Card Generator Infrastructure
date: 2026-01-28
status: current
tags: [spaced-repetition, llm, scheduling, cost-control]
modules: [card-generator, card-discovery-scheduler]
---

# Infrastructure: Card Generator

## What It Does

Automated extraction of Q&A flashcards from vault markdown files using Claude Sonnet. Cards feed into the Spaced Repetition review system. Runs on schedule (daily/weekly) or manual trigger, with cost controls and deduplication.

## Scheduling

Three generation passes with different scopes:

| Pass | When | Scope | Byte Limit |
|------|------|-------|------------|
| Daily | 4am | Files modified in last 24h | None |
| Weekly | Sundays 4am | Oldest unprocessed files | Budget-limited |
| Manual | User button | Remaining weekly budget | Budget-limited |

### Daily Pass

Processes recent changes to keep current work fresh:

1. Scan all vaults for `.md` files
2. Filter to files modified in last 24 hours (+30min overlap)
3. Check each file's SHA-256 checksum against stored state
4. If new or changed: extract cards via Claude Sonnet
5. Save cards as individual `.md` files

No byte limit because recent files are typically small.

### Weekly Pass

Backfills historical content gradually:

1. Load weekly byte budget from config
2. Check progress against current week (Monday-based)
3. Find all unprocessed files (not in state)
4. Sort by mtime (oldest first)
5. Process until byte budget exhausted
6. Track bytes processed for the week

### Manual Trigger

User-initiated via System Settings:

1. Check if generation already running
2. Calculate remaining weekly budget
3. If exhausted: reject with message
4. Run weekly pass logic with remaining budget
5. Stream status updates to UI

## Cost Controls

### Weekly Byte Budget

Configurable limit on content processed per week:

| Setting | Range | Default |
|---------|-------|---------|
| Weekly limit | 100KB - 10MB | 500KB |

At 500KB default, roughly 125 notes at 4KB each per week.

### Content Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Minimum | 100 chars | Skip file |
| Maximum | 8000 chars | Truncate |

### Model Selection

Uses Claude Sonnet (not Opus) for cost-efficient batch processing.

### Skip Patterns

Files excluded from processing:

- Hidden files (`.` prefix)
- `06_Metadata/` directory (card storage)
- `{inboxPath}/chats/` (conversation transcripts)
- `CLAUDE.md` files (project instructions)

### Per-Vault Opt-Out

`cardsEnabled` flag in `.memory-loop.json`:

```json
{ "cardsEnabled": false }
```

Disables card generation for vaults with non-knowledge content (templates, references).

## Deduplication

SHA-256 checksum of file content prevents redundant processing:

```json
// card-discovery-state.json
{
  "processedFiles": {
    "/path/to/note.md": "a1b2c3...",
    "/path/to/other.md": "d4e5f6..."
  }
}
```

File reprocessed only if:
- Not in processedFiles (new)
- Checksum differs (content changed)
- Previous attempt failed with retriable error

## Error Handling

### Retriable Errors

Don't mark as processed (will retry next pass):
- Rate limits, token limits, quotas
- Network issues (ECONNREFUSED, ETIMEDOUT)
- Transient SDK issues

### Permanent Errors

Mark as processed to avoid infinite retries:
- Invalid content that can't be parsed
- Authentication failures
- Non-retriable SDK errors

## Card Output

Each card saved as individual markdown file:

**Location:** `{vault}/06_Metadata/memory-loop/cards/{uuid}.md`

**Format:**
```markdown
---
id: abc123-...
source_file: /path/to/note.md
created_at: 2026-01-28T04:15:00.000Z
interval: 0
ease_factor: 2.5
next_review: 2026-01-28
review_count: 0
---

## Question

What is the capital of France?

## Answer

Paris is the capital of France.
```

SM-2 metadata initialized for immediate review (interval 0, next_review today).

## Configuration

### Requirements Prompt

Controls what kinds of cards get generated:

- **Default:** Built-in prompt in `card-generator.ts`
- **Override:** `~/.config/memory-loop/card-generator-requirements.md`

Editable via System Settings → Card Generator tab.

### Config File

`~/.config/memory-loop/card-generator-config.json`:

```json
{
  "weeklyByteLimit": 512000
}
```

### State File

`{vault}/06_Metadata/memory-loop/card-discovery-state.json`:

```json
{
  "processedFiles": { "path": "checksum", ... },
  "lastDailyRun": "2026-01-28T04:00:00.000Z",
  "lastWeeklyRun": "2026-01-26T04:00:00.000Z",
  "weeklyProgress": {
    "bytesProcessed": 245000,
    "weekStartDate": "2026-01-27"
  },
  "runInProgress": null
}
```

## Concurrency Control

Prevents overlapping runs:

- **In-memory flag:** `schedulerState.runInProgress`
- **Persisted flag:** `state.runInProgress` in discovery state

Both checked before starting any pass. Cleared on completion (even on error).

## Implementation

### Files Involved

| File | Role |
|------|------|
| `backend/src/spaced-repetition/card-generator.ts` | LLM extraction logic |
| `backend/src/spaced-repetition/card-discovery-scheduler.ts` | Scheduling passes |
| `backend/src/spaced-repetition/card-generator-config.ts` | Config management |
| `backend/src/spaced-repetition/card-manager.ts` | Card file CRUD |
| `backend/src/handlers/card-generator-handlers.ts` | WebSocket message handlers |
| `frontend/src/components/settings/CardGeneratorEditor.tsx` | Config UI |

### WebSocket Messages

| Message | Purpose |
|---------|---------|
| `get_card_generator_config` | Load config + requirements + usage |
| `save_card_generator_requirements` | Save requirements override |
| `save_card_generator_config` | Save byte limit |
| `reset_card_generator_requirements` | Delete override, restore default |
| `trigger_card_generation` | Start manual pass |
| `get_card_generation_status` | Check progress |
| `card_generation_status` | Progress updates (server → client) |

## Startup Behavior

On server start:
- **First run ever:** Skip catch-up (let weekly handle backlog gradually)
- **Has run before + >24h ago:** Run catch-up pass

Prevents overwhelming new users with thousands of cards at once.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Spaced Repetition](../spaced-repetition.md) | Cards are input to review system |
| [System Settings](./system-settings.md) | Card Generator tab for config |
| [Configuration](./configuration.md) | `cardsEnabled` per-vault flag |

## Notes

- State saved incrementally after each file (crash recovery)
- Week boundaries are Monday-based
- Manual trigger disabled in UI if weekly budget exhausted
- Progress bar in Settings shows current week's usage
