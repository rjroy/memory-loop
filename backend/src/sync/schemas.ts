/**
 * Sync Pipeline Configuration Schemas
 *
 * Zod schemas for validating sync pipeline configuration files.
 * Pipelines are defined in `.memory-loop/sync/*.yaml` within vaults.
 * Secrets are defined in `.memory-loop/secrets/*.yaml` (for git-crypt encryption).
 *
 * Spec Requirements:
 * - REQ-F-1: Sync pipelines defined in `.memory-loop/sync/*.yaml` files
 * - REQ-F-2: Each pipeline specifies: API connector, file matching criteria, field mappings, transformations
 * - REQ-F-3: Files matched by frontmatter field value (e.g., `match_field: bgg_id`)
 * - REQ-F-4: Pipeline config specifies target namespace or direct field mapping
 * - REQ-F-5: Per-field merge strategy: `overwrite`, `preserve`, or `merge`
 * - REQ-F-6: Default merge strategy configurable at pipeline level, overridable per-field
 * - REQ-F-7: Support writing to nested namespace (e.g., `synced.bgg.rating`) or direct fields
 * - REQ-F-12: Define canonical vocabulary mappings in pipeline config
 * - REQ-F-14: Normalization applied per-field when `normalize: true` in field config
 * - REQ-F-18: Track last sync timestamp per file in frontmatter (`_sync_meta.last_synced`)
 * - REQ-F-20: API secrets stored in `.memory-loop/secrets/*.yaml`
 * - REQ-F-21: Secrets file format: key-value pairs
 */

import { z } from "zod";

// =============================================================================
// Merge Strategy Schema
// =============================================================================

/**
 * Merge strategies for synced data (REQ-F-5).
 * - overwrite: Replace existing value with synced value
 * - preserve: Keep existing value if present, otherwise use synced value
 * - merge: For arrays, combine values without duplicates
 */
export const MergeStrategySchema = z.enum(["overwrite", "preserve", "merge"]);

// =============================================================================
// Field Mapping Schema
// =============================================================================

/**
 * Configuration for mapping a source field to a target frontmatter field (REQ-F-4, REQ-F-5, REQ-F-14).
 * Maps data from the API connector to frontmatter with optional transformation.
 */
export const FieldMappingSchema = z.object({
  /** Source field name from the API connector (e.g., "name", "mechanics") */
  source: z.string().min(1, "Source field is required"),

  /** Target frontmatter field name (e.g., "title", "bgg.mechanics") */
  target: z.string().min(1, "Target field is required"),

  /**
   * Merge strategy for this field (overrides pipeline default).
   * - overwrite: Always replace existing value
   * - preserve: Keep existing if present
   * - merge: Combine arrays without duplicates
   */
  strategy: MergeStrategySchema.optional(),

  /** When true, apply vocabulary normalization to this field (REQ-F-14) */
  normalize: z.boolean().optional(),
});

// =============================================================================
// Match Configuration Schema
// =============================================================================

/**
 * Configuration for matching files to sync (REQ-F-3).
 * Two-phase matching: glob pattern filters files, then frontmatter field determines eligibility.
 */
export const MatchConfigSchema = z.object({
  /** Frontmatter field containing the external ID (e.g., "bgg_id") */
  field: z.string().min(1, "Match field is required"),

  /** Glob pattern for candidate files (e.g., `Games/**.md`) */
  pattern: z.string().min(1, "Match pattern is required"),
});

// =============================================================================
// Defaults Configuration Schema
// =============================================================================

/**
 * Default settings for the pipeline (REQ-F-6, REQ-F-7).
 * Can be overridden at the field level.
 */
export const DefaultsConfigSchema = z.object({
  /**
   * Default merge strategy for all fields.
   * Individual field mappings can override this.
   */
  merge_strategy: MergeStrategySchema.optional(),

  /**
   * Namespace prefix for synced fields (e.g., "bgg" writes to "bgg.*").
   * When set, field targets are prefixed with this namespace.
   * When omitted, fields are written at the root level.
   */
  namespace: z.string().optional(),
});

// =============================================================================
// Vocabulary Schema
// =============================================================================

/**
 * Vocabulary mapping for LLM-assisted normalization (REQ-F-12).
 * Maps canonical terms to their known variations.
 *
 * Example:
 * ```yaml
 * vocabulary:
 *   "Worker Placement":
 *     - "worker placement"
 *     - "Worker placement game"
 *   "Deck Building":
 *     - "deck building"
 *     - "Deckbuilding"
 * ```
 */
export const VocabularySchema = z.record(
  z.string().min(1, "Canonical term cannot be empty"),
  z.array(z.string().min(1, "Variation cannot be empty")).min(1, "At least one variation is required")
);

// =============================================================================
// Pipeline Configuration Schema
// =============================================================================

