---
title: Spaced Repetition Feature
date: 2026-01-28
status: current
tags: [spaced-repetition, sm2, flashcards, review]
modules: [spaced-repetition-widget, card-manager, sm2-algorithm]
---

# Feature: Spaced Repetition

## What It Does

Spaced Repetition turns vault notes into flashcards and schedules them for optimal retention. Cards are automatically generated from your notes using Claude, then presented for review using the SM-2 algorithm (the same algorithm Anki uses).

The goal: remember what you write without re-reading everything.

## User Flow

```
Your Notes           Claude Sonnet         Review Widget
    │                     │                     │
    ▼                     │                     │
┌─────────────┐           │                     │
│ 02_Areas/   │           │                     │
│ Projects/   │───────────┼────────────────────▶│ Question
│ *.md        │  Extract Q&A pairs             │    ↓
└─────────────┘                                │ Show Answer
                                               │    ↓
                                               │ Self-Assess
                                               │ (Again/Hard/Good/Easy)
                                               │    ↓
                                               │ SM-2 schedules next review
```

## Capabilities

- **Automatic card generation**: Daily/weekly scans find new notes and create cards
- **Manual generation**: Trigger via Settings → Card Generator → "Generate Cards Now"
- **Review session**: Answer questions, reveal answer, self-assess recall quality
- **Keyboard shortcuts**: 1/2/3/4 for Again/Hard/Good/Easy, Enter for Show Answer
- **Skip**: Move card to end of queue (review later today)
- **Forget**: Archive card permanently (won't appear again)
- **Open source**: Jump to the original note in Recall tab

## Entry Points

| Entry | Type | Handler |
|-------|------|---------|
| Ground tab widget | Frontend | `SpacedRepetitionWidget.tsx` |
| GET /api/vaults/:id/cards/due | REST | `routes/cards.ts` |
| GET /api/vaults/:id/cards/:cardId | REST | `routes/cards.ts` |
| POST /api/vaults/:id/cards/:cardId/review | REST | `routes/cards.ts` |
| POST /api/vaults/:id/cards/:cardId/archive | REST | `routes/cards.ts` |
| Settings → Card Generator | Frontend | `SettingsDialog.tsx` |

## Card Generation

See [Card Generator](./_infrastructure/card-generator.md) for detailed scheduling, cost controls, and deduplication logic.

### Triggers

| Trigger | Schedule | Scope |
|---------|----------|-------|
| **Daily** | 4am | Files modified in last 24h (unbounded) |
| **Weekly** | Sundays 4am | Oldest unprocessed files (byte-limited) |
| **Manual** | User-initiated | Remaining weekly budget |

### Discovery Process

1. Scan vault for `.md` files (excluding metadata, chats, CLAUDE.md)
2. Calculate SHA-256 checksum of each file
3. Compare against `card-discovery-state.json`
4. Process only new or modified files

### LLM Extraction

**Model**: Claude Sonnet (cost-efficient for batch extraction)

**Prompt structure**:
```
Extract factual Q&A pairs from the following content for spaced repetition learning.

Requirements:
{user requirements OR default requirements}

Source file: {path}
Content: {truncated to 8000 chars}

Respond ONLY with a JSON array: [{"question": "...", "answer": "..."}]
```

**Default requirements** (can be customized):
- Questions must be self-contained (no "this" or "the above")
- Answers must be unambiguous and complete
- Skip opinions, TODOs, transient information
- Only extract facts useful to recall weeks/months later

### Card Storage

**Location**: `{vault}/06_Metadata/memory-loop/cards/{uuid}.md`

**Format**:
```markdown
---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-28"
last_reviewed: null
next_review: "2026-01-28"
ease_factor: 2.5
interval: 0
repetitions: 0
source_file: "02_Areas/Projects/memory-loop.md"
---

## Question

What is the default ease factor for new cards in SM-2?

## Answer

2.5
```

## SM-2 Algorithm

The SM-2 algorithm schedules cards based on how well you recall them.

### Self-Assessment Options

| Response | Keyboard | Meaning | Effect |
|----------|----------|---------|--------|
| **Again** | 1 | Failed to recall | Reset to 1 day, EF -0.20 |
| **Hard** | 2 | Recalled with difficulty | interval × 1.2, EF -0.15 |
| **Good** | 3 | Recalled normally | interval × EF |
| **Easy** | 4 | Perfect recall | interval × EF × 1.3, EF +0.15 |

### Interval Progression

Example for a new card reviewed with "Good" each time:

| Review | Interval | Next Review |
|--------|----------|-------------|
| 1st | 1 day | Tomorrow |
| 2nd | 6 days | Next week |
| 3rd | 15 days | ~2 weeks |
| 4th | 38 days | ~5 weeks |
| 5th | 95 days | ~3 months |

### Ease Factor

- **Default**: 2.5 (for new cards)
- **Minimum**: 1.3 (prevents cards from becoming impossibly hard)
- **Maximum**: 3.0 (prevents intervals from growing too fast)

Cards you struggle with get lower ease factors and shorter intervals.

## Widget State Machine

```
┌─────────┐
│ loading │
└────┬────┘
     │
     ├── 0 cards ──→ [ idle ] "No cards due today"
     │
     └── N cards ──→ ┌──────────┐
                     │ question │ ←───────────────┐
                     └────┬─────┘                 │
                          │                       │
            ┌─────────────┼─────────────┐         │
            │             │             │         │
          Skip         Forget     Show Answer     │
            │             │             │         │
            │         Archive     ┌──────────┐    │
            │             │       │ revealed │    │
            │             │       └────┬─────┘    │
            │             │            │          │
            │             │      1/2/3/4 assess   │
            │             │            │          │
            └─────────────┴────────────┴──────────┤
                                                  │
                              More cards? ────────┤
                                   │              │
                                  Yes            No
                                   │              │
                                   └──────────────┘
                                          │
                                          ▼
                                    ┌──────────┐
                                    │ complete │
                                    └──────────┘
                                    "Great job!"
```

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/components/home/SpacedRepetitionWidget.tsx` | Review UI (558 lines) |
| `frontend/src/hooks/useCards.ts` | REST API client |
| `backend/src/spaced-repetition/card-generator.ts` | LLM extraction |
| `backend/src/spaced-repetition/sm2-algorithm.ts` | Interval calculation |
| `backend/src/spaced-repetition/card-storage.ts` | File I/O, parsing |
| `backend/src/spaced-repetition/card-manager.ts` | CRUD operations |
| `backend/src/spaced-repetition/card-discovery-scheduler.ts` | Cron, discovery |
| `backend/src/spaced-repetition/card-discovery-state.ts` | Checksum tracking |
| `backend/src/routes/cards.ts` | REST endpoints |

### REST API

| Endpoint | Purpose |
|----------|---------|
| `GET /cards/due` | Fetch cards where `next_review <= today` |
| `GET /cards/:id` | Fetch full card with answer (after "Show Answer") |
| `POST /cards/:id/review` | Submit assessment, apply SM-2, return new schedule |
| `POST /cards/:id/archive` | Move card to `cards/archive/` (permanent removal) |

### Configuration

**Card Generator Config** (`~/.config/memory-loop/card-generator-config.json`):
```json
{
  "weeklyByteLimit": 512000
}
```

**Requirements Override** (`~/.config/memory-loop/card-generator-requirements.md`):
Custom prompt requirements for Q&A extraction. Editable via Settings → Card Generator.

**Discovery State** (`~/.config/memory-loop/card-discovery-state.json`):
Tracks processed files by checksum, prevents reprocessing unchanged content.

## Design Decisions

### Date-Seeded Randomization
Cards with the same `next_review` date are shuffled deterministically by today's date. Same order all day, different order tomorrow. Prevents sequence recognition effects.

### Atomic File Writes
Cards are written via temp file + rename pattern. If process crashes mid-write, the card is either fully written or not written at all (never corrupted).

### Checksum-Based Idempotency
File content is SHA-256 hashed. Same content won't be reprocessed even if file is touched. Modified content triggers re-extraction.

### Byte-Limited Weekly Scans
Weekly pass processes older files up to a configurable byte limit (default 500KB). Prevents runaway costs on large vaults while ensuring all content eventually gets processed.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Ground](./home-dashboard.md) | Widget lives in Ground tab |
| [Card Generator](./_infrastructure/card-generator.md) | Creates cards from vault notes |
| [System Settings](./_infrastructure/system-settings.md) | Card Generator tab for config |
| [Recall](./recall.md) | "Open" and "Open Source" navigate here |

## Notes

- Widget hides on API error (doesn't block Ground tab)
- New cards are due immediately (`next_review = today`)
- Archived cards retain metadata but are excluded from review
- `source_file` is optional (cards can exist without source link)
- Both question and answer support markdown (rendered with react-markdown)
