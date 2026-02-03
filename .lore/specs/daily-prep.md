---
title: Daily Prep System
date: 2026-02-02
status: approved
tags: [daily-planning, bookend, energy, commitment, ground-tab, skill]
modules: [home-view, vault-info-card, session-actions-card, daily-prep-skill, daily-debrief-skill, routes-daily-prep]
related: [.lore/brainstorm/daily-prep-system.md, .lore/research/daily-planning-science.md]
---

# Spec: Daily Prep System

## Overview

A skill-based bookend planning system that helps users answer "what should I focus on today?" in the morning and "did I do anything useful?" in the evening. Uses guided prompts to overcome blank-page paralysis, surfaces relevant tasks from the vault, and records commitments for later evaluation.

The core insight: the value isn't in filtering algorithms, it's in creating an evaluable contract with yourself. Morning commitment + evening reflection forms the bookend.

### What is a Skill?

A skill is a SKILL.md file in `backend/src/skills/` that teaches Claude how to behave during a session. Skills use standard Claude Code tools (AskUserQuestion, Bash, Read, Write, Grep, Glob) to interact with the vault. The daily-prep skill will be a new file at `backend/src/skills/daily-prep/SKILL.md`.

**Implementation note**: Use the `plugin-dev:skill-development` skill to guide writing the new skill correctly. It knows the proper structure and patterns.

## Entry Points

| Entry | Source | Behavior |
|-------|--------|----------|
| "Daily Prep" button | Ground tab | Launches `/daily-prep` skill in Discussion |
| `/daily-prep` command | Discussion input | Runs morning prep flow |
| `/daily-debrief` command | Discussion input | Runs evening closure if prep exists, otherwise standard debrief |

## Requirements

### Morning Prep Flow

- REQ-1: Skill uses `AskUserQuestion` to collect energy level (Sharp / Steady / Low)
- REQ-2: Skill uses `AskUserQuestion` to collect meeting density (Clear / Scattered / Heavy)
- REQ-3: Skill references `vault-task-management` skill for task queries (which knows how to use the scripts) and recent activity via Grep/Read to surface relevant items
- REQ-4: Skill presents surfaced items in three categories: Pressure, Slipping, Quick Wins
- REQ-5: User can respond with corrections, additions, or redirections ("what about that ADR from last week?")
- REQ-6: Skill proposes commitment summary based on dialogue
- REQ-7: User confirms or edits commitment in their own words
- REQ-8: Skill saves daily prep record to dedicated file

### Surfacing Categories

Surfacing is LLM-powered, not algorithmic. The skill references `vault-task-management` skill for task data and uses Grep/Read for recent captures. Claude categorizes based on these guidelines:

- REQ-9: **Pressure** - Tasks with external weight: flagged (`f` status), mentioned in recent captures, connected to people (names in task text), approaching dates
- REQ-10: **Slipping** - Tasks going cold: in files not modified for 3+ days, tasks in old daily notes still incomplete
- REQ-11: **Quick Wins** - Small completable items: short task text, no dependencies mentioned, similar to tasks user has completed quickly before

### Evening Closure Flow

- REQ-12: When `/daily-debrief` runs, skill checks for `{inboxPath}/daily-prep/{today}.md`
- REQ-13: If prep exists, offer to review it first; if no prep exists, run standard debrief unchanged
- REQ-14: Show morning commitment and energy/calendar context
- REQ-15: Collect assessment per commitment item (Done / Partial / Blocked / Skipped) - title case in UI, lowercase in storage
- REQ-16: Allow freeform dialogue about what happened, blockers, pivots
- REQ-17: Save closure data to same daily prep file

### Storage

