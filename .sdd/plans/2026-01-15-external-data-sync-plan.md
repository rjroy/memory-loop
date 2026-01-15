---
specification: ./../specs/2026-01-15-external-data-sync.md
status: Draft
version: 1.0.0
created: 2026-01-15
last_updated: 2026-01-15
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# External Data Sync - Technical Plan

## Overview

This plan describes how to implement a sync pipeline system that fetches data from external APIs (starting with BoardGameGeek), applies transformations including LLM-assisted vocabulary normalization, and updates frontmatter in vault files. The system follows Memory Loop's existing patterns: YAML configuration in `.memory-loop/`, Zod schema validation, handler-based WebSocket messaging, and atomic file operations.

The architecture prioritizes extensibility (adding new API connectors) while keeping the initial implementation focused on BGG. Sync is manual-trigger only, with progress reported via WebSocket to the Ground tab UI.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Memory Loop                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Frontend   │◄──►│  WebSocket   │◄──►│  Sync Pipeline   │  │
│  │  (Ground)    │    │   Handler    │    │     Manager      │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                                                │                │
│                           ┌────────────────────┼────────────┐   │
│                           ▼                    ▼            ▼   │
│                    ┌─────────────┐    ┌────────────┐  ┌───────┐ │
│                    │ BGG         │    │ File       │  │ LLM   │ │
│                    │ Connector   │    │ Processor  │  │ Norm. │ │
│                    └─────────────┘    └────────────┘  └───────┘ │
│                           │                    │                │
└───────────────────────────│────────────────────│────────────────┘
                            ▼                    ▼
                    ┌─────────────┐    ┌────────────────┐
                    │  BGG API    │    │  Vault Files   │
                    │  (XML v2)   │    │  (frontmatter) │
                    └─────────────┘    └────────────────┘
