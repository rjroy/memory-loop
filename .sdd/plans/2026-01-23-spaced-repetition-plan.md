---
specification: [.sdd/specs/2026-01-23-spaced-repetition.md](./../specs/2026-01-23-spaced-repetition.md)
status: Approved
version: 1.0.0
created: 2026-01-23
last_updated: 2026-01-23
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Spaced Repetition - Technical Plan

## Overview

This plan defines the technical approach for implementing spaced repetition in Memory Loop. The feature has three main subsystems: (1) a card discovery system that runs on a schedule to extract Q&A cards from vault content using LLM analysis, (2) a card storage system using markdown files with YAML frontmatter, and (3) a review widget on the Ground page that implements the SM-2 algorithm.

The implementation follows existing Memory Loop patterns: REST API routes for card operations, React hooks for frontend data fetching, and the extraction system pattern for scheduled discovery. Cards are stored as markdown files in the vault's metadata directory, matching the established convention for vault-specific data.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Memory Loop System                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    REST API     ┌──────────────────────────────┐ │
│  │   Frontend   │◄──────────────►│         Backend               │ │
│  │              │                 │                               │ │
│  │ ┌──────────┐ │                 │  ┌─────────────────────────┐ │ │
│  │ │ Review   │ │  GET /cards/due │  │    Card Manager         │ │ │
│  │ │ Widget   │◄├────────────────►├─►│  - getDueCards()        │ │ │
│  │ │          │ │  POST /review   │  │  - submitReview()       │ │ │
│  │ │          │ │  POST /archive  │  │  - archiveCard()        │ │ │
│  │ └──────────┘ │                 │  └─────────────────────────┘ │ │
│  │              │                 │              │                │ │
│  │  HomeView    │                 │              ▼                │ │
│  │  (Ground)    │                 │  ┌─────────────────────────┐ │ │
│  └──────────────┘                 │  │    Card Storage         │ │ │
│                                   │  │  vault/06_Metadata/     │ │ │
│                                   │  │  memory-loop/cards/     │ │ │
│  ┌──────────────────────────────┐ │  │  └── *.md (card files)  │ │ │
│  │    Card Discovery Scheduler   │ │  │  └── archive/ (archived)│ │ │
│  │                               │ │  └─────────────────────────┘ │ │
│  │  - Daily pass (last 24h)      │ │              ▲                │ │
│  │  - Weekly catch-up (500KB)    │─┼──────────────┘                │ │
│  │  - State: ~/.config/memory-   │ │                               │ │
│  │    loop/card-discovery-       │ │                               │ │
│  │    state.json                 │ │                               │ │
│  └──────────────────────────────┘ │                               │ │
│                                   └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

- **CardDiscoveryScheduler** (`backend/src/spaced-repetition/card-discovery-scheduler.ts`): Orchestrates scheduled discovery runs using cron (follows extraction-manager.ts pattern)
- **CardDiscoveryState** (`backend/src/spaced-repetition/card-discovery-state.ts`): Persists discovery state to `~/.config/memory-loop/card-discovery-state.json` (follows extraction-state.ts pattern)
- **CardGenerator** (`backend/src/spaced-repetition/card-generator.ts`): LLM-based Q&A extraction from vault content
- **CardManager** (`backend/src/spaced-repetition/card-manager.ts`): CRUD operations for card files, SM-2 calculations
- **CardRoutes** (`backend/src/routes/cards.ts`): REST endpoints for card operations
- **useCards** (`frontend/src/hooks/useCards.ts`): React hook for card operations
- **SpacedRepetitionWidget** (`frontend/src/components/SpacedRepetitionWidget.tsx`): Review UI component

## Technical Decisions

### TD-1: Card Storage as Markdown Files
**Choice**: Store each card as an individual markdown file with YAML frontmatter in `06_Metadata/memory-loop/cards/`
**Requirements**: REQ-F-10, REQ-F-11, REQ-F-14, REQ-NF-4
**Rationale**:
- Matches existing vault metadata convention (inspiration files use same pattern)
- Human-readable and editable via Obsidian (REQ-F-14)
- Atomic file writes via temp+rename prevent corruption (REQ-NF-4)
- No database dependency keeps the system simple
**Alternatives Considered**:
- SQLite database: Better query performance but adds dependency, breaks plain-text vault ethos
- Single JSON file: Simpler but loses individual card editability and risks full-file corruption

