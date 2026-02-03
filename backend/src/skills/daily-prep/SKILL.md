---
name: Daily Prep
description: This skill should be used when the user says "/daily-prep", "daily prep", "morning prep", "what should I focus on today", "plan my day", "start my day", "prep for today", or wants help deciding what to work on. Creates a morning commitment with energy and calendar context.
version: 0.1.0
---

# Daily Prep

A morning ritual for deciding what to focus on today. The skill guides the user through energy check, calendar assessment, surfacing relevant tasks, and finalizing 1-3 commitments.

## Philosophy

The value is not in filtering algorithms; it is in creating an evaluable contract with yourself. Morning commitment + evening reflection forms the bookend.

Research supports this approach:
- **Implementation intentions** (specific commitments) improve goal attainment ~3x
- **Energy management** outperforms pure time management
- **Zeigarnik effect**: planning closes open loops even without completion
- **Decision fatigue**: keep task selection simple and early

## Morning Flow

### 1. Energy Check

To begin, use AskUserQuestion to collect the user's energy level:

```
Question: "How's your energy this morning?"
Options:
- Sharp: Ready for deep work
- Steady: Normal energy, can handle variety
- Low: Need easy wins or lighter tasks
```

### 2. Calendar Shape

Next, use AskUserQuestion for meeting density:

```
Question: "What does your calendar look like?"
Options:
- Clear: Large blocks of uninterrupted time
- Scattered: Some meetings but workable gaps
- Heavy: Meeting-dense, need quick tasks
```

### 3. Surfacing

To surface relevant work, reference the `vault-task-management` skill for task queries. Use Grep and Read tools to find recent captures.

Look for items in these categories:

**Pressure** - Tasks with external weight:
- Fire tasks (`f` status in vault-task-management)
- Tasks mentioned in recent daily notes
- Tasks connected to people (names in task text)
- Approaching deadlines

**Slipping** - Tasks going cold:
- Tasks in files not modified for 3+ days
- Incomplete tasks from old daily notes
- Items mentioned multiple times without progress

**Quick Wins** - Small completable items:
- Short task text
- No dependencies mentioned
- Similar to tasks completed quickly before

Present surfaced items grouped by category. Example:

```
Here's what I found in your vault:

**Pressure**
- [f] Review Roman's PR (mentioned in yesterday's note)
- TTS spec response to Ryan (people dependency)

**Slipping**
- Auth ADR from last week (not touched in 5 days)
- Test coverage for session manager (3 mentions, no progress)

**Quick Wins**
- Update CLAUDE.md with new pattern
- Close stale GitHub issue
```

### 4. Dialogue

Allow the user to respond with corrections, additions, or redirections:
- "What about that other thing?"
- "Actually, the ADR is blocked"
- "Add reviewing the SDK migration"

Incorporate feedback and adjust the surfaced list. The user drives; the skill supports.

### 5. Commitment

To finalize, suggest 1-3 commitment items based on:
- Energy level (Sharp = deep work OK, Low = quick wins)
- Calendar shape (Heavy = only time-boxed items)
- User's expressed priorities during dialogue

Present as a proposal, not a mandate:

```
Based on your steady energy and scattered calendar, I'd suggest:

1. Review Roman's PR with real feedback
2. Revisit auth ADR from last week
3. TTS spec response to Ryan

Does this feel right for today?
```

Use AskUserQuestion to confirm or allow the user to edit in their own words.

### 6. Save

To complete the prep, use the Write tool to save the daily prep file:

**Path:** `{inboxPath}/daily-prep/YYYY-MM-DD.md`

Where `inboxPath` is the vault's configured inbox directory (usually `00_Inbox`).

For file format details, see `references/file-format.md`.

## Evening Integration

This skill creates prep files that `/daily-debrief` can read for evening closure. When running `/daily-debrief`:

1. Check for today's prep file
2. If exists, show the morning commitment
3. Collect assessment for each item (Done / Partial / Blocked / Skipped)
4. Record reflection and update the file

The skill does not implement evening closure directly; it prepares the data structure that debrief uses.

## Tools Used

No custom scripts. Uses existing Claude Code tools:
- **AskUserQuestion** - Structured input for energy, calendar, confirmation
- **Grep** - Search vault for tasks, names, recent mentions
- **Glob** - Find files by date pattern
- **Read** - Read daily notes and task files
- **Write** - Save the daily prep file

Reference `vault-task-management` skill for task query patterns.

## Example Session

User: "/daily-prep"

Claude: "How's your energy this morning?"
[AskUserQuestion: Sharp / Steady / Low]

User selects: Steady

Claude: "What does your calendar look like?"
[AskUserQuestion: Clear / Scattered / Heavy]

User selects: Scattered

Claude: [Searches vault, presents surfaced items]
"Here's what I found..."

User: "That looks right, but add the SDK migration review"

Claude: "Got it. Based on steady energy and scattered calendar:
1. Review Roman's PR with real feedback
2. Revisit auth ADR from last week
3. SDK migration review

Ready to commit to these?"

User: "Yes"

Claude: [Writes prep file, confirms]
"Done. Your commitment for today is saved. I'll check in during debrief."

## Constraints

- Suggest 1-3 items (research warns against over-planning)
- Do not enforce a limit; trust user judgment
- No calendar API integration in v1 (self-report only)
- Pattern feedback is future scope (not implemented)
