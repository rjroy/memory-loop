/**
 * Widget Engine Tests
 *
 * Unit tests for the core widget computation engine.
 * Tests aggregate computation, similarity computation, caching, and routing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WidgetEngine, createWidgetEngine } from "../widget-engine";
import { WIDGETS_DIR } from "../widget-loader";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates the widgets directory structure in a vault.
 */
async function createWidgetsDir(vaultPath: string): Promise<string> {
  const widgetsDir = join(vaultPath, WIDGETS_DIR);
  await mkdir(widgetsDir, { recursive: true });
  return widgetsDir;
}

/**
 * Creates a directory within the vault.
 */
async function createVaultDir(vaultPath: string, subdir: string): Promise<string> {
  const fullPath = join(vaultPath, subdir);
  await mkdir(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Writes a widget config file.
 */
async function writeWidgetConfig(
  widgetsDir: string,
  filename: string,
  content: string
): Promise<void> {
  await writeFile(join(widgetsDir, filename), content);
}

/**
 * Writes a markdown file with frontmatter.
 */
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
// Widget Config Fixtures
// =============================================================================

const aggregateWidgetYaml = `
name: Collection Stats
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
fields:
  total_games:
    count: true
  total_plays:
    sum: play_count
  avg_rating:
    avg: rating
display:
  type: summary-card
`;

const similarityWidgetYaml = `
name: Similar Games
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: tags
    weight: 0.6
    method: jaccard
  - field: rating
    weight: 0.4
    method: proximity
display:
  type: list
  limit: 3
`;

const expressionWidgetYaml = `
name: Game Scores
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
fields:
  # Stats fields that feed into expressions
  rating_avg:
    avg: rating
  rating_max:
    max: rating
  rating_stddev:
    stddev: rating
  # Expression-based computed fields
  normalized_rating:
    expr: "zscore(this.rating, stats.rating_avg, stats.rating_stddev)"
  rating_percent:
    expr: "safeDivide(this.rating, stats.rating_max) * 100"
display:
  type: meter
  min: 0
  max: 100
`;

const groundRecallMixedYaml = {
  ground: `
name: Ground Widget
type: aggregate
location: ground
source:
  pattern: "**/*.md"
fields:
  count:
    count: true
display:
  type: summary-card
`,
  recall: `
name: Recall Widget
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
fields:
  game_count:
    count: true
display:
  type: summary-card
`,
};

// =============================================================================
// WidgetEngine Initialization Tests
// =============================================================================

describe("WidgetEngine initialization", () => {
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

  test("initializes with empty vault (no widgets dir)", async () => {
    const engine = new WidgetEngine(testDir);
    const result = await engine.initialize();

    expect(engine.isInitialized()).toBe(true);
    expect(result.hasWidgetsDir).toBe(false);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(engine.getWidgets()).toHaveLength(0);

    engine.shutdown();
    expect(engine.isInitialized()).toBe(false);
  });

  test("initializes with widgets directory but no configs", async () => {
    await createWidgetsDir(testDir);

    const engine = new WidgetEngine(testDir);
    const result = await engine.initialize();

    expect(result.hasWidgetsDir).toBe(true);
    expect(result.widgets).toHaveLength(0);

    engine.shutdown();
  });

  test("initializes and loads valid widget configs", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);

    const engine = new WidgetEngine(testDir);
    const result = await engine.initialize();

    expect(result.widgets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(engine.getWidgets()).toHaveLength(1);
    expect(engine.getWidgets()[0].config.name).toBe("Collection Stats");

    engine.shutdown();
  });

  test("reports config validation errors", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "invalid.yaml", "name: ''");

    const engine = new WidgetEngine(testDir);
    const result = await engine.initialize();

    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);

    engine.shutdown();
  });

  test("factory function creates and initializes engine", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);

    const { engine, loaderResult } = await createWidgetEngine(testDir);

    expect(engine.isInitialized()).toBe(true);
    expect(loaderResult.widgets).toHaveLength(1);

    engine.shutdown();
  });

  test("throws when computing before initialization", () => {
    const engine = new WidgetEngine(testDir);

    expect(() => engine.computeGroundWidgets()).toThrow(
      "Engine not initialized"
    );
  });

  test("uses provided vault ID", async () => {
    const engine = new WidgetEngine(testDir, "custom-vault-id");
    await engine.initialize();

    expect(engine.getVaultId()).toBe("custom-vault-id");

    engine.shutdown();
  });

  test("generates vault ID from path if not provided", async () => {
    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    expect(engine.getVaultId()).toMatch(/^[a-f0-9]{8}$/);

    engine.shutdown();
  });
});

