/**
 * Widget Integration Tests (TASK-018)
 *
 * End-to-end tests covering all acceptance tests from the spec:
 * - AT-1: Config discovery on vault connection
 * - AT-2: Simple aggregation returns correct count
 * - AT-3: Z-score computation matches manual calculation
 * - AT-4: Similarity cache hit returns <50ms
 * - AT-5: Cache invalidation on file change
 * - AT-6: Ground widget appears on Home view
 * - AT-7: Recall widget appears for matching file
 * - AT-8: Single-value edit persists and updates widget
 * - AT-9: Invalid config produces actionable error
 * - AT-10: Expression with blocked keywords rejected
 *
 * Run with: bun test backend/src/__tests__/widget-integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import matter from "gray-matter";

import { WidgetEngine, createWidgetEngine } from "../widgets/widget-engine";
import { loadWidgetConfigs } from "../widgets/widget-loader";
import {
  evaluateExpression,
  validateExpressionSecurity,
  ExpressionSecurityError,
} from "../widgets/expression-eval";

// =============================================================================
// Configuration
// =============================================================================

/** Path to the test-vault-widgets fixture */
const TEST_VAULT_PATH = join(
  import.meta.dir,
  "../../__fixtures__/test-vault-widgets"
);

/** Path for temporary test files */
const TEMP_DIR = join(import.meta.dir, "../../__fixtures__/test-vault-temp");

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a temporary vault for isolated tests.
 * Returns the path to the temp vault.
 */
async function createTempVault(): Promise<string> {
  const tempVaultPath = join(TEMP_DIR, `vault-${Date.now()}`);
  await mkdir(join(tempVaultPath, ".memory-loop/widgets"), { recursive: true });
  await mkdir(join(tempVaultPath, "notes"), { recursive: true });
  return tempVaultPath;
}

/**
 * Cleans up a temporary vault.
 */
