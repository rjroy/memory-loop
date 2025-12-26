---
version: 1.0.0
status: Approved
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Inspiration System Specification

## Executive Summary

Replace static UI space with a dual inspiration system: **contextual prompts** based on vault content and **inspirational quotes** from timeless wisdom. Both display on HomeView, and clicking either starts a discussion about that topic.

- **Contextual prompts**: AI-generated on weekdays, drawing from daily notes, projects, and areas
- **Inspirational quotes**: AI-generated weekly, sourcing historical wisdom and philosophy

Generation is lazy (triggered on request, not scheduled) to avoid unnecessary API calls. Both pools are capped at 50 entries with oldest-first pruning.

## User Story

As a Memory Loop user, I want to see contextual prompts based on my vault content alongside timeless inspirational quotes, so that I'm reminded of thoughts worth revisiting and encouraged to reflect on my work.

## Stakeholders

- **Primary**: Memory Loop users with claudesidian-structured vaults
- **Secondary**: Developers maintaining the generation logic

## Success Criteria

1. User sees both a contextual prompt and an inspirational quote on Home view
2. Clicking either item navigates to Discussion mode with text pre-filled
3. System gracefully handles missing or empty files (hide contextual if empty, fallback quote for inspiration)
4. Contextual generation runs lazily on weekdays (Mon-Fri) when inspiration is requested
5. Inspiration generation runs lazily once per week when inspiration is requested
6. Token costs remain low (Haiku model, <1000 input tokens per generation cycle)
7. Both pools stay manageable (max 50 each, oldest pruned automatically)

## Functional Requirements

### Display & Interaction

- **REQ-F-1**: Display two items on HomeView between context card and quick actions: one contextual prompt (top) and one inspirational quote (bottom)
- **REQ-F-2**: Select each item randomly from its respective pool on each HomeView load
- **REQ-F-3**: Clicking either item navigates to Discussion mode with the text pre-filled (not auto-sent)
- **REQ-F-4**: Display attribution alongside quotes when available (format: "Quote text" — Source)

### Content Sources & Fallback

- **REQ-F-5**: Read contextual prompts from `06_Metadata/memory-loop/contextual-prompts.md`
- **REQ-F-6**: Read inspirational quotes from `06_Metadata/memory-loop/general-inspiration.md`
- **REQ-F-7**: If contextual prompts file is missing/empty, hide the contextual prompt section (show only inspiration)
- **REQ-F-8**: If inspiration file is missing/empty, display a hardcoded fallback quote
- **REQ-F-20**: Create `06_Metadata/memory-loop/` directory if it doesn't exist when generating

### File Format