```

### Components

| Component | Responsibility |
|-----------|----------------|
| `sync-pipeline.ts` | Orchestrates sync: loads config, matches files, coordinates fetch/transform/write |
| `bgg-connector.ts` | Fetches and parses BGG XML API responses, handles rate limiting |
| `api-response-cache.ts` | In-memory cache for API responses during sync run |
| `vocabulary-normalizer.ts` | LLM-based term normalization with configurable vocabularies |
| `frontmatter-updater.ts` | Reads/merges/writes frontmatter with atomic file operations |
| `sync-handlers.ts` | WebSocket message handlers for sync trigger and status |

## Technical Decisions

### TD-1: Pipeline Configuration Location
**Choice**: Store sync pipelines in `.memory-loop/sync/*.yaml`, secrets in `.memory-loop/secrets/*.yaml`
**Requirements**: REQ-F-1, REQ-F-20, REQ-F-21
**Rationale**: Follows the established `.memory-loop/` convention for per-vault config (widgets use `.memory-loop/widgets/`). Separate secrets directory enables git-crypt encryption without affecting pipeline configs. YAML matches widget config format for consistency.

### TD-2: API Connector Interface
**Choice**: Define `ApiConnector` interface with `fetchById()` and `extractFields()` methods
**Requirements**: REQ-NF-4
**Rationale**: Interface-based design allows adding new APIs (books, movies) by implementing a single interface rather than modifying core sync logic. BGG connector is the first implementation. Each connector encapsulates its API's quirks (XML parsing, auth, rate limits).

```typescript
interface ApiConnector {
  readonly name: string;
  fetchById(id: string): Promise<ApiResponse>;
  extractFields(response: ApiResponse, mappings: FieldMapping[]): Record<string, unknown>;
}
```

### TD-3: Rate Limiting Strategy
**Choice**: Connector-level rate limiting with exponential backoff on 429 responses
**Requirements**: REQ-F-10, REQ-F-27
**Rationale**: BGG's API returns 429 when rate limited. Rather than preemptive throttling (which would slow all syncs), we respond to 429s with exponential backoff (1s, 2s, 4s, max 30s). This maximizes throughput while respecting the API. Retry count capped at 3 per file before marking as failed.

### TD-4: API Response Cache
**Choice**: In-memory Map-based cache, scoped to sync run, invalidated on full sync
**Requirements**: REQ-F-11, REQ-F-28
**Rationale**: Simple in-memory cache avoids SQLite complexity for this use case. Cache is per-run (not persistent) because BGG data changes and we want fresh data on sync. Full sync explicitly clears cache. Incremental sync benefits from cache if multiple files share the same BGG ID (unlikely but handled).

### TD-5: LLM Vocabulary Normalization
**Choice**: Use Claude via existing SDK with structured prompt, fall back to raw value on failure
**Requirements**: REQ-F-12, REQ-F-13, REQ-F-14, REQ-F-15, REQ-F-29
**Rationale**: LLM excels at fuzzy term matching ("Worker placement game" -> "Worker Placement"). Vocabulary is defined in pipeline config as canonical term -> variations mapping. On LLM failure (timeout, API error), preserve raw value and log warning per REQ-F-29. This prevents sync from blocking on normalization issues.

### TD-6: Frontmatter Merge Strategy
**Choice**: Per-field strategy (`overwrite`, `preserve`, `merge`) with pipeline-level default
**Requirements**: REQ-F-5, REQ-F-6, REQ-F-7
**Rationale**: Users need control over what gets updated. `preserve` protects manual edits (e.g., personal notes). `overwrite` ensures API data takes precedence (e.g., rating). `merge` appends to arrays without duplicates (e.g., mechanics). Default at pipeline level reduces config verbosity for common case.

### TD-7: Atomic File Writes
**Choice**: Write to temp file, rename to target (following existing `note-capture.ts` pattern)
**Requirements**: REQ-NF-2, REQ-F-19
**Rationale**: Prevents partial writes from corrupting files. Node's `rename()` is atomic on POSIX systems. This pattern is already used in the codebase (note-capture). On Windows, we use `fs.rename()` which is also atomic within the same filesystem.

### TD-8: Sync Progress Communication
**Choice**: WebSocket messages for status updates, following existing handler pattern
**Requirements**: REQ-F-30, REQ-F-31, REQ-F-32
**Rationale**: Frontend already uses WebSocket for real-time updates. Add `sync_status` message type to protocol. Status includes: `idle`, `syncing` (with progress), `success`, `error` (with message). Matches existing patterns (e.g., `index_progress` for search indexing).

### TD-9: File Matching Strategy
**Choice**: Two-phase matching: glob pattern filters candidate files, then frontmatter field presence determines sync eligibility
**Requirements**: REQ-F-2, REQ-F-3
**Rationale**: Glob patterns (e.g., `Games/**/*.md`) provide fast filesystem-level filtering without parsing every file. Only files matching the pattern are then checked for the required frontmatter field (e.g., `bgg_id`). Files without the ID field are silently skipped per spec constraint. This balances performance (glob is O(directory structure)) with flexibility (any frontmatter field can be the match key).

**Alternatives Considered**:
- Full frontmatter scan of all files: Too slow for large vaults
- Filename-based ID extraction: Too restrictive, many users embed IDs in frontmatter

### TD-10: BGG XML API v2
**Choice**: Use BGG's public XML API v2 (`/xmlapi2/thing`) with `fast-xml-parser` for parsing
**Requirements**: REQ-F-8, REQ-F-9
**Rationale**: BGG offers two APIs: XML API v2 (public, no auth for read) and JSON API (requires auth, more restrictive). XML API v2 provides all required fields (name, rating, weight, players, playtime, mechanics, categories) in a single request. `fast-xml-parser` is lightweight (no native deps), actively maintained, and handles BGG's nested attribute syntax well.

**Field Extraction**: XPath-like traversal of parsed XML. The connector maps BGG's nested structure to flat field names:
- `item/name[@type='primary']/@value` -> `name`
- `item/statistics/ratings/average/@value` -> `rating`
- `item/link[@type='boardgamemechanic']/@value` -> `mechanics` (array)

### TD-11: Manual-Only Sync Trigger
**Choice**: Sync triggered exclusively via UI button press, no scheduled/automatic sync
**Requirements**: REQ-F-16
**Rationale**: Per spec constraint, automatic sync is explicitly out of scope. Manual-only trigger:
- Gives users control over when API calls are made (respects API quotas)
- Avoids background processing complexity
- Prevents unexpected file modifications
- Simplifies implementation (no cron/scheduler infrastructure)

The UI exposes a "Sync" button in Ground tab settings. Pressing it sends `trigger_sync` WebSocket message.

### TD-12: Sync Metadata Tracking
**Choice**: Store `_sync_meta` object in frontmatter with `last_synced` timestamp, `source`, and `source_id`
**Requirements**: REQ-F-18
**Rationale**: Embedding sync metadata in the file itself (rather than external tracking) ensures:
- Metadata travels with the file (no orphaned tracking data)
- Incremental sync can check staleness by reading the file it's about to update
- Users can see when data was last synced by viewing frontmatter
- No separate database required

The `_sync_meta` prefix indicates system-managed fields (convention from other systems). Timestamp is ISO 8601 for unambiguous parsing.

### TD-13: Observability and Logging
**Choice**: Structured logging at INFO level for sync progress, WARN for recoverable issues, ERROR for failures
**Requirements**: REQ-NF-3
**Rationale**: Following existing logging patterns (`createLogger` from `logger.ts`), sync operations log:
- INFO: Sync start/complete, files processed count, duration
- WARN: Rate limit encountered (with retry count), normalization fallback, skipped files
- ERROR: Network failures (after retries exhausted), file write failures

Secrets are explicitly filtered from all log output by wrapping the secrets object in a non-enumerable proxy.

## Data Model

### Pipeline Configuration Schema

```yaml
# .memory-loop/sync/boardgames.yaml
name: Board Games BGG Sync
connector: bgg                    # Which API connector to use
match:
  field: bgg_id                   # Frontmatter field to match on
  pattern: "Games/**/*.md"        # Glob pattern for candidate files

