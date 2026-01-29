# ADR 0002: Test Coverage Baseline and Integration

## Status

Accepted

**Date:** 2026-01-16
**Authors:** RJ Roy

## Context

Memory Loop lacked test coverage tracking and CI integration. Additionally, a critical bug was discovered where the backend test script only ran 21 of 44 test files due to a shell glob pattern that missed nested directories.

The original script used `src/__tests__/*.test.ts` which only matched files directly in that directory, missing:
- `src/sync/__tests__/` (8 files)
- `src/handlers/__tests__/` (1 file)
- `src/widgets/__tests__/` (14 files)

## Decision

1. Fix backend test execution by replacing the shell for-loop with Bun's recursive directory discovery
2. Add coverage tooling using Bun's native coverage with lcov output for Codecov integration
3. Establish baseline coverage metrics and track regressions via CI

## Baseline Metrics (2026-01-16)

| Workspace | Functions | Lines |
|-----------|-----------|-------|
| backend   | 82.77%    | 79.36% |
| frontend  | 84.07%    | 85.93% |
| shared    | 80.00%    | 100.00% |

## Consequences

- All 44 backend test files now execute (was 21)
- Coverage reports are generated in lcov format for each workspace
- CI workflow runs tests with coverage on every PR
- Codecov integration provides PR comments with coverage delta
- Coverage thresholds can be added to prevent regression

## Implementation

- `backend/package.json`: Changed test script from shell for-loop to `bun test src/`
- `*/bunfig.toml`: Added coverage configuration (lcov output, skip test files)
- `.github/workflows/ci.yml`: CI workflow with coverage and Codecov upload
- `codecov.yml`: Codecov configuration with flags per workspace
