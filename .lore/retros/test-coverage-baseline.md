---
title: Test coverage baseline revealed half the backend tests weren't running
date: 2026-01-16
status: complete
tags: [testing, coverage, ci, bun, glob-patterns]
modules: [backend, frontend, shared, ci]
related: []
---

# Retro: Test Coverage Baseline

## Summary

Established test coverage tracking and CI integration. In the process, discovered that the backend test script was only running 21 of 44 test files. A shell glob pattern (`src/__tests__/*.test.ts`) missed nested directories entirely: 8 files in `src/sync/__tests__/`, 1 in `src/handlers/__tests__/`, and 14 in `src/widgets/__tests__/`.

## What Went Well

- **Caught a real blind spot.** 23 test files (over half) were silently not running. No one noticed because the glob matched enough files to look healthy. Adding coverage tooling forced a closer look at what was actually executing.
- **Bun's recursive discovery fixed it cleanly.** Replacing the shell for-loop with `bun test src/` let Bun find all test files automatically. No fragile glob maintenance.
- **Baseline metrics captured.** Functions: backend 82.77%, frontend 84.07%, shared 80.00%. Lines: backend 79.36%, frontend 85.93%, shared 100.00%. Having numbers made future regressions detectable instead of guesswork.
- **CI integration landed alongside.** Coverage reports in lcov format, Codecov PR comments with delta. Coverage became visible on every PR, not something you had to remember to check locally.

## What Could Improve

- **The broken glob existed since day one.** Nobody questioned whether all tests were running. The test script looked reasonable, output showed passing tests, and the absence of failures from the missing files was invisible. A simple count check ("do we have N test files? does the runner report N files?") would have caught this immediately.
- **No threshold enforcement.** Baseline was captured but no minimum was set. Coverage could regress silently until someone noticed the Codecov trend.

## Lessons Learned

- Shell glob patterns don't recurse by default. `*.test.ts` only matches the current directory. Use the test runner's built-in discovery instead of hand-rolling glob patterns in shell scripts.
- Count your test files. If you have 44 test files on disk but the runner reports 21, something is wrong. A mismatch between file count and execution count is a signal, not noise.
- Adding coverage tooling isn't just about the numbers. The act of setting it up forces you to verify that the test pipeline is actually doing what you think it's doing.

## Artifacts

- Original ADR `docs/adr/0002-test-coverage-baseline.md` was replaced by this retro