// =============================================================================
// Ground Widget Computation Tests
// =============================================================================

describe("Ground widget computation", () => {
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

  test("returns empty array when no ground widgets configured", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(0);

    engine.shutdown();
  });

  test("computes aggregate widget with count", async () => {
    // Setup vault structure
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", { title: "Catan", play_count: 10, rating: 8 });
    await writeMarkdownFile(gamesDir, "wingspan.md", { title: "Wingspan", play_count: 5, rating: 9 });
    await writeMarkdownFile(gamesDir, "ticket.md", { title: "Ticket to Ride", play_count: 15, rating: 7 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.widgetId).toBe("stats");
    expect(result.name).toBe("Collection Stats");
    expect(result.type).toBe("aggregate");
    expect(result.location).toBe("ground");
    expect(result.isEmpty).toBe(false);

    const data = result.data as Record<string, unknown>;
    expect(data.total_games).toBe(3);
    expect(data.total_plays).toBe(30);
    expect(data.avg_rating).toBe(8);

    engine.shutdown();
  });

  test("handles empty glob results (isEmpty flag)", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    // No Games directory created

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.isEmpty).toBe(true);
    expect(result.emptyReason).toContain("No files match");
    expect(result.data).toBeNull();

    engine.shutdown();
  });

  test("handles missing frontmatter fields (null values)", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", { title: "Catan", play_count: 10, rating: 8 });
    await writeMarkdownFile(gamesDir, "wingspan.md", { title: "Wingspan" }); // Missing play_count and rating
    await writeMarkdownFile(gamesDir, "ticket.md", { title: "Ticket to Ride", play_count: 5 }); // Missing rating

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    // Count includes all files
    expect(data.total_games).toBe(3);
    // Sum only includes files with values
    expect(data.total_plays).toBe(15); // 10 + 5
    // Avg only averages valid values
    expect(data.avg_rating).toBe(8); // Only catan has rating

    engine.shutdown();
  });

  test("includes computation time in result", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 1, rating: 5 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results[0].computeTimeMs).toBeDefined();
    expect(results[0].computeTimeMs).toBeGreaterThanOrEqual(0);

    engine.shutdown();
  });

  test("only returns ground widgets, not recall widgets", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "ground.yaml", groundRecallMixedYaml.ground);
    await writeWidgetConfig(widgetsDir, "recall.yaml", groundRecallMixedYaml.recall);

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    expect(engine.getWidgets()).toHaveLength(2);

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);
    expect(results[0].location).toBe("ground");

    engine.shutdown();
  });
});

// =============================================================================
// Recall Widget Computation Tests
// =============================================================================

