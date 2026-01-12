---
version: 1.0.0
status: Approved
created: 2026-01-10
last_updated: 2026-01-10
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Widgets Specification

## Executive Summary

Memory Loop currently displays vault content as-is: markdown files with frontmatter rendered directly. For vaults with structured data (game collections, recipes, reading lists), raw display is insufficient. Users need computed views: aggregated statistics, similarity rankings, normalized scores that require collection-wide calculations.

Vault Widgets introduces a configuration-driven system where each vault defines its own data processing, display, and editing widgets. Widgets compute derived values from frontmatter data, display results in contextual locations, and allow simple single-value edits back to source files. The system uses a persistent cache with file-change detection to avoid recomputation.

## User Story

As a vault owner with structured collections, I want to define custom computations and displays for my data, so that I can see meaningful derived insights (rankings, similarity, normalized scores) without leaving Memory Loop.

## Stakeholders

- **Primary**: Vault owners with structured data collections (games, books, recipes, etc.)
- **Secondary**: Memory Loop maintainers extending the widget system
- **Tertiary**: Other vault users who view but don't configure widgets; users of other Memory Loop features affected by performance

## Success Criteria

1. Vault owner can define a widget config and see computed results within 5 seconds of vault connection
2. File changes trigger widget recomputation within 2 seconds (after debounce)
3. Similarity queries return cached results in under 100ms for collections up to 1000 items
4. Single-value edits persist to vault files and reflect in UI without page reload

## Functional Requirements

### Widget Configuration

- **REQ-F-1**: Vaults define widgets in `.memory-loop/widgets/*.yaml` files
- **REQ-F-2**: Server discovers and validates widget configs when vault connects
- **REQ-F-3**: Invalid configs produce actionable error messages, not silent failures
- **REQ-F-4**: Widget configs specify: source files (glob), fields, computations, display type, and location (ground/recall)

### Data Processing

- **REQ-F-5**: File discovery via glob patterns matching vault files
- **REQ-F-6**: Field extraction from YAML frontmatter by dot-notation paths (e.g., `bgg.play_count`)
- **REQ-F-7**: Collection-level aggregations: sum, avg, count, min, max, stddev
- **REQ-F-8**: Per-item computed fields using a safe expression language (math, conditionals, field references)
- **REQ-F-9**: Two-phase computation: collection stats computed first, then available to per-item expressions
- **REQ-F-10**: Z-score computation: `(value - mean) / stddev` with access to collection stats
- **REQ-F-11**: Expression language supports: arithmetic, comparisons, conditionals, math functions (abs, round, clamp)

### Similarity Computation

- **REQ-F-12**: Similarity widgets define dimensions with field, weight, and method
- **REQ-F-13**: Similarity methods: `jaccard` (set overlap), `proximity` (numeric distance), `cosine` (vector similarity)
- **REQ-F-14**: Similarity computed on-demand for a given item, returning top-N similar items
- **REQ-F-15**: Similarity results cached with vault content hash; cache invalidated when source files change

### Display

- **REQ-F-16**: Ground widgets appear on Home/Ground view (global dashboard context)
- **REQ-F-17**: Recall widgets appear on Browse/Recall view when viewing a matching file
- **REQ-F-18**: Display types: `summary-card` (key-value pairs), `table` (rows/columns), `list` (ranked items), `meter` (single value with scale)
- **REQ-F-19**: Widgets render computed values with optional labels and formatting

### Editing

- **REQ-F-20**: Widgets can declare editable fields with input type: `slider`, `number`, `text`, `date`, `select`
- **REQ-F-21**: Edits modify a single frontmatter field in the source file
- **REQ-F-22**: Edit writes persist immediately and trigger widget recomputation

### Caching

- **REQ-F-23**: Widget computation results cached in SQLite database (`.memory-loop/cache.db` in vault)
- **REQ-F-24**: File change detection with configurable debounce (default 500ms)
- **REQ-F-25**: Cache keyed by vault ID + widget ID + content hash
- **REQ-F-26**: Stale cache served while recomputation runs in background (stale-while-revalidate pattern)
- **REQ-F-31**: Cache database configured for crash resilience (WAL mode); ungraceful shutdown must not corrupt beyond recovery
- **REQ-F-32**: On startup, validate cache integrity; if corrupted, delete and rebuild from source files

### Error Handling

- **REQ-F-27**: When glob pattern matches zero files, widget displays "no data" indicator (not an error)
- **REQ-F-28**: When frontmatter field missing from a file, treat as null and skip in aggregations; include in count but not in sum/avg
- **REQ-F-29**: When cache persistence fails, log error and continue with in-memory fallback until resolved
- **REQ-F-30**: Expression evaluation must timeout after 1 second per item to prevent infinite loops or resource exhaustion

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Collection-level aggregation completes in under 1 second for 1000 files
- **REQ-NF-2** (Performance): Similarity computation for a single item completes in under 500ms for 1000-item collections
- **REQ-NF-3** (Reliability): Cache corruption does not crash the server; fallback to recomputation
- **REQ-NF-4** (Extensibility): New aggregation types and display types can be added without architectural changes
- **REQ-NF-5** (Security): Expression language does not permit arbitrary code execution, file system access, or network calls

## Explicit Constraints (DO NOT)

- Do NOT execute arbitrary JavaScript from widget configs
- Do NOT use Claude/LLM for core computation (cost constraint); LLM usage limited to optional explanation generation
- Do NOT allow widgets to modify multiple frontmatter fields in a single edit
- Do NOT require Obsidian or any external tool to run; Memory Loop computes widgets independently
- Do NOT store cached data in RAM only; must persist across server restarts

## Technical Context

- **Existing Stack**: Bun runtime, Hono server, React 19 frontend, WebSocket communication
- **Integration Points**:
  - `vault-manager.ts` for file discovery
  - `file-browser.ts` for file reading
  - WebSocket protocol for widget data to frontend
  - Existing frontmatter parsing in vault files
- **Patterns to Respect**:
  - Zod schemas in `shared/` for message validation
  - useReducer pattern in SessionContext for state
  - Existing mode structure (Home, Note, Discussion, Browse)

## Acceptance Tests

1. **Config Discovery**: Create `.memory-loop/widgets/test.yaml` in vault; verify server logs discovery on connection
2. **Simple Aggregation**: Widget with `count` on `Games/*.md` returns correct file count
3. **Z-Score Computation**: Widget computing z-scores matches manual calculation for test data
4. **Similarity Cache Hit**: Request similarity twice; second request returns in under 50ms
5. **Cache Invalidation**: Modify a source file; verify similarity cache invalidated and recomputed
6. **Ground Widget Display**: Widget with `location: ground` appears on Home view
7. **Recall Widget Display**: Widget with `location: recall` appears when viewing matching file
8. **Single-Value Edit**: Use slider widget to change frontmatter value; verify file updated and widget reflects new value
9. **Invalid Config Handling**: Create malformed widget config; verify actionable error message, no crash
10. **Expression Safety**: Attempt expression with `require()` or file access; verify rejection

## Open Questions

None - all resolved.

## Out of Scope

- Real-time collaboration (multiple users editing same vault)
- Widget marketplace or sharing between vaults
- Widget config inheritance/composition (can revisit if copy-paste becomes painful)
- Complex multi-field editing forms
- Chart/graph visualizations (future enhancement)
- LLM-powered recommendations (cost prohibitive for core feature)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