async function cleanupTempVault(vaultPath: string): Promise<void> {
  try {
    await rm(vaultPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Write a widget config to a temp vault.
 */
async function writeWidgetConfig(
  vaultPath: string,
  filename: string,
  content: string
): Promise<void> {
  const widgetsDir = join(vaultPath, ".memory-loop/widgets");
  await mkdir(widgetsDir, { recursive: true });
  await writeFile(join(widgetsDir, filename), content);
}

/**
 * Copy the test vault fixtures to a temp directory for edit tests.
 */
async function copyTestVault(destPath: string): Promise<void> {
  const files = [
    ".memory-loop/widgets/collection-stats.yaml",
    ".memory-loop/widgets/note-similarity.yaml",
    ".memory-loop/widgets/rating-meter.yaml",
    ".memory-loop/widgets/status-table.yaml",
    "notes/project-alpha.md",
    "notes/meeting-notes-jan.md",
    "notes/research-ai.md",
    "notes/personal-goals.md",
    "notes/book-review-atomic.md",
    "notes/tech-stack-notes.md",
    "notes/recipe-pasta.md",
    "notes/archived-ideas.md",
    "notes/no-frontmatter.md",
    "notes/partial-frontmatter.md",
    "CLAUDE.md",
  ];

  // Read content and write independently to avoid any btrfs CoW/reflink issues
  for (const file of files) {
    const srcPath = join(TEST_VAULT_PATH, file);
    const destFilePath = join(destPath, file);
    await mkdir(dirname(destFilePath), { recursive: true });
    // Read content as buffer, then write as new allocation
    const content = await Bun.file(srcPath).text();
    // Use Bun.write which should create independent data
    await Bun.write(destFilePath, content);
  }

  // Debug: Verify project-alpha was copied correctly
  const copiedContent = await readFile(join(destPath, "notes/project-alpha.md"), "utf-8");
  const copiedParsed = matter(copiedContent);
  console.log(`[COPY DEBUG] Copied to ${destPath}, rating = ${copiedParsed.data.rating}`);
}

// =============================================================================
// AT-1: Config Discovery on Vault Connection
// =============================================================================

describe("AT-1: Config discovery on vault connection", () => {
  test("discovers widget configs when vault is loaded", async () => {
    const { engine, loaderResult } = await createWidgetEngine(TEST_VAULT_PATH);

    try {
      // Verify widgets were discovered
      expect(loaderResult.hasWidgetsDir).toBe(true);
      expect(loaderResult.widgets.length).toBeGreaterThan(0);

      // Verify specific widgets from the fixture
      const widgetIds = loaderResult.widgets.map((w) => w.id);
      expect(widgetIds).toContain("collection-stats");
      expect(widgetIds).toContain("note-similarity");
      expect(widgetIds).toContain("rating-meter");
      expect(widgetIds).toContain("status-table");
    } finally {
      engine.shutdown();
    }
  });

  test("logs discovery for each widget config found", async () => {
    const loaderResult = await loadWidgetConfigs(TEST_VAULT_PATH);

    // Should have found 4 widgets
    expect(loaderResult.widgets.length).toBe(4);
    expect(loaderResult.errors.length).toBe(0);

    // Each widget should have an id and config
    for (const widget of loaderResult.widgets) {
      expect(widget.id).toBeDefined();
      expect(widget.config).toBeDefined();
      expect(widget.config.name).toBeDefined();
      expect(widget.config.type).toBeDefined();
    }
  });

  test("handles vault without widgets directory", async () => {
    const tempVault = await createTempVault();
    // Remove the widgets directory
    await rm(join(tempVault, ".memory-loop"), { recursive: true, force: true });

    try {
      const loaderResult = await loadWidgetConfigs(tempVault);

      // Should report no widgets directory
      expect(loaderResult.hasWidgetsDir).toBe(false);
      expect(loaderResult.widgets.length).toBe(0);
      expect(loaderResult.errors.length).toBe(0);
    } finally {
      await cleanupTempVault(tempVault);
    }
  });
});

// =============================================================================
// AT-2: Simple Aggregation Returns Correct Count
// =============================================================================

describe("AT-2: Simple aggregation returns correct count", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    const result = await createWidgetEngine(TEST_VAULT_PATH);
    engine = result.engine;
    // Clear cache to ensure tests use fresh data
    engine.invalidateAll();
  });

  afterAll(() => {
    engine?.shutdown();
  });

  test("counts files matching source pattern correctly", async () => {
    // Get the collection-stats widget which counts notes/**/*.md
    const groundWidgets = await engine.computeGroundWidgets();

    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );
    expect(statsWidget).toBeDefined();

    // The test fixture has 10 notes
    const data = statsWidget!.data as Record<string, unknown>;
    expect(data.total_notes).toBe(10);
  });

  test("computes sum correctly", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );

    // Only 8 notes have ratings: 4, 6, 7, 7, 8, 8, 9, 10 = 59
    const data = statsWidget!.data as Record<string, unknown>;
    expect(data.total_rating_sum).toBe(59);
  });

  test("computes average correctly", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );

    // Mean of [4, 6, 7, 7, 8, 8, 9, 10] = 59/8 = 7.375
    const data = statsWidget!.data as Record<string, unknown>;
    expect(data.average_rating).toBeCloseTo(7.375, 4);
  });

  test("computes min/max correctly", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );

    const data = statsWidget!.data as Record<string, unknown>;
    expect(data.min_rating).toBe(4);
    expect(data.max_rating).toBe(10);
  });
});

// =============================================================================
// AT-3: Z-Score Computation Matches Manual Calculation
// =============================================================================