describe("Recall widget computation", () => {
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

  test("returns empty array when no recall widgets configured", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    // Only configure ground widget
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", { title: "Catan" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/catan.md");
    // aggregateWidgetYaml has location: ground, so no recall widgets
    expect(results).toHaveLength(0);

    engine.shutdown();
  });

  test("filters recall widgets by source pattern matching", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");
    const notesDir = await createVaultDir(testDir, "Notes");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", { title: "Catan", tags: ["strategy"], rating: 8 });
    await writeMarkdownFile(notesDir, "note.md", { title: "A Note" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Game file should match
    const gameResults = await engine.computeRecallWidgets("Games/catan.md");
    expect(gameResults).toHaveLength(1);

    // Note file should not match (pattern is Games/**/*.md)
    const noteResults = await engine.computeRecallWidgets("Notes/note.md");
    expect(noteResults).toHaveLength(0);

    engine.shutdown();
  });

  test("computes similarity widget for item", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);

    // Create games with varying similarity
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy", "trading", "resource"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading", "family"],
      rating: 6,
    });
    await writeMarkdownFile(gamesDir, "chess.md", {
      title: "Chess",
      tags: ["strategy", "abstract"],
      rating: 9,
    });
    await writeMarkdownFile(gamesDir, "risk.md", {
      title: "Risk",
      tags: ["strategy", "area-control"],
      rating: 7,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/catan.md");
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.type).toBe("similarity");
    expect(result.isEmpty).toBe(false);

    const data = result.data as Array<{
      path: string;
      score: number;
      title: string;
    }>;

    // Should return top 3 (limit: 3)
    expect(data).toHaveLength(3);

    // Results should be sorted by score descending
    expect(data[0].score).toBeGreaterThanOrEqual(data[1].score);
    expect(data[1].score).toBeGreaterThanOrEqual(data[2].score);

    // Current file should not be in results
    const paths = data.map((d) => d.path);
    expect(paths).not.toContain("Games/catan.md");

    engine.shutdown();
  });

  test("handles file not found in collection", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", { title: "Catan" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Request a file that exists in pattern but not physically
    const results = await engine.computeRecallWidgets("Games/nonexistent.md");

    // Widget matches pattern but file not found
    expect(results).toHaveLength(1);
    expect(results[0].isEmpty).toBe(true);
    expect(results[0].emptyReason).toContain("File not found");

    engine.shutdown();
  });
});

// =============================================================================
// Expression Evaluation Tests
// =============================================================================

