# Daily Prep Skill

A morning ritual for deciding what to focus on today. Part of the bookend planning system (morning prep + evening debrief).

## What This Skill Provides

1. **Energy-aware planning** - Matches tasks to current energy level
2. **Calendar awareness** - Adjusts commitment size based on meeting load
3. **Vault surfacing** - Finds relevant tasks without manual searching
4. **Structured commitment** - Creates an evaluable contract with yourself

## Activation

- `/daily-prep`
- "daily prep"
- "morning prep"
- "what should I focus on today"
- "plan my day"
- "start my day"

## Morning Flow

1. **Energy Check** - Sharp / Steady / Low
2. **Calendar Shape** - Clear / Scattered / Heavy
3. **Surfacing** - Find Pressure, Slipping, and Quick Win items from vault
4. **Dialogue** - User can correct, add, or redirect
5. **Commitment** - Confirm 1-3 items to focus on
6. **Save** - Write prep file for evening review

## Key Behaviors

The skill will:
- Ask structured questions via AskUserQuestion
- Search the vault for relevant tasks proactively
- Present findings in clear categories
- Suggest commitments based on context
- Save prep file in standard format

The skill will not:
- Enforce hard limits on commitment count
- Access calendar APIs (self-report only)
- Draw conclusions about what matters most
- Skip steps to be faster

## Tools Used

No custom scripts. Uses existing Claude Code tools:
- **AskUserQuestion** - Energy, calendar, confirmation
- **Grep** - Task and mention searching
- **Glob** - Date-based file finding
- **Read** - Context from daily notes
- **Write** - Save prep file

## File Structure

```
daily-prep/
├── SKILL.md           # Main skill documentation
├── README.md          # This file
└── references/
    └── file-format.md # YAML frontmatter specification
```

## Integration

Works with other skills:
- **vault-task-management** - Referenced for task queries
- **daily-debrief** - Reads prep file for evening closure
- **research-assistant** - Similar proactive search pattern

## Storage

Prep files are saved to:
```
{inboxPath}/daily-prep/YYYY-MM-DD.md
```

Where `inboxPath` comes from vault config (default: `00_Inbox`).

## Research Background

The approach is validated by:
- Implementation intentions improve goal attainment ~3x
- Energy management outperforms pure time management
- Evening reflection improves performance 22-25%
- The Zeigarnik effect: planning closes open loops
