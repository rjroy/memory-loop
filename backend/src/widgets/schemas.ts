/**
 * Widget Configuration Schemas
 *
 * Zod schemas for validating widget configuration files.
 * Widgets are defined in `.memory-loop/widgets/*.yaml` within vaults.
 *
 * Spec Requirements:
 * - REQ-F-1: Vaults define widgets in `.memory-loop/widgets/*.yaml` files
 * - REQ-F-3: Invalid configs produce actionable error messages
 * - REQ-F-4: Widget configs specify source files, fields, computations, display type, and location
 */

import { z } from "zod";

// =============================================================================
// Similarity Method Schema
// =============================================================================

/**
 * Methods for computing similarity between items (REQ-F-13).
 * - jaccard: Set overlap for array/tag fields
 * - proximity: Numeric distance (closer values = more similar)
 * - cosine: Vector similarity for multi-dimensional comparison
 */
export const SimilarityMethodSchema = z.enum(["jaccard", "proximity", "cosine"]);

// =============================================================================
// Widget Type Schema
// =============================================================================

/**
 * Types of widget computation (REQ-F-4).
 * - aggregate: Collection-level statistics (sum, avg, count, etc.)
 * - similarity: Per-item similarity ranking against other items
 */
export const WidgetTypeSchema = z.enum(["aggregate", "similarity"]);

// =============================================================================
// Widget Location Schema
// =============================================================================

/**
 * Display locations for widgets (REQ-F-16, REQ-F-17).
 * - ground: Appears on Home/Ground view (global dashboard)
 * - recall: Appears on Browse/Recall view when viewing a matching file
 */
export const WidgetLocationSchema = z.enum(["ground", "recall"]);

// =============================================================================
// Display Type Schema
// =============================================================================

/**
 * Display component types (REQ-F-18).
 * - summary-card: Key-value pairs for collection stats
 * - table: Rows/columns for ranked lists
 * - list: Ordered items for similar items
 * - meter: Single value with scale (e.g., HEPCAT score)
 */
export const DisplayTypeSchema = z.enum(["summary-card", "table", "list", "meter"]);

// =============================================================================
// Editable Field Type Schema
// =============================================================================

/**
 * Input types for editable frontmatter fields (REQ-F-20).
 */
export const EditableTypeSchema = z.enum(["slider", "number", "text", "date", "select"]);

// =============================================================================
// Field Configuration Schema
// =============================================================================

/**
 * Configuration for a computed field (REQ-F-7, REQ-F-8, REQ-F-10).
 * Supports simple aggregations (count, sum, avg, min, max, stddev)
 * and expression-based computations.
 */
export const FieldConfigSchema = z
  .object({
    // Simple aggregations - each specifies the field path to aggregate
    count: z.boolean().optional(),
    sum: z.string().optional(),
    avg: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    stddev: z.string().optional(),

    // Expression-based computation (REQ-F-8, REQ-F-11)
    expr: z.string().optional(),
  })
  .refine(
    (data) => {
      // At least one field operation must be specified
      const hasAggregation =
        data.count === true ||
        data.sum !== undefined ||
        data.avg !== undefined ||
        data.min !== undefined ||
        data.max !== undefined ||
        data.stddev !== undefined;
      const hasExpression = data.expr !== undefined;
      return hasAggregation || hasExpression;
    },
    {
      message:
        "Field config must specify at least one operation: count, sum, avg, min, max, stddev, or expr",
    }
  );

// =============================================================================
// Dimension Configuration Schema
// =============================================================================

/**
 * Configuration for a similarity dimension (REQ-F-12).
 * Dimensions define how similarity is computed between items.
 */
export const DimensionConfigSchema = z.object({
  /** Frontmatter field path (e.g., "tags" or "bgg.mechanics") */
  field: z.string().min(1, "Dimension field is required"),

  /** Weight of this dimension in overall similarity (0-1 recommended) */
  weight: z.number().positive("Weight must be positive"),

  /** Similarity computation method */
  method: SimilarityMethodSchema,
});

// =============================================================================
// Display Configuration Schema
// =============================================================================

/**
 * Configuration for widget display (REQ-F-18, REQ-F-19).
 */
