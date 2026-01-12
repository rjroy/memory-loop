# Vault Widgets

Vault Widgets enable computed frontmatter aggregation and similarity-based recommendations for your Obsidian vault.

## What Are Widgets?

Widgets are YAML-configured displays that:

- **Aggregate** data across your vault (count, sum, average, etc.)
- **Find similar** items based on shared attributes (tags, ratings, categories)
- **Display** results as cards, tables, lists, or meters
- **Allow editing** of frontmatter directly from the widget

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | Create your first widget in 5 minutes |
| [Configuration Reference](./configuration-reference.md) | Complete YAML schema documentation |
| [Expression Language](./expression-language.md) | Custom computed fields with expressions |
| [Examples](./examples.md) | Real-world widget patterns |

## Quick Example

Create `.memory-loop/widgets/book-stats.yaml`:

```yaml
name: Reading Stats
type: aggregate
location: ground
source:
  pattern: "Books/**/*.md"
fields:
  total_books:
    count: true
  average_rating:
    avg: rating
  pages_read:
    sum: pages
display:
  type: summary-card
```

This creates a dashboard card showing book collection statistics on the Home view.

## Widget Locations

| Location | View | Purpose |
|----------|------|---------|
| `ground` | Home | Vault-wide dashboards |
| `recall` | Browse | Per-file contextual info |

## Widget Types

| Type | Purpose | Example |
|------|---------|---------|
| `aggregate` | Collection statistics | Total count, average rating |
| `similarity` | Find related items | "Similar books" list |

## Display Types

| Type | Best for |
|------|----------|
| `summary-card` | Key-value statistics |
| `table` | Sortable item lists |
| `list` | Ranked similar items |
| `meter` | Single value gauges |

## Key Features

**Aggregators:** `count`, `sum`, `avg`, `min`, `max`, `stddev`

**Similarity methods:** `jaccard` (sets), `proximity` (numbers), `cosine` (vectors)

**Expression language:** Safe math expressions with `this.*` (current item) and `stats.*` (collection stats)

**Editable fields:** Slider, number, text, date, select inputs for frontmatter editing
