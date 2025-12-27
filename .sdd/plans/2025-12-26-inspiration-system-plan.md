---
specification: [.sdd/specs/inspiration-system.md](./../specs/inspiration-system.md)
status: Draft
version: 1.0.0
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Inspiration System - Technical Plan

## Overview

The inspiration system adds dual-content display to HomeView: vault-aware contextual prompts and timeless inspirational quotes. Both content types are stored as markdown files in the vault's `06_Metadata/memory-loop/` directory and rendered between the context card and quick actions. Clicking either navigates to Discussion mode with the text prefilled.

Key technical strategies:
- **Lazy generation**: AI content generated on-demand when requested (not on schedule), checking freshness markers before generating
- **File-based persistence**: Content stored in vault markdown files, parsed on fetch
- **Minimal frontend state**: Inspiration data fetched via WebSocket, rendered immediately, no caching
- **Prefill pattern**: Discussion mode enhanced to accept initial input text via SessionContext

## Architecture

### System Context

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
├─────────────────┬──────────────────────────────────────────────┤
│    HomeView     │     SessionContext                            │
│  ┌───────────┐  │   ┌───────────────────────────────────────┐  │
│  │Inspiration│──┼──▶│ discussionPrefill: string | null      │  │
│  │   Card    │  │   │ setDiscussionPrefill: (text) => void  │  │
│  └───────────┘  │   └───────────────────────────────────────┘  │
└────────┬────────┴──────────────────────────────────────────────┘
         │ WebSocket
         ▼
┌────────────────────────────────────────────────────────────────┐
│                      Backend (Hono + Bun)                       │
├─────────────────┬──────────────────────────────────────────────┤
│ WebSocketHandler│      inspiration-manager.ts                   │
│  ┌────────────┐ │   ┌──────────────────────────────────────┐   │
│  │get_inspire │─┼──▶│ getInspiration(vault)                │   │
│  └────────────┘ │   │ ├─ checkGeneration(type, vault)      │   │
│                 │   │ ├─ generateContent(type, vault, sdk) │   │
│                 │   │ ├─ parseInspirationFile(path)        │   │
│                 │   │ └─ selectRandom(pool)                │   │
│                 │   └──────────────────────────────────────┘   │
└─────────────────┴────────────────┬─────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────┐
│                     Vault Filesystem                            │
│  06_Metadata/memory-loop/                                       │
│    ├─ contextual-prompts.md                                     │
│    └─ general-inspiration.md                                    │
└────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|----------------|
| `InspirationCard` | Frontend card displaying both prompt types, clickable |
| `inspiration-manager.ts` | Backend module: file parsing, generation logic, Claude API |
| `SessionContext` | Extended with `discussionPrefill` state for click-to-discuss |
| `Discussion` | Enhanced to consume and clear prefill on mount |
| WebSocket protocol | New `get_inspiration` / `inspiration` message types |

## Technical Decisions

### TD-1: Single WebSocket Message for Both Content Types
**Choice**: Use one `get_inspiration` request that returns both contextual prompt and inspirational quote
**Requirements**: REQ-F-1, REQ-F-2, REQ-NF-1
**Rationale**:
- Reduces round trips (one request instead of two)
- Allows server to handle both generation checks atomically
- Simplifies frontend state management (single response handler)
- Matches existing patterns like `get_recent_activity` returning multiple data types

### TD-2: Lazy Generation with Date Markers in File
**Choice**: Store generation timestamps as file headers; check on each request
**Requirements**: REQ-F-14, REQ-F-23
**Rationale**:
- No scheduler/cron needed - generation triggers when user requests inspiration
- Date markers embedded in file format: `<!-- last-generated: YYYY-MM-DD -->` at file top
- Simple to implement: read first line, parse date, compare to today/week
- Survives server restarts (state persisted in vault files)
- Follows existing patterns where vault files are source of truth

### TD-3: Claude Haiku for Generation
**Choice**: Use `claude-3-haiku` model via Claude Agent SDK for all generation
**Requirements**: REQ-NF-2
**Rationale**:
- Cost-effective for simple text generation tasks (~$0.25/M input tokens)
- Fast response times (<1s typical)
- SDK already integrated for discussion mode - reuse infrastructure
- Single-turn completion (no conversation context needed)
- Use `query()` with minimal options for isolated generation