export const DisplayConfigSchema = z
  .object({
    /** Display component type */
    type: DisplayTypeSchema,

    /** Optional custom title (defaults to widget name) */
    title: z.string().optional(),

    /** Column names for table display */
    columns: z.array(z.string()).optional(),

    /** Maximum items for list display */
    limit: z.number().int().positive().optional(),

    /** Minimum value for meter display */
    min: z.number().optional(),

    /** Maximum value for meter display */
    max: z.number().optional(),
  })
  .refine(
    (data) => {
      // Table type requires columns
      if (data.type === "table" && (!data.columns || data.columns.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "Table display type requires at least one column",
      path: ["columns"],
    }
  )
  .refine(
    (data) => {
      // Meter type requires min and max
      if (data.type === "meter" && (data.min === undefined || data.max === undefined)) {
        return false;
      }
      return true;
    },
    {
      message: "Meter display type requires both min and max values",
      path: ["min"],
    }
  );

// =============================================================================
// Editable Field Schema
// =============================================================================

/**
 * Configuration for an editable frontmatter field (REQ-F-20, REQ-F-21).
 */
export const EditableFieldSchema = z
  .object({
    /** Frontmatter field path to edit (e.g., "rating" or "status") */
    field: z.string().min(1, "Editable field path is required"),

    /** Input type for editing */
    type: EditableTypeSchema,

    /** User-facing label for the input */
    label: z.string().min(1, "Editable field label is required"),

    /** Options for select type */
    options: z.array(z.string()).optional(),

    /** Minimum value for slider/number types */
    min: z.number().optional(),

    /** Maximum value for slider/number types */
    max: z.number().optional(),

    /** Step increment for slider/number types */
    step: z.number().positive().optional(),
  })
  .refine(
    (data) => {
      // Select type requires options
      if (data.type === "select" && (!data.options || data.options.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "Select type requires at least one option",
      path: ["options"],
    }
  )
  .refine(
    (data) => {
      // Slider type requires min and max
      if (data.type === "slider" && (data.min === undefined || data.max === undefined)) {
        return false;
      }
      return true;
    },
    {
      message: "Slider type requires both min and max values",
      path: ["min"],
    }
  );

// =============================================================================
// Source Configuration Schema
// =============================================================================

/**
 * Configuration for widget data source (REQ-F-5).
 */
export const SourceConfigSchema = z.object({
  /** Glob pattern for matching vault files (e.g., Games/**.md) */
  pattern: z.string().min(1, "Source pattern is required"),

  /** Optional frontmatter filters to further narrow files */
  filter: z.record(z.string(), z.unknown()).optional(),
});

// =============================================================================
// Widget Configuration Schema
// =============================================================================

/**
 * Complete widget configuration (REQ-F-4).
 * This is the main schema for validating widget YAML files.
 */
export const WidgetConfigSchema = z
  .object({
    /** Human-readable widget name */
    name: z.string().min(1, "Widget name is required"),

    /** Computation type */
    type: WidgetTypeSchema,

    /** Display location */
    location: WidgetLocationSchema,

    /** Data source configuration */
    source: SourceConfigSchema,

    /** Field computations for aggregate widgets */
    fields: z.record(z.string(), FieldConfigSchema).optional(),

    /** Similarity dimensions for similarity widgets */
    dimensions: z.array(DimensionConfigSchema).optional(),

    /** Display configuration */
    display: DisplayConfigSchema,

    /** Optional editable fields (REQ-F-20) */
    editable: z.array(EditableFieldSchema).optional(),
  })
  .refine(
    (data) => {
      // Aggregate widgets require fields
      if (data.type === "aggregate" && (!data.fields || Object.keys(data.fields).length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "Aggregate widgets require at least one field definition",
      path: ["fields"],
    }
  )
  .refine(
    (data) => {
      // Similarity widgets require dimensions
      if (data.type === "similarity" && (!data.dimensions || data.dimensions.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "Similarity widgets require at least one dimension",
      path: ["dimensions"],
    }
  );

// =============================================================================
// Inferred TypeScript Types
// =============================================================================

export type SimilarityMethod = z.infer<typeof SimilarityMethodSchema>;
export type WidgetType = z.infer<typeof WidgetTypeSchema>;
export type WidgetLocation = z.infer<typeof WidgetLocationSchema>;
export type DisplayType = z.infer<typeof DisplayTypeSchema>;
export type EditableType = z.infer<typeof EditableTypeSchema>;
export type FieldConfig = z.infer<typeof FieldConfigSchema>;
export type DimensionConfig = z.infer<typeof DimensionConfigSchema>;
export type DisplayConfig = z.infer<typeof DisplayConfigSchema>;
export type EditableField = z.infer<typeof EditableFieldSchema>;
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Parse and validate a widget configuration.
 * @throws ZodError if validation fails
 */
export function parseWidgetConfig(data: unknown): WidgetConfig {
  return WidgetConfigSchema.parse(data);
}

/**
 * Safely parse a widget configuration, returning success/error result.
 */
export function safeParseWidgetConfig(data: unknown) {
  return WidgetConfigSchema.safeParse(data);
}

/**
 * Format a Zod validation error into an actionable message (REQ-F-3).
 * Includes field paths and specific error descriptions.
 */
export function formatValidationError(error: z.ZodError, filePath?: string): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });

  const prefix = filePath ? `Invalid widget config in "${filePath}":\n` : "Invalid widget config:\n";
  return prefix + issues.join("\n");
}
