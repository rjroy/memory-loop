---
specification: [.sdd/specs/2026-01-12-dag-dependency-resolution.md](./../specs/2026-01-12-dag-dependency-resolution.md)
plan: [.sdd/plans/2026-01-12-dag-dependency-resolution-plan.md](./../plans/2026-01-12-dag-dependency-resolution-plan.md)
status: Under Review
version: 1.0.0
created: 2026-01-12
last_updated: 2026-01-12
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# DAG-Based Dependency Resolution - Task Breakdown

## Task Summary

Total: 8 tasks | Complexity Distribution: 2×S, 4×M, 2×L

## Foundation: Dependency Graph Module

### TASK-001: Create dependency-graph.ts with types and graph building

**Priority**: Critical | **Complexity**: M | **Dependencies**: None

**Description**: Create the new `dependency-graph.ts` module with type definitions and the `buildDependencyGraph()` function that extracts dependencies from field configs.

**Acceptance Criteria**:
- [ ] `DependencyGraph` interface with nodes, edges, and scope maps
- [ ] `buildDependencyGraph(fields: Record<string, FieldConfig>)` function
- [ ] Extracts `result.<fieldName>` from aggregator paths (sum, avg, min, max, stddev)
- [ ] Extracts `result.<fieldName>` from expression variables using `getExpressionVariables()`
- [ ] Correctly identifies field scope (collection for aggregators, item for expressions)

**Files**:
- Create: `src/widgets/dependency-graph.ts`
- Modify: `src/widgets/index.ts` (add export)

**Testing**: Unit tests in TASK-005

---

### TASK-002: Implement topological sort with Kahn's algorithm

**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Implement `topologicalSort()` using Kahn's algorithm to determine field execution order and identify cycle participants.

**Acceptance Criteria**:
- [ ] `SortResult` interface with sorted array and cycles array
- [ ] `topologicalSort(graph: DependencyGraph): SortResult` function
- [ ] Returns fields in valid execution order (dependencies before dependents)
- [ ] Fields with no dependencies preserve original insertion order
- [ ] Remaining nodes after sort are identified as cycle participants

**Files**:
- Modify: `src/widgets/dependency-graph.ts`

**Testing**: Unit tests in TASK-005

---

### TASK-003: Implement cycle detection and error messages

**Priority**: High | **Complexity**: S | **Dependencies**: TASK-002

**Description**: Add cycle path tracing and formatted error messages per REQ-NF-4.

**Acceptance Criteria**:
- [ ] `traceCyclePath(graph, startNode)` helper to trace cycle for error message
- [ ] Error messages use field names only (e.g., "Cycle detected: a -> b -> c -> a")
- [ ] `createComputationPlan()` function that returns `ComputationPlan` with warnings
- [ ] Warning messages logged but no exceptions thrown

**Files**:
- Modify: `src/widgets/dependency-graph.ts`

**Testing**: Unit tests in TASK-005

---

## Integration: Widget Engine Refactor

### TASK-004: Extend ExpressionContext to include result

**Priority**: High | **Complexity**: S | **Dependencies**: None

**Description**: Add `result` property to `ExpressionContext` interface and update `flattenContext()` to include it in evaluation.

**Acceptance Criteria**:
- [ ] `ExpressionContext` interface extended with `result: Record<string, unknown>`
- [ ] `flattenContext()` includes result in returned context
- [ ] Accessing undefined `result.<field>` returns null (not error)
- [ ] Existing `this.*` and `stats.*` access unchanged

**Files**:
- Modify: `src/widgets/expression-eval.ts`

**Testing**: Existing tests pass + unit test for result access

---

### TASK-005: Unit tests for dependency-graph.ts

**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001, TASK-002, TASK-003

**Description**: Comprehensive unit tests for dependency graph module covering graph construction, sorting, and cycle detection.