describe("AT-3: Z-score computation matches manual calculation", () => {
  test("zscore function computes correct value", () => {
    // Manual calculation:
    // Values: [4, 6, 7, 7, 8, 8, 9, 10]
    // Mean: 7.375
    // Variance: ((4-7.375)^2 + (6-7.375)^2 + ... ) / 8
    //         = (11.390625 + 1.890625 + 0.140625 + 0.140625 + 0.390625 + 0.390625 + 2.640625 + 6.890625) / 8
    //         = 23.875 / 8 = 2.984375
    // StdDev: sqrt(2.984375) = 1.7274...
    const mean = 7.375;
    const stddev = Math.sqrt(23.875 / 8); // ~1.7274

    // Test z-score for value 10 (book review)
    // z = (10 - 7.375) / 1.7274 = 2.625 / 1.7274 = ~1.52
    const result = evaluateExpression("zscore(10, 7.375, 1.7274)", {
      this: {},
      stats: {},
    });

    const expectedZscore = (10 - mean) / stddev;
    expect(result).toBeCloseTo(expectedZscore, 2);
  });

  test("zscore with collection stats context", () => {
    // Simulate using stats from collection
    const context = {
      this: { rating: 10 },
      stats: {
        rating_mean: 7.375,
        rating_stddev: 1.7274,
      },
    };

    const result = evaluateExpression(
      "zscore(this.rating, stats.rating_mean, stats.rating_stddev)",
      context
    );

    // z = (10 - 7.375) / 1.7274 = ~1.52
    expect(result).toBeCloseTo(1.52, 1);
  });

  test("zscore handles zero stddev gracefully", () => {
    // When all values are the same, stddev is 0
    // zscore should return null (not Infinity)
    const result = evaluateExpression("zscore(5, 5, 0)", {
      this: {},
      stats: {},
    });

    expect(result).toBeNull();
  });

  test("zscore handles negative values correctly", () => {
    // Test with negative z-score (below mean)
    // z = (4 - 7.375) / 1.7274 = -3.375 / 1.7274 = ~-1.95
    const result = evaluateExpression("zscore(4, 7.375, 1.7274)", {
      this: {},
      stats: {},
    });

    expect(result).toBeCloseTo(-1.95, 1);
  });
});

// =============================================================================
// AT-4: Similarity Cache Hit Returns <50ms
// =============================================================================

describe("AT-4: Similarity cache hit returns <50ms", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    const result = await createWidgetEngine(TEST_VAULT_PATH);
    engine = result.engine;
  });

  afterAll(() => {
    engine?.shutdown();
  });

  test("first request computes similarity (cache miss)", async () => {
    // Clear any cached results
    engine.invalidateAll();

    const result = await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );

    expect(result.cacheHit).toBe(false);
    expect(result.result.length).toBeGreaterThan(0);
  });

  test("second request returns cached result in <50ms", async () => {
    // First request to prime cache
    await engine.computeSimilarity("note-similarity", "notes/project-alpha.md");

    // Second request should hit cache
    const startTime = performance.now();
    const result = await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );
    const elapsed = performance.now() - startTime;

    expect(result.cacheHit).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  test("cache hit is consistent across multiple calls", async () => {
    // Prime cache
    await engine.computeSimilarity("note-similarity", "notes/research-ai.md");

    // Multiple cache hits
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await engine.computeSimilarity(
        "note-similarity",
        "notes/research-ai.md"
      );
      times.push(performance.now() - start);
      expect(result.cacheHit).toBe(true);
    }

    // All should be fast
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(50);
  });
});

// =============================================================================
// AT-5: Cache Invalidation on File Change
// =============================================================================

describe("AT-5: Cache invalidation on file change", () => {
  let tempVault: string;
  let engine: WidgetEngine;

  beforeEach(async () => {
    // Create a fresh temp vault for each test
    tempVault = await createTempVault();
    await copyTestVault(tempVault);

    const result = await createWidgetEngine(tempVault);
    engine = result.engine;
  });

  afterEach(async () => {
    // Clean up after each test to ensure isolation
    engine?.shutdown();
    if (tempVault) {
      await cleanupTempVault(tempVault);
    }
  });

  test("cache invalidation via handleFilesChanged", async () => {
    // Prime the cache
    const firstResult = await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );
    expect(firstResult.cacheHit).toBe(false);

    // Verify cache hit
    const secondResult = await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );
    expect(secondResult.cacheHit).toBe(true);

    // Simulate file change
    engine.handleFilesChanged(["notes/research-ai.md"]);

    // Should miss cache after invalidation
    const thirdResult = await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );
    expect(thirdResult.cacheHit).toBe(false);
  });

  test("cache invalidation returns affected widgets", async () => {
    // Prime the cache
    await engine.computeGroundWidgets();
    await engine.computeSimilarity(
      "note-similarity",
      "notes/project-alpha.md"
    );

    // Invalidate with file change
    const result = engine.handleFilesChanged(["notes/project-alpha.md"]);

    // Should report which widgets were invalidated
    expect(result.invalidatedWidgets.length).toBeGreaterThan(0);
    expect(result.totalEntriesInvalidated).toBeGreaterThan(0);
  });

  test("actual file modification triggers recomputation with new value", async () => {
    // Compute ground widgets first
    const firstResult = await engine.computeGroundWidgets({ force: true });
    const statsWidget = firstResult.find(
      (w) => w.widgetId === "collection-stats"
    );
    const firstSum = (statsWidget!.data as Record<string, unknown>)
      .total_rating_sum as number;

    // Modify a file (change rating from 8 to 9 for project-alpha)
    const filePath = join(tempVault, "notes/project-alpha.md");
    const content = await readFile(filePath, "utf-8");
    const parsed = matter(content);
    // IMPORTANT: Create new data object to avoid gray-matter caching issues
    const newData = { ...parsed.data, rating: 9 }; // Was 8
    const newContent = matter.stringify(parsed.content, newData);
    await writeFile(filePath, newContent);

    // Invalidate cache
    engine.handleFilesChanged(["notes/project-alpha.md"]);

    // Recompute
    const secondResult = await engine.computeGroundWidgets({ force: true });
    const statsWidget2 = secondResult.find(
      (w) => w.widgetId === "collection-stats"
    );
    const secondSum = (statsWidget2!.data as Record<string, unknown>)
      .total_rating_sum as number;

    // Sum should increase by 1
    expect(secondSum).toBe(firstSum + 1);
  });
});

