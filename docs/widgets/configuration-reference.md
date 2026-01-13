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
| `includes` | array | No | Widget names to include (cross-widget references) |

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

## Includes Configuration

Reference other widgets to access their computed results in your expressions.

```yaml
name: Books Dashboard
includes:
  - "Reading Stats"
  - "Genre Breakdown"
fields:
  combined_score:
    expr: "included['Reading Stats'].avg_rating * included['Genre Breakdown'].diversity_index"
```

| Property | Type | Description |
|----------|------|-------------|
| `includes` | `string[]` | Array of widget names to include |

### How Includes Work

When a widget includes other widgets:

1. **Dependency order**: Included widgets are computed first
2. **Access via `included`**: Results are available in expressions as `included.WidgetName.fieldName` or `included['Widget Name'].fieldName`
3. **Transitive includes**: If Widget A includes Widget B, and B includes Widget C, then A has access to both B and C

### Circular Dependencies

Circular dependencies (A includes B, B includes A) are detected at initialization and reported as errors. Widgets in a cycle cannot be computed and display an error state.

### Invalid Includes

References to non-existent widgets are reported as warnings. The widget will still compute, but the missing include will not be available in the `included` context.

### Use Cases

**Cross-collection analysis**: Reference stats from different file patterns.

```yaml
# books-stats.yaml
name: Books Stats
source:
  pattern: "Books/**/*.md"
fields:
  avg_rating:
    avg: rating

# movies-stats.yaml
name: Movies Stats
source:
  pattern: "Movies/**/*.md"
fields:
  avg_rating:
    avg: rating

# media-comparison.yaml
name: Media Comparison
includes:
  - "Books Stats"
  - "Movies Stats"
source:
  pattern: "**/*.md"  # Dummy pattern for ground widget
fields:
  book_avg:
    expr: "included['Books Stats'].avg_rating"
  movie_avg:
    expr: "included['Movies Stats'].avg_rating"
  difference:
    expr: "included['Books Stats'].avg_rating - included['Movies Stats'].avg_rating"
```

**Derived calculations**: Build on computed values from specialized widgets.

```yaml
# base-stats.yaml
name: Base Stats
source:
  pattern: "Data/**/*.md"
fields:
  mean:
    avg: value
  stddev:
    stddev: value

# normalized-view.yaml
name: Normalized View
includes:
  - "Base Stats"
source:
  pattern: "Data/**/*.md"
fields:
  zscore:
    expr: "zscore(this.value, included['Base Stats'].mean, included['Base Stats'].stddev)"
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

### Field Paths and Context Prefixes

Aggregators support context prefixes to specify where values come from:

| Prefix | Description | Example |
|--------|-------------|---------|
| `this.` | Frontmatter value (explicit) | `sum: this.pages` |
| `result.` | Previously computed expression | `avg: result.adjusted_score` |
| *(none)* | Frontmatter value (implicit) | `sum: pages` |

**Frontmatter references** (`this.*` or plain path):

```yaml
# Frontmatter: { bgg: { rating: 7.5 } }
fields:
  board_game_rating:
    avg: bgg.rating           # Implicit: same as this.bgg.rating
  explicit_rating:
    avg: this.bgg.rating      # Explicit: clearer intent
```

**Expression result references** (`result.*`):

Aggregate over values computed by expression fields:

```yaml
fields:
  # Expression field - computed per item
  adjusted_score:
    expr: "this.rating * this.weight"

  # Aggregator referencing the expression result
  avg_adjusted:
    avg: result.adjusted_score    # Averages the per-item adjusted_score values
```

This enables powerful patterns where you transform values before aggregating:

```yaml
fields:
  # Normalize each item's rating to 0-100 scale
  normalized:
    expr: "this.rating * 10"

  # Then aggregate the normalized values
  avg_normalized:
    avg: result.normalized
  max_normalized:
    max: result.normalized
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
