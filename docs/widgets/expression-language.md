# Expression Language

Widgets support a safe expression language for custom computed fields. Expressions can reference frontmatter data and collection statistics.

## Basic Syntax

Expressions use mathematical notation with field references:

```yaml
fields:
  score:
    expr: "(this.rating * 10) + (this.bonus / 2)"
```

## Context Variables

### `this` - Current Item

Access the current file's frontmatter:

```yaml
# Frontmatter: { rating: 8, weight: 1.5 }
expr: "this.rating * this.weight"  # Returns 12
```

Nested fields use dot notation:

```yaml
# Frontmatter: { bgg: { rating: 7.5, weight: 2.8 } }
expr: "this.bgg.rating + this.bgg.weight"  # Returns 10.3
```

### `stats` - Collection Statistics

Access aggregator results in expressions:

```yaml
fields:
  # Aggregator: computed across collection
  mean_rating:
    avg: rating

  # Expression: can reference aggregator results via stats
  deviation_from_mean:
    expr: "this.rating - stats.mean_rating"
```

### `result` - Computed Field Results

Access other computed field values. For expressions, this allows chaining computations:

```yaml
fields:
  # First expression
  base_score:
    expr: "this.rating * 10"

  # Second expression referencing the first
  adjusted_score:
    expr: "result.base_score + this.bonus"
```

**In aggregators**, `result.*` enables aggregating over transformed values:

```yaml
fields:
  # Transform each item
  weighted_rating:
    expr: "this.rating * this.weight"

  # Aggregate the transformed values
  avg_weighted:
    avg: result.weighted_rating
```

