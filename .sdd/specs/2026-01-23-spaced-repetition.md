---
version: 1.0.0
status: Draft
created: 2026-01-23
last_updated: 2026-01-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Spaced Repetition Specification

## Executive Summary

Spaced repetition combats forgetting through retrieval practice. The LLM discovers notecards from vault content and presents them at increasing intervals based on user performance. This keeps facts accessible without manual notecard creation.

The feature operates as a widget on the Ground (Home) page, allowing users to review cards at their own pace throughout the day. Cards have shelf life (answers change over time) and can be marked outdated when no longer relevant.

## User Story

As a Memory Loop user, I want the system to generate review cards from my vault content and quiz me at optimal intervals, so that I retain important information without manual flashcard creation.

## Stakeholders

- **Primary**: Memory Loop users who want to retain vault knowledge
- **Secondary**: Developers maintaining the extraction and scheduling systems
- **Tertiary**: Obsidian community members evaluating Memory Loop, future contributors extending card types

## Success Criteria

1. System discovers at least 1 card from any new vault note containing factual content
2. Review widget displays when at least one card has `next_review` <= today
3. SM-2 algorithm produces correct `next_review` dates (verifiable via unit tests against reference implementation)
4. Users can archive cards via "forget" button (card moves to archive/ within 1 second)
5. New notes created today generate cards within 24 hours of next daily discovery run
6. Weekly catch-up processes 500KB of oldest unprocessed files per run

## Functional Requirements

### Card Discovery

- **REQ-F-1**: System discovers cards from vault content via LLM analysis
- **REQ-F-2**: Daily discovery pass runs once per day, processing files created or modified in last 24 hours
- **REQ-F-3**: Weekly catch-up pass processes oldest unprocessed files (500KB per run, amortizing cost)
- **REQ-F-4**: Discovery tracks processed files via checksum to avoid reprocessing unchanged content
- **REQ-F-5**: Discovery state persists in `~/.config/memory-loop/card-discovery-state.json`

### Card Generation

- **REQ-F-6**: LLM generates Q&A cards from content (question + expected answer)
- **REQ-F-7**: System supports multiple card types with extensible type selection mechanism
- **REQ-F-8**: System supports extensible card construction for different card types
- **REQ-F-9**: Initial implementation supports only Q&A card type

### Card Storage

- **REQ-F-10**: Cards stored as Markdown files in `06_Metadata/memory-loop/cards/`
- **REQ-F-11**: Each card is one file with YAML frontmatter containing metadata
- **REQ-F-12**: Card metadata includes: `created_date`, `last_reviewed`, `next_review`, `ease_factor`, `interval`, `repetitions`
- **REQ-F-13**: Card body contains question and answer in markdown format
- **REQ-F-14**: Users can manually create cards by adding files to the cards directory

### Review Widget

- **REQ-F-15**: Widget displays on Ground page (HomeView) when cards are due
- **REQ-F-16**: Widget shows card count header: "Spaced Repetition: N cards"
- **REQ-F-17**: Widget displays current question
- **REQ-F-18**: Widget provides answer input field
- **REQ-F-19**: Widget provides three action buttons: [skip] [forget] [answer]
- **REQ-F-20**: "skip" defers card to end of current review queue (queue = all cards with next_review <= today at widget load time)
- **REQ-F-21**: "forget" archives the card (moves to `cards/archive/` subfolder)
- **REQ-F-22**: "answer" reveals expected answer and prompts for self-assessment
- **REQ-F-23**: After answering, widget shows self-assessment options: [again] [hard] [good] [easy]
- **REQ-F-24**: Widget shows completion state when all due cards are reviewed or archived: "Great job today!"
- **REQ-F-25**: Widget always visible on Ground page (user-initiated review, no notifications)

### Scheduling (SM-2 Algorithm)

- **REQ-F-26**: Implement SM-2 spaced repetition algorithm for scheduling
- **REQ-F-27**: "again" response: reset interval to 1 day, decrease ease factor
- **REQ-F-28**: "hard" response: increase interval slightly, decrease ease factor slightly
- **REQ-F-29**: "good" response: increase interval by ease factor
- **REQ-F-30**: "easy" response: increase interval significantly, increase ease factor
- **REQ-F-31**: Default ease factor is 2.5 for new cards
- **REQ-F-32**: Minimum ease factor is 1.3
- **REQ-F-33**: Cards with `next_review` <= today are "due"

