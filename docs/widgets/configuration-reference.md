# Widget Configuration Reference

Complete reference for widget YAML configuration files.

## File Location

Widget configs live in `.memory-loop/widgets/*.yaml` within your vault:

```
vault/
  .memory-loop/
    widgets/
      stats.yaml
      similar-notes.yaml
      rating-meter.yaml
```

Each `.yaml` file defines one widget.

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable widget name |
| `type` | `aggregate` \| `similarity` | Yes | Computation type |
| `location` | `ground` \| `recall` | Yes | Display location |
| `source` | object | Yes | Data source configuration |
| `fields` | object | For aggregate | Field computations |
| `dimensions` | array | For similarity | Similarity dimensions |
| `display` | object | Yes | Display configuration |
| `editable` | array | No | Editable frontmatter fields |

## Source Configuration

Defines which files the widget processes.

```yaml
source:
  pattern: "Books/**/*.md"
  filter:
    status: "read"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | Yes | Glob pattern for matching files |
| `filter` | object | No | Frontmatter filters (exact match) |

### Pattern Examples

```yaml
# All markdown in Books/
pattern: "Books/**/*.md"

# Direct children only (not subdirectories)
pattern: "Notes/*.md"

# Multiple levels with specific name
pattern: "**/README.md"
```

### Filter Examples

```yaml
# Only files with status: "active"
filter:
  status: active

# Multiple conditions (AND)
filter:
  type: book
  status: read
```

## Field Configuration (Aggregate Widgets)

Define computed fields using aggregators or expressions.

```yaml
fields:
  total_items:
    count: true
  total_pages:
    sum: pages
  average_rating:
    avg: rating
  highest_rating:
    max: rating
  lowest_rating:
    min: rating
  rating_spread:
    stddev: rating
  computed_score:
    expr: "(this.rating * 10) + (this.pages / 100)"
```

### Aggregators

| Aggregator | Syntax | Description |
|------------|--------|-------------|
| `count` | `count: true` | Count of matching files |
| `sum` | `sum: fieldPath` | Sum of numeric values |
| `avg` | `avg: fieldPath` | Average of numeric values |
| `min` | `min: fieldPath` | Minimum value |
| `max` | `max: fieldPath` | Maximum value |
| `stddev` | `stddev: fieldPath` | Standard deviation (requires 2+ values) |

### Field Paths

Access nested frontmatter using dot notation:

```yaml
# Frontmatter: { bgg: { rating: 7.5 } }
fields:
  board_game_rating:
    avg: bgg.rating
```

### Expression-Based Fields

For complex computations, use `expr`:

```yaml
fields:
  normalized_score:
    expr: "safeDivide(this.rating, 10) * 100"
  weighted_value:
    expr: "this.rating * this.weight"
```

See [Expression Language](./expression-language.md) for full syntax.

### Field Visibility

Control whether a field appears in the widget output using `visible`:

```yaml
fields:
  # Hidden intermediate value - computed but not displayed
  max_rating:
    max: rating
    visible: false

  # Visible field using the hidden one
  normalized:
    expr: "safeDivide(this.rating, stats.max_rating) * 100"
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `visible` | boolean | `true` | Whether to include field in output |

Use `visible: false` for intermediate calculations that other expressions depend on but shouldn't be shown in the widget display.

## Dimension Configuration (Similarity Widgets)

Define how similarity is computed between items.

```yaml
dimensions:
  - field: tags
    weight: 0.6
    method: jaccard
  - field: rating
    weight: 0.3
    method: proximity
  - field: categories
    weight: 0.1
    method: cosine
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | string | Yes | Frontmatter field path |
| `weight` | number | Yes | Relative importance (positive) |
| `method` | string | Yes | Similarity algorithm |

### Similarity Methods

| Method | Best for | How it works |
|--------|----------|--------------|
| `jaccard` | Tags, categories, arrays | Set overlap: \|A ∩ B\| / \|A ∪ B\| |
| `proximity` | Ratings, years, numeric values | Inverse distance (closer = more similar) |
| `cosine` | Multi-dimensional vectors | Vector angle similarity |

### Weight Guidelines

Weights are relative, not percentages. These are equivalent:

```yaml
# Using decimals
dimensions:
  - field: tags
    weight: 0.6
  - field: rating
    weight: 0.4

# Using whole numbers
dimensions:
  - field: tags
    weight: 6
  - field: rating
    weight: 4
```

## Display Configuration

Controls how widget results are rendered.

```yaml
display:
  type: summary-card
  title: "Collection Stats"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Display component type |
| `title` | string | No | Custom title (defaults to widget name) |
| `columns` | array | For table | Column headers |
| `limit` | number | For list | Max items to show |
| `min` | number | For meter | Scale minimum |
| `max` | number | For meter | Scale maximum |

### Summary Card

Key-value display for aggregate statistics:

```yaml
display:
  type: summary-card
  title: "My Collection"
```

### Table

Sortable rows and columns:

```yaml
display:
  type: table
  columns:
    - Title
    - Author
    - Rating
```

### List

Ranked items (typically for similarity):

```yaml
display:
  type: list
  limit: 10
  title: "Related Items"
```

### Meter

Single value with scale visualization:

```yaml
display:
  type: meter
  min: 0
  max: 100
  title: "Completion"
```

## Editable Fields

Allow users to modify frontmatter from the widget.

```yaml
editable:
  - field: rating
    type: slider
    label: "Rating"
    min: 1
    max: 10
    step: 1
  - field: status
    type: select
    label: "Status"
    options:
      - backlog
      - in-progress
      - completed
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | string | Yes | Frontmatter field to edit |
| `type` | string | Yes | Input control type |
| `label` | string | Yes | User-facing label |
| `options` | array | For select | Dropdown options |
| `min` | number | For slider/number | Minimum value |
| `max` | number | For slider/number | Maximum value |
| `step` | number | For slider/number | Increment step |

### Input Types

| Type | Description | Required config |
|------|-------------|-----------------|
| `slider` | Range slider | `min`, `max` |
| `number` | Numeric input | None (`min`, `max` optional) |
| `text` | Text input | None |
| `date` | Date picker | None |
| `select` | Dropdown | `options` |

## Complete Examples

### Ground Widget with All Features

```yaml
name: Book Collection Dashboard
type: aggregate
location: ground
source:
  pattern: "Books/**/*.md"
  filter:
    type: book
fields:
  total_books:
    count: true
  pages_read:
    sum: pages
  average_rating:
    avg: rating
  completion_rate:
    expr: "safeDivide(stats.pages_read, stats.total_pages) * 100"
display:
  type: summary-card
  title: Reading Stats
```

### Recall Widget with Similarity

```yaml
name: Similar Games
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: mechanics
    weight: 0.5
    method: jaccard
  - field: bgg.rating
    weight: 0.3
    method: proximity
  - field: players.max
    weight: 0.2
    method: proximity
display:
  type: list
  limit: 5
  title: You Might Also Like
```

### Recall Widget with Editable Fields

```yaml
name: Game Rating
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
fields:
  current_rating:
    expr: "this.rating"
display:
  type: meter
  min: 0
  max: 10
editable:
  - field: rating
    type: slider
    label: My Rating
    min: 1
    max: 10
    step: 0.5
  - field: status
    type: select
    label: Status
    options:
      - want-to-play
      - playing
      - played
```
