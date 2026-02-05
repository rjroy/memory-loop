---
title: Daily Prep System - Bookend Planning
date: 2026-02-02
status: resolved
tags: [daily-planning, bookend, energy, commitment, ground-tab, gctr]
modules: [home-view, task-list]
related: [.lore/reference/home-dashboard.md, .lore/reference/task-list.md]
---

# Brainstorm: Daily Prep System

## Context

Problem: With 100+ tasks across business alone and 4h+ of meetings daily, how do you decide what to focus on? The existing Ground tab provides orientation ("here's what exists") but not decision support ("here's what to do today").

Three compounding problems:
1. **Volume**: Too many tasks to hold in mind
2. **Time**: Meetings consume most of the day, leaving fragmented work time
3. **Energy**: What you *can* do != what you *will* do given current state

Current state: Adhoc wishful thinking. Works okay (20 years of practice), but creates the question "did I do anything useful today?" without a way to answer it.

## Core Insight: The Bookend Pattern

The value isn't in filtering algorithms. It's in creating an evaluable contract with yourself.

**Morning**: "What does useful look like today?"
**Evening**: "Did I do what I said was useful?"

Without the morning commitment, the evening question has no answer. You did *stuff*, but can't evaluate it.

The system's job isn't "pick the right tasks" - it's "help you make a commitment you can assess."

## Ideas Explored

### Energy as Primary Input

Energy is known in the morning, not the night before. First question should be self-report:
- "Sharp" - give me the hard thing
- "Steady" - normal day
- "Low" - minimum viable day

Tasks don't need priority scores; they need energy alignment. A "scattered" day pulls from different pools than a "sharp" day.

### Calendar Shape vs Calendar Integration

Meeting load matters, but *shape* matters more than hours. 4h of meetings distributed as 4x1h scattered gaps vs 1x4h morning block require different task types.

Self-report is simpler than calendar integration: "Clear / Scattered / Heavy"

### Guided Prompts to Overcome Tabula Rasa

The blank page problem is real. Morning brain needs scaffolding. The flow should surface context that jogs memory:

**Pressure**: Tasks with external weight
- Mentioned in recent captures/meetings
- Has due dates
- Connected to people

**Slipping**: Tasks going cold
- Unchecked for 3+ days
- Created recently but not touched
- Referenced but not on task list

**Quick Wins**: Small completable items
- Short task text (heuristic for small scope)
- Similar tasks completed quickly before

These categories surface candidates; user decides relevance and writes commitment in own words.

### Vault-Scoped, Not Domain-Split

Originally considered professional/personal/health split. Better approach: each vault has its own prep. Professional vault = professional prep. Personal vault = personal prep. Keeps things simple.

### Evening Closure

Same interface, different mode. Show morning commitment, quick assessment per item (Done/Partial/Blocked/Skipped), optional reflection note.

Over time, patterns emerge:
- "I always say exercise but only do it 40% of days"
- "I overcommit on Mondays"
- "When I say 'if time' I never do it"

## Proposed Morning Flow

1. **Energy Check** (5 sec): Sharp / Steady / Low
2. **Calendar Shape** (5 sec): Clear / Scattered / Heavy
3. **Surfacing** (30-60 sec): Scan Pressure / Slipping / Quick Wins panels
4. **Commitment** (30 sec): Write 1-3 things in your own words

Total time: ~2 minutes. "Push the button" simplicity.

## Proposed Evening Flow

1. **Review**: Show morning commitment
2. **Assessment**: Per-item Done/Partial/Blocked/Skipped
3. **Reflection**: Optional freeform note
4. **Save**

## Implementation Approach: Skill-Based Flow

Key insight: This doesn't need custom UI for the flow itself. It's a Claude skill that uses `AskUserQuestion` for structured inputs, then handles dialogue naturally.

### Architecture

```
Ground Tab
┌─────────────────────────────────────────────┐
│  [ Daily Prep ]  [ Daily Debrief ]          │  ← Buttons launch skills
│                                             │
│  Today's Commitment:                        │  ← Shows after prep completes
│  "Roman's PR, auth ADR revisit, TTS spec"   │
│                                             │
└─────────────────────────────────────────────┘
```

### Daily Prep Skill Flow

1. `AskUserQuestion`: Energy (Sharp / Steady / Low)
2. `AskUserQuestion`: Calendar (Clear / Scattered / Heavy)
3. Query vault: tasks, recent captures, recent discussions
4. Present surfacing in conversation (Pressure / Slipping / Quick Wins)
5. Dialogue: user corrects, adds, redirects ("what about that ADR from last week?")
6. AI proposes commitment summary
7. User confirms/edits
8. Save to storage

### Evening Closure Skill Flow

1. Load morning commitment
2. Present: "This morning you said..."
3. `AskUserQuestion` or freeform: assessment per item
4. Dialogue about blockers, pivots, surprises
5. Save reflection

### Why Skill-Based Works

- LLM can understand "that ADR thing from a few days ago" and find it
- User can inject context the system doesn't have
- Structured enough to overcome blank page (AI always presents something first)
- Flexible enough for course correction
- No custom UI components needed for the flow itself

### What's Actually New

**Backend:**
- Surfacing endpoint: `GET /api/vaults/:id/daily-prep/surfacing?energy=steady&calendar=scattered`
- Storage for daily prep records

**Frontend:**
- "Daily Prep" button on Ground tab (trivial, like existing debrief buttons)
- Widget showing current commitment after prep completes

**Skills:**
- `/daily-prep` skill
- `/evening-closure` skill (or same skill, different mode)

### Surfacing API Response Shape

```json
{
  "pressure": [
    { "text": "Review Roman's PR", "signal": "mentioned in standup yesterday" },
    { "text": "TTS spec response", "signal": "due date approaching" }
  ],
  "slipping": [
    { "text": "Leadership decision doc", "signal": "untouched 4 days" },
    { "text": "Unity QBR follow-ups", "signal": "created 5 days ago, never checked" }
  ],
  "quickWins": [
    { "text": "Archive Slack threads", "signal": "3 items, typically <5min each" }
  ]
}
```

## Open Questions

### Storage Model

Options:
- **A) Daily note extension**: Morning/evening appended to existing daily notes (keeps everything together)
- **B) Dedicated files**: `06_Metadata/memory-loop/daily-prep/2026-02-02.md` (cleaner separation, richer structure)
- **C) Hybrid**: Structured data in metadata, summary in daily note

### Surfacing Heuristics

**Pressure** (external weight):
- Mentioned in recent captures/meetings
- Has due dates approaching
- Connected to people (named in task text)
- Flagged markers (🔥)

**Slipping** (going cold):
- Unchecked for N days
- Created recently but not touched
- Referenced in conversation but not on task list

**Quick Wins** (small completable):
- Short task text (heuristic for small scope)
- Similar tasks completed quickly before

Do these categories resonate? Alternative frames possible.

### Pattern Feedback (Future)

Over time, the system could surface:
- "You usually skip 'if time' items"
- "Tuesdays after all-hands tend to go sideways"
- "You've said 'exercise' 5 days, done it 2"

Not MVP, but natural extension.

## Next Steps

- Decide storage model
- Create spec for skill-based implementation
- Define surfacing query heuristics in detail