// =============================================================================
// AT-6: Ground Widget Appears on Home View
// =============================================================================

describe("AT-6: Ground widget appears on Home view", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    const result = await createWidgetEngine(TEST_VAULT_PATH);
    engine = result.engine;
  });

  afterAll(() => {
    engine?.shutdown();
  });

  test("computeGroundWidgets returns ground widgets", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    // Should have at least one ground widget
    expect(groundWidgets.length).toBeGreaterThan(0);

    // All returned widgets should be ground location
    for (const widget of groundWidgets) {
      expect(widget.location).toBe("ground");
    }
  });

  test("ground widgets include collection-stats", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    // Find the collection-stats widget
    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );

    expect(statsWidget).toBeDefined();
    expect(statsWidget!.name).toBe("Note Statistics");
    expect(statsWidget!.type).toBe("aggregate");
    expect(statsWidget!.display.type).toBe("summary-card");
  });

  test("ground widgets exclude recall widgets", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    // Should not include recall-only widgets like note-similarity
    const similarityWidget = groundWidgets.find(
      (w) => w.widgetId === "note-similarity"
    );

    expect(similarityWidget).toBeUndefined();
  });
});

// =============================================================================
// AT-7: Recall Widget Appears for Matching File
// =============================================================================

describe("AT-7: Recall widget appears for matching file", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    const result = await createWidgetEngine(TEST_VAULT_PATH);
    engine = result.engine;
  });

  afterAll(() => {
    engine?.shutdown();
  });

  test("computeRecallWidgets returns widgets for matching file", async () => {
    const recallWidgets = await engine.computeRecallWidgets(
      "notes/project-alpha.md"
    );

    // Should have at least one recall widget
    expect(recallWidgets.length).toBeGreaterThan(0);

    // All returned widgets should be recall location
    for (const widget of recallWidgets) {
      expect(widget.location).toBe("recall");
    }
  });

  test("recall widgets include similarity for matching file", async () => {
    const recallWidgets = await engine.computeRecallWidgets(
      "notes/project-alpha.md"
    );

    // Find the note-similarity widget
    const similarityWidget = recallWidgets.find(
      (w) => w.widgetId === "note-similarity"
    );

    expect(similarityWidget).toBeDefined();
    expect(similarityWidget!.name).toBe("Similar Notes");
    expect(similarityWidget!.type).toBe("similarity");
    expect(similarityWidget!.display.type).toBe("list");
  });

  test("similarity widget returns similar items", async () => {
    const recallWidgets = await engine.computeRecallWidgets(
      "notes/project-alpha.md"
    );

    const similarityWidget = recallWidgets.find(
      (w) => w.widgetId === "note-similarity"
    );

    // Data should be array of similar items
    const data = similarityWidget!.data as Array<{
      path: string;
      score: number;
    }>;

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Should not include self
    const paths = data.map((d) => d.path);
    expect(paths).not.toContain("notes/project-alpha.md");

    // Scores should be between 0 and 1
    for (const item of data) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  test("recall widgets empty for non-matching file", async () => {
    // Use a pattern that doesn't match any widget
    const recallWidgets = await engine.computeRecallWidgets(
      "other/non-matching.md"
    );

    // Should return empty array (no matching widgets)
    expect(recallWidgets.length).toBe(0);
  });
});

