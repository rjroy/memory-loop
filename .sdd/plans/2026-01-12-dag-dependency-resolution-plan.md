---
specification: [.sdd/specs/2026-01-12-dag-dependency-resolution.md](./../specs/2026-01-12-dag-dependency-resolution.md)
status: Approved
version: 1.0.0
created: 2026-01-12
last_updated: 2026-01-12
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# DAG-Based Dependency Resolution - Technical Plan

## Overview

Replace the fixed two-phase computation model with a DAG-based approach that determines field computation order from dependency analysis. The core change is adding a `result.*` context that accumulates computed values, allowing fields to depend on previously computed fields.

The implementation introduces a new `dependency-graph.ts` module that analyzes field configs, builds a graph, performs topological sort, and detects cycles. The widget-engine computation methods are refactored to execute fields in dependency order rather than type order (aggregators-first).

## Architecture

### System Context

```
Widget Config (YAML)
        │
        ▼
┌───────────────────┐     ┌──────────────────────┐
│  widget-loader.ts │────▶│  dependency-graph.ts │
│  (parse configs)  │     │  (build graph, sort) │
└───────────────────┘     └──────────────────────┘
                                    │
                                    ▼
                          ┌──────────────────────┐
                          │  widget-engine.ts    │
                          │  (execute in order)  │
                          └──────────────────────┘
                                    │
                          Uses ─────┼───── Uses
                                    │
        ┌───────────────────┐       │       ┌──────────────────┐
        │  aggregators.ts   │◀──────┴──────▶│  expression-eval │
        │  (collection ops) │               │  (per-item ops)  │
        └───────────────────┘               └──────────────────┘
```

### Components

- **dependency-graph.ts** (new): Graph construction, topological sort, cycle detection
- **widget-engine.ts** (modify): Replace two-phase with DAG-ordered execution
- **expression-eval.ts** (modify): Extend context to include `result.*`
- **schemas.ts**: No changes (existing schema supports `result.*` in string fields)

## Technical Decisions

### TD-1: Dependency Graph Module

**Choice**: Create `dependency-graph.ts` as a standalone module with pure functions.

**Requirements**: REQ-NF-2 (isolated module), REQ-NF-3 (testable independent of I/O)

**Rationale**: Separation of concerns keeps the widget-engine focused on orchestration. Pure functions operating on field configs (no file I/O) enable comprehensive unit testing. The module exports:
- `buildDependencyGraph(fields: Record<string, FieldConfig>): DependencyGraph`
- `topologicalSort(graph: DependencyGraph): SortResult`
- `detectCycles(graph: DependencyGraph): string[][]`

### TD-2: Graph Representation

**Choice**: Adjacency list with Map<string, Set<string>> for dependencies.

**Requirements**: REQ-F-1 (dependency identification), REQ-NF-1 (performance)

**Rationale**:
- Map/Set provides O(1) lookups for dependency checks
- Memory efficient for sparse graphs (typical widgets have 5-20 fields with few deps each)
- Easy to iterate for topological sort

```typescript
interface DependencyGraph {
  nodes: Set<string>;           // All field names
  edges: Map<string, Set<string>>; // field -> fields it depends on
}
```

### TD-3: Dependency Extraction

**Choice**: Parse `result.<fieldName>` from both aggregator source paths and expression variables.

**Requirements**: REQ-F-1 (parse references), REQ-F-5 (aggregator paths), REQ-F-7 (expressions)

**Rationale**: Two extraction strategies based on field type:

1. **Aggregator fields**: Check if `sum`, `avg`, `min`, `max`, `stddev` path starts with `result.`. Extract field name after the prefix.

2. **Expression fields**: Use existing `getExpressionVariables()` function, filter for variables starting with `result.`.

Both are O(1) or O(n) where n is expression length - negligible overhead.

### TD-4: Topological Sort Algorithm

**Choice**: Kahn's algorithm (BFS-based).

**Requirements**: REQ-F-2 (compute order), REQ-F-9 (cycle detection)

