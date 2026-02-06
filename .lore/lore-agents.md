---
title: Lore Agents Registry
date: 2026-02-05
status: current
tags: [agents, registry, tooling]
---

# Lore Agents

Specialized agents available for lore-development work in this project.

Last updated: 2026-02-05

## Discovery

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `Explore` | Fast codebase exploration | Finding files by patterns, searching code for keywords, answering questions about Memory Loop structure |
| `lore-development:surface-surveyor` | Entry point discovery | Finding where features start during excavation (e.g., tracing a mode from NavBar to View component) |
| `lore-development:lore-researcher` | Searches lore frontmatter for related prior work | Before starting new specs or designs, to surface what's already been explored |

## Documentation Review

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `lore-development:spec-reviewer` | Fresh-context spec review for clarity issues | After completing a spec, when requirements feel ambiguous |
| `lore-development:design-reviewer` | Fresh-context design review for weak decisions | After completing a design, when technical approach feels uncertain |
| `lore-development:fresh-lore` | Fresh-context analysis from outside accumulated context | When too deep in the weeds to think clearly, need a second opinion |

## Architecture

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `Plan` | Software architect for implementation design | Planning new features, choosing between approaches, architectural trade-offs |

## Code Quality

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:code-reviewer` | Project guideline adherence | Before commits, after implementing features |
| `pr-review-toolkit:code-simplifier` | Simplifies code for clarity | Refactoring hooks, reducing component complexity |
| `pr-review-toolkit:comment-analyzer` | Comment accuracy and maintainability | Reviewing JSDoc comments, protocol documentation |
| `pr-review-toolkit:type-design-analyzer` | Type design analysis | Reviewing new Zod schemas, SSE event types |

## Testing

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:pr-test-analyzer` | Test coverage quality | Reviewing PRs for test completeness (remember: tests are mandatory) |

## Error Handling

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `pr-review-toolkit:silent-failure-hunter` | Identifies silent failures | Reviewing SSE streaming error handling, API fallbacks, catch blocks |

## Project-Specific Notes

- **Testing is mandatory**: Always consult `pr-review-toolkit:pr-test-analyzer` before marking work complete
- **Schema changes**: When modifying `lib/schemas/types.ts`, use `pr-review-toolkit:type-design-analyzer` to review Zod schema design
- **SSE streaming**: Consult `silent-failure-hunter` for any changes to SSE chat endpoint or error handling paths
- **SDK integration**: The Claude Agent SDK provider pattern requires careful review; use `code-reviewer` for any `sdk-provider.ts` changes
- **Single workspace**: All code lives in `nextjs/`. Domain logic in `lib/`, schemas in `lib/schemas/`.