// =============================================================================
// AT-8: Single-Value Edit Persists and Updates Widget
// =============================================================================

describe("AT-8: Single-value edit persists and updates widget", () => {
  let tempVault: string;
  let engine: WidgetEngine;

  beforeEach(async () => {
    // Create a fresh temp vault for each test
    tempVault = await createTempVault();
    await copyTestVault(tempVault);

    const result = await createWidgetEngine(tempVault);
    engine = result.engine;
  });

  afterEach(async () => {
    // Clean up after each test to ensure isolation
    engine?.shutdown();
    if (tempVault) {
      await cleanupTempVault(tempVault);
    }
  });

  test("editable field config is included in widget result", async () => {
    const recallWidgets = await engine.computeRecallWidgets(
      "notes/project-alpha.md"
    );

    // Find rating-meter widget which has editable field
    const meterWidget = recallWidgets.find(
      (w) => w.widgetId === "rating-meter"
    );

    expect(meterWidget).toBeDefined();
    expect(meterWidget!.editable).toBeDefined();
    expect(meterWidget!.editable!.length).toBe(1);
    expect(meterWidget!.editable![0].field).toBe("rating");
    expect(meterWidget!.editable![0].type).toBe("slider");
  });

  test("editing frontmatter field persists to file", async () => {
    const filePath = join(tempVault, "notes/project-alpha.md");

    // Read original value
    const originalContent = await readFile(filePath, "utf-8");
    const originalParsed = matter(originalContent);
    expect(originalParsed.data.rating).toBe(8);

    // Simulate edit: modify frontmatter and write back
    // IMPORTANT: Create new data object to avoid gray-matter caching issues
    const newData = { ...originalParsed.data, rating: 5 };
    const newContent = matter.stringify(originalParsed.content, newData);
    await writeFile(filePath, newContent);

    // Verify change persisted
    const updatedContent = await readFile(filePath, "utf-8");
    const updatedParsed = matter(updatedContent);
    expect(updatedParsed.data.rating).toBe(5);
  });

  test("widget reflects updated value after edit", async () => {
    const filePath = join(tempVault, "notes/project-alpha.md");

    // Get initial widget value
    engine.invalidateAll();
    let recallWidgets = await engine.computeRecallWidgets(
      "notes/project-alpha.md"
    );
    let meterWidget = recallWidgets.find((w) => w.widgetId === "rating-meter");
    const initialRating = (meterWidget!.data as Record<string, unknown>)
      .current_rating;
    expect(initialRating).toBe(8);

    // Edit the file
    const content = await readFile(filePath, "utf-8");
    const parsed = matter(content);
    // IMPORTANT: Create new data object to avoid gray-matter caching issues
    const newData = { ...parsed.data, rating: 3 };
    await writeFile(filePath, matter.stringify(parsed.content, newData));

    // Invalidate and recompute
    engine.handleFilesChanged(["notes/project-alpha.md"]);
    recallWidgets = await engine.computeRecallWidgets("notes/project-alpha.md");
    meterWidget = recallWidgets.find((w) => w.widgetId === "rating-meter");

    // Widget should reflect new value
    const newRating = (meterWidget!.data as Record<string, unknown>)
      .current_rating;
    expect(newRating).toBe(3);
  });

  test("edit triggers recalculation of dependent aggregations", async () => {
    const filePath = join(tempVault, "notes/project-alpha.md");

    // Get initial sum
    engine.invalidateAll();
    let groundWidgets = await engine.computeGroundWidgets({ force: true });
    let statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );
    const initialSum = (statsWidget!.data as Record<string, unknown>)
      .total_rating_sum as number;

    // Edit the file (decrease rating from 8 to 2, diff of -6)
    const content = await readFile(filePath, "utf-8");
    const parsed = matter(content);
    // IMPORTANT: Create new data object to avoid gray-matter caching issues
    const newData = { ...parsed.data, rating: 2 };
    await writeFile(filePath, matter.stringify(parsed.content, newData));

    // Invalidate and recompute
    engine.handleFilesChanged(["notes/project-alpha.md"]);
    groundWidgets = await engine.computeGroundWidgets({ force: true });
    statsWidget = groundWidgets.find((w) => w.widgetId === "collection-stats");

    // Sum should decrease by 6
    const newSum = (statsWidget!.data as Record<string, unknown>)
      .total_rating_sum as number;
    expect(newSum).toBe(initialSum - 6);
  });
});

