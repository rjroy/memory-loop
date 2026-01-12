# Getting Started with Vault Widgets

Vault Widgets let you create computed dashboards and contextual displays from your Obsidian vault's frontmatter data. This guide walks you through creating your first widget.

## Prerequisites

- A vault configured for Memory Loop (has a `CLAUDE.md` at root)
- Markdown files with YAML frontmatter

## Quick Start

### 1. Create the Widget Directory

Create a `.memory-loop/widgets/` directory in your vault root:

```
my-vault/
  .memory-loop/
    widgets/
      my-first-widget.yaml
  notes/
    note1.md
    note2.md
  CLAUDE.md
```

### 2. Create a Simple Widget

Create `.memory-loop/widgets/note-stats.yaml`:

```yaml
name: Note Statistics
type: aggregate
location: ground
source:
  pattern: "notes/**/*.md"
fields:
  total_notes:
    count: true
  average_rating:
    avg: rating
display:
  type: summary-card
  title: My Notes
```

This widget:
- Appears on the Home view (`location: ground`)
- Scans all markdown files in `notes/` (`source.pattern`)
- Counts total notes and averages the `rating` frontmatter field
- Displays as a summary card with key-value pairs

### 3. Add Frontmatter to Your Notes

Your notes need frontmatter for the widget to aggregate:

```markdown
---
title: My First Note
rating: 8
tags:
  - productivity
  - writing
---

Note content here...
```

### 4. View Your Widget

Open Memory Loop and navigate to the Home view. Your widget appears with the computed statistics.

## Widget Types

### Aggregate Widgets

Compute statistics across a collection of files:

```yaml
name: Book Collection
type: aggregate
location: ground
source:
  pattern: "Books/**/*.md"
fields:
  total:
    count: true
  pages_read:
    sum: pages
  avg_rating:
    avg: rating
display:
  type: summary-card
```

**Available aggregators:** `count`, `sum`, `avg`, `min`, `max`, `stddev`

### Similarity Widgets

Find related items based on shared attributes:

```yaml
name: Similar Books
type: similarity
location: recall
source:
  pattern: "Books/**/*.md"
dimensions:
  - field: genres
    weight: 0.5
    method: jaccard
  - field: rating
    weight: 0.3
    method: proximity
  - field: author
    weight: 0.2
    method: jaccard
display:
  type: list
  limit: 5
```

This widget appears when viewing a book file and shows the 5 most similar books.

## Display Locations

| Location | Where it appears | Use case |
|----------|------------------|----------|
| `ground` | Home view | Vault-wide dashboards and statistics |
| `recall` | Browse view (per-file) | Contextual info about the current file |

## Display Types

| Type | Description | Required config |
|------|-------------|-----------------|
| `summary-card` | Key-value pairs | None |
| `table` | Rows and columns | `columns: [...]` |
| `list` | Ranked items | `limit: N` (optional) |
| `meter` | Single value gauge | `min`, `max` |

## Next Steps

- [Configuration Reference](./configuration-reference.md) - All widget options
- [Expression Language](./expression-language.md) - Custom computed fields
- [Examples](./examples.md) - Common widget patterns