### Card Lifecycle

- **REQ-F-34**: New cards start with interval=1, repetitions=0, ease_factor=2.5
- **REQ-F-35**: Each review updates `last_reviewed`, `next_review`, `interval`, `repetitions`, `ease_factor`
- **REQ-F-36**: Archived cards retain their metadata but are not shown in review queue

### Error Handling

- **REQ-F-37**: If card generation fails for a file, system logs error and continues to next file
- **REQ-F-38**: System skips cards with invalid YAML frontmatter and logs warning
- **REQ-F-39**: System creates `cards/` directory if not present on first discovery run
- **REQ-F-40**: System creates `cards/archive/` directory if not present on first archive operation

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Card discovery completes within 5 minutes for daily pass
- **REQ-NF-2** (Performance): Widget loads due cards within 500ms
- **REQ-NF-3** (Idempotency): Discovery is safe to re-run without creating duplicate cards
- **REQ-NF-4** (Consistency): Card file writes use atomic rename pattern to prevent corruption
- **REQ-NF-5** (Usability): Self-assessment buttons are clearly labeled and touch-friendly
- **REQ-NF-6** (Maintainability): Card type system is extensible without modifying core logic

## Explicit Constraints (DO NOT)

- Do NOT implement notifications or reminders (user-initiated only)
- Do NOT create a separate tab/mode for review (widget on Ground page only)
- Do NOT implement card editing UI (users edit markdown files directly)
- Do NOT implement card deletion from UI (only archive via "forget")
- Do NOT support card types beyond Q&A in initial implementation
- Do NOT process files outside vault content root
- Do NOT store card metadata in a database (markdown files only)

## Technical Context

- **Existing Stack**: TypeScript monorepo (Bun), Hono backend, React 19 frontend, Zod schemas
- **Integration Points**:
  - Extraction system pattern for discovery scheduling (`backend/src/extraction/`)
  - REST API hooks pattern for widget data (`frontend/src/hooks/`)
  - HomeView component for widget placement (`frontend/src/components/HomeView.tsx`)
  - Vault metadata path convention (`06_Metadata/memory-loop/`)
- **Patterns to Respect**:
  - WebSocket protocol for real-time updates (if needed)
  - REST API for stateless operations
  - Zod schemas in `shared/src/protocol.ts`
  - Dependency injection for testability (no `mock.module()`)

## Acceptance Tests

1. **Card Discovery - New Content**: Create a new note in vault; after next daily discovery run, cards appear in `cards/` directory
2. **Card Discovery - Backlog**: Old unprocessed files are processed over multiple weekly runs (500KB per run)
3. **Widget Display**: When at least one card has `next_review` <= today, Ground page shows "Spaced Repetition: N cards" widget
4. **Review Flow - Answer**: Click answer, see expected answer, select "good", card disappears from queue
5. **Review Flow - Skip**: Click skip, card moves to end of queue, next card appears
6. **Review Flow - Forget**: Click forget, card moves to `cards/archive/`, no longer appears in queue
7. **Scheduling**: Card reviewed with "good" today has `next_review` set to today + (interval * ease_factor)
8. **Completion State**: After reviewing or archiving all due cards, widget shows "Great job today!" message
9. **Manual Card**: User creates markdown file in `cards/` with proper frontmatter; card appears in review queue when `next_review` <= today
10. **Idempotency**: Running discovery twice on same content does not create duplicate cards
11. **Error Handling - Invalid Card**: Card file with malformed YAML is skipped with warning logged
12. **Directory Creation**: First discovery run creates `cards/` directory if missing

## Open Questions

- [ ] Should the answer input field perform any validation or is it purely for user self-reflection?
- [ ] Should cards have source file references for context during review?

## Out of Scope

- Card editing UI (users edit files directly in Obsidian)
- Spaced repetition statistics/analytics dashboard
- Card sharing or export
- Integration with external spaced repetition systems (Anki, etc.)
- Audio/image cards (text-only Q&A)
- Card categories or tags (future enhancement)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
