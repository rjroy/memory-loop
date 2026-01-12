/**
 * Widget Protocol Schema Tests
 *
 * Tests for widget-related WebSocket message validation using Zod schemas.
 * Tests cover valid messages, invalid messages, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import {
  // Widget supporting schemas
  WidgetDisplayTypeSchema,
  WidgetTypeSchema,
  WidgetLocationSchema,
  WidgetDisplayConfigSchema,
  WidgetEditableTypeSchema,
  WidgetEditableFieldSchema,
  WidgetResultSchema,
  // Client message schemas
  GetGroundWidgetsMessageSchema,
  GetRecallWidgetsMessageSchema,
  WidgetEditMessageSchema,
  ClientMessageSchema,
  // Server message schemas
  GroundWidgetsMessageSchema,
  RecallWidgetsMessageSchema,
  WidgetUpdateMessageSchema,
  WidgetErrorMessageSchema,
  ServerMessageSchema,
} from "../protocol.js";

// =============================================================================
// Widget Display Type Schema Tests
// =============================================================================

describe("WidgetDisplayTypeSchema", () => {
  test("accepts valid display types", () => {
    const validTypes = ["summary-card", "table", "list", "meter"] as const;
    for (const type of validTypes) {
      expect(WidgetDisplayTypeSchema.parse(type)).toBe(type);
    }
  });

  test("rejects invalid display type", () => {
    expect(() => WidgetDisplayTypeSchema.parse("chart")).toThrow(ZodError);
    expect(() => WidgetDisplayTypeSchema.parse("graph")).toThrow(ZodError);
  });

  test("rejects non-string", () => {
    expect(() => WidgetDisplayTypeSchema.parse(123)).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Type Schema Tests
// =============================================================================

describe("WidgetTypeSchema", () => {
  test("accepts valid widget types", () => {
    expect(WidgetTypeSchema.parse("aggregate")).toBe("aggregate");
    expect(WidgetTypeSchema.parse("similarity")).toBe("similarity");
  });

  test("rejects invalid widget type", () => {
    expect(() => WidgetTypeSchema.parse("computed")).toThrow(ZodError);
    expect(() => WidgetTypeSchema.parse("")).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Location Schema Tests
// =============================================================================

describe("WidgetLocationSchema", () => {
  test("accepts valid locations", () => {
    expect(WidgetLocationSchema.parse("ground")).toBe("ground");
    expect(WidgetLocationSchema.parse("recall")).toBe("recall");
  });

  test("rejects invalid location", () => {
    expect(() => WidgetLocationSchema.parse("home")).toThrow(ZodError);
    expect(() => WidgetLocationSchema.parse("browse")).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Display Config Schema Tests
// =============================================================================

describe("WidgetDisplayConfigSchema", () => {
  test("accepts minimal config with type only", () => {
    const config = { type: "summary-card" as const };
    const result = WidgetDisplayConfigSchema.parse(config);
    expect(result.type).toBe("summary-card");
  });

  test("accepts config with all optional fields", () => {
    const config = {
      type: "table" as const,
      title: "Game Statistics",
      columns: ["Name", "Rating", "Play Count"],
      limit: 10,
      min: 0,
      max: 100,
    };
    const result = WidgetDisplayConfigSchema.parse(config);
    expect(result.type).toBe("table");
    expect(result.title).toBe("Game Statistics");
    expect(result.columns).toHaveLength(3);
    expect(result.limit).toBe(10);
  });

  test("accepts meter config with min and max", () => {
    const config = {
      type: "meter" as const,
      min: 0,
      max: 10,
    };
    const result = WidgetDisplayConfigSchema.parse(config);
    expect(result.min).toBe(0);
    expect(result.max).toBe(10);
  });

  test("accepts list config with limit", () => {
    const config = {
      type: "list" as const,
      title: "Similar Games",
      limit: 5,
    };
    const result = WidgetDisplayConfigSchema.parse(config);
    expect(result.limit).toBe(5);
  });

  test("rejects invalid type", () => {
    const config = { type: "invalid" };
    expect(() => WidgetDisplayConfigSchema.parse(config)).toThrow(ZodError);
  });

  test("rejects non-positive limit", () => {
    const config = { type: "list", limit: 0 };
    expect(() => WidgetDisplayConfigSchema.parse(config)).toThrow(ZodError);
  });

  test("rejects negative limit", () => {
    const config = { type: "list", limit: -5 };
    expect(() => WidgetDisplayConfigSchema.parse(config)).toThrow(ZodError);
  });

  test("rejects non-integer limit", () => {
    const config = { type: "list", limit: 5.5 };
    expect(() => WidgetDisplayConfigSchema.parse(config)).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Editable Type Schema Tests
// =============================================================================

describe("WidgetEditableTypeSchema", () => {
  test("accepts valid editable types", () => {
    const validTypes = ["slider", "number", "text", "date", "select"] as const;
    for (const type of validTypes) {
      expect(WidgetEditableTypeSchema.parse(type)).toBe(type);
    }
  });

  test("rejects invalid editable type", () => {
    expect(() => WidgetEditableTypeSchema.parse("checkbox")).toThrow(ZodError);
    expect(() => WidgetEditableTypeSchema.parse("toggle")).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Editable Field Schema Tests
// =============================================================================

describe("WidgetEditableFieldSchema", () => {
  test("accepts minimal editable field config", () => {
    const field = {
      field: "rating",
      type: "number" as const,
      label: "Rating",
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.field).toBe("rating");
    expect(result.type).toBe("number");
    expect(result.label).toBe("Rating");
  });

  test("accepts slider config with min, max, step", () => {
    const field = {
      field: "rating",
      type: "slider" as const,
      label: "Rating",
      min: 1,
      max: 10,
      step: 0.5,
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.min).toBe(1);
    expect(result.max).toBe(10);
    expect(result.step).toBe(0.5);
  });

  test("accepts select config with options", () => {
    const field = {
      field: "status",
      type: "select" as const,
      label: "Status",
      options: ["unplayed", "playing", "completed", "abandoned"],
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.options).toHaveLength(4);
  });

  test("accepts dot-notation field path", () => {
    const field = {
      field: "bgg.play_count",
      type: "number" as const,
      label: "Play Count",
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.field).toBe("bgg.play_count");
  });

  test("accepts field with currentValue", () => {
    const field = {
      field: "rating",
      type: "number" as const,
      label: "Rating",
      currentValue: 8.5,
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.currentValue).toBe(8.5);
  });

  test("rejects empty field path", () => {
    const field = { field: "", type: "number", label: "Rating" };
    expect(() => WidgetEditableFieldSchema.parse(field)).toThrow(ZodError);
  });

  test("rejects empty label", () => {
    const field = { field: "rating", type: "number", label: "" };
    expect(() => WidgetEditableFieldSchema.parse(field)).toThrow(ZodError);
  });

  test("rejects invalid type", () => {
    const field = { field: "rating", type: "checkbox", label: "Rating" };
    expect(() => WidgetEditableFieldSchema.parse(field)).toThrow(ZodError);
  });

  test("rejects non-positive step", () => {
    const field = {
      field: "rating",
      type: "slider",
      label: "Rating",
      step: 0,
    };
    expect(() => WidgetEditableFieldSchema.parse(field)).toThrow(ZodError);
  });

  test("rejects negative step", () => {
    const field = {
      field: "rating",
      type: "slider",
      label: "Rating",
      step: -1,
    };
    expect(() => WidgetEditableFieldSchema.parse(field)).toThrow(ZodError);
  });
});

// =============================================================================
// Widget Result Schema Tests
// =============================================================================

describe("WidgetResultSchema", () => {
  const validBaseWidget = {
    widgetId: "collection-stats",
    name: "Collection Statistics",
    type: "aggregate" as const,
    location: "ground" as const,
    display: { type: "summary-card" as const },
    data: { count: 150, avgRating: 7.5 },
    isEmpty: false,
  };

  test("accepts valid aggregate widget result", () => {
    const result = WidgetResultSchema.parse(validBaseWidget);
    expect(result.widgetId).toBe("collection-stats");
    expect(result.name).toBe("Collection Statistics");
    expect(result.type).toBe("aggregate");
    expect(result.location).toBe("ground");
    expect(result.isEmpty).toBe(false);
  });

  test("accepts valid similarity widget result", () => {
    const widget = {
      ...validBaseWidget,
      widgetId: "similar-games",
      name: "Similar Games",
      type: "similarity" as const,
      location: "recall" as const,
      display: { type: "list" as const, limit: 5 },
      data: [
        { name: "Wingspan", score: 0.95 },
        { name: "Everdell", score: 0.87 },
      ],
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.type).toBe("similarity");
    expect(result.location).toBe("recall");
  });

  test("accepts widget with isEmpty=true and emptyReason", () => {
    const widget = {
      ...validBaseWidget,
      data: null,
      isEmpty: true,
      emptyReason: "No files match the pattern",
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.isEmpty).toBe(true);
    expect(result.emptyReason).toBe("No files match the pattern");
  });

  test("accepts widget with editable fields", () => {
    const widget = {
      ...validBaseWidget,
      editable: [
        {
          field: "rating",
          type: "slider" as const,
          label: "Rating",
          min: 1,
          max: 10,
        },
        {
          field: "status",
          type: "select" as const,
          label: "Status",
          options: ["playing", "completed"],
        },
      ],
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.editable).toHaveLength(2);
    expect(result.editable?.[0].field).toBe("rating");
  });

  test("accepts widget with null data", () => {
    const widget = {
      ...validBaseWidget,
      data: null,
      isEmpty: true,
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.data).toBeNull();
  });

  test("accepts widget with array data", () => {
    const widget = {
      ...validBaseWidget,
      data: [1, 2, 3, 4, 5],
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.data).toEqual([1, 2, 3, 4, 5]);
  });

  test("accepts widget with complex nested data", () => {
    const widget = {
      ...validBaseWidget,
      data: {
        fields: {
          count: 150,
          avgRating: 7.5,
          nested: { deep: { value: 42 } },
        },
      },
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.data).toEqual({
      fields: {
        count: 150,
        avgRating: 7.5,
        nested: { deep: { value: 42 } },
      },
    });
  });

  test("rejects empty widgetId", () => {
    const widget = { ...validBaseWidget, widgetId: "" };
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects empty name", () => {
    const widget = { ...validBaseWidget, name: "" };
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects invalid type", () => {
    const widget = { ...validBaseWidget, type: "computed" };
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects invalid location", () => {
    const widget = { ...validBaseWidget, location: "home" };
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects missing isEmpty field", () => {
    const { isEmpty: _, ...widget } = validBaseWidget;
    void _; // Mark as intentionally unused
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects missing display field", () => {
    const { display: _, ...widget } = validBaseWidget;
    void _; // Mark as intentionally unused
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });

  test("rejects invalid editable field in array", () => {
    const widget = {
      ...validBaseWidget,
      editable: [{ field: "", type: "number", label: "Rating" }], // empty field
    };
    expect(() => WidgetResultSchema.parse(widget)).toThrow(ZodError);
  });
});

// =============================================================================
// Client -> Server Widget Message Tests
// =============================================================================

describe("Client -> Server Widget Messages", () => {
  describe("GetGroundWidgetsMessageSchema", () => {
    test("accepts valid get_ground_widgets message", () => {
      const msg = { type: "get_ground_widgets" as const };
      const result = GetGroundWidgetsMessageSchema.parse(msg);
      expect(result.type).toBe("get_ground_widgets");
    });

    test("ignores extra fields", () => {
      const msg = { type: "get_ground_widgets", extra: "ignored" };
      const result = GetGroundWidgetsMessageSchema.parse(msg);
      expect(result.type).toBe("get_ground_widgets");
      expect((result as Record<string, unknown>).extra).toBeUndefined();
    });
  });

  describe("GetRecallWidgetsMessageSchema", () => {
    test("accepts valid get_recall_widgets message", () => {
      const msg = { type: "get_recall_widgets" as const, path: "Games/wingspan.md" };
      const result = GetRecallWidgetsMessageSchema.parse(msg);
      expect(result.type).toBe("get_recall_widgets");
      expect(result.path).toBe("Games/wingspan.md");
    });

    test("accepts nested path", () => {
      const msg = {
        type: "get_recall_widgets" as const,
        path: "Games/Board Games/Strategy/wingspan.md",
      };
      const result = GetRecallWidgetsMessageSchema.parse(msg);
      expect(result.path).toBe("Games/Board Games/Strategy/wingspan.md");
    });

    test("rejects empty path", () => {
      const msg = { type: "get_recall_widgets", path: "" };
      expect(() => GetRecallWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "get_recall_widgets" };
      expect(() => GetRecallWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("WidgetEditMessageSchema", () => {
    test("accepts valid widget_edit message with string value", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "status",
        value: "completed",
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.type).toBe("widget_edit");
      expect(result.path).toBe("Games/wingspan.md");
      expect(result.field).toBe("status");
      expect(result.value).toBe("completed");
    });

    test("accepts widget_edit with numeric value", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "rating",
        value: 8.5,
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.value).toBe(8.5);
    });

    test("accepts widget_edit with dot-notation field", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "bgg.play_count",
        value: 15,
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.field).toBe("bgg.play_count");
    });

    test("accepts widget_edit with null value", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "rating",
        value: null,
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.value).toBeNull();
    });

    test("accepts widget_edit with date string value", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "last_played",
        value: "2025-01-15",
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.value).toBe("2025-01-15");
    });

    test("accepts widget_edit with array value", () => {
      const msg = {
        type: "widget_edit" as const,
        path: "Games/wingspan.md",
        field: "tags",
        value: ["strategy", "birds", "engine-building"],
      };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.value).toEqual(["strategy", "birds", "engine-building"]);
    });

    test("rejects empty path", () => {
      const msg = { type: "widget_edit", path: "", field: "rating", value: 8 };
      expect(() => WidgetEditMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects empty field", () => {
      const msg = { type: "widget_edit", path: "Games/wingspan.md", field: "", value: 8 };
      expect(() => WidgetEditMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "widget_edit", field: "rating", value: 8 };
      expect(() => WidgetEditMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing field", () => {
      const msg = { type: "widget_edit", path: "Games/wingspan.md", value: 8 };
      expect(() => WidgetEditMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("accepts missing value (undefined)", () => {
      // value is z.unknown() so undefined is valid
      const msg = { type: "widget_edit" as const, path: "Games/wingspan.md", field: "rating" };
      const result = WidgetEditMessageSchema.parse(msg);
      expect(result.value).toBeUndefined();
    });
  });

  describe("ClientMessageSchema includes widget messages", () => {
    test("parses get_ground_widgets via discriminated union", () => {
      const msg = { type: "get_ground_widgets" };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("get_ground_widgets");
    });

    test("parses get_recall_widgets via discriminated union", () => {
      const msg = { type: "get_recall_widgets", path: "Games/wingspan.md" };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("get_recall_widgets");
    });

    test("parses widget_edit via discriminated union", () => {
      const msg = { type: "widget_edit", path: "Games/wingspan.md", field: "rating", value: 8 };
      const result = ClientMessageSchema.parse(msg);
      expect(result.type).toBe("widget_edit");
    });
  });
});

// =============================================================================
// Server -> Client Widget Message Tests
// =============================================================================

describe("Server -> Client Widget Messages", () => {
  const validWidget = {
    widgetId: "collection-stats",
    name: "Collection Statistics",
    type: "aggregate" as const,
    location: "ground" as const,
    display: { type: "summary-card" as const },
    data: { count: 150 },
    isEmpty: false,
  };

  describe("GroundWidgetsMessageSchema", () => {
    test("accepts valid ground_widgets message with widgets", () => {
      const msg = {
        type: "ground_widgets" as const,
        widgets: [validWidget],
      };
      const result = GroundWidgetsMessageSchema.parse(msg);
      expect(result.type).toBe("ground_widgets");
      expect(result.widgets).toHaveLength(1);
      expect(result.widgets[0].widgetId).toBe("collection-stats");
    });

    test("accepts empty widgets array", () => {
      const msg = { type: "ground_widgets" as const, widgets: [] };
      const result = GroundWidgetsMessageSchema.parse(msg);
      expect(result.widgets).toHaveLength(0);
    });

    test("accepts multiple widgets", () => {
      const msg = {
        type: "ground_widgets" as const,
        widgets: [
          validWidget,
          { ...validWidget, widgetId: "another-widget", name: "Another Widget" },
        ],
      };
      const result = GroundWidgetsMessageSchema.parse(msg);
      expect(result.widgets).toHaveLength(2);
    });

    test("rejects invalid widget in array", () => {
      const msg = {
        type: "ground_widgets",
        widgets: [{ ...validWidget, widgetId: "" }],
      };
      expect(() => GroundWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing widgets field", () => {
      const msg = { type: "ground_widgets" };
      expect(() => GroundWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("RecallWidgetsMessageSchema", () => {
    test("accepts valid recall_widgets message", () => {
      const msg = {
        type: "recall_widgets" as const,
        path: "Games/wingspan.md",
        widgets: [{ ...validWidget, location: "recall" as const }],
      };
      const result = RecallWidgetsMessageSchema.parse(msg);
      expect(result.type).toBe("recall_widgets");
      expect(result.path).toBe("Games/wingspan.md");
      expect(result.widgets).toHaveLength(1);
    });

    test("accepts empty widgets array with path", () => {
      const msg = {
        type: "recall_widgets" as const,
        path: "Games/wingspan.md",
        widgets: [],
      };
      const result = RecallWidgetsMessageSchema.parse(msg);
      expect(result.widgets).toHaveLength(0);
      expect(result.path).toBe("Games/wingspan.md");
    });

    test("rejects empty path", () => {
      const msg = { type: "recall_widgets", path: "", widgets: [] };
      expect(() => RecallWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing path", () => {
      const msg = { type: "recall_widgets", widgets: [] };
      expect(() => RecallWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing widgets field", () => {
      const msg = { type: "recall_widgets", path: "Games/wingspan.md" };
      expect(() => RecallWidgetsMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("WidgetUpdateMessageSchema", () => {
    test("accepts valid widget_update message", () => {
      const msg = {
        type: "widget_update" as const,
        widgets: [validWidget],
      };
      const result = WidgetUpdateMessageSchema.parse(msg);
      expect(result.type).toBe("widget_update");
      expect(result.widgets).toHaveLength(1);
    });

    test("accepts empty widgets array", () => {
      const msg = { type: "widget_update" as const, widgets: [] };
      const result = WidgetUpdateMessageSchema.parse(msg);
      expect(result.widgets).toHaveLength(0);
    });

    test("accepts multiple updated widgets", () => {
      const msg = {
        type: "widget_update" as const,
        widgets: [
          validWidget,
          { ...validWidget, widgetId: "similar-games", type: "similarity" as const },
        ],
      };
      const result = WidgetUpdateMessageSchema.parse(msg);
      expect(result.widgets).toHaveLength(2);
    });

    test("rejects missing widgets field", () => {
      const msg = { type: "widget_update" };
      expect(() => WidgetUpdateMessageSchema.parse(msg)).toThrow(ZodError);
    });
  });

  describe("WidgetErrorMessageSchema", () => {
    test("accepts valid widget_error with widgetId", () => {
      const msg = {
        type: "widget_error" as const,
        widgetId: "collection-stats",
        error: "Invalid field path: rating.invalid",
      };
      const result = WidgetErrorMessageSchema.parse(msg);
      expect(result.type).toBe("widget_error");
      expect(result.widgetId).toBe("collection-stats");
      expect(result.error).toBe("Invalid field path: rating.invalid");
    });

    test("accepts widget_error without widgetId (global error)", () => {
      const msg = {
        type: "widget_error" as const,
        error: "Widget configuration directory not found",
      };
      const result = WidgetErrorMessageSchema.parse(msg);
      expect(result.widgetId).toBeUndefined();
      expect(result.error).toBe("Widget configuration directory not found");
    });

    test("rejects empty error message", () => {
      const msg = { type: "widget_error", error: "" };
      expect(() => WidgetErrorMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("rejects missing error field", () => {
      const msg = { type: "widget_error", widgetId: "test" };
      expect(() => WidgetErrorMessageSchema.parse(msg)).toThrow(ZodError);
    });

    test("accepts empty string widgetId (schema allows it)", () => {
      // Empty string widgetId is technically valid (no min constraint)
      const msg = { type: "widget_error" as const, widgetId: "", error: "Error" };
      const result = WidgetErrorMessageSchema.parse(msg);
      expect(result.widgetId).toBe("");
    });
  });

  describe("ServerMessageSchema includes widget messages", () => {
    test("parses ground_widgets via discriminated union", () => {
      const msg = { type: "ground_widgets", widgets: [] };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("ground_widgets");
    });

    test("parses recall_widgets via discriminated union", () => {
      const msg = { type: "recall_widgets", path: "Games/wingspan.md", widgets: [] };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("recall_widgets");
    });

    test("parses widget_update via discriminated union", () => {
      const msg = { type: "widget_update", widgets: [] };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("widget_update");
    });

    test("parses widget_error via discriminated union", () => {
      const msg = { type: "widget_error", error: "Test error" };
      const result = ServerMessageSchema.parse(msg);
      expect(result.type).toBe("widget_error");
    });
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe("Widget Schema Edge Cases", () => {
  test("handles widget with unicode in name", () => {
    const widget = {
      widgetId: "game-stats",
      name: "Game Statistics \u{1F3B2}",
      type: "aggregate" as const,
      location: "ground" as const,
      display: { type: "summary-card" as const },
      data: {},
      isEmpty: false,
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.name).toContain("\u{1F3B2}");
  });

  test("handles very long widget name", () => {
    const widget = {
      widgetId: "game-stats",
      name: "a".repeat(1000),
      type: "aggregate" as const,
      location: "ground" as const,
      display: { type: "summary-card" as const },
      data: {},
      isEmpty: false,
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.name.length).toBe(1000);
  });

  test("handles widget with special characters in field path", () => {
    const field = {
      field: "my-field_name.sub-field",
      type: "number" as const,
      label: "Special Field",
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.field).toBe("my-field_name.sub-field");
  });

  test("handles widget_edit with deeply nested field path", () => {
    const msg = {
      type: "widget_edit" as const,
      path: "Games/wingspan.md",
      field: "metadata.bgg.stats.rating.average",
      value: 8.1,
    };
    const result = WidgetEditMessageSchema.parse(msg);
    expect(result.field).toBe("metadata.bgg.stats.rating.average");
  });

  test("handles widget with very large data object", () => {
    const largeData: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      largeData[`field_${i}`] = i;
    }
    const widget = {
      widgetId: "large-widget",
      name: "Large Widget",
      type: "aggregate" as const,
      location: "ground" as const,
      display: { type: "summary-card" as const },
      data: largeData,
      isEmpty: false,
    };
    const result = WidgetResultSchema.parse(widget);
    expect(Object.keys(result.data as Record<string, number>).length).toBe(1000);
  });

  test("handles widget with empty emptyReason when isEmpty is true", () => {
    const widget = {
      widgetId: "empty-widget",
      name: "Empty Widget",
      type: "aggregate" as const,
      location: "ground" as const,
      display: { type: "summary-card" as const },
      data: null,
      isEmpty: true,
      emptyReason: "",
    };
    const result = WidgetResultSchema.parse(widget);
    expect(result.emptyReason).toBe("");
  });

  test("handles display config with empty columns array", () => {
    const config = {
      type: "table" as const,
      columns: [],
    };
    // Empty columns array is valid at schema level (runtime validation handles it)
    const result = WidgetDisplayConfigSchema.parse(config);
    expect(result.columns).toHaveLength(0);
  });

  test("handles editable field with negative min value", () => {
    const field = {
      field: "temperature",
      type: "number" as const,
      label: "Temperature",
      min: -273.15,
      max: 1000,
    };
    const result = WidgetEditableFieldSchema.parse(field);
    expect(result.min).toBe(-273.15);
  });

  test("handles recall widgets with path containing spaces", () => {
    const msg = {
      type: "recall_widgets" as const,
      path: "My Games/Board Games/wingspan.md",
      widgets: [],
    };
    const result = RecallWidgetsMessageSchema.parse(msg);
    expect(result.path).toBe("My Games/Board Games/wingspan.md");
  });
});
