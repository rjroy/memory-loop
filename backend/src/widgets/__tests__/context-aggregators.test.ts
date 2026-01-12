/**
 * Context-Aware Aggregator Tests
 *
 * Tests for aggregator field paths with context prefixes:
 * - `this.X` - Explicit frontmatter reference (backward compatible)
 * - `result.X` - Reference to previously computed per-item values
 * - Plain `X` - Implicit frontmatter reference (backward compatible)
 *
 * Issue #251: Widget stats calculation needs to use context
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WidgetEngine } from "../widget-engine";
import { WIDGETS_DIR } from "../widget-loader";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `context-agg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

async function createWidgetsDir(vaultPath: string): Promise<string> {
  const widgetsDir = join(vaultPath, WIDGETS_DIR);
  await mkdir(widgetsDir, { recursive: true });
  return widgetsDir;
}

async function createVaultDir(vaultPath: string, subdir: string): Promise<string> {
  const fullPath = join(vaultPath, subdir);
  await mkdir(fullPath, { recursive: true });
  return fullPath;
}

async function writeWidgetConfig(
  widgetsDir: string,
  filename: string,
  content: string
): Promise<void> {
  await writeFile(join(widgetsDir, filename), content);
}

async function writeMarkdownFile(
  dir: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  content = ""
): Promise<void> {
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${(value as unknown[]).map((v) => `  - ${String(v)}`).join("\n")}`;
      }
      if (typeof value === "object" && value !== null) {
        const nested = Object.entries(value as Record<string, unknown>)
          .map(([k, v]) => `  ${k}: ${String(v)}`)
          .join("\n");
        return `${key}:\n${nested}`;
      }
      return `${key}: ${String(value)}`;
    })
    .join("\n");
  const fileContent = `---\n${yaml}\n---\n${content}`;
  await writeFile(join(dir, filename), fileContent);
}

// =============================================================================
// this.* Prefix Tests
// =============================================================================

describe("this.* prefix in aggregators", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("avg: this.rating is equivalent to avg: rating", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    // Widget using both this.X and plain X for the same field
    const widgetYaml = `
name: This Prefix Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  explicit_avg:
    avg: this.rating
  implicit_avg:
    avg: rating
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "this-prefix.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "item1.md", { title: "Item 1", rating: 6 });
    await writeMarkdownFile(dataDir, "item2.md", { title: "Item 2", rating: 8 });
    await writeMarkdownFile(dataDir, "item3.md", { title: "Item 3", rating: 10 });
    // avg = (6 + 8 + 10) / 3 = 8

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const data = results[0].data as Record<string, unknown>;

    // Both should produce the same result
    expect(data.explicit_avg).toBe(8);
    expect(data.implicit_avg).toBe(8);

    engine.shutdown();
  });

  test("this.* works with nested frontmatter paths", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Games");

    const widgetYaml = `
name: Nested Path Test
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
fields:
  avg_bgg_rating:
    avg: this.bgg.rating
  max_bgg_weight:
    max: this.bgg.weight
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "nested.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "catan.md", {
      title: "Catan",
      bgg: { rating: 7.2, weight: 2.3 },
    });
    await writeMarkdownFile(dataDir, "wingspan.md", {
      title: "Wingspan",
      bgg: { rating: 8.1, weight: 2.4 },
    });
    // avg_bgg_rating = (7.2 + 8.1) / 2 = 7.65
    // max_bgg_weight = 2.4

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.avg_bgg_rating).toBeCloseTo(7.65, 2);
    expect(data.max_bgg_weight).toBe(2.4);

    engine.shutdown();
  });
});

// =============================================================================
// result.* Prefix Tests (Core Issue #251 Feature)
// =============================================================================

describe("result.* prefix in aggregators", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("avg: result.adjusted_score aggregates per-item expression values", async () => {
    // This is the core use case from Issue #251
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Result Prefix Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  mean_rating:
    avg: this.rating
  adjusted_score:
    expr: "this.score - stats.mean_rating"
  mean_adjusted_score:
    avg: result.adjusted_score
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "result-prefix.yaml", widgetYaml);

    // Create items with rating and score
    await writeMarkdownFile(dataDir, "item1.md", { title: "Item 1", rating: 5, score: 10 });
    await writeMarkdownFile(dataDir, "item2.md", { title: "Item 2", rating: 7, score: 15 });
    await writeMarkdownFile(dataDir, "item3.md", { title: "Item 3", rating: 9, score: 20 });
    // mean_rating = (5 + 7 + 9) / 3 = 7
    // adjusted_score per item:
    //   item1: 10 - 7 = 3
    //   item2: 15 - 7 = 8
    //   item3: 20 - 7 = 13
    // mean_adjusted_score = (3 + 8 + 13) / 3 = 8

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const data = results[0].data as Record<string, unknown>;

    expect(data.mean_rating).toBe(7);
    // Note: adjusted_score is an expression, so it won't have a single value in ground widgets
    // (ground widgets don't have `this` context for expressions)
    expect(data.mean_adjusted_score).toBe(8);

    engine.shutdown();
  });

  test("sum: result.* aggregates per-item computed values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Sum Result Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  doubled_value:
    expr: "this.value * 2"
  sum_doubled:
    sum: result.doubled_value
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "sum-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A", value: 10 });
    await writeMarkdownFile(dataDir, "b.md", { title: "B", value: 20 });
    await writeMarkdownFile(dataDir, "c.md", { title: "C", value: 30 });
    // doubled_value per item: 20, 40, 60
    // sum_doubled = 20 + 40 + 60 = 120

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.sum_doubled).toBe(120);

    engine.shutdown();
  });

  test("min/max: result.* finds extremes of per-item computed values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: MinMax Result Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  normalized:
    expr: "this.score / 10"
  min_normalized:
    min: result.normalized
  max_normalized:
    max: result.normalized
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "minmax-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "low.md", { title: "Low", score: 30 });
    await writeMarkdownFile(dataDir, "mid.md", { title: "Mid", score: 50 });
    await writeMarkdownFile(dataDir, "high.md", { title: "High", score: 90 });
    // normalized per item: 3, 5, 9
    // min = 3, max = 9

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.min_normalized).toBe(3);
    expect(data.max_normalized).toBe(9);

    engine.shutdown();
  });

  test("stddev: result.* computes deviation of per-item values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Stddev Result Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  scaled:
    expr: "this.value * 10"
  stddev_scaled:
    stddev: result.scaled
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "stddev-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A", value: 1 });
    await writeMarkdownFile(dataDir, "b.md", { title: "B", value: 2 });
    await writeMarkdownFile(dataDir, "c.md", { title: "C", value: 3 });
    // scaled per item: 10, 20, 30
    // mean = 20, variance = ((10-20)^2 + (20-20)^2 + (30-20)^2) / 3 = (100 + 0 + 100) / 3 = 200/3
    // stddev = sqrt(200/3) ~= 8.165

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(typeof data.stddev_scaled).toBe("number");
    expect(data.stddev_scaled).toBeCloseTo(8.165, 2);

    engine.shutdown();
  });

  test("result.* referencing non-existent field returns null values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Missing Result Field
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  avg_missing:
    avg: result.does_not_exist
  valid_sum:
    sum: value
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "missing-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "item.md", { title: "Item", value: 42 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    // avg of all nulls should be null
    expect(data.avg_missing).toBeNull();
    // Valid field should still work
    expect(data.valid_sum).toBe(42);

    engine.shutdown();
  });

  test("chained result.* dependencies compute in correct order", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Chained Dependencies
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  # First: compute per-item base value
  base:
    expr: "this.value + 10"
  # Second: compute per-item enhanced value using base
  enhanced:
    expr: "result.base * 2"
  # Third: aggregate the enhanced values
  sum_enhanced:
    sum: result.enhanced
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "chained.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A", value: 5 });
    await writeMarkdownFile(dataDir, "b.md", { title: "B", value: 10 });
    // base per item: 15, 20
    // enhanced per item: 30, 40
    // sum_enhanced = 30 + 40 = 70

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.sum_enhanced).toBe(70);

    engine.shutdown();
  });
});

// =============================================================================
// Mixed Context Tests
// =============================================================================

describe("mixed context references", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("combination of this.*, result.*, and plain paths", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Mixed Context
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  # Plain path (backward compatible)
  plain_sum:
    sum: value
  # Explicit this.* path
  this_avg:
    avg: this.rating
  # Per-item expression
  computed:
    expr: "this.value + this.rating"
  # Aggregate over computed values
  result_max:
    max: result.computed
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "mixed.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A", value: 10, rating: 3 });
    await writeMarkdownFile(dataDir, "b.md", { title: "B", value: 20, rating: 5 });
    await writeMarkdownFile(dataDir, "c.md", { title: "C", value: 30, rating: 7 });
    // plain_sum = 10 + 20 + 30 = 60
    // this_avg = (3 + 5 + 7) / 3 = 5
    // computed per item: 13, 25, 37
    // result_max = 37

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.plain_sum).toBe(60);
    expect(data.this_avg).toBe(5);
    expect(data.result_max).toBe(37);

    engine.shutdown();
  });

  test("result.* with stats.* in expression", async () => {
    // Tests that expressions can use stats.* while aggregators use result.*
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Stats and Result
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  # Collection aggregator
  mean_value:
    avg: this.value
  # Per-item expression using stats.*
  deviation:
    expr: "this.value - stats.mean_value"
  # Aggregate the deviations (should sum to approximately 0)
  sum_deviation:
    sum: result.deviation
  # Aggregate absolute deviation
  abs_deviation:
    expr: "abs(this.value - stats.mean_value)"
  sum_abs_deviation:
    sum: result.abs_deviation
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "stats-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A", value: 10 });
    await writeMarkdownFile(dataDir, "b.md", { title: "B", value: 20 });
    await writeMarkdownFile(dataDir, "c.md", { title: "C", value: 30 });
    // mean_value = 20
    // deviation per item: -10, 0, 10
    // sum_deviation = -10 + 0 + 10 = 0
    // abs_deviation per item: 10, 0, 10
    // sum_abs_deviation = 20

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.mean_value).toBe(20);
    expect(data.sum_deviation).toBe(0);
    expect(data.sum_abs_deviation).toBe(20);

    engine.shutdown();
  });
});

// =============================================================================
// Recall Widget Context Tests
// =============================================================================

describe("recall widgets with context prefixes", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("result.* in recall widget aggregates collection values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Recall Result Test
type: aggregate
location: recall
source:
  pattern: "Items/**/*.md"