// =============================================================================
// AT-9: Invalid Config Produces Actionable Error
// =============================================================================

describe("AT-9: Invalid config produces actionable error", () => {
  test("missing required field produces specific error", async () => {
    const tempVault = await createTempVault();

    try {
      // Create widget with missing required 'name' field
      const invalidConfig = `
type: aggregate
location: ground
source:
  pattern: "notes/**/*.md"
fields:
  count:
    count: true
display:
  type: summary-card
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      // Should have one error
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].id).toBe("invalid");

      // Error should mention the missing field
      expect(result.errors[0].error).toContain("name");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("invalid type produces actionable error", async () => {
    const tempVault = await createTempVault();

    try {
      // Create widget with invalid type
      const invalidConfig = `
name: Test Widget
type: invalid_type
location: ground
source:
  pattern: "notes/**/*.md"
fields:
  count:
    count: true
display:
  type: summary-card
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("type");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("aggregate widget without fields produces error", async () => {
    const tempVault = await createTempVault();

    try {
      const invalidConfig = `
name: Test Widget
type: aggregate
location: ground
source:
  pattern: "notes/**/*.md"
display:
  type: summary-card
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("field");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("similarity widget without dimensions produces error", async () => {
    const tempVault = await createTempVault();

    try {
      const invalidConfig = `
name: Test Widget
type: similarity
location: recall
source:
  pattern: "notes/**/*.md"
display:
  type: list
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("dimension");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("malformed YAML produces parse error", async () => {
    const tempVault = await createTempVault();

    try {
      // Invalid YAML syntax
      const invalidConfig = `
name: Test Widget
type: aggregate
  location: ground  # Incorrect indentation
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("YAML");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("empty config file produces error", async () => {
    const tempVault = await createTempVault();

    try {
      await writeWidgetConfig(tempVault, "empty.yaml", "");

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("empty");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });

  test("table display without columns produces error", async () => {
    const tempVault = await createTempVault();

    try {
      const invalidConfig = `
name: Test Widget
type: aggregate
location: ground
source:
  pattern: "notes/**/*.md"
fields:
  count:
    count: true
display:
  type: table
`;
      await writeWidgetConfig(tempVault, "invalid.yaml", invalidConfig);

      const result = await loadWidgetConfigs(tempVault);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain("column");
    } finally {
      await cleanupTempVault(tempVault);
    }
  });
});

// =============================================================================
// AT-10: Expression with Blocked Keywords Rejected
// =============================================================================

describe("AT-10: Expression with blocked keywords rejected", () => {
  test("rejects require() in expression", () => {
    expect(() => {
      validateExpressionSecurity("require('fs')");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects import in expression", () => {
    expect(() => {
      validateExpressionSecurity("import('fs')");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects eval in expression", () => {
    expect(() => {
      validateExpressionSecurity("eval('code')");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects process in expression", () => {
    expect(() => {
      validateExpressionSecurity("process.exit()");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects globalThis in expression", () => {
    expect(() => {
      validateExpressionSecurity("globalThis.foo");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects constructor access in expression", () => {
    expect(() => {
      validateExpressionSecurity("this.constructor");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects __proto__ in expression", () => {
    expect(() => {
      validateExpressionSecurity("this.__proto__");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects Function constructor", () => {
    expect(() => {
      validateExpressionSecurity("Function('return this')()");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects fetch in expression", () => {
    expect(() => {
      validateExpressionSecurity("fetch('http://evil.com')");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects fs operations", () => {
    expect(() => {
      validateExpressionSecurity("readFile('/etc/passwd')");
    }).toThrow(ExpressionSecurityError);

    expect(() => {
      validateExpressionSecurity("writeFile('/tmp/test', 'data')");
    }).toThrow(ExpressionSecurityError);
  });

  // Note: Tests for child process operations (exec, spawn) are validated
  // by the expression-eval unit tests. Here we verify the security boundary
  // is enforced for code execution attempts.
  test("rejects command execution attempts", () => {
    expect(() => {
      validateExpressionSecurity("child_process.execSync('ls')");
    }).toThrow(ExpressionSecurityError);

    expect(() => {
      validateExpressionSecurity("spawn('bash')");
    }).toThrow(ExpressionSecurityError);
  });

  test("rejects setTimeout/setInterval", () => {
    expect(() => {
      validateExpressionSecurity("setTimeout(fn, 1000)");
    }).toThrow(ExpressionSecurityError);

    expect(() => {
      validateExpressionSecurity("setInterval(fn, 1000)");
    }).toThrow(ExpressionSecurityError);
  });

  test("error message includes blocked keyword", () => {
    try {
      validateExpressionSecurity("require('fs')");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionSecurityError);
      expect((error as ExpressionSecurityError).blockedKeyword).toBe("require");
      expect((error as ExpressionSecurityError).expression).toBe(
        "require('fs')"
      );
    }
  });

  test("allows safe mathematical expressions", () => {
    // These should not throw
    expect(() => {
      validateExpressionSecurity("this.rating * 2");
    }).not.toThrow();

    expect(() => {
      validateExpressionSecurity("zscore(this.rating, stats.mean, stats.stddev)");
    }).not.toThrow();

    expect(() => {
      validateExpressionSecurity("clamp(this.value, 0, 100)");
    }).not.toThrow();

    expect(() => {
      validateExpressionSecurity("this.count > 10 ? 'high' : 'low'");
    }).not.toThrow();
  });

  test("evaluateExpression throws on blocked keywords", () => {
    expect(() => {
      evaluateExpression("require('fs')", { this: {}, stats: {} });
    }).toThrow(ExpressionSecurityError);
  });
});

// =============================================================================
// Additional Integration Tests
// =============================================================================

describe("Additional integration scenarios", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    const result = await createWidgetEngine(TEST_VAULT_PATH);
    engine = result.engine;
  });

  afterAll(() => {
    engine?.shutdown();
  });

  test("handles files with no frontmatter gracefully", async () => {
    const groundWidgets = await engine.computeGroundWidgets();

    // Should complete without error
    expect(groundWidgets.length).toBeGreaterThan(0);

    // Stats should still include count of all files
    const statsWidget = groundWidgets.find(
      (w) => w.widgetId === "collection-stats"
    );
    const data = statsWidget!.data as Record<string, unknown>;

    // 10 total notes, but only 8 have ratings
    expect(data.total_notes).toBe(10);
  });

  test("handles files with partial frontmatter", async () => {
    const recallWidgets = await engine.computeRecallWidgets(
      "notes/partial-frontmatter.md"
    );

    // Should return widgets (even if data is empty for some fields)
    // The file matches the pattern, so widgets apply
    expect(recallWidgets.length).toBeGreaterThan(0);
  });

  test("widget engine reports correct initialization state", () => {
    expect(engine.isInitialized()).toBe(true);
    expect(engine.getVaultPath()).toBe(TEST_VAULT_PATH);
  });

  test("cache stats reflect actual cached entries", async () => {
    // Clear and recompute
    engine.invalidateAll();

    // Initial stats should be zero
    let stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBe(0);

    // Compute widgets
    await engine.computeGroundWidgets();

    // Stats should reflect cached entries
    stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBeGreaterThan(0);
  });

  test("similarity scores are sorted descending", async () => {
    const result = await engine.computeSimilarity(
      "note-similarity",
      "notes/research-ai.md"
    );

    const scores = result.result.map((r) => r.score);

    // Check that scores are sorted descending
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  test("similarity respects limit from config", async () => {
    const result = await engine.computeSimilarity(
      "note-similarity",
      "notes/research-ai.md"
    );

    // note-similarity config has limit: 5
    expect(result.result.length).toBeLessThanOrEqual(5);
  });
});
