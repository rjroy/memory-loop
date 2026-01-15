---
version: 1.0.0
status: Draft
created: 2026-01-15
last_updated: 2026-01-15
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
issue: "#236"
---

# External Data Sync Specification

## Executive Summary

Memory Loop's widget system reads frontmatter from markdown files but cannot fetch external data. Users with board game collections want to sync metadata from BoardGameGeek (BGG) into their vault files without manual data entry.

This feature adds a sync pipeline system that fetches data from external APIs, applies configurable transformations (including LLM-assisted vocabulary normalization), and updates frontmatter in matching files. Starting with BGG as the first connector, the architecture supports adding other APIs later.

## User Story

As a vault user with board game notes, I want to sync metadata from BoardGameGeek into my files' frontmatter, so that my widgets display accurate ratings, play counts, and mechanics without manual data entry.

## Stakeholders

- **Primary**: Vault users who maintain collections (board games, books, media) with external metadata sources
- **Secondary**: Memory Loop maintainers extending to new APIs
- **Tertiary**: Widget developers consuming synced data, vault administrators managing secrets

## Success Criteria

1. User can trigger sync from Ground tab and see completion status
2. Synced BGG data appears in frontmatter within 60 seconds for collections under 100 items
3. Vocabulary normalization produces consistent canonical terms (e.g., all variations of "Worker Placement" map to single term)
4. Existing user-edited frontmatter fields are preserved unless explicitly configured to overwrite

## Functional Requirements

### Pipeline Configuration

- **REQ-F-1**: Sync pipelines defined in `.memory-loop/sync/*.yaml` files
- **REQ-F-2**: Each pipeline specifies: API connector, file matching criteria, field mappings, and transformation rules
- **REQ-F-3**: Files matched by frontmatter field value (e.g., `match_field: bgg_id`)
- **REQ-F-4**: Pipeline config specifies target namespace or direct field mapping for synced data

### Field Mapping and Merge Behavior

- **REQ-F-5**: Per-field merge strategy: `overwrite`, `preserve` (skip if exists), or `merge` (for arrays)
- **REQ-F-6**: Default merge strategy configurable at pipeline level, overridable per-field
- **REQ-F-7**: Support writing to nested namespace (e.g., `synced.bgg.rating`) or direct fields (e.g., `rating`)

### BGG API Connector

- **REQ-F-8**: Fetch game data by BGG ID via BGG XML API v2
- **REQ-F-9**: Extract fields: name, rating, weight, player count range, play time, mechanics, categories, year published
- **REQ-F-10**: Handle BGG API rate limiting (respect 429 responses, implement backoff)
- **REQ-F-11**: Cache API responses to reduce redundant requests during sync

### LLM Vocabulary Normalization

- **REQ-F-12**: Define canonical vocabulary mappings in pipeline config
- **REQ-F-13**: LLM maps incoming values to canonical terms using provided vocabulary
- **REQ-F-14**: Normalization applied per-field when `normalize: true` in field config
- **REQ-F-15**: Unmapped values either preserved as-is or flagged for review (configurable)

### Sync Execution

- **REQ-F-16**: Manual trigger only (no automatic/scheduled sync)
- **REQ-F-17**: Support full sync (all matching files) and incremental sync (only files without synced data or with stale data)
- **REQ-F-18**: Track last sync timestamp per file in frontmatter (`_sync_meta.last_synced`)
- **REQ-F-19**: Sync writes frontmatter updates atomically (no partial writes or data corruption)

### Secrets Management

- **REQ-F-20**: API secrets stored in `.memory-loop/secrets/*.yaml` (intended for git-crypt encryption)
- **REQ-F-21**: Secrets file format: key-value pairs, referenced in pipeline config by key name
- **REQ-F-22**: Secrets files excluded from any logging or error messages

### Error Handling

- **REQ-F-26**: Invalid pipeline config logs validation errors and skips that pipeline
- **REQ-F-27**: Network failures retry up to 3 times before marking file as failed
- **REQ-F-28**: API response cache invalidated when manual full sync is triggered
- **REQ-F-29**: If LLM normalization fails, preserve raw value and log warning

### UI Integration

- **REQ-F-30**: Sync button in Ground tab settings section
- **REQ-F-31**: Button shows sync status: idle, syncing, success, error
- **REQ-F-32**: Error state shows brief message (e.g., "3 files failed to sync")

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Sync 100 files in under 60 seconds (excluding API rate limit delays)
- **REQ-NF-2** (Reliability): Partial failures do not corrupt files; each file write is atomic
- **REQ-NF-3** (Observability): Log sync progress at INFO level (files processed, errors encountered)
- **REQ-NF-4** (Extensibility): Adding a new API connector requires implementing a defined interface, not modifying core sync logic

## Explicit Constraints (DO NOT)

- Do NOT implement automatic/scheduled sync (manual trigger only)
- Do NOT store secrets in plaintext in vault config or logs
- Do NOT modify files outside the vault content root
- Do NOT make sync a blocking operation for other Memory Loop features
- Do NOT implement a full-featured sync configuration UI (text-based YAML config is sufficient)
- Do NOT fetch data for files without a valid ID field (skip silently)

## Technical Context

- **Existing Stack**: Bun runtime, TypeScript, Hono server, WebSocket communication
- **Integration Points**:
  - Vault config system (`.memory-loop.json`, `.memory-loop/` directory)
  - Frontmatter parsing (`gray-matter` library)
  - Widget engine (consumes synced frontmatter data)
  - WebSocket handler (for sync trigger and status messages)
- **Patterns to Respect**:
  - Zod schemas for config validation
  - Handler pattern for WebSocket messages
  - Atomic file operations with temp files

## Acceptance Tests

1. **Basic BGG Sync**: Given a file with `bgg_id: 174430` (Gloomhaven), when sync runs, then frontmatter contains `bgg.rating`, `bgg.weight`, and `bgg.mechanics`

2. **Vocabulary Normalization**: Given canonical vocabulary `{"Worker Placement": ["worker placement", "Worker placement game"]}`, when BGG returns "Worker placement game", then frontmatter contains "Worker Placement"

3. **Preserve User Edits**: Given field config `notes: { strategy: preserve }` and existing `notes` field, when sync runs, then original `notes` value is unchanged

4. **Incremental Sync**: Given 10 files where 3 have `_sync_meta.last_synced` within threshold, when incremental sync runs, then only 7 files are fetched from API

5. **Rate Limit Handling**: Given BGG returns 429 status, when sync encounters rate limit, then sync pauses and retries with backoff

6. **Sync Status UI**: Given sync in progress, when user views Ground tab, then sync button shows "Syncing..." state

7. **Error Reporting**: Given 2 files fail to sync due to invalid BGG ID, when sync completes, then status shows "Synced 8/10 files (2 errors)"

8. **Secrets Not Logged**: Given secrets file with API key, when sync runs with verbose logging, then API key never appears in logs

9. **LLM Normalization Fallback**: Given LLM normalization fails for a field, when sync completes, then raw BGG value is preserved and warning logged

10. **Invalid Config Handling**: Given pipeline config with invalid YAML, when sync is triggered, then error is logged and other valid pipelines still execute

## Open Questions

- [ ] What BGG API endpoints are needed beyond the basic "thing" endpoint for game data? (Deferred to planning phase)

## Out of Scope

- Scheduled/automatic sync triggers
- Bidirectional sync (pushing changes back to BGG)
- UI for creating/editing sync pipeline configs
- Support for APIs other than BGG in initial release
- Conflict resolution for concurrent syncs

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
