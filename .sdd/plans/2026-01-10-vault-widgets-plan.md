---
version: 1.0.0
status: Under Review
created: 2026-01-10
last_updated: 2026-01-10
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
spec: .sdd/specs/2026-01-10-vault-widgets.md
---

# Vault Widgets Implementation Plan

## Architecture Overview

The widget system introduces four new backend modules and extends the frontend with widget-aware components. The architecture follows existing Memory Loop patterns: WebSocket communication, Zod-validated messages, and useReducer state management.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  HomeView   │  │  BrowseMode │  │    SessionContext       │  │
│  │  (Ground    │  │  (Recall    │  │  + widgetState          │  │
│  │   Widgets)  │  │   Widgets)  │  │  + widgetActions        │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         └────────────────┴──────────────────────┘                │
│                          │ WebSocket                             │
└──────────────────────────┼───────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                      Backend                                     │
│  ┌─────────────────┐     │                                       │
│  │ websocket-      │◄────┘                                       │
│  │ handler.ts      │                                             │
│  └────────┬────────┘                                             │
│           │                                                      │
│  ┌────────▼────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  widget-        │──│  widget-    │──│  widget-cache.ts    │  │
│  │  loader.ts      │  │  engine.ts  │  │  (SQLite + WAL)     │  │
│  └─────────────────┘  └──────┬──────┘  └─────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────────┐  │
│  │                           │                               │  │
│  │  ┌─────────────┐  ┌───────▼──────┐  ┌─────────────────┐  │  │
│  │  │ aggregators │  │ expression-  │  │   comparators   │  │  │
│  │  │ .ts         │  │ eval.ts      │  │   .ts           │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │  │
│  │                     Computation Layer                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐   │
│  │  file-watcher   │  │  vault-manager.ts (existing)        │   │
│  │  .ts            │  │  file-browser.ts (existing)         │   │
│  └─────────────────┘  └─────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Purpose | Spec Requirements |
|-----------|---------|-------------------|
| `widget-loader.ts` | Discover and validate `.memory-loop/widgets/*.yaml` | REQ-F-1, REQ-F-2, REQ-F-3, REQ-F-4 |
| `widget-engine.ts` | Orchestrate computation, route by location | REQ-F-5, REQ-F-9, REQ-F-14, REQ-F-16, REQ-F-17, REQ-F-27 |
| `widget-cache.ts` | SQLite persistence with WAL, in-memory fallback | REQ-F-23, REQ-F-25, REQ-F-29, REQ-F-31, REQ-F-32 |
| `aggregators.ts` | Collection-level computations with null handling | REQ-F-7, REQ-F-10, REQ-F-28 |
| `expression-eval.ts` | Safe math expression evaluation | REQ-F-8, REQ-F-11, REQ-F-30, REQ-NF-5 |
| `comparators.ts` | Similarity methods (jaccard, proximity, cosine) | REQ-F-12, REQ-F-13 |
| `file-watcher.ts` | Debounced file change detection | REQ-F-24 |
| `frontmatter.ts` | YAML parsing with dot-notation field access | REQ-F-6 |

## Technical Decisions

### TD-1: Expression Language Selection

**Decision**: Use `expr-eval` library for safe expression evaluation.

**Why**:
- No access to globals, require, or file system (REQ-NF-5)
- Supports arithmetic, comparisons, conditionals, and custom functions
- Lightweight (~15KB) with no dependencies
- Can inject custom functions (abs, round, clamp, z-score)
- Used in production by similar projects (Obsidian Dataview uses a similar approach)

**Alternatives considered**:
- `mathjs`: More powerful but 500KB+, overkill for our needs
- Custom parser: High effort, risk of security holes
- `vm2`/QuickJS: Full JS sandbox is more than we need

### TD-2: SQLite Library Selection

**Decision**: Use `better-sqlite3` (synchronous) wrapped with async file operations.

**Why**:
- Bun has native SQLite support via `bun:sqlite` but it mirrors `better-sqlite3` API
- Synchronous operations are simpler and avoid callback complexity
- WAL mode requires proper configuration at connection time (REQ-F-31)
- Single-threaded access pattern matches our use case (one vault per connection)

**Configuration for crash resilience**:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### TD-3: File Watcher Implementation

**Decision**: Use `chokidar` for cross-platform file watching with custom debounce.