fields:
  collection_avg:
    avg: this.value
  per_item_ratio:
    expr: "this.value / stats.collection_avg"
  avg_ratio:
    avg: result.per_item_ratio
display:
  type: meter
  min: 0
  max: 2
`;

    await writeWidgetConfig(widgetsDir, "recall-result.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "low.md", { title: "Low", value: 10 });
    await writeMarkdownFile(dataDir, "mid.md", { title: "Mid", value: 20 });
    await writeMarkdownFile(dataDir, "high.md", { title: "High", value: 30 });
    // collection_avg = 20
    // per_item_ratio: 0.5, 1.0, 1.5
    // avg_ratio = 1.0

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Items/mid.md");
    expect(results).toHaveLength(1);

    const data = results[0].data as Record<string, unknown>;

    expect(data.collection_avg).toBe(20);
    expect(data.per_item_ratio).toBe(1.0); // Current item's ratio
    expect(data.avg_ratio).toBe(1.0); // Average of all ratios

    engine.shutdown();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("result.* handles null/missing values in expressions", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Null Handling
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  optional_calc:
    expr: "this.optional * 2"
  avg_optional:
    avg: result.optional_calc
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "null-handling.yaml", widgetYaml);

    // Some items have the field, some don't
    await writeMarkdownFile(dataDir, "has_value.md", { title: "Has Value", optional: 10 });
    await writeMarkdownFile(dataDir, "no_value.md", { title: "No Value" }); // Missing optional
    await writeMarkdownFile(dataDir, "another.md", { title: "Another", optional: 20 });
    // optional_calc: 20, null, 40
    // avg = (20 + 40) / 2 = 30 (nulls skipped)

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.avg_optional).toBe(30);

    engine.shutdown();
  });

  test("count: true ignores context prefixes", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const dataDir = await createVaultDir(testDir, "Items");

    const widgetYaml = `
name: Count Test
type: aggregate
location: ground
source:
  pattern: "Items/**/*.md"
fields:
  total_count:
    count: true
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "count.yaml", widgetYaml);

    await writeMarkdownFile(dataDir, "a.md", { title: "A" });
    await writeMarkdownFile(dataDir, "b.md", { title: "B" });
    await writeMarkdownFile(dataDir, "c.md", { title: "C" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.total_count).toBe(3);

    engine.shutdown();
  });

  test("empty file set returns appropriate null values", async () => {
    const widgetsDir = await createWidgetsDir(testDir);

    const widgetYaml = `
name: Empty Test
type: aggregate
location: ground
source:
  pattern: "NonExistent/**/*.md"
fields:
  some_avg:
    avg: this.value
  computed:
    expr: "this.value * 2"
  result_sum:
    sum: result.computed
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "empty.yaml", widgetYaml);

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);
    expect(results[0].isEmpty).toBe(true);

    engine.shutdown();
  });
});