See [Configuration Reference](./configuration-reference.md#field-paths-and-context-prefixes) for more aggregator examples.

## Operators

### Arithmetic

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Addition | `this.a + this.b` |
| `-` | Subtraction | `this.a - this.b` |
| `*` | Multiplication | `this.a * this.b` |
| `/` | Division | `this.a / this.b` |
| `%` | Modulo | `this.a % 10` |
| `^` | Exponentiation | `this.a ^ 2` |

### Comparison

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equal | `this.status == 1` |
| `!=` | Not equal | `this.status != 0` |
| `<` | Less than | `this.rating < 5` |
| `<=` | Less or equal | `this.rating <= 5` |
| `>` | Greater than | `this.rating > 5` |
| `>=` | Greater or equal | `this.rating >= 5` |

### Logical

| Operator | Description | Example |
|----------|-------------|---------|
| `and` | Logical AND | `this.a > 0 and this.b > 0` |
| `or` | Logical OR | `this.a > 0 or this.b > 0` |
| `not` | Logical NOT | `not this.archived` |

### Conditional (Ternary)

```yaml
expr: "this.rating >= 7 ? 'good' : 'needs work'"
```

## Built-in Functions

### Math Functions (Single Argument)

| Function | Description | Example |
|----------|-------------|---------|
| `abs(x)` | Absolute value | `abs(this.delta)` |
| `round(x)` | Round to integer | `round(this.score)` |
| `floor(x)` | Round down | `floor(this.value)` |
| `ceil(x)` | Round up | `ceil(this.value)` |
| `trunc(x)` | Truncate decimal | `trunc(this.value)` |
| `sqrt(x)` | Square root | `sqrt(this.variance)` |
| `cbrt(x)` | Cube root | `cbrt(this.volume)` |
| `exp(x)` | e^x | `exp(this.growth)` |
| `log(x)` | Natural log | `log(this.value)` |
| `log2(x)` | Log base 2 | `log2(this.bits)` |
| `log10(x)` | Log base 10 | `log10(this.magnitude)` |
| `sign(x)` | Sign (-1, 0, 1) | `sign(this.delta)` |

### Trigonometric Functions

| Function | Description |
|----------|-------------|
| `sin(x)`, `cos(x)`, `tan(x)` | Basic trig |
| `asin(x)`, `acos(x)`, `atan(x)` | Inverse trig |
| `sinh(x)`, `cosh(x)`, `tanh(x)` | Hyperbolic |

### Multi-Argument Functions

| Function | Description | Example |
|----------|-------------|---------|
| `min(a, b, ...)` | Minimum value | `min(this.a, this.b, 10)` |
| `max(a, b, ...)` | Maximum value | `max(this.a, this.b, 0)` |
| `pow(base, exp)` | Power | `pow(this.base, 2)` |
| `atan2(y, x)` | Two-argument arctangent | `atan2(this.y, this.x)` |
| `hypot(a, b)` | Hypotenuse | `hypot(this.x, this.y)` |
| `roundTo(x, places)` | Round to decimals | `roundTo(this.score, 2)` |

### Constants

| Constant | Value |
|----------|-------|
| `PI` | 3.14159... |
| `E` | 2.71828... |
| `true` | Boolean true |
| `false` | Boolean false |

## Custom Functions

These functions handle edge cases common in frontmatter data:

### `roundTo(value, decimals)`

Round to specific decimal places:

```yaml
expr: "roundTo(this.rating / 3, 2)"  # 2.67 instead of 2.666666...
```

### `safeDivide(x, y)`

Division that returns `null` instead of error on divide-by-zero:

```yaml
expr: "safeDivide(this.completed, this.total) * 100"
```

### `isNull(value)`

Check if a value is null or undefined:

```yaml
expr: "isNull(this.rating) ? 0 : this.rating"
```

### `coalesce(value, default)`

Return first non-null value:

```yaml
expr: "coalesce(this.rating, 5)"  # Use 5 if rating is null
```

### `clamp(value, min, max)`

Constrain value to range:

```yaml
expr: "clamp(this.score, 0, 100)"  # Always between 0-100
```

### `normalize(value, min, max)`

Scale value to 0-1 range:

```yaml
expr: "normalize(this.rating, 1, 10)"  # 8 becomes 0.778
```

### `lerp(a, b, t)`

Linear interpolation:

```yaml
expr: "lerp(0, 100, this.progress)"  # t=0.5 returns 50
```

## DAG-Based Computation

Widget fields are computed using a Directed Acyclic Graph (DAG) that automatically determines the correct order based on dependencies. This means you can reference other fields freely without worrying about declaration order.

### How Dependencies Work

The engine analyzes each field to find references to other fields:
- `stats.X` references → depends on aggregator field X
- `result.X` references → depends on computed field X

Fields are then computed in topological order, ensuring dependencies are resolved first.

### What is `stats`?

`stats` contains the results of aggregator fields **that you explicitly define** in the same widget. Nothing is automatic. If you don't define an aggregator, it won't exist in `stats`.

```yaml
fields:
  # You define this field, you choose the name "max_rating"
  max_rating:
    max: rating

  # Now stats.max_rating exists because YOU defined it above
  # stats.min_rating does NOT exist (you didn't define it)
  normalized:
    expr: "safeDivide(this.rating, stats.max_rating)"
```

### Aggregators

Aggregators compute a single value across all matching files:

```yaml
fields:
  total_pages:
    sum: pages        # Sum frontmatter 'pages' field
  avg_rating:
    avg: rating       # Average frontmatter 'rating' field
  book_count:
    count: true       # Count matching files
```

After computation, `stats` contains:
- `stats.total_pages` (because you defined `total_pages`)
- `stats.avg_rating` (because you defined `avg_rating`)
- `stats.book_count` (because you defined `book_count`)

### Aggregators with `result.*`

Aggregators can reference expression results using `result.*`:

```yaml
fields:
  # Expression: computed per item
  adjusted_rating:
    expr: "this.rating * this.confidence"

  # Aggregator: aggregates the per-item expression values
  avg_adjusted:
    avg: result.adjusted_rating
```

When an aggregator references `result.X`, the engine:
1. Computes expression X for each file individually
2. Aggregates those per-item values

This enables powerful transform-then-aggregate patterns.

### Expressions

Expressions compute values that can reference frontmatter (`this.*`), aggregator results (`stats.*`), and other computed fields (`result.*`):

```yaml
fields:
  max_rating:
    max: rating
  collection_avg:
    avg: rating

  normalized_rating:
    expr: "safeDivide(this.rating, stats.max_rating)"
  above_average:
    expr: "this.rating > stats.collection_avg ? 1 : 0"
```

### Common Mistake

This **won't work** because `stats.rating` doesn't exist:

```yaml
fields:
  # WRONG - there's no aggregator named "rating"
  normalized:
    expr: "this.rating / stats.rating"  # stats.rating is undefined!
```

You must define the aggregator first:

```yaml
fields:
  # Define what you need
  max_rating:
    max: rating

  # Now you can use it
  normalized:
    expr: "this.rating / stats.max_rating"  # Works!
```

## Security

Expressions run in a sandboxed environment with these restrictions:

- No file system access
- No network access
- No code execution (`eval`, `Function`, etc.)
- No access to global objects (`process`, `window`, etc.)
- 1 second timeout per expression

Blocked patterns include:
- `require`, `import`, `export`
- `fetch`, `XMLHttpRequest`
- `setTimeout`, `setInterval`
- Object literal syntax (security measure)

## Error Handling

Invalid expressions produce clear error messages:

```
Expression error in widget "My Stats":
  Field: normalized_score
  Expression: this.rating / this.total
  Error: Division by zero
```

Null values in arithmetic typically propagate (result is null), unless handled with `coalesce()` or `isNull()`.

## Examples

### Percentage Calculation

```yaml
fields:
  completion_percent:
    expr: "roundTo(safeDivide(this.completed, this.total) * 100, 1)"
```

### Conditional Score

```yaml
fields:
  adjusted_rating:
    expr: "this.verified ? this.rating : this.rating * 0.8"
```

### Normalized Comparison

```yaml
fields:
  max_rating:
    max: rating
  relative_score:
    expr: "roundTo(safeDivide(this.rating, stats.max_rating) * 100, 0)"
```

### Weighted Average

```yaml
fields:
  weighted_score:
    expr: "(this.quality * 0.4) + (this.difficulty * 0.3) + (this.fun * 0.3)"
```

### Clamped Output

```yaml
fields:
  display_score:
    expr: "clamp(this.raw_score * 10, 0, 100)"
```
