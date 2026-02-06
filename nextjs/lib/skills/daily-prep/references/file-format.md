# Daily Prep File Format

Specification for daily prep files stored in `{inboxPath}/daily-prep/YYYY-MM-DD.md`.

## File Structure

```markdown
---
date: 2026-02-02
energy: steady
calendar: scattered
commitment:
  - text: "Review Roman's PR with real feedback"
    assessment: done
  - text: "Revisit auth ADR from last week"
    assessment: partial
  - text: "TTS spec response to Ryan"
    assessment: blocked
    note: "Waiting on EGSM requirements"
closure:
  completed_at: "2026-02-02T17:30:00Z"
  reflection: "Got pulled into TTS escalation. Roman's PR was better than expected."
---

# Daily Prep: 2026-02-02

## Morning

**Energy**: Steady
**Calendar**: Scattered

### What I'm Committing To

1. Review Roman's PR with real feedback
2. Revisit auth ADR from last week
3. TTS spec response to Ryan

## Evening

**What Happened**:
- Roman's PR: Done. Better than expected.
- Auth ADR: Partial. Started but didn't finish.
- TTS spec: Blocked. Waiting on EGSM requirements.

**Reflection**: Got pulled into TTS escalation mid-day. Adjusted priorities appropriately.
```

## YAML Frontmatter Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | The prep date in YYYY-MM-DD format |

### Morning Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `energy` | string | `sharp`, `steady`, `low` | Morning energy self-report |
| `calendar` | string | `clear`, `scattered`, `heavy` | Meeting density self-report |
| `commitment` | array | see below | Items the user committed to |

### Commitment Items

Each item in the `commitment` array:

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `text` | string | freeform | The commitment item text |
| `assessment` | string or null | `done`, `partial`, `blocked`, `skipped`, `null` | Evening assessment |
| `note` | string | freeform, optional | Context for the assessment |

### Closure Fields

Added during evening debrief:

| Field | Type | Description |
|-------|------|-------------|
| `closure.completed_at` | string | ISO 8601 timestamp of when closure happened |
| `closure.reflection` | string | Evening reflection prose |

## Value Definitions

### Energy Levels

- **sharp** - Ready for deep work, can tackle complex problems
- **steady** - Normal energy, can handle a variety of tasks
- **low** - Need easy wins or lighter tasks, avoid deep work

### Calendar Density

- **clear** - Large blocks of uninterrupted time available
- **scattered** - Some meetings but workable gaps between them
- **heavy** - Meeting-dense, only time for quick tasks between meetings

### Assessment Values

- **done** - Fully completed as intended
- **partial** - Started but not finished
- **blocked** - Could not proceed due to external factors
- **skipped** - Intentionally not done (priorities changed)
- **null** - Not yet assessed (morning file, no evening closure)

## Markdown Body

The markdown body provides human-readable content that mirrors the frontmatter. This is for:
- Reading the file directly in Obsidian
- Displaying in Daily Notes preview
- Manual editing if needed

### Morning Section

```markdown
## Morning

**Energy**: [Title case energy level]
**Calendar**: [Title case calendar density]

### What I'm Committing To

1. [First commitment]
2. [Second commitment]
3. [Third commitment]
```

### Evening Section

Added during debrief:

```markdown
## Evening

**What Happened**:
- [Commitment 1]: [Assessment]. [Optional context]
- [Commitment 2]: [Assessment]. [Optional context]

**Reflection**: [Free-form reflection text]
```

## Creating a New File

When creating a morning prep file:

1. Generate YAML frontmatter with:
   - `date`: Today's date as YYYY-MM-DD
   - `energy`: User's response (lowercase)
   - `calendar`: User's response (lowercase)
   - `commitment`: Array of items with `text` and `assessment: null`

2. Generate markdown body with:
   - H1 title: `# Daily Prep: YYYY-MM-DD`
   - Morning section with context
   - Numbered commitment list

3. Write to: `{contentRoot}/{inboxPath}/daily-prep/YYYY-MM-DD.md`

## Updating for Evening Closure

When running debrief on an existing prep file:

1. Read the file
2. Update frontmatter:
   - Set `assessment` for each commitment item
   - Add `note` fields where user provides context
   - Add `closure.completed_at` with current ISO timestamp
   - Add `closure.reflection` with user's reflection

3. Append Evening section to markdown body

4. Write back to the same file

## Example: Morning Only

```markdown
---
date: 2026-02-02
energy: sharp
calendar: clear
commitment:
  - text: "Deep work on SDK refactor"
    assessment: null
  - text: "Write ADR for auth approach"
    assessment: null
---

# Daily Prep: 2026-02-02

## Morning

**Energy**: Sharp
**Calendar**: Clear

### What I'm Committing To

1. Deep work on SDK refactor
2. Write ADR for auth approach
```

## Example: With Evening Closure

```markdown
---
date: 2026-02-02
energy: sharp
calendar: clear
commitment:
  - text: "Deep work on SDK refactor"
    assessment: done
  - text: "Write ADR for auth approach"
    assessment: partial
    note: "Got outline done, needs review section"
closure:
  completed_at: "2026-02-02T17:45:00Z"
  reflection: "Good focus day. The refactor went smoother than expected."
---

# Daily Prep: 2026-02-02

## Morning

**Energy**: Sharp
**Calendar**: Clear

### What I'm Committing To

1. Deep work on SDK refactor
2. Write ADR for auth approach

## Evening

**What Happened**:
- SDK refactor: Done. Went smoother than expected.
- Auth ADR: Partial. Got outline done, needs review section.

**Reflection**: Good focus day. The refactor went smoother than expected.
```

## Directory Creation

If `{inboxPath}/daily-prep/` does not exist, create it before writing the file. The skill should not fail if the directory is missing.
