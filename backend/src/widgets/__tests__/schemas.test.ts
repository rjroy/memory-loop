/**
 * Widget Schemas Tests
 *
 * Unit tests for widget configuration Zod schemas.
 * Tests validation of valid/invalid configs and error message formatting.
 */

import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import {
  WidgetConfigSchema,
  FieldConfigSchema,
  DimensionConfigSchema,
  DisplayConfigSchema,
  EditableFieldSchema,
  SourceConfigSchema,
  parseWidgetConfig,
  safeParseWidgetConfig,
  formatValidationError,
  type WidgetConfig,
} from "../schemas";

// =============================================================================
// FieldConfigSchema Tests
// =============================================================================

describe("FieldConfigSchema", () => {
  test("accepts count field", () => {
    const result = FieldConfigSchema.safeParse({ count: true });
    expect(result.success).toBe(true);
  });

  test("accepts sum field with field path", () => {
    const result = FieldConfigSchema.safeParse({ sum: "bgg.play_count" });
    expect(result.success).toBe(true);
  });

  test("accepts avg field", () => {
    const result = FieldConfigSchema.safeParse({ avg: "rating" });
    expect(result.success).toBe(true);
  });

  test("accepts min field", () => {
    const result = FieldConfigSchema.safeParse({ min: "price" });
    expect(result.success).toBe(true);
  });

  test("accepts max field", () => {
    const result = FieldConfigSchema.safeParse({ max: "score" });
    expect(result.success).toBe(true);
  });

  test("accepts stddev field", () => {
    const result = FieldConfigSchema.safeParse({ stddev: "rating" });
    expect(result.success).toBe(true);
  });

  test("accepts expression field", () => {
    const result = FieldConfigSchema.safeParse({
      expr: "zscore(this.rating, stats.rating_mean, stats.rating_stddev)",
    });
    expect(result.success).toBe(true);
  });

  test("accepts multiple aggregations", () => {
    const result = FieldConfigSchema.safeParse({
      sum: "play_count",
      avg: "rating",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty object", () => {
    const result = FieldConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("at least one operation");
    }
  });

  test("rejects count: false (must be true)", () => {
    const result = FieldConfigSchema.safeParse({ count: false });
    expect(result.success).toBe(false);
  });

  test("accepts similarity aggregator with ref and field", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { ref: "Similar Games", field: "rating" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts similarity aggregator with nested field path", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { ref: "Similar Games", field: "bgg.rating" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects similarity aggregator without ref", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { field: "rating" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects similarity aggregator without field", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { ref: "Similar Games" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects similarity aggregator with empty ref", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { ref: "", field: "rating" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects similarity aggregator with empty field", () => {
    const result = FieldConfigSchema.safeParse({
      similarity: { ref: "Similar Games", field: "" },
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DimensionConfigSchema Tests
// =============================================================================

describe("DimensionConfigSchema", () => {
  test("accepts valid dimension", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "mechanics",
      weight: 0.5,
      method: "jaccard",
    });
    expect(result.success).toBe(true);
  });

  test("accepts proximity method", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "player_count",
      weight: 0.3,
      method: "proximity",
    });
    expect(result.success).toBe(true);
  });

  test("accepts cosine method", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "features",
      weight: 1.0,
      method: "cosine",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty field", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "",
      weight: 0.5,
      method: "jaccard",
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative weight", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "tags",
      weight: -0.5,
      method: "jaccard",
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero weight", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "tags",
      weight: 0,
      method: "jaccard",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid method", () => {
    const result = DimensionConfigSchema.safeParse({
      field: "tags",
      weight: 0.5,
      method: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DisplayConfigSchema Tests
// =============================================================================

describe("DisplayConfigSchema", () => {
  test("accepts summary-card type", () => {
    const result = DisplayConfigSchema.safeParse({ type: "summary-card" });
    expect(result.success).toBe(true);
  });

  test("accepts list type with limit", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "list",
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  test("accepts table type with columns", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "table",
      columns: ["name", "rating", "play_count"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects table type without columns", () => {
    const result = DisplayConfigSchema.safeParse({ type: "table" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("requires at least one column");
    }
  });

  test("rejects table type with empty columns array", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "table",
      columns: [],
    });
    expect(result.success).toBe(false);
  });

  test("accepts meter type with min and max", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "meter",
      min: 0,
      max: 100,
    });
    expect(result.success).toBe(true);
  });

  test("rejects meter type without min", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "meter",
      max: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("requires both min and max");
    }
  });

  test("rejects meter type without max", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "meter",
      min: 0,
    });
    expect(result.success).toBe(false);
  });

  test("accepts optional title", () => {
    const result = DisplayConfigSchema.safeParse({
      type: "summary-card",
      title: "Collection Statistics",
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// EditableFieldSchema Tests
// =============================================================================

describe("EditableFieldSchema", () => {
  test("accepts slider with min and max", () => {
    const result = EditableFieldSchema.safeParse({
      field: "rating",
      type: "slider",
      label: "Rating",
      min: 1,
      max: 10,
    });
    expect(result.success).toBe(true);
  });

  test("rejects slider without min", () => {
    const result = EditableFieldSchema.safeParse({
      field: "rating",
      type: "slider",
      label: "Rating",
      max: 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("requires both min and max");
    }
  });

  test("accepts number type without min/max", () => {
    const result = EditableFieldSchema.safeParse({
      field: "play_count",
      type: "number",
      label: "Play Count",
    });
    expect(result.success).toBe(true);
  });

  test("accepts number type with optional step", () => {
    const result = EditableFieldSchema.safeParse({
      field: "price",
      type: "number",
      label: "Price",
      min: 0,
      step: 0.01,
    });
    expect(result.success).toBe(true);
  });

  test("accepts text type", () => {
    const result = EditableFieldSchema.safeParse({
      field: "notes",
      type: "text",
      label: "Notes",
    });
    expect(result.success).toBe(true);
  });

  test("accepts date type", () => {
    const result = EditableFieldSchema.safeParse({
      field: "last_played",
      type: "date",
      label: "Last Played",
    });
    expect(result.success).toBe(true);
  });

  test("accepts select type with options", () => {
    const result = EditableFieldSchema.safeParse({
      field: "status",
      type: "select",
      label: "Status",
      options: ["owned", "wishlist", "sold"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects select type without options", () => {
    const result = EditableFieldSchema.safeParse({
      field: "status",
      type: "select",
      label: "Status",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("requires at least one option");
    }
  });

  test("rejects select type with empty options", () => {
    const result = EditableFieldSchema.safeParse({
      field: "status",
      type: "select",
      label: "Status",
      options: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty field path", () => {
    const result = EditableFieldSchema.safeParse({
      field: "",
      type: "text",
      label: "Notes",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty label", () => {
    const result = EditableFieldSchema.safeParse({
      field: "notes",
      type: "text",
      label: "",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// SourceConfigSchema Tests
// =============================================================================

describe("SourceConfigSchema", () => {
  test("accepts pattern only", () => {
    const result = SourceConfigSchema.safeParse({
      pattern: "Games/**/*.md",
    });
    expect(result.success).toBe(true);
  });

  test("accepts pattern with filter", () => {
    const result = SourceConfigSchema.safeParse({
      pattern: "Books/*.md",
      filter: { status: "reading" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty pattern", () => {
    const result = SourceConfigSchema.safeParse({
      pattern: "",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// WidgetConfigSchema Tests
// =============================================================================

describe("WidgetConfigSchema", () => {
  const validAggregateWidget: WidgetConfig = {
    name: "Collection Stats",
    type: "aggregate",
    location: "ground",
    source: { pattern: "Games/**/*.md" },
    fields: {
      total_games: { count: true },
      total_plays: { sum: "play_count" },
    },
    display: { type: "summary-card" },
  };

  const validSimilarityWidget: WidgetConfig = {
    name: "Similar Games",
    type: "similarity",
    location: "recall",
    source: { pattern: "Games/**/*.md" },
    dimensions: [
      { field: "mechanics", weight: 0.5, method: "jaccard" },
      { field: "player_count", weight: 0.3, method: "proximity" },
    ],
    display: { type: "list", limit: 5 },
  };

  test("accepts valid aggregate widget", () => {
    const result = WidgetConfigSchema.safeParse(validAggregateWidget);
    expect(result.success).toBe(true);
  });

  test("accepts valid similarity widget", () => {
    const result = WidgetConfigSchema.safeParse(validSimilarityWidget);
    expect(result.success).toBe(true);
  });

  test("rejects aggregate widget without fields", () => {
    const config = { ...validAggregateWidget, fields: undefined };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("at least one field");
    }
  });

  test("rejects aggregate widget with empty fields", () => {
    const config = { ...validAggregateWidget, fields: {} };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("rejects similarity widget without dimensions", () => {
    const config = { ...validSimilarityWidget, dimensions: undefined };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("at least one dimension");
    }
  });

  test("rejects similarity widget with empty dimensions", () => {
    const config = { ...validSimilarityWidget, dimensions: [] };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("rejects empty name", () => {
    const config = { ...validAggregateWidget, name: "" };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("rejects invalid type", () => {
    const config = { ...validAggregateWidget, type: "invalid" };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("rejects invalid location", () => {
    const config = { ...validAggregateWidget, location: "invalid" };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("accepts widget with editable fields", () => {
    const config = {
      ...validAggregateWidget,
      editable: [
        {
          field: "rating",
          type: "slider",
          label: "Rating",
          min: 1,
          max: 10,
        },
      ],
    };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("accepts ground location", () => {
    const config = { ...validAggregateWidget, location: "ground" };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe("ground");
    }
  });

  test("accepts recall location", () => {
    const config = { ...validSimilarityWidget, location: "recall" };
    const result = WidgetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe("recall");
    }
  });
});

// =============================================================================
// parseWidgetConfig Tests
// =============================================================================

describe("parseWidgetConfig", () => {
  test("returns valid config", () => {
    const config = {
      name: "Test Widget",
      type: "aggregate",
      location: "ground",
      source: { pattern: "*.md" },
      fields: { count: { count: true } },
      display: { type: "summary-card" },
    };
    const result = parseWidgetConfig(config);
    expect(result.name).toBe("Test Widget");
    expect(result.type).toBe("aggregate");
  });

  test("throws ZodError on invalid config", () => {
    const invalidConfig = { name: "" };
    expect(() => parseWidgetConfig(invalidConfig)).toThrow(ZodError);
  });
});

// =============================================================================
// safeParseWidgetConfig Tests
// =============================================================================

describe("safeParseWidgetConfig", () => {
  test("returns success result for valid config", () => {
    const config = {
      name: "Test Widget",
      type: "aggregate",
      location: "ground",
      source: { pattern: "*.md" },
      fields: { count: { count: true } },
      display: { type: "summary-card" },
    };
    const result = safeParseWidgetConfig(config);
    expect(result.success).toBe(true);
  });

  test("returns error result for invalid config", () => {
    const invalidConfig = { name: "" };
    const result = safeParseWidgetConfig(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// formatValidationError Tests
// =============================================================================

describe("formatValidationError", () => {
  test("includes file path in message", () => {
    const result = safeParseWidgetConfig({ name: "" });
    if (!result.success) {
      const message = formatValidationError(result.error, "widgets/test.yaml");
      expect(message).toContain("widgets/test.yaml");
    }
  });

  test("includes field path in message", () => {
    const result = safeParseWidgetConfig({
      name: "Test",
      type: "aggregate",
      location: "ground",
      source: { pattern: "" },
      fields: { count: { count: true } },
      display: { type: "summary-card" },
    });
    if (!result.success) {
      const message = formatValidationError(result.error);
      expect(message).toContain("source.pattern");
    }
  });

  test("formats multiple errors", () => {
    const result = safeParseWidgetConfig({});
    if (!result.success) {
      const message = formatValidationError(result.error);
      expect(message.split("\n").length).toBeGreaterThan(1);
    }
  });

  test("handles root-level errors", () => {
    // This creates a refinement error at root level
    const result = safeParseWidgetConfig({
      name: "Test",
      type: "aggregate",
      location: "ground",
      source: { pattern: "*.md" },
      fields: {},
      display: { type: "summary-card" },
    });
    if (!result.success) {
      const message = formatValidationError(result.error);
      expect(message).toContain("at least one field");
    }
  });
});