**Acceptance Criteria**:
- [ ] Graph construction from various field configs (aggregators, expressions, mixed)
- [ ] Topological sort with no dependencies (preserves order)
- [ ] Topological sort with linear chain (A→B→C)
- [ ] Topological sort with diamond pattern (A→B, A→C, B→D, C→D)
- [ ] Cycle detection: self-reference (A→A)
- [ ] Cycle detection: two-node cycle (A→B→A)
- [ ] Cycle detection: multi-node cycle (A→B→C→A)
- [ ] Mixed: some fields in cycle, others valid (non-cycle fields still sorted)
- [ ] Error message format validation

**Files**:
- Create: `src/widgets/__tests__/dependency-graph.test.ts`

**Testing**: All tests pass, coverage >90% for dependency-graph.ts

---

### TASK-006: Refactor widget-engine computation to use DAG ordering

**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Description**: Replace two-phase computation in `computeAggregateWidget` and `computeAggregateWidgetForItem` with DAG-ordered execution using the dependency graph.

**Acceptance Criteria**:
- [ ] Import and use `buildDependencyGraph`, `topologicalSort`, `createComputationPlan`
- [ ] Execute fields in dependency order, populating `result` context after each
- [ ] Maintain `stats` object for backward compatibility (aggregators + count)
- [ ] Skip cycle fields and set their result to null
- [ ] Log cycle warnings using formatted messages
- [ ] When aggregator depends on expression field, compute expression for all items first, then aggregate those per-item values

**Files**:
- Modify: `src/widgets/widget-engine.ts`

**Testing**: Integration tests in TASK-007

---

## Validation: Integration and Backward Compatibility

### TASK-007: Integration tests for DAG-ordered computation

**Priority**: High | **Complexity**: L | **Dependencies**: TASK-006

**Description**: Integration tests validating end-to-end DAG computation including dependency chains, cycle handling, and scope interactions.

**Acceptance Criteria**:
- [ ] Simple dependency chain: A (aggregator) → B (expr uses stats.A) → C (aggregator of result.B)
- [ ] Aggregator depending on expression result computes correctly
- [ ] Expression depending on aggregator result computes correctly
- [ ] Cycle fields return null, other fields compute successfully
- [ ] Undefined `result.nonexistent` returns null without error
- [ ] Performance: 20-field config with 15 dependencies (mix of aggregators and expressions) completes in <10ms

**Files**:
- Modify: `src/widgets/__tests__/widget-engine.test.ts`

**Testing**: All new tests pass

---

### TASK-008: Backward compatibility tests

**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-006

**Description**: Verify existing widget configs without `result.*` references produce identical output to the previous two-phase implementation.

**Acceptance Criteria**:
- [ ] Existing widget configs with only aggregators produce same results
- [ ] Existing widget configs with aggregators + expressions produce same results
- [ ] `stats.count` available in all expressions
- [ ] `stats.<aggregatorField>` available in expressions (same as before)
- [ ] No performance regression (total overhead <5ms vs baseline)

**Files**:
- Modify: `src/widgets/__tests__/widget-engine.test.ts`

**Testing**: Snapshot or comparison tests against known-good outputs

---

## Dependency Graph

```
TASK-001 (graph types + build)
    │
    ▼
TASK-002 (topological sort)
    │
    ▼
TASK-003 (cycle detection)      TASK-004 (expression context)
    │                                │
    └───────────┬────────────────────┘
                │
                ▼
          TASK-005 (unit tests)
                │
                ▼
          TASK-006 (engine refactor) ◀─── Critical path bottleneck
                │
        ┌───────┴───────┐
        ▼               ▼
  TASK-007          TASK-008
(integration)    (backward compat)
```

## Implementation Order

**Phase 1** (Foundation - can parallelize): TASK-001, TASK-004
**Phase 2** (Core algorithm): TASK-002, TASK-003
**Phase 3** (Testing foundation): TASK-005
**Phase 4** (Integration - critical path): TASK-006
**Phase 5** (Validation - can parallelize): TASK-007, TASK-008

## Notes

- **Parallelization**: TASK-001 and TASK-004 have no dependencies and can start immediately in parallel
- **Critical path**: TASK-001 → TASK-002 → TASK-003 → TASK-006 is the longest chain
- **Risk mitigation**: TASK-008 (backward compat) should run before any PR merge to catch regressions early