describe("Expression evaluation in widgets", () => {
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

  test("evaluates expressions with collection stats", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "scores.yaml", expressionWidgetYaml);

    // Create games with ratings for z-score calculation
    await writeMarkdownFile(gamesDir, "game1.md", { title: "Game 1", rating: 6 });
    await writeMarkdownFile(gamesDir, "game2.md", { title: "Game 2", rating: 8 });
    await writeMarkdownFile(gamesDir, "game3.md", { title: "Game 3", rating: 10 });
    // Mean = 8, stddev = 1.63 (approx)

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Recall widget for specific item
    const results = await engine.computeRecallWidgets("Games/game3.md");
    expect(results).toHaveLength(1);

    const data = results[0].data as Record<string, unknown>;

    // game3 has rating 10, mean 8, max 10
    // rating_percent = (10 / 10) * 100 = 100
    expect(data.rating_percent).toBe(100);

    // Z-score for rating 10 with mean 8 should be positive
    expect(typeof data.normalized_rating).toBe("number");
    expect(data.normalized_rating as number).toBeGreaterThan(0);

    engine.shutdown();
  });

  test("handles expression errors gracefully", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    const badExpressionYaml = `
name: Bad Expression
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
fields:
  broken:
    expr: "this.nonexistent.deeply.nested + 1"
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "bad.yaml", badExpressionYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game.md");
    expect(results).toHaveLength(1);

    const data = results[0].data as Record<string, unknown>;
    // Expression should fail gracefully and return null
    expect(data.broken).toBeNull();

    engine.shutdown();
  });
});

// =============================================================================
// Caching Tests
// =============================================================================

describe("Widget caching", () => {
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

  test("caches widget results", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 5, rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First computation
    const results1 = await engine.computeGroundWidgets();
    const time1 = results1[0].computeTimeMs!;

    // Second computation should hit cache and be faster
    const results2 = await engine.computeGroundWidgets();
    const time2 = results2[0].computeTimeMs!;

    // Both should return same data
    expect(results1[0].data).toEqual(results2[0].data);

    // Cache hit should be faster (this is a soft check, may vary)
    expect(time2).toBeLessThanOrEqual(time1 + 100); // Allow some variance

    engine.shutdown();
  });

  test("force option bypasses cache", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 5, rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First computation
    await engine.computeGroundWidgets();

    // Force recomputation
    const results = await engine.computeGroundWidgets({ force: true });
    expect(results).toHaveLength(1);
    expect(results[0].isEmpty).toBe(false);

    engine.shutdown();
  });

  test("invalidateWidget clears cache for specific widget", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 5, rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Compute and cache
    await engine.computeGroundWidgets();

    // Invalidate
    engine.invalidateWidget("stats");

    // Should recompute after invalidation
    const stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBe(0);

    engine.shutdown();
  });

  test("invalidateAll clears all cache for vault", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "game1.md", { title: "Game 1", tags: ["a"], rating: 8 });
    await writeMarkdownFile(gamesDir, "game2.md", { title: "Game 2", tags: ["b"], rating: 7 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Compute and cache
    await engine.computeGroundWidgets();
    await engine.computeRecallWidgets("Games/game1.md");

    // Invalidate all
    engine.invalidateAll();

    const stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBe(0);
    expect(stats.similarityEntries).toBe(0);

    engine.shutdown();
  });

  test("getCacheStats returns cache information", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 5, rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Initially empty
    let stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBe(0);

    // After computation
    await engine.computeGroundWidgets();
    stats = engine.getCacheStats();
    expect(stats.widgetEntries).toBeGreaterThan(0);
    expect(stats.usingFallback).toBe(false);

    engine.shutdown();
  });
});

// =============================================================================
// Stale-While-Revalidate Tests
// =============================================================================

describe("Stale-while-revalidate", () => {
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

  test("returns cached results with isStale flag", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", play_count: 5, rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First call computes fresh
    const { results, isStale } = await engine.computeWithStaleWhileRevalidate("ground");

    expect(results).toHaveLength(1);
    // First call may be stale (no cache) or fresh (computed in place)
    expect(typeof isStale).toBe("boolean");

    engine.shutdown();
  });

  test("returns empty for recall without file path", async () => {
    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const { results, isStale } = await engine.computeWithStaleWhileRevalidate("recall");

    expect(results).toHaveLength(0);
    expect(isStale).toBe(false);

    engine.shutdown();
  });
});

// =============================================================================
// Display Config Tests
// =============================================================================

describe("Display configuration in results", () => {
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

  test("includes display config in widget result", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    const tableWidgetYaml = `
name: Games Table
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
fields:
  count:
    count: true
display:
  type: table
  columns:
    - Name
    - Plays
    - Rating
  title: All Games
`;

    await writeWidgetConfig(widgetsDir, "table.yaml", tableWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const display = results[0].display;
    expect(display.type).toBe("table");
    expect(display.columns).toEqual(["Name", "Plays", "Rating"]);
    expect(display.title).toBe("All Games");

    engine.shutdown();
  });

  test("includes editable fields in result", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    const editableWidgetYaml = `
name: Editable Stats
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
fields:
  count:
    count: true
display:
  type: summary-card
editable:
  - field: rating
    type: slider
    label: Rating
    min: 1
    max: 10
`;

    await writeWidgetConfig(widgetsDir, "editable.yaml", editableWidgetYaml);
    await writeMarkdownFile(gamesDir, "game.md", { title: "Game", rating: 8 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results[0].editable).toHaveLength(1);
    expect(results[0].editable![0].field).toBe("rating");
    expect(results[0].editable![0].type).toBe("slider");

    engine.shutdown();
  });
});

// =============================================================================
// Similarity Widget on Ground View
// =============================================================================

describe("Similarity widget summary on ground view", () => {
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

  test("shows collection info for similarity widget on ground", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    const groundSimilarityYaml = `
name: Game Similarity
type: similarity
location: ground
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: tags
    weight: 1.0
    method: jaccard
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "sim.yaml", groundSimilarityYaml);
    await writeMarkdownFile(gamesDir, "game1.md", { title: "Game 1", tags: ["a"] });
    await writeMarkdownFile(gamesDir, "game2.md", { title: "Game 2", tags: ["b"] });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);

    const data = results[0].data as { itemCount: number; dimensions: unknown[]; message: string };
    expect(data.itemCount).toBe(2);
    expect(data.dimensions).toHaveLength(1);
    expect(data.message).toContain("Similarity widget");

    engine.shutdown();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

// =============================================================================
// Public computeSimilarity API Tests
// =============================================================================

