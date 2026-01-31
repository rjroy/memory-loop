---
title: Lore Agents Registry
date: 2026-01-29
status: current
tags: [agents, registry, tooling]
---

# Lore Agents

Specialized agents available for lore-development work in this project.

Last updated: 2026-01-29

## Discovery

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `Explore` | Fast codebase exploration | Finding files by patterns, searching code for keywords, answering questions about Memory Loop structure |
| `lore-development:surface-surveyor` | Entry point discovery | Finding where features start during excavation (e.g., tracing a mode from NavBar to View component) |

## Architecture

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `Plan` | Software architect for implementation design | Planning new features, choosing between approaches (REST vs WebSocket), architectural trade-offs |

## Code Quality

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:code-reviewer` | Project guideline adherence | Before commits, after implementing features |
| `pr-review-toolkit:code-simplifier` | Simplifies code for clarity | Refactoring hooks, reducing component complexity |
| `pr-review-toolkit:comment-analyzer` | Comment accuracy and maintainability | Reviewing JSDoc comments, protocol documentation |
| `pr-review-toolkit:type-design-analyzer` | Type design analysis | Reviewing new Zod schemas, WebSocket message types |
| `code-simplifier:code-simplifier` | Code clarity and consistency | Refining recently modified code |

## Testing

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:pr-test-analyzer` | Test coverage quality | Reviewing PRs for test completeness (remember: tests are mandatory) |

## Error Handling

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:silent-failure-hunter` | Identifies silent failures | Reviewing WebSocket error handling, API fallbacks, catch blocks |

## Project-Specific Notes

- **Testing is mandatory**: Always consult `pr-review-toolkit:pr-test-analyzer` before marking work complete
- **Protocol changes**: When modifying `shared/src/protocol.ts`, use `pr-review-toolkit:type-design-analyzer` to review Zod schema design
- **WebSocket handlers**: Consult `silent-failure-hunter` for any changes to `websocket-handler.ts` or error handling paths
- **SDK integration**: The Claude Agent SDK provider pattern requires careful review; use `code-reviewer` for any `sdk-provider.ts` changes
- **Monorepo context**: When exploring, remember the three workspaces (backend, frontend, shared) have distinct concerns