- REQ-18: Daily prep records stored in `{inboxPath}/daily-prep/YYYY-MM-DD.md` (using vault's configured inbox path from config)
- REQ-19: YAML frontmatter contains structured data (energy, calendar, items, assessments) for future analysis - lowercase values (sharp/steady/low, clear/scattered/heavy)
- REQ-20: Markdown body contains human-readable commitment and reflection prose
- REQ-21: Skill uses Write tool to create/update the prep file

### Ground Tab Restructure

Split existing "Session Context Card" into two cards:

**Vault Info Card** (left on desktop, top on mobile):
- REQ-22: Displays vault name and description
- REQ-23: No interactive elements, just context

**Session Actions Card** (right on desktop, bottom on mobile):
- REQ-24: Daily row always visible with one of:
  - "Daily Prep" button if no prep file exists for today
  - "Daily Debrief" button if prep file exists for today
- REQ-25: Weekly Debrief button (existing visibility rules: Friday-Sunday)
- REQ-26: Monthly Summary button (existing visibility rules: last/first 3 days of month)
- REQ-27: Commitment summary displayed below buttons when prep exists (follows Goals Card display pattern)

### Button Behavior

- REQ-28: Clicking "Daily Prep" prefills `/daily-prep` in input and routes to Think tab (user submits to start)
- REQ-29: Clicking "Daily Debrief" prefills `/daily-debrief` in input and routes to Think tab (existing behavior)

### REST Endpoint

- REQ-30: `GET /api/vaults/:id/daily-prep/today` returns prep status and commitment data for today
- REQ-31: Response includes: `{ exists: boolean, commitment?: string[], energy?: string, calendar?: string }`
- REQ-32: Ground tab uses this endpoint on mount to determine button visibility and display commitment summary

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Prep complete | User confirms commitment | Ground tab with commitment displayed |
| Closure complete | User confirms reflection | Ground tab |
| User cancels | User abandons flow | Discussion (no file saved) |
| Pattern insight | [STUB: pattern-feedback] | Future: surface patterns from historical data |

## Success Criteria

- [ ] Ground tab restructured: Vault Info Card (left/top) + Session Actions Card (right/bottom)
- [ ] Daily row shows "Daily Prep" or "Daily Debrief" based on prep file existence
- [ ] User can complete morning prep flow in under 3 minutes
- [ ] Energy and calendar inputs recorded in parseable frontmatter
- [ ] Commitment summary visible in Session Actions Card after prep completes
- [ ] Evening debrief integrates closure when prep exists
- [ ] Surfacing categories populated from vault tasks
- [ ] User can inject corrections during surfacing dialogue
- [ ] Daily prep file readable by future pattern analysis

## AI Validation

**Defaults** (apply unless overridden):
- Unit tests with mocked time/network/filesystem/LLM calls
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom**:
- Daily prep file parses correctly (valid YAML frontmatter)
- Energy/calendar values constrained to defined options
- REST endpoint returns correct prep status and commitment data
- Ground tab displays commitment when navigating back after prep
- `/daily-debrief` detects existing prep and offers closure flow
- Responsive layout: side-by-side on desktop, stacked on mobile
- Daily button switches between Prep/Debrief based on REST endpoint response

## Constraints

- No calendar API integration in v1 (self-report only)
- Surfacing is LLM-powered, not algorithmic endpoint
- Pattern feedback is future scope
- Skill should suggest 1-3 commitment items (research warns against over-planning), but does not enforce a limit

## Stubs

### [STUB: pattern-feedback]

Future capability to surface patterns from historical prep data:
- "You usually skip 'if time' items"
- "Tuesdays after all-hands tend to go sideways"
- "You've said 'exercise' 5 days, done it 2"

Requires: accumulated daily prep records, analysis queries.

### [STUB: historical-trends]

Future capability to show trends over time:
- Completion rates by energy level
- Completion rates by day of week
- Common blockers

Requires: structured frontmatter data (being recorded now for this purpose).

### [STUB: calendar-integration]

Future capability to read calendar directly:
- Auto-detect meeting density
- Show available time blocks
- Warn about conflicts with commitment

Requires: calendar API access, OAuth setup.

## Data Model

### Daily Prep File Format

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

### Frontmatter Schema

| Field | Type | Values | Purpose |
|-------|------|--------|---------|
| `date` | string | YYYY-MM-DD | Record date |
| `energy` | string | sharp, steady, low | Morning energy self-report |
| `calendar` | string | clear, scattered, heavy | Meeting density self-report |
| `commitment` | array | objects with text, assessment, note | Items committed to |
| `commitment[].text` | string | freeform | The commitment item |
| `commitment[].assessment` | string | done, partial, blocked, skipped, null | Evening assessment |
| `commitment[].note` | string | freeform, optional | Context for assessment |
| `closure.completed_at` | string | ISO timestamp | When closure happened |
| `closure.reflection` | string | freeform | Evening reflection prose |

## Context

### From Research

The research validates this approach:
- **Implementation intentions** (specific commitments) improve goal attainment ~3x
- **Energy management** outperforms pure time management
- **Evening reflection** improves performance 22-25%
- **Commitment devices** increase follow-through
- **Zeigarnik effect**: planning closes open loops even without completion
- **Decision fatigue**: keep task selection simple and early

### From Existing Features

- Ground tab already has debrief buttons that launch skills (pattern to follow)
- `vault-task-management` skill exists for task queries (daily-prep skill will reference it)
- `research-assistant` skill shows pattern for proactive vault searching
- `AskUserQuestion` tool available for structured input
- Session persistence handles conversation continuity
- `plugin-dev:skill-development` skill guides proper skill authoring

### Lessons to Apply

- "Trace config changes end-to-end" - new inbox path usage must work with existing config
- "Visual components need visual testing" - Ground tab commitment widget