**Rationale**:
- O(V+E) time complexity - meets <5ms target for typical configs
- Naturally detects cycles (remaining nodes after sort = cycle participants)
- Simple to implement and debug
- Returns sorted order and cycle participants in one pass

**Alternative considered**: DFS-based topological sort. While DFS can detect cycles via back-edge detection during traversal, Kahn's algorithm provides two advantages: (1) it produces the sorted list AND identifies ALL cycle participants in a single pass, and (2) the algorithm terminates with exactly the cycle nodes remaining, making error reporting straightforward. DFS would require separate cycle-tracing logic after detection.

### TD-5: Cycle Handling Strategy

**Choice**: Mark cycle participants, return null for those fields, compute others normally.

**Requirements**: REQ-F-10 (partial computation), REQ-F-11 (error messages), REQ-F-12 (no exceptions)

**Rationale**:
- User-friendly: One misconfigured field doesn't break the entire widget
- Debuggable: Log warning with cycle path helps users fix configs
- Consistent: Null is already used for missing/invalid values

Implementation:
1. After topological sort, any nodes not in sorted output are in cycles
2. For each cycle node, trace the cycle path for error message
3. Set `cycleFields: Set<string>` on the computation context
4. During execution, skip cycle fields and set their result to null

### TD-6: Result Context Integration

**Choice**: Add `result: Record<string, unknown>` to ExpressionContext, pass to both aggregators and expressions. Maintain `stats.*` as an alias for backward compatibility.

**Requirements**: REQ-F-3 (populate result), REQ-F-4 (flat object), REQ-F-6 (aggregator access), REQ-F-13 (backward compat), REQ-F-14 (stats.count available)

**Rationale**: Minimal change to existing interfaces. The result object accumulates values as fields complete:

```typescript
// Extended context
interface ComputationContext {
  this: Record<string, unknown>;    // Current item frontmatter
  stats: Record<string, unknown>;   // Legacy stats (count + completed aggregators)
  result: Record<string, unknown>;  // All completed field values
}
```

**Backward compatibility strategy** (REQ-F-13, REQ-F-14):
- `stats.count` is always populated with file count before any field computation
- `stats.<fieldName>` is populated as each aggregator completes (same as current behavior)
- `result.<fieldName>` is populated for ALL fields (aggregators + expressions)
- Existing expressions using `stats.fieldName` continue working unchanged
- The `stats` object is a subset of `result` (aggregators only) plus `count`

### TD-7: Per-Item vs Collection Context

**Choice**: Distinguish field "scope" to determine what values are available.

**Requirements**: REQ-F-6 (per-item aggregation), REQ-F-8 (context distinction)

**Rationale**: Fields fall into two scopes:

1. **Collection scope** (aggregators): Operate across all items, produce single value
   - Access: `result.<field>` gets the single aggregated value

2. **Item scope** (expressions): Operate per-item, produce value per item
   - Access: `result.<field>` gets that item's computed value

When a collection-scope field depends on an item-scope field (e.g., `avg: result.normalized`), the system must:
1. Compute the item-scope field for ALL items first
2. Then aggregate those per-item values

This is handled by tracking field scope in the graph and grouping item-scope dependencies.

### TD-8: Undefined Reference Handling

**Choice**: Return null for `result.<nonexistent>` without error.

**Requirements**: REQ-F-4 (undefined returns null)

**Rationale**: Consistent with existing null handling for missing frontmatter fields. Enables optional dependencies where a field gracefully handles missing data via `coalesce(result.optional, 0)`.

Implementation: The result object is a plain object - accessing undefined keys naturally returns undefined, which expression-eval normalizes to null.

### TD-9: Error Message Quality

**Choice**: Format all error messages with field names and dependency paths, never internal IDs.

**Requirements**: REQ-NF-4 (error clarity)

**Rationale**: Users configure widgets via YAML field names. Error messages must use those same names for actionable debugging.

**Message formats**:
- Cycle: `"Cycle detected in fields: rating_norm -> adjusted_score -> rating_norm"`
- Missing dependency: `"Field 'final_score' depends on undefined field 'missing_field'"`
- Scope mismatch warning: `"Field 'per_item_expr' references collection-scope result in item context"`