**Why**:
- Battle-tested, handles platform differences (inotify, FSEvents, polling)
- Supports glob patterns for efficient watching
- Memory-efficient for large vaults (doesn't watch all files, just the vault root)
- Debounce logic is simple to implement on top

**Debounce strategy**:
- Collect file change events for 500ms (configurable via REQ-F-24)
- On debounce timeout, trigger recomputation for affected widgets
- Use content hash comparison to avoid recomputing unchanged files

### TD-4: Two-Phase Computation Model

**Decision**: Separate collection stats from per-item computation (REQ-F-9).

**Phase 1 - Collection Stats**:
1. Load all matching files via glob
2. Extract frontmatter from each file
3. Compute aggregates: count, sum, mean, stddev for each field
4. Store as `CollectionStats` object

**Phase 2 - Per-Item Computation**:
1. For each file, evaluate expressions with access to:
   - `this.*` - current item's frontmatter fields
   - `stats.*` - collection-level statistics
   - Built-in functions: `abs()`, `round()`, `clamp()`, `zscore()`

**Z-score example**:
```yaml
# Widget config
fields:
  normalized_rating:
    expr: "zscore(this.rating, stats.rating_mean, stats.rating_stddev)"
```

### TD-5: Similarity Caching Strategy

**Decision**: Compute similarity on-demand, cache with content hash invalidation (REQ-F-15).

**Why not pre-compute all pairs**:
- N² storage for large collections (1000 games = 1M pairs)
- Most pairs never queried
- Background computation would be complex

**Cache key structure**:
```
similarity:{vault_id}:{widget_id}:{source_item_hash}:{content_version}
```

Where `content_version` is a hash of all file modification times in the collection. When any file changes, the version changes, invalidating all similarity caches for that widget.

### TD-6: Frontend Widget State

**Decision**: Extend SessionContext with widget-specific state slice.

**Why**:
- Follows existing pattern (goals, tasks, inspiration are in SessionContext)
- Allows widgets to persist across mode switches
- Simplifies component access via `useSession()`

**State additions**:
```typescript
interface WidgetState {
  // Ground widgets (Home view)
  groundWidgets: WidgetResult[];
  groundWidgetsLoading: boolean;

  // Recall widgets (keyed by current file path)
  recallWidgets: Map<string, WidgetResult[]>;
  recallWidgetsLoading: boolean;

  // Edit state for widget inputs
  pendingEdits: Map<string, unknown>;
}
```

### TD-7: Widget Display Components

**Decision**: Create a `WidgetRenderer` component that dispatches to type-specific renderers.

**Display type mapping** (REQ-F-18):
| Type | Component | Use Case |
|------|-----------|----------|
| `summary-card` | `SummaryCardWidget` | Key-value pairs (collection stats) |
| `table` | `TableWidget` | Rows/columns (ranked lists) |
| `list` | `ListWidget` | Ordered items (similar games) |
| `meter` | `MeterWidget` | Single value with scale (HEPCAT score) |

### TD-8: Frontmatter Editing Protocol

**Decision**: Widget edits go through existing `write_file` protocol with targeted updates.

**Flow** (REQ-F-20, REQ-F-21, REQ-F-22):
1. User adjusts slider/input in widget
2. Frontend sends `widget_edit` message with path, field, value
3. Backend reads current file, updates frontmatter field, writes back
4. Backend triggers widget recomputation
5. Backend sends updated widget results via `widget_update` message

**Why not use `toggle_task` pattern**: Task toggle is line-based; frontmatter editing requires YAML parsing and serialization.

### TD-9: Frontmatter Parsing

**Decision**: Use `gray-matter` library for frontmatter extraction and serialization (REQ-F-6).

**Why**:
- Battle-tested (500K+ weekly npm downloads)
- Handles YAML frontmatter with `---` delimiters
- Preserves content after frontmatter unchanged
- Supports dot-notation field access via lodash `get()`

**Field path resolution**:
```typescript
import matter from "gray-matter";
import { get } from "lodash-es";

function extractField(content: string, fieldPath: string): unknown {
  const { data } = matter(content);
  return get(data, fieldPath);  // e.g., "bgg.play_count" → data.bgg.play_count
}
```

### TD-10: Widget Routing Logic

**Decision**: Backend filters widgets by `location` field before sending to frontend (REQ-F-16, REQ-F-17).

**Ground widget routing**:
```typescript
// In handleGetGroundWidgets
const groundWidgets = allWidgets.filter(w => w.config.location === "ground");
const results = await Promise.all(groundWidgets.map(w => this.computeWidget(w)));
this.send(ws, { type: "ground_widgets", widgets: results });
```

**Recall widget routing**:
```typescript
// In handleGetRecallWidgets
const recallWidgets = allWidgets.filter(w => w.config.location === "recall");
// Only compute for widgets whose source pattern matches the current file
const applicableWidgets = recallWidgets.filter(w =>
  minimatch(path, w.config.source.pattern)
);
const results = await Promise.all(applicableWidgets.map(w =>
  this.computeWidgetForItem(w, path)
));
this.send(ws, { type: "recall_widgets", path, widgets: results });
```

### TD-11: Null Value Handling in Aggregations

**Decision**: Skip null/undefined values in aggregations; include in count (REQ-F-28).

**Strategy**:
```typescript
// In aggregators.ts
function sum(values: (number | null | undefined)[]): number {
  return values
    .filter((v): v is number => v !== null && v !== undefined)
    .reduce((acc, v) => acc + v, 0);
}

function avg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && v !== undefined);
  if (valid.length === 0) return null;
  return sum(valid) / valid.length;
}

function count(values: unknown[]): number {
  return values.length;  // Includes nulls - REQ-F-28
}
```

**Rationale**: `count` reflects collection size; `sum`/`avg` reflect actual data. A game with no rating still exists in the collection.

### TD-12: In-Memory Cache Fallback

**Decision**: When SQLite persistence fails, fall back to in-memory Map with logged warning (REQ-F-29).

**Architecture**:
```typescript
class WidgetCache {
  private db: Database | null = null;
  private memoryFallback: Map<string, CacheEntry> = new Map();
  private usingFallback = false;

  async initialize(dbPath: string): Promise<void> {
    try {
      this.db = new Database(dbPath);
      this.configurePragmas();
    } catch (error) {
      log.error(`SQLite init failed, using memory fallback: ${error}`);
      this.usingFallback = true;
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    if (this.usingFallback) {
      return this.memoryFallback.get(key) ?? null;
    }
    // SQLite query...
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.usingFallback) {
      this.memoryFallback.set(key, entry);
      return;
    }
    // SQLite insert...
  }
}
```

**Memory fallback limitations**:
- Cache lost on server restart
- No persistence across connections
- Log warning so user knows to investigate

### TD-13: No Data Indicator

**Decision**: Widget results include `isEmpty` flag; frontend displays "No data" message (REQ-F-27).

**Protocol extension**:
```typescript
const WidgetResultSchema = z.object({
  widgetId: z.string(),
  name: z.string(),
  // ...existing fields...
  isEmpty: z.boolean(),  // True when glob matches zero files
  emptyReason: z.string().optional(),  // e.g., "No files match Games/**/*.md"
});
```

**Frontend handling**:
```tsx
function WidgetRenderer({ widget }: { widget: WidgetResult }) {
  if (widget.isEmpty) {
    return (
      <div className="widget widget--empty">
        <span className="widget__name">{widget.name}</span>
        <p className="widget__empty-message">
          {widget.emptyReason ?? "No data found"}
        </p>
      </div>
    );
  }
  // Normal rendering...
}
```

### TD-14: Extensibility Architecture

**Decision**: Use registry pattern for aggregators, comparators, and display types (REQ-NF-4).

**Aggregator registry**:
```typescript
type Aggregator = (values: (number | null)[]) => number | null;

const aggregatorRegistry: Map<string, Aggregator> = new Map([
  ["sum", sum],
  ["avg", avg],
  ["count", count],
  ["min", min],
  ["max", max],
  ["stddev", stddev],
]);

// Adding new aggregator:
aggregatorRegistry.set("median", median);
```

**Comparator registry**:
```typescript
type Comparator = (a: unknown, b: unknown) => number;

const comparatorRegistry: Map<string, Comparator> = new Map([
  ["jaccard", jaccardSimilarity],
  ["proximity", proximitySimilarity],
  ["cosine", cosineSimilarity],
]);
```

**Display type registry (frontend)**:
```typescript
const displayRegistry: Map<string, React.ComponentType<WidgetProps>> = new Map([
  ["summary-card", SummaryCardWidget],
  ["table", TableWidget],
  ["list", ListWidget],
  ["meter", MeterWidget],
]);

// WidgetRenderer uses registry lookup:
const Component = displayRegistry.get(widget.display.type);
```

**Why registry pattern**:
- New types added without modifying core code
- Clear extension point for future features
- Easy to test individual implementations

## Data Model

### Widget Configuration Schema

```typescript
interface WidgetConfig {
  name: string;                    // Human-readable name
  type: "aggregate" | "similarity"; // Computation type
  location: "ground" | "recall";   // Display location
  source: {
    pattern: string;               // Glob pattern (e.g., "Games/**/*.md")
    filter?: Record<string, unknown>; // Frontmatter filters
  };
  fields?: Record<string, FieldConfig>;  // For aggregate widgets
  dimensions?: DimensionConfig[];         // For similarity widgets
  display: DisplayConfig;
  editable?: EditableField[];      // Optional editable fields
}

interface FieldConfig {
  // Simple aggregation
  count?: boolean;
  sum?: string;      // Field path
  avg?: string;
  min?: string;
  max?: string;
  stddev?: string;

  // Expression-based
  expr?: string;     // Expression string
}

interface DimensionConfig {
  field: string;
  weight: number;
  method: "jaccard" | "proximity" | "cosine";
}

interface DisplayConfig {
  type: "summary-card" | "table" | "list" | "meter";
  title?: string;
  columns?: string[];  // For table
  limit?: number;      // For list
  min?: number;        // For meter
  max?: number;
}

interface EditableField {
  field: string;       // Frontmatter path
  type: "slider" | "number" | "text" | "date" | "select";
  label: string;
  options?: string[];  // For select type
  min?: number;        // For slider/number
  max?: number;
  step?: number;
}
```

### SQLite Cache Schema

```sql
-- Widget computation cache
CREATE TABLE widget_cache (
  id INTEGER PRIMARY KEY,
  vault_id TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  UNIQUE(vault_id, widget_id, content_hash)
);

-- Similarity cache (per-item)
CREATE TABLE similarity_cache (
  id INTEGER PRIMARY KEY,
  vault_id TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_version TEXT NOT NULL,
  similar_items_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  UNIQUE(vault_id, widget_id, source_path, content_version)
);

-- Indexes for fast lookup
CREATE INDEX idx_widget_cache_lookup ON widget_cache(vault_id, widget_id);
CREATE INDEX idx_similarity_lookup ON similarity_cache(vault_id, widget_id, source_path);
```

### WebSocket Protocol Extensions

**New Client Messages**:
```typescript
// Request ground widgets for current vault
const GetGroundWidgetsMessageSchema = z.object({
  type: z.literal("get_ground_widgets"),
});

// Request recall widgets for current file
const GetRecallWidgetsMessageSchema = z.object({
  type: z.literal("get_recall_widgets"),
  path: z.string().min(1),
});

// Edit a frontmatter field via widget
const WidgetEditMessageSchema = z.object({
  type: z.literal("widget_edit"),
  path: z.string().min(1),      // File path
  field: z.string().min(1),     // Frontmatter field path
  value: z.unknown(),           // New value
});
```

**New Server Messages**:
```typescript
// Widget computation results
const WidgetResultSchema = z.object({
  widgetId: z.string(),
  name: z.string(),
  type: z.enum(["aggregate", "similarity"]),
  location: z.enum(["ground", "recall"]),
  display: DisplayConfigSchema,
  data: z.unknown(),  // Type depends on widget type
  editable: z.array(EditableFieldSchema).optional(),
});

const GroundWidgetsMessageSchema = z.object({
  type: z.literal("ground_widgets"),
  widgets: z.array(WidgetResultSchema),
});

const RecallWidgetsMessageSchema = z.object({
  type: z.literal("recall_widgets"),
  path: z.string(),
  widgets: z.array(WidgetResultSchema),
});

// Widget update after edit or file change
const WidgetUpdateMessageSchema = z.object({
  type: z.literal("widget_update"),
  widgets: z.array(WidgetResultSchema),
});

// Widget config error (REQ-F-3)
const WidgetErrorMessageSchema = z.object({
  type: z.literal("widget_error"),
  widgetId: z.string().optional(),
  error: z.string(),
});
```

## Integration Points

### Vault Manager Integration

Extend `parseVault()` to detect widget config directory:
```typescript
// In vault-manager.ts
const widgetsDir = join(vaultPath, ".memory-loop", "widgets");
const hasWidgets = await directoryExists(widgetsDir);
```

Add to `VaultInfo`:
```typescript
widgetsPath?: string;  // Relative path to widgets directory
```

### WebSocket Handler Integration

Add widget message handlers to `websocket-handler.ts`:
```typescript
case "get_ground_widgets":
  await this.handleGetGroundWidgets(ws, state);
  break;
case "get_recall_widgets":
  await this.handleGetRecallWidgets(ws, state, message.path);
  break;
case "widget_edit":
  await this.handleWidgetEdit(ws, state, message);
  break;
```

### File Watcher Integration

Start watcher when vault is selected, stop when deselected:
```typescript
// In websocket-handler.ts select_vault handler
if (vault.widgetsPath) {
  this.fileWatcher = new FileWatcher(vault.contentRoot, {
    debounceMs: 500,
    onFilesChanged: (paths) => this.handleFilesChanged(ws, state, paths),
  });
}
```

## Testing Strategy

### Unit Tests

| Module | Test Focus |
|--------|------------|
| `widget-loader.ts` | YAML parsing, validation errors, edge cases |
| `aggregators.ts` | Sum, avg, stddev accuracy; null handling |
| `expression-eval.ts` | Expression parsing, security (no globals), timeouts |
| `comparators.ts` | Jaccard/proximity/cosine correctness |
| `widget-cache.ts` | SQLite operations, WAL recovery, corruption handling |

### Integration Tests

1. **End-to-end widget flow**: Create widget config, trigger computation, verify results
2. **File change detection**: Modify file, verify cache invalidation and recomputation
3. **Edit persistence**: Use widget to edit frontmatter, verify file updated
4. **Error handling**: Malformed configs, missing files, expression errors

### Test Fixtures

Create test vault in `backend/__fixtures__/test-vault-widgets/`:
```
.memory-loop/
  widgets/
    collection-stats.yaml
    game-similarity.yaml
Games/
  wingspan.md
  catan.md
  ...
```

### Performance Validation

**Benchmark fixtures** (REQ-NF-1, REQ-NF-2):
- Create `backend/__fixtures__/test-vault-1000/` with 1000 markdown files
- Each file has realistic frontmatter (10-20 fields)
- Use this fixture for performance regression tests

**Performance test approach**:
```typescript
// In aggregators.test.ts
describe("performance", () => {
  it("aggregates 1000 files in under 1 second", async () => {
    const start = performance.now();
    await computeAggregateWidget(widget, vault1000);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);  // REQ-NF-1
  });
});

// In comparators.test.ts
describe("performance", () => {
  it("computes similarity for 1000 items in under 500ms", async () => {
    const start = performance.now();
    await computeSimilarity(widget, sourceItem, vault1000);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);  // REQ-NF-2
  });
});
```

**Production monitoring**:
- Log computation times for each widget
- Include timing in widget_update messages (optional `computeTimeMs` field)
- Dashboard alert if p95 exceeds targets

## Risks and Mitigations

### R-1: SQLite Corruption on Ungraceful Shutdown

**Risk**: Server killed mid-write corrupts cache database.
**Mitigation**:
- WAL mode (TD-2) reduces corruption window
- Integrity check on startup (REQ-F-32)
- Cache is derived data; rebuild from source files if corrupted
- Log corruption events for monitoring

### R-2: Expression Evaluation Performance

**Risk**: Complex expressions or large collections cause slow computation.
**Mitigation**:
- 1-second timeout per item (REQ-F-30)
- Stale-while-revalidate pattern (REQ-F-26) serves old results while computing
- Performance metrics logged for monitoring

### R-3: Memory Pressure from Large Collections

**Risk**: Loading 1000+ files with frontmatter into memory.
**Mitigation**:
- Stream files rather than loading all at once
- Parse frontmatter lazily (only extract needed fields)
- Consider pagination for very large collections (future enhancement)

### R-4: File Watcher Resource Exhaustion

**Risk**: Watching large vault directory trees consumes inotify handles.
**Mitigation**:
- Use `chokidar`'s `usePolling: false` (native watchers)
- Only watch `.memory-loop/widgets/` and files matching widget patterns
- Fall back to polling if native watchers fail

## Deployment Considerations

### Database Location

Cache database stored at `.memory-loop/cache.db` within each vault (REQ-F-23). This keeps the cache portable with the vault and avoids server-side state management.

### Graceful Shutdown

Server should:
1. Stop file watchers
2. Allow in-flight widget computations to complete (with timeout)
3. Close SQLite connections cleanly
4. WAL checkpoint before exit

### First-Run Experience

When a vault first connects with widget configs:
1. Validate all configs (report errors immediately)
2. Initialize SQLite database with schema
3. Compute initial widget results (may take a few seconds for large vaults)
4. Send results to frontend

---

**Next Phase**: Once approved, use `/task-breakdown` to decompose into implementable tasks.
