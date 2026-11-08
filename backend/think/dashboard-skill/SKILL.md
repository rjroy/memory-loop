---
name: memory-loop-dashboard-setup
description: Help set up or safely update the selected vault's Memory Loop Ground dashboard Markdown resources.
---

# Ground dashboard setup

Help the user maintain the Markdown behind Ground. Work in the selected vault, not the Memory Loop source checkout. Ask which resources and content they want; do not invent their goals, actions, installed skills, quotations, attributions or sources. Examples below illustrate syntax only, not content to install without the user's approval.

Before writing, inspect the existing resource and any configured `ground.resources` overrides in the Memory Loop operator configuration if available. Paths below are defaults relative to the selected vault. Overrides must be distinct vault-relative `.md` paths under `03_Resources/Memory-Loop/`. If the effective path is unknown, ask rather than editing a guessed file. Preserve existing content, order and citations. If a file is malformed, unsafe, unexpectedly changed or not valid UTF-8, explain and ask before repair; do not replace it with a template. Avoid overwriting concurrent edits. Create only files the user requested. Ground itself does not create missing files on reads; optional generation can also update prompts and inspiration, so check for changes before saving.

Each resource has a maximum of 65,536 UTF-8 bytes. The first three are narrow line-oriented formats, not general Markdown. Each may start with one optional `# Title` and blank lines. No frontmatter, HTML, comments, code fences, extra paragraphs or unexplained content. At most 50 entries per collection; exact duplicate entries are invalid. Plain fields cannot contain control characters, HTML tags/comments or triple backticks/tildes.

## Quick Actions: `03_Resources/Memory-Loop/quick-actions.md`

Each unique heading is exactly `## @name`, where the reference matches `@[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Follow it with one nonempty plain-text paragraph of at most 1,024 UTF-8 bytes. Soft line breaks become spaces. No lists, nested headings, blockquotes or second paragraph.

```markdown
# Quick Actions

## @example-skill
Describe the action the user has chosen.
```

This example does not assert that `example-skill` exists. Check actual available skills before recommending a reference, or ask the user. Selecting an action prepares only the reference as an editable, unsent draft in a new Think chat. The description is not sent, and neither prefill nor valid syntax invokes or installs a skill.

## Prompts: `03_Resources/Memory-Loop/prompts.md`

Each entry starts with literal `## Question` followed by one nonempty plain-text paragraph of at most 2,048 UTF-8 bytes. Soft breaks become spaces. Questions must be unique; no extra paragraph or nested structure.

```markdown
# Prompts

## Question
Which example idea should be explored next?
```

## Inspiration: `03_Resources/Memory-Loop/inspiration.md`

Each literal `## Quote` entry has a contiguous block of `> ` lines, at most 4,096 UTF-8 bytes after prefixes are removed. A bare `>` is a blank line in the quotation. Follow with exactly one nonempty `Attribution: ` line, at most 256 bytes, and optionally a `Source: ` line. A source is plain bibliographic text up to 512 bytes or exactly `[title](https://example.com/path)` (HTTP or HTTPS, no credentials; title up to 512 bytes, URL up to 2,048 bytes). Preserve optional existing sources. Do not invent or claim to verify quotations, authors or sources.

```markdown
# Inspiration

## Quote
> Fictional example for format illustration only.
Attribution: Fictional example author
Source: Fictional example publication
```

## Current Goals: `03_Resources/Memory-Loop/goals.md`

Ordinary nonblank CommonMark/GFM is accepted, including headings, lists and task lists. Ground displays task boxes read-only, does not render raw HTML live and does not fetch images. Use only goals the user provides or approves. Preserve their structure and progress.

After a requested edit, check the resulting file against its format and byte limits, and report what changed and any unresolved issue. Do not imply a malformed file or nonexistent skill is functional.
