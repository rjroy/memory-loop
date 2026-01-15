/**
 * Sync Pipeline Schema Tests
 *
 * Unit tests for sync configuration Zod schemas.
 * Tests validation of valid/invalid configs and error message formatting.
 */

import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import {
  MergeStrategySchema,
  FieldMappingSchema,
  MatchConfigSchema,
  DefaultsConfigSchema,
  VocabularySchema,
  PipelineConfigSchema,
  SecretsConfigSchema,
  SyncMetaSchema,
  parsePipelineConfig,
  safeParsePipelineConfig,
  parseSecretsConfig,
  safeParseSecretsConfig,
  parseSyncMeta,
  safeParseSyncMeta,
  formatSyncValidationError,
  type PipelineConfig,
} from "../schemas";

// =============================================================================
// MergeStrategySchema Tests
// =============================================================================

describe("MergeStrategySchema", () => {
  test("accepts 'overwrite' strategy", () => {
    const result = MergeStrategySchema.safeParse("overwrite");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("overwrite");
    }
  });

  test("accepts 'preserve' strategy", () => {
    const result = MergeStrategySchema.safeParse("preserve");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("preserve");
    }
  });

  test("accepts 'merge' strategy", () => {
    const result = MergeStrategySchema.safeParse("merge");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("merge");
    }
  });

  test("rejects invalid strategy", () => {
    const result = MergeStrategySchema.safeParse("replace");
    expect(result.success).toBe(false);
  });

  test("rejects empty string", () => {
    const result = MergeStrategySchema.safeParse("");
    expect(result.success).toBe(false);
  });

  test("rejects number", () => {
    const result = MergeStrategySchema.safeParse(1);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// FieldMappingSchema Tests
// =============================================================================

describe("FieldMappingSchema", () => {
  test("accepts minimal field mapping (source and target only)", () => {
    const result = FieldMappingSchema.safeParse({
      source: "name",
      target: "title",
    });
    expect(result.success).toBe(true);
  });

  test("accepts field mapping with strategy", () => {
    const result = FieldMappingSchema.safeParse({
      source: "name",
      target: "title",
      strategy: "preserve",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.strategy).toBe("preserve");
    }
  });

  test("accepts field mapping with normalize flag", () => {
    const result = FieldMappingSchema.safeParse({
      source: "mechanics",
      target: "mechanics",
      normalize: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.normalize).toBe(true);
    }
  });

  test("accepts field mapping with all options", () => {
    const result = FieldMappingSchema.safeParse({
      source: "mechanics",
      target: "bgg.mechanics",
      strategy: "merge",
      normalize: true,
    });
    expect(result.success).toBe(true);
  });

  test("accepts nested target field path", () => {
    const result = FieldMappingSchema.safeParse({
      source: "rating",
      target: "synced.bgg.rating",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty source", () => {
    const result = FieldMappingSchema.safeParse({
      source: "",
      target: "title",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Source field is required");
    }
  });

  test("rejects empty target", () => {
    const result = FieldMappingSchema.safeParse({
      source: "name",
      target: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Target field is required");
    }
  });

  test("rejects missing source", () => {
    const result = FieldMappingSchema.safeParse({
      target: "title",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing target", () => {
    const result = FieldMappingSchema.safeParse({
      source: "name",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid strategy value", () => {
    const result = FieldMappingSchema.safeParse({
      source: "name",
      target: "title",
      strategy: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// MatchConfigSchema Tests
// =============================================================================

describe("MatchConfigSchema", () => {
  test("accepts valid match config", () => {
    const result = MatchConfigSchema.safeParse({
      field: "bgg_id",
      pattern: "Games/**/*.md",
    });
    expect(result.success).toBe(true);
  });

  test("accepts simple glob pattern", () => {
    const result = MatchConfigSchema.safeParse({
      field: "book_id",
      pattern: "*.md",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty field", () => {
    const result = MatchConfigSchema.safeParse({
      field: "",
      pattern: "Games/**/*.md",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Match field is required");
    }
  });

  test("rejects empty pattern", () => {
    const result = MatchConfigSchema.safeParse({
      field: "bgg_id",
      pattern: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Match pattern is required");
    }
  });

  test("rejects missing field", () => {
    const result = MatchConfigSchema.safeParse({
      pattern: "Games/**/*.md",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing pattern", () => {
    const result = MatchConfigSchema.safeParse({
      field: "bgg_id",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DefaultsConfigSchema Tests
// =============================================================================

describe("DefaultsConfigSchema", () => {
  test("accepts empty defaults (all optional)", () => {
    const result = DefaultsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("accepts merge_strategy only", () => {
    const result = DefaultsConfigSchema.safeParse({
      merge_strategy: "overwrite",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merge_strategy).toBe("overwrite");
    }
  });

  test("accepts namespace only", () => {
    const result = DefaultsConfigSchema.safeParse({
      namespace: "bgg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespace).toBe("bgg");
    }
  });

  test("accepts both merge_strategy and namespace", () => {
    const result = DefaultsConfigSchema.safeParse({
      merge_strategy: "preserve",
      namespace: "synced.bgg",
    });
    expect(result.success).toBe(true);
  });

  test("accepts all valid merge strategies", () => {
    for (const strategy of ["overwrite", "preserve", "merge"]) {
      const result = DefaultsConfigSchema.safeParse({ merge_strategy: strategy });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid merge_strategy", () => {
    const result = DefaultsConfigSchema.safeParse({
      merge_strategy: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// VocabularySchema Tests
// =============================================================================

describe("VocabularySchema", () => {
  test("accepts valid vocabulary mapping", () => {
    const result = VocabularySchema.safeParse({
      "Worker Placement": ["worker placement", "Worker placement game"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts multiple canonical terms", () => {
    const result = VocabularySchema.safeParse({
      "Worker Placement": ["worker placement", "Workers placement"],
      "Deck Building": ["deck building", "Deckbuilding", "Deck-building"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts single variation per term", () => {
    const result = VocabularySchema.safeParse({
      "Solo Mode": ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty canonical term key", () => {
    const result = VocabularySchema.safeParse({
      "": ["variation"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty variations array", () => {
    const result = VocabularySchema.safeParse({
      "Worker Placement": [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("At least one variation");
    }
  });

  test("rejects empty variation string", () => {
    const result = VocabularySchema.safeParse({
      "Worker Placement": ["valid", ""],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Variation cannot be empty");
    }
  });

  test("accepts empty object (no vocabulary)", () => {
    const result = VocabularySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// PipelineConfigSchema Tests
// =============================================================================

describe("PipelineConfigSchema", () => {
  const validPipelineConfig: PipelineConfig = {
    name: "Board Games BGG Sync",
    connector: "bgg",
    match: {
      field: "bgg_id",
      pattern: "Games/**/*.md",
    },
    defaults: {
      merge_strategy: "overwrite",
      namespace: "bgg",
    },
    fields: [
      { source: "name", target: "title", strategy: "preserve" },
      { source: "rating", target: "rating" },
    ],
  };

  test("accepts valid pipeline config", () => {
    const result = PipelineConfigSchema.safeParse(validPipelineConfig);
    expect(result.success).toBe(true);
  });

  test("accepts minimal pipeline config (without defaults)", () => {
    const config = {
      name: "Simple Sync",
      connector: "bgg",
      match: {
        field: "id",
        pattern: "*.md",
      },
      fields: [{ source: "name", target: "title" }],
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("accepts pipeline with vocabulary (when normalize is used)", () => {
    const config = {
      ...validPipelineConfig,
      fields: [
        { source: "mechanics", target: "mechanics", normalize: true },
      ],
      vocabulary: {
        "Worker Placement": ["worker placement"],
      },
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const config = { ...validPipelineConfig, name: "" };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Pipeline name is required");
    }
  });

  test("rejects empty connector", () => {
    const config = { ...validPipelineConfig, connector: "" };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Connector is required");
    }
  });

  test("rejects missing match config", () => {
    const { match: _match, ...configWithoutMatch } = validPipelineConfig;
    void _match; // Intentionally destructuring to omit from config
    const result = PipelineConfigSchema.safeParse(configWithoutMatch);
    expect(result.success).toBe(false);
  });

  test("rejects empty fields array", () => {
    const config = { ...validPipelineConfig, fields: [] };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("At least one field mapping");
    }
  });

  test("rejects missing fields", () => {
    const { fields: _fields, ...configWithoutFields } = validPipelineConfig;
    void _fields; // Intentionally destructuring to omit from config
    const result = PipelineConfigSchema.safeParse(configWithoutFields);
    expect(result.success).toBe(false);
  });

  test("rejects normalize: true without vocabulary", () => {
    const config = {
      ...validPipelineConfig,
      fields: [
        { source: "mechanics", target: "mechanics", normalize: true },
      ],
      // No vocabulary defined
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const vocabularyError = result.error.issues.find((i) => i.path.includes("vocabulary"));
      expect(vocabularyError?.message).toContain("Vocabulary is required when any field has normalize: true");
    }
  });

  test("accepts normalize: false without vocabulary", () => {
    const config = {
      ...validPipelineConfig,
      fields: [
        { source: "mechanics", target: "mechanics", normalize: false },
      ],
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("accepts fields without normalize flag and no vocabulary", () => {
    const config = {
      ...validPipelineConfig,
      fields: [
        { source: "name", target: "title" },
        { source: "rating", target: "rating" },
      ],
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("validates all merge strategies in fields", () => {
    for (const strategy of ["overwrite", "preserve", "merge"] as const) {
      const config = {
        ...validPipelineConfig,
        fields: [{ source: "data", target: "data", strategy }],
      };
      const result = PipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid field mapping in array", () => {
    const config = {
      ...validPipelineConfig,
      fields: [
        { source: "name", target: "title" },
        { source: "", target: "invalid" }, // Invalid: empty source
      ],
    };
    const result = PipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// SecretsConfigSchema Tests
// =============================================================================

describe("SecretsConfigSchema", () => {
  test("accepts valid secrets config", () => {
    const result = SecretsConfigSchema.safeParse({
      bgg_username: "myuser",
      api_key: "sk-12345",
    });
    expect(result.success).toBe(true);
  });

  test("accepts single secret", () => {
    const result = SecretsConfigSchema.safeParse({
      api_key: "secret-value",
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty secrets (no secrets defined)", () => {
    const result = SecretsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("rejects empty key", () => {
    const result = SecretsConfigSchema.safeParse({
      "": "value",
    });
    expect(result.success).toBe(false);
    // Zod record key validation produces "Invalid key in record" for min(1)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  test("rejects empty value", () => {
    const result = SecretsConfigSchema.safeParse({
      api_key: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Secret value cannot be empty");
    }
  });

  test("rejects non-string value", () => {
    const result = SecretsConfigSchema.safeParse({
      port: 8080,
    });
    expect(result.success).toBe(false);
  });

  test("accepts complex secret values", () => {
    const result = SecretsConfigSchema.safeParse({
      connection_string: "postgresql://user:pass@host:5432/db?ssl=true",
      json_key: '{"type":"service_account","project_id":"test"}',
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// SyncMetaSchema Tests
// =============================================================================

describe("SyncMetaSchema", () => {
  test("accepts valid sync meta", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(true);
  });

  test("accepts ISO 8601 datetime with milliseconds", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00.123Z",
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(true);
  });

  test("accepts ISO 8601 datetime with timezone offset", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00+05:00",
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid datetime format", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "January 15, 2026",
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("ISO 8601 datetime");
    }
  });

  test("rejects date without time", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15",
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty source", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source: "",
      source_id: "174430",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Source is required");
    }
  });

  test("rejects empty source_id", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
      source_id: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Source ID is required");
    }
  });

  test("rejects missing last_synced", () => {
    const result = SyncMetaSchema.safeParse({
      source: "bgg",
      source_id: "174430",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing source", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source_id: "174430",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing source_id", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
    });
    expect(result.success).toBe(false);
  });

  test("accepts numeric source_id as string", () => {
    const result = SyncMetaSchema.safeParse({
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
      source_id: "12345",
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// parsePipelineConfig Tests
// =============================================================================

describe("parsePipelineConfig", () => {
  test("returns valid config", () => {
    const config = {
      name: "Test Pipeline",
      connector: "bgg",
      match: { field: "id", pattern: "*.md" },
      fields: [{ source: "name", target: "title" }],
    };
    const result = parsePipelineConfig(config);
    expect(result.name).toBe("Test Pipeline");
    expect(result.connector).toBe("bgg");
  });

  test("throws ZodError on invalid config", () => {
    const invalidConfig = { name: "" };
    expect(() => parsePipelineConfig(invalidConfig)).toThrow(ZodError);
  });
});

// =============================================================================
// safeParsePipelineConfig Tests
// =============================================================================

describe("safeParsePipelineConfig", () => {
  test("returns success result for valid config", () => {
    const config = {
      name: "Test Pipeline",
      connector: "bgg",
      match: { field: "id", pattern: "*.md" },
      fields: [{ source: "name", target: "title" }],
    };
    const result = safeParsePipelineConfig(config);
    expect(result.success).toBe(true);
  });

  test("returns error result for invalid config", () => {
    const invalidConfig = { name: "" };
    const result = safeParsePipelineConfig(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// parseSecretsConfig Tests
// =============================================================================

describe("parseSecretsConfig", () => {
  test("returns valid secrets", () => {
    const secrets = { api_key: "secret123" };
    const result = parseSecretsConfig(secrets);
    expect(result.api_key).toBe("secret123");
  });

  test("throws ZodError on invalid secrets", () => {
    const invalidSecrets = { key: "" };
    expect(() => parseSecretsConfig(invalidSecrets)).toThrow(ZodError);
  });
});

// =============================================================================
// safeParseSecretsConfig Tests
// =============================================================================

describe("safeParseSecretsConfig", () => {
  test("returns success result for valid secrets", () => {
    const secrets = { api_key: "secret123" };
    const result = safeParseSecretsConfig(secrets);
    expect(result.success).toBe(true);
  });

  test("returns error result for invalid secrets", () => {
    const invalidSecrets = { key: "" };
    const result = safeParseSecretsConfig(invalidSecrets);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// parseSyncMeta Tests
// =============================================================================

describe("parseSyncMeta", () => {
  test("returns valid sync meta", () => {
    const meta = {
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
      source_id: "174430",
    };
    const result = parseSyncMeta(meta);
    expect(result.source).toBe("bgg");
    expect(result.source_id).toBe("174430");
  });

  test("throws ZodError on invalid sync meta", () => {
    const invalidMeta = { source: "bgg" };
    expect(() => parseSyncMeta(invalidMeta)).toThrow(ZodError);
  });
});

// =============================================================================
// safeParseSyncMeta Tests
// =============================================================================

describe("safeParseSyncMeta", () => {
  test("returns success result for valid sync meta", () => {
    const meta = {
      last_synced: "2026-01-15T10:30:00Z",
      source: "bgg",
      source_id: "174430",
    };
    const result = safeParseSyncMeta(meta);
    expect(result.success).toBe(true);
  });

  test("returns error result for invalid sync meta", () => {
    const invalidMeta = { source: "bgg" };
    const result = safeParseSyncMeta(invalidMeta);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// formatSyncValidationError Tests
// =============================================================================

describe("formatSyncValidationError", () => {
  test("includes file path in message", () => {
    const result = safeParsePipelineConfig({ name: "" });
    if (!result.success) {
      const message = formatSyncValidationError(result.error, "sync/boardgames.yaml");
      expect(message).toContain("sync/boardgames.yaml");
    }
  });

  test("includes field path in message", () => {
    const result = safeParsePipelineConfig({
      name: "Test",
      connector: "bgg",
      match: { field: "", pattern: "*.md" },
      fields: [{ source: "name", target: "title" }],
    });
    if (!result.success) {
      const message = formatSyncValidationError(result.error);
      expect(message).toContain("match.field");
    }
  });

  test("formats multiple errors", () => {
    const result = safeParsePipelineConfig({});
    if (!result.success) {
      const message = formatSyncValidationError(result.error);
      expect(message.split("\n").length).toBeGreaterThan(1);
    }
  });

  test("formats array index in path", () => {
    const result = safeParsePipelineConfig({
      name: "Test",
      connector: "bgg",
      match: { field: "id", pattern: "*.md" },
      fields: [
        { source: "name", target: "title" },
        { source: "", target: "bad" },
      ],
    });
    if (!result.success) {
      const message = formatSyncValidationError(result.error);
      expect(message).toContain("fields.1.source");
    }
  });

  test("handles refinement errors", () => {
    const result = safeParsePipelineConfig({
      name: "Test",
      connector: "bgg",
      match: { field: "id", pattern: "*.md" },
      fields: [{ source: "data", target: "data", normalize: true }],
      // Missing vocabulary when normalize: true
    });
    if (!result.success) {
      const message = formatSyncValidationError(result.error);
      expect(message).toContain("vocabulary");
    }
  });
});
