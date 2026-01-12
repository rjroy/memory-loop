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

Access Phase 1 aggregate results in Phase 2 expressions:

```yaml
fields:
  # Phase 1: computed first
  mean_rating:
    avg: rating

  # Phase 2: can reference Phase 1 results
  deviation_from_mean:
    expr: "this.rating - stats.mean_rating"
```

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

## Two-Phase Computation

Widget computation happens in two phases:

**Phase 1 (Collection Stats):** Simple aggregators run first:

```yaml
fields:
  total_pages:
    sum: pages
  avg_rating:
    avg: rating
```

**Phase 2 (Per-Item Expressions):** Expressions run second and can reference Phase 1 results:

```yaml
fields:
  # Phase 1
  max_rating:
    max: rating

  # Phase 2 - can use stats.max_rating
  normalized_rating:
    expr: "safeDivide(this.rating, stats.max_rating)"
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