All messages use user-defined field names, never internal node IDs or memory addresses.

## Data Model

### DependencyGraph

```typescript
interface DependencyGraph {
  nodes: Set<string>;
  edges: Map<string, Set<string>>;  // field -> dependencies
  scope: Map<string, "collection" | "item">;  // field -> scope
}
```

### SortResult

```typescript
interface SortResult {
  sorted: string[];        // Fields in valid execution order
  cycles: string[][];      // Arrays of cycle paths (empty if no cycles)
}
```

### ComputationPlan

```typescript
interface ComputationPlan {
  phases: ComputationPhase[];  // Ordered execution phases
  cycleFields: Set<string>;    // Fields to skip (return null)
  warnings: string[];          // Cycle warning messages
}

interface ComputationPhase {
  scope: "collection" | "item";
  fields: string[];  // Fields to compute in this phase
}
```

## Integration Points

### widget-engine.ts

**Changes**:
- Import `buildDependencyGraph`, `topologicalSort` from dependency-graph
- Replace `computeAggregateWidget` two-phase logic with:
  1. Build graph from field configs
  2. Sort and detect cycles
  3. Execute phases in order, accumulating results
- Pass `result` context to both aggregator and expression evaluation

**Data Flow**:
1. Field configs → `buildDependencyGraph()` → DependencyGraph
2. DependencyGraph → `topologicalSort()` → SortResult
3. SortResult → `createComputationPlan()` → ComputationPlan
4. ComputationPlan → execute phases → WidgetResult

### expression-eval.ts

**Changes**:
- Extend `ExpressionContext` interface to include `result`
- Update `flattenContext()` to include result in evaluation context
- No changes to `evaluateExpression()` logic - just passes through

### aggregators.ts

**Changes**: None required. Aggregators receive values via the existing pattern. The widget-engine extracts values from `result.*` when the source path indicates it.

## Error Handling, Performance, Security

### Error Strategy

- Cycle detection: Log warning with cycle path, set affected fields to null
- Invalid `result.*` reference: Return null (same as missing frontmatter)
- Graph construction errors: Log and fall back to legacy two-phase order

### Performance Targets

- Graph construction: <1ms for 20 fields (O(n) where n = field count)
- Topological sort: <1ms for 20 fields with typical dependencies
- Total overhead vs two-phase: <5ms (REQ-NF-1)

### Security Measures

No new security concerns. Expression evaluation already validates against code injection. The `result.*` context is populated only with values computed by the engine itself.

## Testing Strategy

### Unit Tests (dependency-graph.ts)

- Graph construction from various field configs
- Topological sort with no dependencies (original order preserved)
- Topological sort with linear chain (A→B→C)
- Topological sort with diamond pattern (A→B, A→C, B→D, C→D)
- Cycle detection: self-reference
- Cycle detection: two-node cycle
- Cycle detection: multi-node cycle
- Mixed: some fields in cycle, others valid

### Integration Tests (widget-engine.ts)

- Existing two-phase configs produce identical results
- Simple dependency chain computes correctly
- Aggregator depending on expression result
- Expression depending on aggregator result
- Cycle fields return null, others compute
- Performance: 20-field config completes in <10ms

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Performance regression for large configs | L | M | Benchmark before/after, optimize if >5ms overhead |
| Breaking existing configs | L | H | Extensive backward-compat tests, fallback to two-phase on error |
| Complex cycle detection edge cases | M | L | Comprehensive unit tests, Kahn's algorithm is well-understood |
| Per-item vs collection scope confusion | M | M | Clear documentation, helpful error messages when scope mismatch detected, examples in docs |

## Dependencies

### Technical
- No new external dependencies
- Uses existing `expr-eval` for expression parsing

### Team
- None - self-contained implementation

## Open Questions

- [x] Resolved in spec: Aggregators can read from result context
- [x] Resolved in spec: Cycles return null, no exceptions
- [x] Resolved in spec: No artificial depth limit

---

**Next Phase**: Once approved, use `/task-breakdown` to decompose into implementable tasks.
