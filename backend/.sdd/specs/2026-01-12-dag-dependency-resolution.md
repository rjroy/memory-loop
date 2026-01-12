---
version: 1.0.0
status: Approved
created: 2026-01-12
last_updated: 2026-01-12
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
github_issue: 242
---

# DAG-Based Dependency Resolution for Widget Fields

## Executive Summary

Widget field computation currently uses a fixed two-phase approach: aggregators run first, then expressions. This prevents fields from depending on other computed fields beyond the initial aggregation phase.

This feature introduces a dependency graph (DAG) for field computation, allowing fields to reference previously computed values via a `result.*` context. Both aggregators and expressions can participate in the dependency chain, enabling multi-stage computations like "normalize a value, then aggregate the normalized values."

## User Story

As a vault author, I want to define widget fields that depend on other computed fields, so that I can build complex derived metrics without manual calculation or intermediate files.

## Stakeholders

- **Primary**: Vault authors creating sophisticated widget configurations
- **Secondary**: Memory Loop maintainers extending the computation model

## Success Criteria

1. Fields can reference `result.<fieldName>` to depend on previously computed values
2. Computation order is automatically determined to respect dependencies
3. Cycles are detected before computation begins and produce clear error messages
4. Fields in cycles return null; unaffected fields still compute successfully
5. Existing two-phase configs continue working without modification

## Functional Requirements

### Core DAG Computation

- **REQ-F-1**: Analyze field configurations to identify dependency relationships from `result.<fieldName>` references in aggregator paths and expressions
- **REQ-F-2**: Determine computation order that respects all identified dependencies
- **REQ-F-3**: Execute fields in dependency order, populating `result.*` context after each field completes
- **REQ-F-4**: The `result` context is a flat object keyed by user-defined field names (e.g., `result.y_adjusted`); accessing undefined fields returns null without error

### Aggregator Enhancements

- **REQ-F-5**: Aggregators can specify `result.<fieldName>` as their source path (e.g., `avg: result.normalized_score`)
- **REQ-F-6**: When aggregating over `result.fieldName`, collect the value of `fieldName` computed for each item in the collection

### Expression Enhancements

- **REQ-F-7**: Expressions can reference `result.<fieldName>` to access previously computed values
- **REQ-F-8**: Per-item expressions accessing `result.*` receive per-item values; collection expressions receive aggregated values

### Cycle Detection and Error Handling

- **REQ-F-9**: Detect dependency cycles before computation begins
- **REQ-F-10**: Fields participating in a cycle return null; non-cycle fields compute normally
- **REQ-F-11**: Cycle errors include the cycle path (e.g., "Cycle detected: a -> b -> c -> a")
- **REQ-F-12**: Log cycle warnings but do not throw exceptions

### Backward Compatibility

- **REQ-F-13**: Existing configs without `result.*` references work unchanged
- **REQ-F-14**: The implicit `stats.count` remains available in all expressions

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Dependency resolution adds <5ms overhead for typical configs (10-20 fields) compared to current two-phase implementation
- **REQ-NF-2** (Maintainability): Graph logic is isolated in a dedicated module, not inlined in widget-engine
- **REQ-NF-3** (Testability): Graph construction and cycle detection are unit-testable independent of file I/O
- **REQ-NF-4** (Error clarity): Error messages include field names and dependency paths, not internal IDs

## Explicit Constraints (DO NOT)

- Do NOT support cross-widget dependencies (fields can only reference fields within the same widget)
- Do NOT allow `result.*` in similarity dimension configs
- Do NOT impose artificial depth limits; cycles are the only constraint
- Do NOT change the schema format for existing aggregator/expression configs

## Technical Context

- **Existing Stack**: Bun runtime, TypeScript, Zod schemas
- **Integration Points**: `widget-engine.ts` (computation), `schemas.ts` (validation), `expression-eval.ts` (expression parsing)
- **Patterns to Respect**: Two-phase model is replaced by N-phase DAG, but external API (WidgetResult) remains unchanged

## Acceptance Tests

1. **Simple dependency chain**: Field A aggregates frontmatter, Field B expression uses `stats.A`, Field C aggregates `result.B` - all compute correctly
2. **Self-referential cycle**: Field A references `result.A` - returns null with logged warning
3. **Multi-field cycle**: A -> B -> C -> A - all three return null, other fields unaffected
4. **Backward compat**: Existing widget config with no `result.*` produces identical output
5. **Mixed sources**: Aggregator over `result.*` correctly collects per-item expression values
6. **Error message clarity**: Cycle detection message names all fields in the cycle
7. **Undefined reference**: Expression references `result.nonexistent` - returns null without throwing

## Open Questions

- [x] Can aggregators read from result context? **Yes - both types can participate**
- [x] How to surface cycle errors? **Field-level nulls with logged warning**
- [x] Depth limit? **None - cycles are the only constraint**

## Out of Scope

- Cross-widget field dependencies
- Runtime dependency modification (graph is static per config)
- Caching of intermediate computation results across requests
- UI for visualizing the dependency graph

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