### TD-2: Discovery Scheduler Pattern
**Choice**: Reuse extraction-manager.ts/extraction-state.ts patterns for card discovery scheduling
**Requirements**: REQ-F-2, REQ-F-3, REQ-F-4, REQ-F-5
**Rationale**:
- Proven pattern already handles cron scheduling, state persistence, checksum tracking
- Catch-up logic handles missed runs gracefully
- Checksum-based idempotency prevents duplicate card generation (REQ-NF-3)
- Team familiarity reduces implementation risk

### TD-3: REST API for Card Operations
**Choice**: Implement card operations as REST endpoints under `/api/vaults/:vaultId/cards/`
**Requirements**: REQ-F-15 through REQ-F-24
**Rationale**:
- Matches existing pattern (home.ts, capture.ts routes)
- Stateless operations fit REST model well
- No need for WebSocket streaming (review is user-paced, not real-time)
- Simpler client implementation via existing API client

### TD-4: SM-2 Algorithm Implementation
**Choice**: Implement SM-2 as a pure function that calculates next review parameters
**Requirements**: REQ-F-26 through REQ-F-33
**Rationale**:
- Well-documented algorithm with known reference implementation
- Pure function is easily unit tested against reference values
- Keeps scheduling logic isolated from storage/UI concerns
**Alternatives Considered**:
- FSRS (Free Spaced Repetition Scheduler): More modern but complex, less documentation
- Leitner system: Simpler but less efficient for retention optimization
- SM-2 chosen for balance of simplicity, documentation quality, and proven effectiveness

### TD-5: Widget Integration in HomeView
**Choice**: Add SpacedRepetitionWidget as a new section in HomeView.tsx
**Requirements**: REQ-F-15, REQ-F-16, REQ-F-25
**Rationale**:
- Follows existing pattern (GoalsCard, InspirationCard are separate components in HomeView)
- Widget manages its own state via useCards hook
- Conditional rendering based on due card count

### TD-6: Card ID Generation
**Choice**: Use UUID v4 for card IDs, stored in filename as `{uuid}.md`
**Requirements**: REQ-F-10, REQ-NF-3
**Rationale**:
- Unique IDs prevent collisions when multiple cards generated from same source
- Simple filename pattern avoids character escaping issues
- UUID is standard approach used elsewhere in codebase

### TD-7: LLM Card Generation with Haiku
**Choice**: Use Claude Haiku for card extraction (same as inspiration generation)
**Requirements**: REQ-F-1, REQ-F-6
**Rationale**:
- Haiku is cost-efficient for batch operations
- Already used for inspiration generation (proven pattern)
- Q&A extraction doesn't require advanced reasoning
**Alternatives Considered**:
- Sonnet: Better quality cards but ~10x cost for batch processing
- User configurable: Adds complexity without clear benefit (Haiku quality is sufficient for Q&A)

### TD-8: Queue Loading Strategy
**Choice**: Load all due cards into memory when widget mounts, track queue position in component state
**Requirements**: REQ-F-19, REQ-F-20, REQ-NF-2
**Rationale**:
- Due cards are typically <50 items (small memory footprint)
- Simplifies skip logic (just move index in array)
- Avoids repeated API calls during review session
- 500ms load time requirement easily met with single API call
**Alternatives Considered**:
- Lazy loading with pagination: More complex for skip logic, multiple API calls degrade UX
- Server-side queue management: Unnecessary complexity for small queue sizes

### TD-9: Card Type Extensibility Architecture
**Choice**: Abstract card type via `type` field in metadata with type-specific generator and renderer interfaces
**Requirements**: REQ-F-7, REQ-F-8, REQ-F-9, REQ-NF-6
**Rationale**:
- Spec requires extensible card type system even though only Q&A is implemented initially
- Type field in metadata enables future card types without schema changes
- Generator interface allows different LLM prompts per card type
- Renderer interface (frontend) allows different UI per card type
- Q&A implementation becomes the reference implementation for the pattern