describe("computeSimilarity public API", () => {
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

  test("returns similar items for a valid source path", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy", "trading"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading", "family"],
      rating: 6,
    });
    await writeMarkdownFile(gamesDir, "chess.md", {
      title: "Chess",
      tags: ["strategy", "abstract"],
      rating: 9,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const { result, computeTimeMs, cacheHit } = await engine.computeSimilarity(
      "similarity",
      "Games/catan.md"
    );

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBe(2); // monopoly and chess (limit 3, but only 2 other games)
    expect(computeTimeMs).toBeGreaterThan(0);
    expect(cacheHit).toBe(false);

    // Results should be sorted by score descending
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);

    // Should not include the source file itself
    expect(result.map((r) => r.path)).not.toContain("Games/catan.md");

    engine.shutdown();
  });

  test("throws error for non-existent widget", async () => {
    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    try {
      await engine.computeSimilarity("nonexistent", "Games/catan.md");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("Widget not found: nonexistent");
    }

    engine.shutdown();
  });

  test("throws error for non-similarity widget", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    try {
      await engine.computeSimilarity("stats", "Games/catan.md");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("Widget stats is not a similarity widget");
    }

    engine.shutdown();
  });

  test("throws error when engine not initialized", async () => {
    const engine = new WidgetEngine(testDir);

    try {
      await engine.computeSimilarity("similarity", "Games/catan.md");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("Engine not initialized. Call initialize() first.");
    }
  });

  test("returns empty result for missing source file", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const { result, cacheHit } = await engine.computeSimilarity(
      "similarity",
      "Games/nonexistent.md"
    );

    expect(result).toHaveLength(0);
    expect(cacheHit).toBe(false);

    engine.shutdown();
  });

  test("returns empty result when no files match pattern", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    // No Games directory created

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const { result } = await engine.computeSimilarity(
      "similarity",
      "Games/catan.md"
    );

    expect(result).toHaveLength(0);

    engine.shutdown();
  });

  test("caches results and returns from cache on second call", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First call - cache miss
    const first = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(first.cacheHit).toBe(false);

    // Second call - cache hit
    const second = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(second.cacheHit).toBe(true);

    // Results should be identical
    expect(second.result).toEqual(first.result);

    engine.shutdown();
  });
});

// =============================================================================
// handleFilesChanged Tests
// =============================================================================