- **REQ-F-9**: Parse inspiration files as markdown lists with format: `- "Quote text" -- Source`
- **REQ-F-10**: Handle quotes without attribution (format: `- "Quote text"`)
- **REQ-F-11**: Ignore malformed lines gracefully (skip, don't error)

### AI Prompt Generation

#### Contextual Prompts (weekday, vault-aware)

- **REQ-F-12**: Generate 5 new contextual prompts per generation cycle
- **REQ-F-13**: Append generated prompts to `contextual-prompts.md` (don't overwrite existing)
- **REQ-F-14**: Trigger contextual generation lazily on weekdays: when user requests inspiration, check if today's generation has run; if not (and it's Mon-Fri), generate before responding
- **REQ-F-19**: Limit contextual prompt pool to 50 entries; when exceeded, prune oldest prompts first
- **REQ-F-15**: Use day-specific context for contextual generation:
  - **Tuesday-Thursday**: Previous day's daily note
  - **Monday**: Previous week's daily notes + contents of active `01_Projects/` folders
  - **Friday**: Current week's daily notes + contents of active `02_Areas/` folders

#### Inspirational Quotes (weekly, general wisdom)

- **REQ-F-21**: Generate 1 new inspirational quote per week (historical wisdom, timeless advice)
- **REQ-F-22**: Append generated quote to `general-inspiration.md` with attribution
- **REQ-F-23**: Trigger inspiration generation lazily: when user requests inspiration, check if this week's quote has been added; if not, generate before responding
- **REQ-F-24**: Limit inspiration pool to 50 entries; when exceeded, prune oldest quotes first
- **REQ-F-25**: Draw from Claude's knowledge of historical quotes, philosophy, literature, and timeless wisdom

### Generation Context Sources

- **REQ-F-16**: Locate daily notes in `00_Inbox/` with filename pattern `YYYY-MM-DD.md`
- **REQ-F-17**: For project/area context, read the top-level README or index file from each subfolder
- **REQ-F-18**: Structure the generation logic to be easily configurable (day-to-context mapping)

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Inspiration display adds <50ms to HomeView render time
- **REQ-NF-2** (Cost): Use Claude Haiku model for generation; target <1000 input tokens per cycle
- **REQ-NF-3** (Reliability): Generation failures must not block app functionality; log and continue
- **REQ-NF-4** (Maintainability): Day-specific context logic isolated in a single, well-documented module
- **REQ-NF-5** (Compatibility): Require claudesidian vault structure (PARA with numbered folders)

## Explicit Constraints (DO NOT)

- Do NOT regenerate prompts on each page refresh (token cost management)
- Do NOT provide UI for editing/managing prompts (users can edit files directly in Obsidian)
- Do NOT track analytics on prompt clicks or impressions
- Do NOT use extended thinking for generation
- Do NOT auto-send the prompt when navigating to Discussion (user must confirm)

## Technical Context

- **Existing Stack**: React 19 frontend, Hono backend, WebSocket protocol, Claude Agent SDK
- **Integration Points**:
  - HomeView component (display)
  - WebSocket protocol (new message types for fetching inspiration)
  - Vault file system (reading/writing inspiration files)
  - Claude API via Agent SDK (prompt generation)
- **Patterns to Respect**:
  - BEM CSS naming (e.g., `inspiration-card__quote`)
  - Zod schemas in shared/protocol.ts
  - Glassmorphism card styling consistent with RecentActivity

## Acceptance Tests

### Display
1. **Both items shown**: Open HomeView → contextual prompt (top) and inspiration quote (bottom) both visible
2. **Random selection**: Refresh HomeView 5 times → see variation in both sections (assuming pools > 1)
3. **Click contextual**: Click contextual prompt → navigate to Discussion with prompt text pre-filled
4. **Click inspiration**: Click inspiration quote → navigate to Discussion with quote text pre-filled

### Fallback Behavior
5. **No contextual file**: Delete contextual-prompts.md → only inspiration quote shown
6. **No inspiration file**: Delete general-inspiration.md → hardcoded fallback quote shown
7. **Both files missing**: Delete both files → hardcoded fallback quote shown (no contextual section)
8. **File parsing**: File with mixed valid/invalid lines → valid entries display, invalid skipped

### Contextual Generation (Weekday)
9. **Lazy weekday generation**: Request inspiration on Tuesday (first of day) → contextual generation runs, then displayed
10. **No weekend contextual**: Request inspiration on Saturday → no contextual generation, existing prompts used
11. **Weekday context (Tue-Thu)**: Generate on Wednesday → prompts reference Tuesday's daily note
12. **Weekday context (Monday)**: Generate on Monday → prompts reference last week and projects
13. **Weekday context (Friday)**: Generate on Friday → prompts reference current week and areas
14. **Contextual pool pruning**: Pool at 50, add 5 → oldest 5 removed

### Inspiration Generation (Weekly)
15. **Lazy weekly generation**: Request inspiration (first of week) → inspiration quote generated, then displayed
16. **Weekly timing**: Request inspiration twice same week → only one quote generated
17. **Inspiration pool pruning**: Pool at 50, add 1 → oldest 1 removed
18. **Quote has attribution**: Generated quote includes source (author, work, or tradition)

## Open Questions

- [x] Where should the prompt display? → Between context card and quick actions
- [x] What triggers generation? → Lazy on-request (Mon-Fri only)
- [x] What model for generation? → Haiku
- [x] How to trigger the scheduled generation? → Lazy: check on inspiration request if today's generation has run
- [x] Should there be a maximum prompt pool size before old prompts are pruned? → Yes, cap at 50 prompts

## Out of Scope

- UI for editing or managing prompts (edit files in Obsidian)
- Analytics or tracking of prompt engagement
- Weekend contextual prompt generation (inspiration quotes can trigger any day)
- Non-claudesidian vault structures
- Rich formatting in prompts (images, links, etc.)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