**Extensibility Design**:
```typescript
// Card type discriminator in metadata
type: "qa" | string  // "qa" for initial implementation, extensible

// Backend: Generator interface (card-generator.ts)
interface CardTypeGenerator {
  type: string;
  generate(content: string, sdk: QueryFunction): Promise<CardContent>;
}

// Frontend: Renderer interface (SpacedRepetitionWidget.tsx)
interface CardTypeRenderer {
  type: string;
  renderQuestion(card: Card): React.ReactNode;
  renderAnswer(card: Card): React.ReactNode;
}
```

Future card types (cloze deletion, image recognition) can be added by:
1. Adding a new generator implementing `CardTypeGenerator`
2. Adding a new renderer implementing `CardTypeRenderer`
3. Registering both in their respective registries
4. Core logic (scheduling, storage, widget flow) remains unchanged

## Widget UX Design

### Question Display (REQ-F-17)
- Question rendered as markdown in a styled card container
- Source file link shown below question (if available) for context
- Card count shown in header: "Card 1 of N"

### Answer Input (REQ-F-18)
- Single-line text input field below question
- Placeholder text: "Type your answer..."
- Input is for self-reflection only (no validation against expected answer)
- User can leave blank and proceed directly to reveal

### Self-Assessment Buttons (REQ-F-23, REQ-NF-5)
- Four buttons in a row: [Again] [Hard] [Good] [Easy]
- Minimum touch target: 44x44px per iOS/Android guidelines
- Clear visual distinction: Again=red, Hard=orange, Good=green, Easy=blue
- Keyboard shortcuts for desktop: 1/2/3/4 keys

### Action Buttons (REQ-F-19)
- Three buttons below input: [Skip] [Forget] [Show Answer]
- Skip: Outlined style (secondary action)
- Forget: Red text (destructive action with confirmation)
- Show Answer: Primary style (main action)

## Card Lifecycle

### New Card Initialization (REQ-F-34)
When a card is created (either by discovery or manually):
```typescript
{
  interval: 1,           // First review after 1 day
  repetitions: 0,        // Never reviewed
  ease_factor: 2.5,      // Default ease
  next_review: today,    // Due immediately for new cards
  last_reviewed: null,   // Never reviewed
}
```

### Review Update Behavior (REQ-F-35)
Each review updates these fields atomically:
- `last_reviewed`: Set to today's date
- `next_review`: Calculated via SM-2 based on response
- `interval`: Updated per SM-2 algorithm
- `repetitions`: Incremented (or reset to 0 for "again")
- `ease_factor`: Adjusted per response quality

### Archive Behavior (REQ-F-36)
When a card is archived:
- File moved from `cards/` to `cards/archive/`
- All metadata preserved in the file
- Archived cards excluded from `GET /due` query (only reads from `cards/`, not `cards/archive/`)
- Users can manually un-archive by moving file back

## Data Model

### Card File Format (REQ-F-12, REQ-F-13)

```markdown
---
id: "550e8400-e29b-41d4-a716-446655440000"
type: "qa"
created_date: "2026-01-23"
last_reviewed: "2026-01-22"
next_review: "2026-01-25"
ease_factor: 2.5
interval: 3
repetitions: 2
source_file: "01_Projects/memory-loop/notes.md"
---

## Question

What is the primary purpose of the SM-2 algorithm?

## Answer

SM-2 (SuperMemo 2) is a spaced repetition algorithm that calculates optimal review intervals based on how well the user recalls information. It increases intervals for well-remembered items and resets intervals for forgotten items, maximizing retention while minimizing review time.
```

Card body uses `## Question` and `## Answer` headers to separate content (REQ-F-13). This structure is type-specific; future card types may use different headers (e.g., `## Cloze` for cloze deletion cards).

### Card Metadata Schema (Zod)

```typescript
const CardMetadataSchema = z.object({
  id: z.string().uuid(),
  type: z.string().default("qa"),  // Extensibility: "qa" | future types
  created_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last_reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  next_review: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ease_factor: z.number().min(1.3).default(2.5),
  interval: z.number().int().min(0).default(0),
  repetitions: z.number().int().min(0).default(0),
  source_file: z.string().optional(),
});
```

### Discovery State Schema