defaults:
  merge_strategy: overwrite       # Default strategy for all fields
  namespace: bgg                  # Write to bgg.* in frontmatter

fields:
  - source: name                  # BGG field name
    target: title                 # Frontmatter field (under namespace)
    strategy: preserve            # Override default strategy

  - source: mechanics
    target: mechanics
    strategy: merge
    normalize: true               # Apply vocabulary normalization

  - source: rating
    target: rating

vocabulary:                       # Canonical -> variations mapping
  "Worker Placement":
    - "worker placement"
    - "Worker placement game"
    - "Workers placement"
  "Deck Building":
    - "deck building"
    - "Deckbuilding"
    - "Deck-building"
```

### Secrets Configuration Schema

```yaml
# .memory-loop/secrets/api-keys.yaml
bgg_username: myuser              # BGG doesn't require API key, just username for some endpoints
openai_key: sk-...                # Future: if using OpenAI for normalization
```

### Sync Metadata in Frontmatter

```yaml
# Written to each synced file
_sync_meta:
  last_synced: "2026-01-15T10:30:00Z"
  source: bgg
  source_id: "174430"
```

## API Design

### WebSocket Protocol Additions

**Client -> Server:**
```typescript
// Trigger sync
TriggerSyncMessageSchema = z.object({
  type: z.literal("trigger_sync"),
  mode: z.enum(["full", "incremental"]),  // REQ-F-17
  pipeline: z.string().optional(),         // Specific pipeline or all
});
```

**Server -> Client:**
```typescript
// Sync status updates
SyncStatusMessageSchema = z.object({
  type: z.literal("sync_status"),
  status: z.enum(["idle", "syncing", "success", "error"]),
  progress: z.object({
    current: z.number(),
    total: z.number(),
    currentFile: z.string().optional(),
  }).optional(),
  message: z.string().optional(),          // Error message or summary
  errors: z.array(z.object({
    file: z.string(),
    error: z.string(),
  })).optional(),                          // Per-file errors (REQ-F-32)
});
```

### BGG API Integration

BGG XML API v2 endpoints used:
- `https://boardgamegeek.com/xmlapi2/thing?id={id}&stats=1` - Game details with stats