/**
 * Complete sync pipeline configuration (REQ-F-1, REQ-F-2).
 * This is the main schema for validating pipeline YAML files.
 *
 * Example YAML:
 *   name: Board Games BGG Sync
 *   connector: bgg
 *   match:
 *     field: bgg_id
 *     pattern: Games/[star][star]/[star].md
 *   defaults:
 *     merge_strategy: overwrite
 *     namespace: bgg
 *   fields:
 *     - source: name
 *       target: title
 *       strategy: preserve
 *     - source: mechanics
 *       target: mechanics
 *       strategy: merge
 *       normalize: true
 *   vocabulary:
 *     Worker Placement:
 *       - worker placement
 */
export const PipelineConfigSchema = z
  .object({
    /** Human-readable pipeline name */
    name: z.string().min(1, "Pipeline name is required"),

    /** API connector identifier (e.g., "bgg") */
    connector: z.string().min(1, "Connector is required"),

    /** File matching configuration */
    match: MatchConfigSchema,

    /** Default settings for field mappings */
    defaults: DefaultsConfigSchema.optional(),

    /** Field mappings from API to frontmatter */
    fields: z.array(FieldMappingSchema).min(1, "At least one field mapping is required"),

    /** Vocabulary for LLM normalization (optional) */
    vocabulary: VocabularySchema.optional(),
  })
  .refine(
    (data) => {
      // If any field has normalize: true, vocabulary should be defined
      const hasNormalizedField = data.fields.some((f) => f.normalize === true);
      if (hasNormalizedField && !data.vocabulary) {
        return false;
      }
      return true;
    },
    {
      message: "Vocabulary is required when any field has normalize: true",
      path: ["vocabulary"],
    }
  );

// =============================================================================
// Secrets Configuration Schema
// =============================================================================

/**
 * Secrets configuration for API authentication (REQ-F-20, REQ-F-21).
 * Key-value pairs stored in `.memory-loop/secrets/*.yaml`.
 *
 * Example:
 * ```yaml
 * bgg_username: myuser
 * openai_key: sk-...
 * ```
 *
 * Note: Values are strings. Secret files should be encrypted with git-crypt.
 */
export const SecretsConfigSchema = z.record(
  z.string().min(1, "Secret key cannot be empty"),
  z.string().min(1, "Secret value cannot be empty")
);

// =============================================================================
// Sync Metadata Schema
// =============================================================================

/**
 * Sync metadata stored in frontmatter (REQ-F-18, TD-12).
 * Tracks when a file was last synced and from which source.
 *
 * Written as `_sync_meta` in frontmatter:
 * ```yaml
 * _sync_meta:
 *   last_synced: "2026-01-15T10:30:00Z"
 *   source: bgg
 *   source_id: "174430"
 * ```
 */
export const SyncMetaSchema = z.object({
  /** ISO 8601 timestamp of last successful sync */
  last_synced: z.string().datetime({
    offset: true,
    message: "last_synced must be an ISO 8601 datetime string",
  }),

  /** API connector name that performed the sync (e.g., "bgg") */
  source: z.string().min(1, "Source is required"),

  /** External ID used for the sync (e.g., BGG game ID) */
  source_id: z.string().min(1, "Source ID is required"),
});

// =============================================================================
// Inferred TypeScript Types
// =============================================================================

export type MergeStrategy = z.infer<typeof MergeStrategySchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type MatchConfig = z.infer<typeof MatchConfigSchema>;
export type DefaultsConfig = z.infer<typeof DefaultsConfigSchema>;
export type Vocabulary = z.infer<typeof VocabularySchema>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;
export type SyncMeta = z.infer<typeof SyncMetaSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Parse and validate a pipeline configuration.
 * @throws ZodError if validation fails
 */
export function parsePipelineConfig(data: unknown): PipelineConfig {
  return PipelineConfigSchema.parse(data);
}

/**
 * Safely parse a pipeline configuration, returning success/error result.
 */
export function safeParsePipelineConfig(data: unknown) {
  return PipelineConfigSchema.safeParse(data);
}

/**
 * Parse and validate a secrets configuration.
 * @throws ZodError if validation fails
 */
export function parseSecretsConfig(data: unknown): SecretsConfig {
  return SecretsConfigSchema.parse(data);
}

/**
 * Safely parse a secrets configuration, returning success/error result.
 */
export function safeParseSecretsConfig(data: unknown) {
  return SecretsConfigSchema.safeParse(data);
}

/**
 * Parse and validate sync metadata from frontmatter.
 * @throws ZodError if validation fails
 */
export function parseSyncMeta(data: unknown): SyncMeta {
  return SyncMetaSchema.parse(data);
}

/**
 * Safely parse sync metadata, returning success/error result.
 */
export function safeParseSyncMeta(data: unknown) {
  return SyncMetaSchema.safeParse(data);
}

/**
 * Format a Zod validation error into an actionable message.
 * Includes field paths and specific error descriptions.
 */
export function formatSyncValidationError(error: z.ZodError, filePath?: string): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });

  const prefix = filePath ? `Invalid sync config in "${filePath}":\n` : "Invalid sync config:\n";
  return prefix + issues.join("\n");
}