```typescript
const CardDiscoveryStateSchema = z.object({
  lastDailyRun: z.string().datetime().nullable(),
  lastWeeklyRun: z.string().datetime().nullable(),
  processedFiles: z.array(z.object({
    vaultId: z.string(),
    path: z.string(),
    checksum: z.string(),
    processedAt: z.string().datetime(),
  })),
  weeklyProgress: z.object({
    currentBatch: z.number().int().default(0),
    totalProcessed: z.number().int().default(0),
  }),
});
```

## API Design

### REST Endpoints

All endpoints under `/api/vaults/:vaultId/cards/`

#### GET /due
Returns cards with `next_review <= today`, sorted by next_review ascending.

```typescript
// Response
interface DueCardsResponse {
  cards: Array<{
    id: string;
    question: string;
    next_review: string;
  }>;
  count: number;
}
```

#### GET /:cardId
Returns full card details including answer (for reveal).

```typescript
// Response
interface CardDetailResponse {
  id: string;
  question: string;
  answer: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  last_reviewed: string | null;
  next_review: string;
  source_file?: string;
}
```

#### POST /:cardId/review
Submit review response, updates card metadata.

```typescript
// Request
interface ReviewRequest {
  response: "again" | "hard" | "good" | "easy";
}

// Response
interface ReviewResponse {
  id: string;
  next_review: string;
  interval: number;
  ease_factor: number;
}
```

#### POST /:cardId/archive
Moves card to archive directory.

```typescript
// Response
interface ArchiveResponse {
  id: string;
  archived: true;
}
```

## Integration Points

### Vault Manager
- **Type**: Read
- **Purpose**: Get vault info for card storage paths
- **Data Flow**: `vault.contentRoot + vault.metadataPath + "/cards/"`

### SDK Provider
- **Type**: AI Generation
- **Purpose**: LLM calls for card extraction
- **Data Flow**: Vault content → Haiku → Q&A cards
- **Dependency**: Uses existing `getSdkQuery()` pattern from inspiration-manager.ts

### Home Routes
- **Type**: API Extension
- **Purpose**: Add card routes alongside goals/tasks/inspiration
- **Data Flow**: New route file mounted in server.ts

### HomeView Component
- **Type**: UI Integration
- **Purpose**: Render review widget
- **Data Flow**: useCards hook → SpacedRepetitionWidget component

## Error Handling, Performance, Security

### Error Strategy
- **Discovery Errors**: Log and continue to next file (REQ-F-37)
- **Invalid Card Files**: Skip with warning, don't crash (REQ-F-38)
- **Missing Directories**: Create on first access (REQ-F-39, REQ-F-40)
- **Review Errors**: Return error response, don't corrupt card state

### Performance Targets
- **Widget Load**: <500ms for due cards query (REQ-NF-2)
- **Daily Discovery**: <5 minutes (REQ-NF-1)
- **Card Write**: Atomic via temp+rename (REQ-NF-4)

### Security Measures
- **Path Validation**: Reuse existing vault path validation from file-browser.ts
- **No External Data**: Cards derived only from vault content
- **Archive vs Delete**: No destructive delete from UI, only archive

## Testing Strategy

### Unit Tests
- SM-2 algorithm against reference implementation values
- Card metadata parsing/serialization
- Discovery state checksum logic
- Queue management (skip, filter due cards)

### Integration Tests
- Card CRUD via REST API
- Discovery scheduler with mock SDK
- Widget rendering with mock API responses

### Manual Validation
- End-to-end review flow
- Card generation from sample vault content
- Archive operation file movement

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM generates poor quality cards | M | M | Allow manual card creation (REQ-F-14), users can archive bad cards |
| Large vault overwhelms daily discovery | L | M | 500KB weekly batch limit prevents runaway processing |
| Card file corruption during write | L | H | Atomic write pattern (temp+rename) per REQ-NF-4 |
| Duplicate cards from same content | M | L | Checksum tracking prevents reprocessing |

## Dependencies

### Technical
- `cron` package (already used for extraction scheduling)
- `uuid` package (already in dependencies)
- Zod schemas (existing pattern)

### Team
- None required (self-contained feature)

## Open Questions

- [x] Should cards have source file references? → Yes, per spec discussion (optional field in metadata)
- [ ] Answer input validation (spec open question) → Recommend: no validation, purely for self-reflection
