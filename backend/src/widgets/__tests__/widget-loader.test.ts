/**
 * Widget Loader Tests
 *
 * Unit tests for widget configuration discovery and loading.
 * Uses filesystem operations in temp directories.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWidgetConfigs,
  loadWidgetFile,
  validateWidgetConfig,
  WIDGETS_DIR,
  WIDGET_FILE_EXTENSIONS,
} from "../widget-loader";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `widget-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
 * Writes a widget config file.
 */
async function writeWidgetConfig(
  widgetsDir: string,
  filename: string,
  content: string
): Promise<void> {
  await writeFile(join(widgetsDir, filename), content);
}

// =============================================================================
// Valid Widget Config Fixtures
// =============================================================================

const validAggregateYaml = `
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
display:
  type: summary-card
`;

const validSimilarityYaml = `
name: Similar Games
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: mechanics
    weight: 0.5
    method: jaccard
  - field: player_count
    weight: 0.3
    method: proximity
display:
  type: list
  limit: 5
`;

// =============================================================================
// loadWidgetConfigs Tests
// =============================================================================

describe("loadWidgetConfigs", () => {
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

  test("returns empty result when widgets directory does not exist", async () => {
    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.hasWidgetsDir).toBe(false);
  });

  test("returns empty widgets when directory exists but is empty", async () => {
    await createWidgetsDir(testDir);
    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.hasWidgetsDir).toBe(true);
  });

  test("loads single valid widget config", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "collection-stats.yaml", validAggregateYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.hasWidgetsDir).toBe(true);

    const widget = result.widgets[0];
    expect(widget.id).toBe("collection-stats");
    expect(widget.config.name).toBe("Collection Stats");
    expect(widget.config.type).toBe("aggregate");
  });

  test("loads multiple valid widget configs", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "collection-stats.yaml", validAggregateYaml);
    await writeWidgetConfig(widgetsDir, "similar-games.yaml", validSimilarityYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  test("handles .yml extension", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "collection-stats.yml", validAggregateYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].id).toBe("collection-stats");
  });

  test("ignores non-YAML files", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "collection-stats.yaml", validAggregateYaml);
    await writeWidgetConfig(widgetsDir, "readme.md", "# Widgets");
    await writeWidgetConfig(widgetsDir, "config.json", "{}");

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
  });

  test("reports validation errors with file path", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const invalidYaml = `
name: Invalid Widget
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
# Missing required 'fields' for aggregate type
display:
  type: summary-card
`;
    await writeWidgetConfig(widgetsDir, "invalid.yaml", invalidYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe("invalid");
    expect(result.errors[0].error).toContain("at least one field");
  });

  test("reports YAML parse errors", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const malformedYaml = `
name: Broken Widget
  type: aggregate # indentation error
location: ground
`;
    await writeWidgetConfig(widgetsDir, "broken.yaml", malformedYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("YAML parse error");
  });

  test("handles empty YAML files", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "empty.yaml", "");

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("empty");
  });

  test("handles YAML with only comments", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "comments-only.yaml", "# This is just a comment\n# Another comment");

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("empty");
  });

  test("separates valid and invalid configs", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "valid.yaml", validAggregateYaml);
    await writeWidgetConfig(widgetsDir, "invalid.yaml", "name: ''"); // empty name

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.widgets[0].id).toBe("valid");
    expect(result.errors[0].id).toBe("invalid");
  });

  test("includes relative file path in results", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "test-widget.yaml", validAggregateYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets[0].filePath).toBe(".memory-loop/widgets/test-widget.yaml");
  });
});

// =============================================================================
// loadWidgetFile Tests
// =============================================================================