Response fields extracted:
| BGG Field | Type | Notes |
|-----------|------|-------|
| `name[@type='primary']` | string | Primary game name |
| `statistics/ratings/average/@value` | number | Average rating |
| `statistics/ratings/averageweight/@value` | number | Complexity weight |
| `minplayers` | number | Minimum players |
| `maxplayers` | number | Maximum players |
| `minplaytime` | number | Minimum play time |
| `maxplaytime` | number | Maximum play time |
| `yearpublished` | number | Publication year |
| `link[@type='boardgamemechanic']` | string[] | Game mechanics |
| `link[@type='boardgamecategory']` | string[] | Game categories |

## Integration Points

### Existing Codebase Integration

| Integration | How | Files |
|------------|-----|-------|
| WebSocket Protocol | Add message types to discriminated union | `shared/src/protocol.ts` |
| WebSocket Handler | Add sync message routing | `backend/src/websocket-handler.ts`, `backend/src/handlers/sync-handlers.ts` |
| Frontmatter Parsing | Reuse existing `gray-matter` utilities | `backend/src/widgets/frontmatter.ts` |
| Vault Config | Load secrets alongside existing config | `backend/src/vault-config.ts` |
| Health Reporting | Report sync errors to health collector | `backend/src/health-collector.ts` |
| File Watcher | Trigger widget refresh after sync | `backend/src/widgets/file-watcher.ts` |

### Claude SDK Integration

For vocabulary normalization, use existing SDK session pattern:
```typescript
// Create minimal session for normalization (no tools needed)
const result = await sdk.query({
  system: "You are a vocabulary normalizer. Given a term and canonical vocabulary, return the matching canonical term or 'NO_MATCH'.",
  messages: [{ role: "user", content: prompt }],
});
```

## Error Handling, Performance, Security

### Error Strategy

- **Config Errors**: Validate pipeline YAML at load time with Zod. Invalid configs are logged and skipped (REQ-F-26). Other valid pipelines continue.
- **Network Errors**: Retry up to 3 times with exponential backoff (REQ-F-27). After 3 failures, mark file as failed and continue to next file.
- **LLM Errors**: Preserve raw value, log warning (REQ-F-29). Normalization failure is not sync failure.
- **File Write Errors**: Atomic writes prevent corruption. On write failure, log error and continue.

### Performance Targets

- **REQ-NF-1**: 100 files in <60s excluding rate limit delays
  - Achieved by: parallel file matching, batched API requests where possible, in-memory caching
  - BGG API is the bottleneck (~1-2 req/sec sustained)
- **Incremental sync**: Skip files with recent `_sync_meta.last_synced` (configurable threshold, default 24h)

### Security Measures

- **Secrets**: Never logged (REQ-F-22). Secrets object filtered from all log output.
- **Path Traversal**: Pipeline `pattern` validated to stay within vault content root.
- **No External Code**: Pipeline configs are data, not executed code.

## Testing Strategy

### Unit Tests
- Pipeline config validation (valid/invalid YAML)
- BGG XML parsing (mock responses)
- Merge strategy logic (overwrite/preserve/merge)
- Vocabulary normalization prompt generation
- Frontmatter update operations

### Integration Tests
- Full sync flow with mock BGG API
- Incremental sync skip logic
- WebSocket message flow
- Error handling and retry logic
- Atomic write verification

### Manual Testing
- Real BGG API sync with small collection
- Rate limit handling verification
- UI sync button states

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BGG API changes or deprecation | L | H | Abstract behind connector interface; monitor BGG developer forums |
| LLM normalization inconsistency | M | L | Provide canonical vocabulary in prompt; fall back to raw value |
| Large collection causes timeout | M | M | Progress reporting, incremental sync, consider pagination |
| Secrets accidentally logged | L | H | Filter secrets from all log calls; code review |

## Dependencies

### Technical
- `fast-xml-parser`: Parse BGG XML responses (lightweight, no native dependencies)
- Existing: `gray-matter`, `lodash-es`, `zod`

### Team
- None (self-contained feature)

## Open Questions

- [ ] BGG username/password auth: Is it needed for any endpoints we use? (Initial research suggests public endpoints suffice for game data)
- [ ] Should we support multiple ID fields per pipeline? (e.g., match on `bgg_id` OR `bgg_name`)