### TD-4: Discussion Prefill via SessionContext
**Choice**: Add `discussionPrefill` state to SessionContext rather than URL params
**Requirements**: REQ-F-3
**Rationale**:
- Consistent with existing state patterns (vault, mode, messages all in context)
- No URL clutter or navigation history issues
- Auto-clears after use (Discussion component consumes and clears)
- Works with existing mode switching pattern
- localStorage draft logic already exists in Discussion - prefill takes precedence

### TD-5: File Format with Attribution
**Choice**: Markdown list format with `-- Source` separator for attribution
**Requirements**: REQ-F-4, REQ-F-9, REQ-F-10, REQ-F-11
**Rationale**:
- Human-readable and editable in Obsidian (users can curate their inspiration)
- Format: `- "Quote text here" -- Source Name`
- Attribution optional: `- "Quote without source"`
- Two hyphens (`--`) chosen over em-dash for keyboard accessibility
- Graceful parsing: invalid lines skipped, partial success possible

### TD-6: Backend-Side Random Selection
**Choice**: Server selects random item from pool, sends single item to client
**Requirements**: REQ-F-2
**Rationale**:
- Reduces data transfer (don't send entire pool)
- Server controls pool size limits (pruning happens before selection)
- Frontend stays simple (display what it receives)
- Consistent with lazy generation (server already processing request)

### TD-7: Hardcoded Fallback Quote
**Choice**: Single fallback quote embedded in backend code
**Requirements**: REQ-F-8
**Rationale**:
- Zero-config experience for new vaults
- Fallback displayed when both files missing or empty
- Non-contextual by design (can't have vault-specific content without vault files)
- Curated timeless quote that fits the app's philosophical tone

### TD-8: Day-Specific Context Strategy
**Choice**: Weekday-based context gathering with date-aware file selection
**Requirements**: REQ-F-15, REQ-F-16, REQ-F-17, REQ-F-18, REQ-NF-4, REQ-NF-5
**Rationale**:

Context varies by day to provide variety and relevance:
- **Tuesday-Thursday**: Read previous day's daily note only (focused, immediate context)
- **Monday**: Read previous week's daily notes (7 days) + project README files (weekly reset)
- **Friday**: Read current week's daily notes (5 days) + area README files (weekly reflection)

Implementation approach:
- **Day detection**: Use server's local date (consistent with vault file timestamps)
- **Daily note location**: `00_Inbox/YYYY-MM-DD.md` (REQ-F-16)
- **Project/Area detection**: Scan `01_Projects/` or `02_Areas/` for subdirectories, read first found `README.md` or `index.md` in each (REQ-F-17)
- **Token budget**: Cap total context at ~800 tokens (~3200 chars), truncate oldest content first
- **Configurability**: Day-to-context mapping defined in single `DAY_CONTEXT_CONFIG` constant (REQ-F-18, REQ-NF-4)
- **Vault structure**: Assumes claudesidian PARA structure with numbered folders (REQ-NF-5)

Alternatives considered:
- **Flat context (same every day)**: Simpler but less engaging, doesn't leverage vault structure
- **User-configurable days**: Adds complexity, defer to future enhancement
- **Per-project/area activity detection**: Too complex for MVP, all subdirectories included

### TD-9: Generation Quantities and Pruning
**Choice**: Generate 5 contextual prompts per weekday, 1 quote per week; prune at 50 entries
**Requirements**: REQ-F-12, REQ-F-13, REQ-F-19, REQ-F-21, REQ-F-22, REQ-F-24, REQ-F-25
**Rationale**:

Generation quantities:
- **Contextual**: 5 prompts per generation (REQ-F-12) provides week of variety before regeneration needed
- **Quotes**: 1 per week (REQ-F-21) keeps collection growing slowly while staying fresh
- **Quote sources**: Prompt explicitly requests historical figures, philosophers, literary wisdom (REQ-F-25)

Append behavior:
- New entries appended to end of file (REQ-F-13, REQ-F-22)
- Preserves user curation (they can reorder/edit existing entries)
- Generation marker updated to current date/week

Pruning strategy:
- Check pool size after append
- If >50 entries, remove oldest (earliest in file) until at 50 (REQ-F-19, REQ-F-24)
- Ensures files don't grow unbounded
- Oldest-first removal keeps fresh content

### TD-10: File Locations
**Choice**: Fixed paths in `06_Metadata/memory-loop/` directory
**Requirements**: REQ-F-5, REQ-F-6, REQ-F-7, REQ-F-20
**Rationale**:
- **Contextual prompts**: `06_Metadata/memory-loop/contextual-prompts.md` (REQ-F-5)
- **Inspirational quotes**: `06_Metadata/memory-loop/general-inspiration.md` (REQ-F-6)
- **Missing handling**: If contextual file missing/empty, hide contextual section (REQ-F-7)
- **Directory creation**: Create `06_Metadata/memory-loop/` if needed during generation (REQ-F-20)
- Uses same location pattern as existing `goals.md` for consistency

### TD-11: Reliability and Graceful Degradation
**Choice**: Generation failures never block UI; log and continue with existing/fallback content
**Requirements**: REQ-NF-3
**Rationale**:
- Inspiration is enhancement, not core functionality
- Failed generation: return existing pool content (stale but present)
- Failed parse: skip malformed lines, process valid ones
- SDK errors: catch, log, return cached content or fallback
- User never sees error toast for inspiration failures

## Data Model

### Inspiration File Format

**`contextual-prompts.md`**:
```markdown
<!-- last-generated: 2025-12-26 -->

- "What progress did you make on the authentication refactor?"
- "You mentioned deadline pressure in yesterday's notes. How are you managing that?"
- "The project roadmap shows Q1 goals. What's the priority for this week?"
```

**`general-inspiration.md`**:
```markdown
<!-- last-generated: 2025-12-23 (week 52) -->

- "The only way to do great work is to love what you do." -- Steve Jobs
- "In the middle of difficulty lies opportunity." -- Albert Einstein
- "We are what we repeatedly do." -- Aristotle
```

### TypeScript Types

```typescript
// shared/protocol.ts additions
export interface InspirationItem {
  text: string;
  attribution?: string;  // Only for quotes
}

export interface InspirationResponse {
  contextual: InspirationItem | null;  // null if file missing/empty
  quote: InspirationItem;              // Always present (fallback exists)
}

// New message types
export const GetInspirationMessageSchema = z.object({
  type: z.literal("get_inspiration"),
});

export const InspirationMessageSchema = z.object({
  type: z.literal("inspiration"),
  contextual: z.object({
    text: z.string(),
    attribution: z.string().optional(),
  }).nullable(),
  quote: z.object({
    text: z.string(),
    attribution: z.string().optional(),
  }),
});
```

### SessionContext Extensions

```typescript
// Added to SessionState
discussionPrefill: string | null;

// Added to SessionActions
setDiscussionPrefill: (text: string | null) => void;
```

## API Design

### WebSocket Protocol

**Client → Server: `get_inspiration`**
```json
{ "type": "get_inspiration" }
```
Triggers:
1. Check contextual generation (if weekday and not generated today)
2. Check quote generation (if not generated this week)
3. Parse both files
4. Prune if over 50 entries
5. Select random from each pool
6. Return response

**Server → Client: `inspiration`**
```json
{
  "type": "inspiration",
  "contextual": {
    "text": "What did you learn from yesterday's debugging session?",
    "attribution": null
  },
  "quote": {
    "text": "In the middle of difficulty lies opportunity.",
    "attribution": "Albert Einstein"
  }
}
```

**Server → Client: `inspiration` (no contextual)**
```json
{
  "type": "inspiration",
  "contextual": null,
  "quote": {
    "text": "The only way to do great work is to love what you do.",
    "attribution": "Steve Jobs"
  }
}
```

## Integration Points

### Vault Filesystem
- **Purpose**: Read/write inspiration files
- **Location**: `{vaultPath}/06_Metadata/memory-loop/`
- **Dependencies**: `vault-manager.ts` for vault path resolution
- **Data Flow**: Read existing content → append generated → prune oldest → write back
- **Directory Creation**: Create `06_Metadata/memory-loop/` if missing during generation (REQ-F-20)

### Claude Agent SDK
- **Purpose**: Generate contextual prompts and quotes
- **Integration**: Use `query()` with minimal options for single-turn generation
- **Model**: `claude-3-haiku` (hardcoded for cost control)
- **Context Sources**:
  - Daily notes: `{vaultPath}/00_Inbox/YYYY-MM-DD.md`
  - Projects: `{vaultPath}/01_Projects/*/README.md` or `index.md`
  - Areas: `{vaultPath}/02_Areas/*/README.md` or `index.md`

### HomeView Component
- **Purpose**: Display inspiration cards
- **Integration**: Request inspiration on mount (after session_ready)
- **Data Flow**: `get_inspiration` → `inspiration` response → render cards
- **Click Handler**: Call `setDiscussionPrefill(text)` then `setMode("discussion")`

### Discussion Component
- **Purpose**: Handle prefilled text
- **Integration**: Read `discussionPrefill` on mount, populate input, clear prefill
- **Behavior**: Prefill takes precedence over localStorage draft; user must still submit

## Error Handling, Performance, Security

### Error Strategy
- **Generation failures**: Log error, return existing content (stale is better than nothing)
- **File read failures**: Return null for contextual, fallback for quote
- **Parse failures**: Skip malformed lines, process valid ones
- **No user-facing errors**: Inspiration is optional; app functions without it

### Performance Targets
- **REQ-NF-1**: <50ms added to HomeView render
  - Achieved by: Parallel request with other HomeView data
  - File parsing is O(n) where n ≤ 50 entries
  - Random selection is O(1)
- **Generation latency**: ~500-1000ms for Haiku (acceptable since lazy/infrequent)
- **Caching**: None needed (files small, reads fast on local filesystem)

### Security Measures
- **Path validation**: Inspiration files restricted to `06_Metadata/memory-loop/`
- **No user input in generation prompts**: Context comes from vault files only
- **Token limit**: Generation prompts capped at ~1000 input tokens (REQ-NF-2)
- **No secrets exposed**: Generated content is just text from vault

## Testing Strategy

### Unit Tests (Backend)

| Module | Test Cases |
|--------|------------|
| `parseInspirationFile` | Valid entries, invalid lines skipped, empty file, missing file |
| `checkGeneration` | Weekday logic, week boundary, marker parsing |
| `pruneEntries` | At limit, over limit, under limit |
| `formatGenerationMarker` | Date format, week number |
| `selectRandom` | Single item, multiple items, empty pool |

### Unit Tests (Frontend)

| Component | Test Cases |
|-----------|------------|
| `InspirationCard` | Both items, only quote, loading state, click handlers |
| `SessionContext` | `setDiscussionPrefill`, prefill cleared after use |
| `Discussion` | Prefill populates input, clears localStorage draft |

### Integration Tests

| Scenario | Validation |
|----------|------------|
| Full flow | Request → generation → response → display → click → prefill |
| Generation conditions | Weekday/weekend, first of week, already generated |
| Error recovery | Missing files, corrupted files, SDK errors |

### Acceptance Tests (from spec)

Manual verification against spec's 18 acceptance criteria covering:
- Display both items (AT-1), random selection (AT-2), navigation on click (AT-3, AT-4)
- Fallback behaviors (AT-5 through AT-8)
- Generation timing (AT-9 through AT-13, AT-15, AT-16)
- Pool pruning (AT-14, AT-17)
- Attribution display (AT-18)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK rate limits during generation | Low | Medium | Use Haiku (high limits), single-turn only, lazy triggers |
| Vault file corruption | Low | Low | Graceful parsing, skip malformed lines, keep generating |
| User edits break format | Medium | Low | Robust parser, clear format docs in file header |
| Large vault context exceeds token limit | Medium | Medium | Hard cap at 800 tokens (~3200 chars), truncate oldest content |
| Timezone inconsistency | Medium | Low | Use server's local date consistently; document this behavior |
| Week boundary edge cases | Low | Low | Define week as ISO week (Mon-Sun); quote regeneration on Monday |
| Day-specific logic complexity | Medium | Medium | Isolate in `DAY_CONTEXT_CONFIG` constant; comprehensive unit tests |
| Missing daily notes on context days | High | Low | Return empty context, generate generic prompts without references |

## Dependencies

### Technical
- **Claude Agent SDK**: Already integrated for discussion mode
- **Node.js fs/promises**: Already used throughout backend
- **Zod**: Already used for protocol validation

### Team
- None - self-contained feature within existing architecture

## Open Questions

- [x] Inspiration card placement → Between context card and quick actions
- [x] Generation trigger → Lazy on-request
- [x] Model selection → Haiku for cost efficiency