describe("loadWidgetFile", () => {
  let testDir: string;
  let widgetsDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    widgetsDir = await createWidgetsDir(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("loads valid config successfully", async () => {
    await writeWidgetConfig(widgetsDir, "test.yaml", validAggregateYaml);

    const result = await loadWidgetFile(widgetsDir, "test.yaml");
    expect(result.id).toBe("test");
    expect(result.config).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.config?.name).toBe("Collection Stats");
  });

  test("returns error for non-existent file", async () => {
    const result = await loadWidgetFile(widgetsDir, "missing.yaml");
    expect(result.id).toBe("missing");
    expect(result.config).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to read file");
  });

  test("returns error for invalid YAML syntax", async () => {
    await writeWidgetConfig(widgetsDir, "bad-syntax.yaml", "{ invalid yaml: [");

    const result = await loadWidgetFile(widgetsDir, "bad-syntax.yaml");
    expect(result.config).toBeUndefined();
    expect(result.error).toContain("YAML parse error");
  });

  test("returns error for schema validation failure", async () => {
    const invalidConfig = `
name: Test
type: invalid_type
location: ground
source:
  pattern: "*.md"
display:
  type: summary-card
`;
    await writeWidgetConfig(widgetsDir, "invalid-schema.yaml", invalidConfig);

    const result = await loadWidgetFile(widgetsDir, "invalid-schema.yaml");
    expect(result.config).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test("extracts widget ID from .yaml extension", async () => {
    await writeWidgetConfig(widgetsDir, "my-widget.yaml", validAggregateYaml);

    const result = await loadWidgetFile(widgetsDir, "my-widget.yaml");
    expect(result.id).toBe("my-widget");
  });

  test("extracts widget ID from .yml extension", async () => {
    await writeWidgetConfig(widgetsDir, "my-widget.yml", validAggregateYaml);

    const result = await loadWidgetFile(widgetsDir, "my-widget.yml");
    expect(result.id).toBe("my-widget");
  });
});

// =============================================================================
// validateWidgetConfig Tests
// =============================================================================

describe("validateWidgetConfig", () => {
  test("returns validated config for valid input", () => {
    const config = {
      name: "Test Widget",
      type: "aggregate",
      location: "ground",
      source: { pattern: "*.md" },
      fields: { count: { count: true } },
      display: { type: "summary-card" },
    };

    const result = validateWidgetConfig(config);
    expect(result.name).toBe("Test Widget");
    expect(result.type).toBe("aggregate");
  });

  test("throws Error with actionable message for invalid input", () => {
    const invalidConfig = { name: "" };

    expect(() => validateWidgetConfig(invalidConfig)).toThrow("Invalid widget config");
  });

  test("error message includes field paths", () => {
    const invalidConfig = {
      name: "Test",
      type: "aggregate",
      location: "ground",
      source: { pattern: "" },
      fields: { count: { count: true } },
      display: { type: "summary-card" },
    };

    try {
      validateWidgetConfig(invalidConfig);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toContain("source.pattern");
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
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

  test("handles widgets directory that is a file, not directory", async () => {
    // Create .memory-loop/widgets as a file instead of directory
    const memoryLoopDir = join(testDir, ".memory-loop");
    await mkdir(memoryLoopDir, { recursive: true });
    await writeFile(join(memoryLoopDir, "widgets"), "not a directory");

    const result = await loadWidgetConfigs(testDir);
    expect(result.hasWidgetsDir).toBe(false);
    expect(result.widgets).toHaveLength(0);
  });

  test("handles widget files with uppercase extensions", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    await writeWidgetConfig(widgetsDir, "test.YAML", validAggregateYaml);

    const result = await loadWidgetConfigs(testDir);
    // The file should still be recognized (case-insensitive extension matching)
    expect(result.widgets).toHaveLength(1);
  });

  test("handles widget with all optional fields", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const minimalYaml = `
name: Minimal Widget
type: aggregate
location: ground
source:
  pattern: "*.md"
fields:
  count:
    count: true
display:
  type: summary-card
`;
    await writeWidgetConfig(widgetsDir, "minimal.yaml", minimalYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].config.editable).toBeUndefined();
  });

  test("handles widget with editable fields", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const editableYaml = `
name: Editable Widget
type: aggregate
location: ground
source:
  pattern: "*.md"
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
    await writeWidgetConfig(widgetsDir, "editable.yaml", editableYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].config.editable).toHaveLength(1);
    expect(result.widgets[0].config.editable?.[0].field).toBe("rating");
  });

  test("handles nested frontmatter field paths in dimensions", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const nestedFieldsYaml = `
name: Nested Fields Widget
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: bgg.mechanics
    weight: 0.5
    method: jaccard
  - field: bgg.categories
    weight: 0.3
    method: jaccard
display:
  type: list
  limit: 10
`;
    await writeWidgetConfig(widgetsDir, "nested.yaml", nestedFieldsYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].config.dimensions?.[0].field).toBe("bgg.mechanics");
  });

  test("handles source filter", async () => {
    const widgetsDir = await createWidgetsDir(testDir);
    const filteredYaml = `
name: Filtered Widget
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
  filter:
    status: owned
    rating:
      $gte: 7
fields:
  count:
    count: true
display:
  type: summary-card
`;
    await writeWidgetConfig(widgetsDir, "filtered.yaml", filteredYaml);

    const result = await loadWidgetConfigs(testDir);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].config.source.filter).toBeDefined();
    expect(result.widgets[0].config.source.filter?.status).toBe("owned");
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("Constants", () => {
  test("WIDGETS_DIR is correct path", () => {
    expect(WIDGETS_DIR).toBe(".memory-loop/widgets");
  });

  test("WIDGET_FILE_EXTENSIONS includes yaml and yml", () => {
    expect(WIDGET_FILE_EXTENSIONS).toContain(".yaml");
    expect(WIDGET_FILE_EXTENSIONS).toContain(".yml");
  });
});