describe("handleFilesChanged", () => {
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

  test("invalidates cache when matching file changes", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Populate cache
    await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(engine.getCacheStats().similarityEntries).toBeGreaterThan(0);

    // Handle file change
    const result = engine.handleFilesChanged(["Games/catan.md"]);

    expect(result.invalidatedWidgets).toContain("similarity");
    expect(result.totalEntriesInvalidated).toBeGreaterThan(0);

    // Cache should be cleared
    expect(engine.getCacheStats().similarityEntries).toBe(0);

    engine.shutdown();
  });

  test("does not invalidate cache for non-matching files", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");
    const notesDir = await createVaultDir(testDir, "Notes");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
    });
    await writeMarkdownFile(notesDir, "note.md", { title: "A Note" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Populate cache
    await engine.computeSimilarity("similarity", "Games/catan.md");
    const beforeStats = engine.getCacheStats();

    // Handle file change for non-matching pattern
    const result = engine.handleFilesChanged(["Notes/note.md"]);

    expect(result.invalidatedWidgets).toHaveLength(0);
    expect(result.totalEntriesInvalidated).toBe(0);

    // Cache should be unchanged
    expect(engine.getCacheStats().similarityEntries).toBe(beforeStats.similarityEntries);

    engine.shutdown();
  });

  test("handles empty paths array", async () => {
    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const result = engine.handleFilesChanged([]);

    expect(result.invalidatedWidgets).toHaveLength(0);
    expect(result.totalEntriesInvalidated).toBe(0);

    engine.shutdown();
  });

  test("handles uninitalized engine gracefully", () => {
    const engine = new WidgetEngine(testDir);
    // Not initialized

    const result = engine.handleFilesChanged(["Games/catan.md"]);

    expect(result.invalidatedWidgets).toHaveLength(0);
    expect(result.totalEntriesInvalidated).toBe(0);
  });

  test("invalidates multiple widgets when multiple patterns match", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
      play_count: 10,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
      play_count: 5,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Populate both caches
    await engine.computeGroundWidgets();
    await engine.computeSimilarity("similarity", "Games/catan.md");

    // Handle file change
    const result = engine.handleFilesChanged(["Games/catan.md"]);

    // Both widgets should be invalidated (both have pattern Games/**/*.md)
    expect(result.invalidatedWidgets).toContain("similarity");
    expect(result.invalidatedWidgets).toContain("stats");

    engine.shutdown();
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe("Performance benchmarks", () => {
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

  test("cache hit returns in <100ms", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy", "trading"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First call - populate cache
    await engine.computeSimilarity("similarity", "Games/catan.md");

    // Warm up I/O (subsequent calls won't have cold start overhead)
    await engine.computeSimilarity("similarity", "Games/catan.md");

    // Measure cache hit time
    const startTime = performance.now();
    const result = await engine.computeSimilarity("similarity", "Games/catan.md");
    const elapsedMs = performance.now() - startTime;

    expect(result.cacheHit).toBe(true);
    expect(elapsedMs).toBeLessThan(100); // REQ-F-14: <100ms for cached results
    expect(result.computeTimeMs).toBeLessThan(100);

    engine.shutdown();
  });

  test("ground widget cache hit returns in <100ms", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      play_count: 10,
      rating: 8,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First call - populate cache
    await engine.computeGroundWidgets();

    // Measure cache hit time
    const startTime = performance.now();
    const results = await engine.computeGroundWidgets();
    const elapsedMs = performance.now() - startTime;

    expect(results).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(100);
    expect(results[0].computeTimeMs).toBeLessThan(100);

    engine.shutdown();
  });

  test("handles larger collections reasonably", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);

    // Create 50 game files (reasonable for a benchmark test)
    const fileCount = 50;
    for (let i = 0; i < fileCount; i++) {
      await writeMarkdownFile(gamesDir, `game${i}.md`, {
        title: `Game ${i}`,
        tags: [`tag${i % 5}`, `category${i % 3}`],
        rating: (i % 10) + 1,
      });
    }

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // First computation (cache miss)
    const startTime = performance.now();
    const first = await engine.computeSimilarity("similarity", "Games/game0.md");
    const firstElapsed = performance.now() - startTime;

    expect(first.result.length).toBe(3); // limit is 3
    expect(first.cacheHit).toBe(false);

    // Second computation (cache hit) should be faster
    const cacheStartTime = performance.now();
    const second = await engine.computeSimilarity("similarity", "Games/game0.md");
    const cacheElapsed = performance.now() - cacheStartTime;

    expect(second.cacheHit).toBe(true);
    expect(cacheElapsed).toBeLessThan(firstElapsed);
    expect(cacheElapsed).toBeLessThan(100); // Cache hit should be fast

    engine.shutdown();
  });

  test("cache invalidation followed by recomputation works correctly", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);
    await writeMarkdownFile(gamesDir, "catan.md", {
      title: "Catan",
      tags: ["strategy"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "monopoly.md", {
      title: "Monopoly",
      tags: ["trading"],
      rating: 6,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    // Populate cache
    const first = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(first.cacheHit).toBe(false);

    // Verify cache hit
    const second = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(second.cacheHit).toBe(true);

    // Invalidate via file change
    engine.handleFilesChanged(["Games/catan.md"]);

    // Next call should be cache miss
    const third = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(third.cacheHit).toBe(false);

    // And then cache hit again
    const fourth = await engine.computeSimilarity("similarity", "Games/catan.md");
    expect(fourth.cacheHit).toBe(true);

    engine.shutdown();
  });
});

// =============================================================================
// Similarity Aggregator Tests
// =============================================================================

describe("Similarity aggregator", () => {
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

  const similarityWidgetForIncludeYaml = `
name: Game Similarity
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: tags
    weight: 1.0
    method: jaccard
display:
  type: list
  limit: 10
`;

  const aggregateWithSimilarityYaml = `
name: Weighted Rating
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
includes:
  - "Game Similarity"
fields:
  weighted_rating:
    similarity:
      ref: "Game Similarity"
      field: "rating"
display:
  type: meter
  min: 0
  max: 10
`;

  test("computes weighted average using similarity scores", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetForIncludeYaml);
    await writeWidgetConfig(widgetsDir, "weighted.yaml", aggregateWithSimilarityYaml);

    // Create games where we know the similarity and ratings
    // Game A (source): tags = [strategy, trading]
    // Game B: tags = [strategy, trading] -> jaccard = 1.0, rating = 8
    // Game C: tags = [strategy] -> jaccard = 0.5, rating = 10
    // Game D: tags = [trading] -> jaccard = 0.5, rating = 6
    // Expected: (1.0*8 + 0.5*10 + 0.5*6) / (1.0 + 0.5 + 0.5) = (8 + 5 + 3) / 2 = 8

    await writeMarkdownFile(gamesDir, "game-a.md", {
      title: "Game A",
      tags: ["strategy", "trading"],
      rating: 7, // Source file rating (not used in aggregation)
    });
    await writeMarkdownFile(gamesDir, "game-b.md", {
      title: "Game B",
      tags: ["strategy", "trading"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "game-c.md", {
      title: "Game C",
      tags: ["strategy"],
      rating: 10,
    });
    await writeMarkdownFile(gamesDir, "game-d.md", {
      title: "Game D",
      tags: ["trading"],
      rating: 6,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game-a.md");

    // Should have both similarity and aggregate widget results
    expect(results).toHaveLength(2);

    const weightedResult = results.find((r) => r.name === "Weighted Rating");
    expect(weightedResult).toBeDefined();
    expect(weightedResult!.isEmpty).toBe(false);

    const data = weightedResult!.data as Record<string, unknown>;
    // Expected: (1.0*8 + 0.5*10 + 0.5*6) / (1.0 + 0.5 + 0.5) = 16/2 = 8
    expect(data.weighted_rating).toBe(8);

    engine.shutdown();
  });

  test("returns null when referenced widget not in includes", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    // Aggregate widget without including the similarity widget
    const badAggregateYaml = `
name: Bad Weighted
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
fields:
  weighted_rating:
    similarity:
      ref: "Game Similarity"
      field: "rating"
display:
  type: summary-card
`;

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetForIncludeYaml);
    await writeWidgetConfig(widgetsDir, "bad-weighted.yaml", badAggregateYaml);
    await writeMarkdownFile(gamesDir, "game-a.md", {
      title: "Game A",
      tags: ["strategy"],
      rating: 8,
    });
    await writeMarkdownFile(gamesDir, "game-b.md", {
      title: "Game B",
      tags: ["strategy"],
      rating: 9,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game-a.md");

    const badResult = results.find((r) => r.name === "Bad Weighted");
    expect(badResult).toBeDefined();

    const data = badResult!.data as Record<string, unknown>;
    // Should be null because Game Similarity is not in includes
    expect(data.weighted_rating).toBeNull();

    engine.shutdown();
  });

  test("returns null when all similar items have null scores", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetForIncludeYaml);
    await writeWidgetConfig(widgetsDir, "weighted.yaml", aggregateWithSimilarityYaml);

    // Create games where similar games have no rating
    await writeMarkdownFile(gamesDir, "game-a.md", {
      title: "Game A",
      tags: ["strategy"],
      rating: 8, // Source has rating
    });
    await writeMarkdownFile(gamesDir, "game-b.md", {
      title: "Game B",
      tags: ["strategy"],
      // No rating field
    });
    await writeMarkdownFile(gamesDir, "game-c.md", {
      title: "Game C",
      tags: ["strategy"],
      // No rating field
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game-a.md");

    const weightedResult = results.find((r) => r.name === "Weighted Rating");
    const data = weightedResult!.data as Record<string, unknown>;

    // Should be null because no similar items have valid ratings
    expect(data.weighted_rating).toBeNull();

    engine.shutdown();
  });

  test("filters out items with zero similarity", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetForIncludeYaml);
    await writeWidgetConfig(widgetsDir, "weighted.yaml", aggregateWithSimilarityYaml);

    // Game A has no tags in common with others
    await writeMarkdownFile(gamesDir, "game-a.md", {
      title: "Game A",
      tags: ["unique"],
      rating: 5,
    });
    await writeMarkdownFile(gamesDir, "game-b.md", {
      title: "Game B",
      tags: ["different"],
      rating: 10,
    });
    await writeMarkdownFile(gamesDir, "game-c.md", {
      title: "Game C",
      tags: ["other"],
      rating: 10,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game-a.md");

    const weightedResult = results.find((r) => r.name === "Weighted Rating");
    const data = weightedResult!.data as Record<string, unknown>;

    // Should be null because no items have positive similarity
    expect(data.weighted_rating).toBeNull();

    engine.shutdown();
  });

  test("handles nested field paths", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    const aggregateWithNestedFieldYaml = `
name: Weighted BGG Rating
type: aggregate
location: recall
source:
  pattern: "Games/**/*.md"
includes:
  - "Game Similarity"
fields:
  weighted_bgg_rating:
    similarity:
      ref: "Game Similarity"
      field: "bgg.rating"
display:
  type: meter
  min: 0
  max: 10
`;

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetForIncludeYaml);
    await writeWidgetConfig(widgetsDir, "weighted-nested.yaml", aggregateWithNestedFieldYaml);

    await writeMarkdownFile(gamesDir, "game-a.md", {
      title: "Game A",
      tags: ["strategy", "trading"],
      bgg: { rating: 7.0 },
    });
    await writeMarkdownFile(gamesDir, "game-b.md", {
      title: "Game B",
      tags: ["strategy", "trading"], // 100% similar
      bgg: { rating: 8.5 },
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game-a.md");

    const weightedResult = results.find((r) => r.name === "Weighted BGG Rating");
    expect(weightedResult).toBeDefined();

    const data = weightedResult!.data as Record<string, unknown>;
    // Only game-b is similar, with 100% similarity and rating 8.5
    expect(data.weighted_bgg_rating).toBe(8.5);

    engine.shutdown();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
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

  test("handles files without frontmatter", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeFile(join(gamesDir, "no-frontmatter.md"), "# Just a heading\n\nSome content.");

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    expect(results).toHaveLength(1);
    // File counted but all fields are null
    const data = results[0].data as Record<string, unknown>;
    expect(data.total_games).toBe(1);
    expect(data.total_plays).toBe(0); // sum of empty is 0

    engine.shutdown();
  });

  test("handles nested directories in glob pattern", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const deepDir = await createVaultDir(testDir, "Games/BoardGames/Strategy");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(deepDir, "deep-game.md", { title: "Deep Game", play_count: 3, rating: 9 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;
    expect(data.total_games).toBe(1);

    engine.shutdown();
  });

  test("handles special characters in file paths", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    await writeMarkdownFile(gamesDir, "game with spaces.md", { title: "Game", play_count: 1, rating: 5 });
    await writeMarkdownFile(gamesDir, "game-with-dashes.md", { title: "Game", play_count: 2, rating: 6 });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;
    expect(data.total_games).toBe(2);

    engine.shutdown();
  });

  test("extracts title from frontmatter or filename", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "similarity.yaml", similarityWidgetYaml);

    // One with title in frontmatter
    await writeMarkdownFile(gamesDir, "game1.md", {
      title: "Custom Title",
      tags: ["a"],
      rating: 8,
    });
    // One without title (should use filename)
    await writeMarkdownFile(gamesDir, "game-without-title.md", {
      tags: ["a", "b"],
      rating: 7,
    });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeRecallWidgets("Games/game1.md");
    const data = results[0].data as Array<{ title: string; path: string }>;

    // Should find the other game
    const otherGame = data.find((d) => d.path === "Games/game-without-title.md");
    expect(otherGame?.title).toBe("game-without-title");

    engine.shutdown();
  });

  test("handles all null values in aggregation", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const gamesDir = await createVaultDir(testDir, "Games");

    await writeWidgetConfig(widgetsDir, "stats.yaml", aggregateWidgetYaml);
    // All files missing the fields we aggregate
    await writeMarkdownFile(gamesDir, "game1.md", { title: "Game 1" });
    await writeMarkdownFile(gamesDir, "game2.md", { title: "Game 2" });

    const engine = new WidgetEngine(testDir);
    await engine.initialize();

    const results = await engine.computeGroundWidgets();
    const data = results[0].data as Record<string, unknown>;

    expect(data.total_games).toBe(2); // count includes all
    expect(data.total_plays).toBe(0); // sum of nulls is 0
    expect(data.avg_rating).toBeNull(); // avg of no values is null

    engine.shutdown();
  });
});
