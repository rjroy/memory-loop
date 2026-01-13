/**
 * Vault Configuration Tests
 *
 * Tests for per-vault configuration loading and path resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import {
  CONFIG_FILE_NAME,
  DEFAULT_METADATA_PATH,
  DEFAULT_PROJECT_PATH,
  DEFAULT_AREA_PATH,
  DEFAULT_PROMPTS_PER_GENERATION,
  DEFAULT_MAX_POOL_SIZE,
  DEFAULT_QUOTES_PER_WEEK,
  loadVaultConfig,
  resolveContentRoot,
  resolveMetadataPath,
  resolveGoalsPath,
  resolveContextualPromptsPath,
  resolveGeneralInspirationPath,
  resolveProjectPath,
  resolveAreaPath,
  resolvePromptsPerGeneration,
  resolveMaxPoolSize,
  resolveQuotesPerWeek,
  resolveBadges,
  resolvePinnedAssets,
  saveSlashCommands,
  savePinnedAssets,
  slashCommandsEqual,
  type VaultConfig,
} from "../vault-config";
import type { SlashCommand } from "@memory-loop/shared";

describe("vault-config", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `vault-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("CONFIG_FILE_NAME", () => {
    test("exports expected config file name", () => {
      expect(CONFIG_FILE_NAME).toBe(".memory-loop.json");
    });
  });

  describe("DEFAULT_METADATA_PATH", () => {
    test("exports expected default metadata path", () => {
      expect(DEFAULT_METADATA_PATH).toBe("06_Metadata/memory-loop");
    });
  });

  describe("DEFAULT_PROJECT_PATH", () => {
    test("exports expected default project path", () => {
      expect(DEFAULT_PROJECT_PATH).toBe("01_Projects");
    });
  });

  describe("DEFAULT_AREA_PATH", () => {
    test("exports expected default area path", () => {
      expect(DEFAULT_AREA_PATH).toBe("02_Areas");
    });
  });

  describe("DEFAULT_PROMPTS_PER_GENERATION", () => {
    test("exports expected default prompts per generation", () => {
      expect(DEFAULT_PROMPTS_PER_GENERATION).toBe(5);
    });
  });

  describe("DEFAULT_MAX_POOL_SIZE", () => {
    test("exports expected default max pool size", () => {
      expect(DEFAULT_MAX_POOL_SIZE).toBe(50);
    });
  });

  describe("DEFAULT_QUOTES_PER_WEEK", () => {
    test("exports expected default quotes per week", () => {
      expect(DEFAULT_QUOTES_PER_WEEK).toBe(1);
    });
  });

  describe("loadVaultConfig", () => {
    test("returns empty object when no config file exists", async () => {
      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("loads valid config with all fields", async () => {
      const configData: VaultConfig = {
        contentRoot: "content",
        inboxPath: "daily",
        metadataPath: "meta/memory-loop",
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test("loads config with only contentRoot", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ contentRoot: "content" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content" });
    });

    test("loads config with only inboxPath", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ inboxPath: "inbox" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ inboxPath: "inbox" });
    });

    test("loads config with only metadataPath", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ metadataPath: "meta" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ metadataPath: "meta" });
    });

    test("loads config with only title", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ title: "Custom Vault Title" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ title: "Custom Vault Title" });
    });

    test("loads config with title and other fields", async () => {
      const configData: VaultConfig = {
        title: "My Vault",
        contentRoot: "content",
        inboxPath: "inbox",
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test("ignores non-string title value", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ title: 123, contentRoot: "content" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content" });
      expect(config.title).toBeUndefined();
    });

    test("loads config with only subtitle", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ subtitle: "Personal Notes" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ subtitle: "Personal Notes" });
    });

    test("loads config with title and subtitle", async () => {
      const configData: VaultConfig = {
        title: "My Vault",
        subtitle: "Personal Notes",
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test("ignores non-string subtitle value", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ subtitle: 123, contentRoot: "content" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content" });
      expect(config.subtitle).toBeUndefined();
    });

    test("loads config with only projectPath", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ projectPath: "projects" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ projectPath: "projects" });
    });

    test("loads config with only areaPath", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ areaPath: "areas" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ areaPath: "areas" });
    });

    test("loads config with all fields including projectPath and areaPath", async () => {
      const configData: VaultConfig = {
        contentRoot: "content",
        inboxPath: "daily",
        metadataPath: "meta/memory-loop",
        projectPath: "custom_projects",
        areaPath: "custom_areas",
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test("ignores non-string values for known fields", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          contentRoot: 123,
          inboxPath: null,
          metadataPath: ["array"],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("ignores non-string values for projectPath and areaPath", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          projectPath: 42,
          areaPath: { nested: "object" },
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("ignores unknown fields", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          contentRoot: "content",
          unknownField: "value",
          anotherUnknown: 42,
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content" });
    });

    test("returns empty object for invalid JSON", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), "{ invalid json }");

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("returns empty object for non-object JSON (array)", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), '["array"]');

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("returns empty object for non-object JSON (string)", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), '"string"');

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("returns empty object for non-object JSON (null)", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), "null");

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("returns empty object for empty JSON object", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), "{}");

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("handles whitespace in JSON", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        `{
          "contentRoot": "content",
          "inboxPath": "inbox"
        }`
      );

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content", inboxPath: "inbox" });
    });
  });

  describe("resolveContentRoot", () => {
    test("returns vault path when no contentRoot configured", () => {
      const result = resolveContentRoot("/vault/path", {});
      expect(result).toBe("/vault/path");
    });

    test("returns vault path when contentRoot is undefined", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: undefined });
      expect(result).toBe("/vault/path");
    });

    test("joins contentRoot to vault path", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "content" });
      expect(result).toBe("/vault/path/content");
    });

    test("handles nested contentRoot paths", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "src/content" });
      expect(result).toBe("/vault/path/src/content");
    });

    test("handles empty string contentRoot (same as vault path)", () => {
      // Empty string is falsy, so returns vault path
      const result = resolveContentRoot("/vault/path", { contentRoot: "" });
      expect(result).toBe("/vault/path");
    });

    test("rejects path traversal with ..", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "../outside" });
      expect(result).toBe("/vault/path");
    });

    test("rejects path traversal with nested ..", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "content/../../outside" });
      expect(result).toBe("/vault/path");
    });

    test("rejects absolute path traversal", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "/etc/passwd" });
      expect(result).toBe("/vault/path");
    });

    test("allows paths that contain .. but resolve within vault", () => {
      const result = resolveContentRoot("/vault/path", { contentRoot: "content/../other" });
      expect(result).toBe("/vault/path/other");
    });
  });

  describe("resolveMetadataPath", () => {
    test("returns default when no metadataPath configured", () => {
      const result = resolveMetadataPath({});
      expect(result).toBe(DEFAULT_METADATA_PATH);
    });

    test("returns default when metadataPath is undefined", () => {
      const result = resolveMetadataPath({ metadataPath: undefined });
      expect(result).toBe(DEFAULT_METADATA_PATH);
    });

    test("returns configured metadataPath", () => {
      const result = resolveMetadataPath({ metadataPath: "meta" });
      expect(result).toBe("meta");
    });

    test("returns empty string when configured as empty", () => {
      const result = resolveMetadataPath({ metadataPath: "" });
      expect(result).toBe("");
    });
  });

  describe("resolveGoalsPath", () => {
    test("returns goals.md under default metadata path", () => {
      const result = resolveGoalsPath({});
      expect(result).toBe("06_Metadata/memory-loop/goals.md");
    });

    test("returns goals.md under custom metadata path", () => {
      const result = resolveGoalsPath({ metadataPath: "meta" });
      expect(result).toBe("meta/goals.md");
    });

    test("handles nested metadata paths", () => {
      const result = resolveGoalsPath({ metadataPath: "deep/nested/meta" });
      expect(result).toBe("deep/nested/meta/goals.md");
    });
  });

  describe("resolveContextualPromptsPath", () => {
    test("returns contextual-prompts.md under default metadata path", () => {
      const result = resolveContextualPromptsPath({});
      expect(result).toBe("06_Metadata/memory-loop/contextual-prompts.md");
    });

    test("returns contextual-prompts.md under custom metadata path", () => {
      const result = resolveContextualPromptsPath({ metadataPath: "meta" });
      expect(result).toBe("meta/contextual-prompts.md");
    });
  });

  describe("resolveGeneralInspirationPath", () => {
    test("returns general-inspiration.md under default metadata path", () => {
      const result = resolveGeneralInspirationPath({});
      expect(result).toBe("06_Metadata/memory-loop/general-inspiration.md");
    });

    test("returns general-inspiration.md under custom metadata path", () => {
      const result = resolveGeneralInspirationPath({ metadataPath: "meta" });
      expect(result).toBe("meta/general-inspiration.md");
    });
  });

  describe("resolveProjectPath", () => {
    test("returns default when no projectPath configured", () => {
      const result = resolveProjectPath({});
      expect(result).toBe(DEFAULT_PROJECT_PATH);
    });

    test("returns default when projectPath is undefined", () => {
      const result = resolveProjectPath({ projectPath: undefined });
      expect(result).toBe(DEFAULT_PROJECT_PATH);
    });

    test("returns configured projectPath", () => {
      const result = resolveProjectPath({ projectPath: "custom_projects" });
      expect(result).toBe("custom_projects");
    });

    test("returns empty string when configured as empty", () => {
      const result = resolveProjectPath({ projectPath: "" });
      expect(result).toBe("");
    });

    test("handles nested project paths", () => {
      const result = resolveProjectPath({ projectPath: "work/projects" });
      expect(result).toBe("work/projects");
    });
  });

  describe("resolveAreaPath", () => {
    test("returns default when no areaPath configured", () => {
      const result = resolveAreaPath({});
      expect(result).toBe(DEFAULT_AREA_PATH);
    });

    test("returns default when areaPath is undefined", () => {
      const result = resolveAreaPath({ areaPath: undefined });
      expect(result).toBe(DEFAULT_AREA_PATH);
    });

    test("returns configured areaPath", () => {
      const result = resolveAreaPath({ areaPath: "custom_areas" });
      expect(result).toBe("custom_areas");
    });

    test("returns empty string when configured as empty", () => {
      const result = resolveAreaPath({ areaPath: "" });
      expect(result).toBe("");
    });

    test("handles nested area paths", () => {
      const result = resolveAreaPath({ areaPath: "life/areas" });
      expect(result).toBe("life/areas");
    });
  });

  describe("resolvePromptsPerGeneration", () => {
    test("returns default when not configured", () => {
      const result = resolvePromptsPerGeneration({});
      expect(result).toBe(DEFAULT_PROMPTS_PER_GENERATION);
    });

    test("returns default when undefined", () => {
      const result = resolvePromptsPerGeneration({ promptsPerGeneration: undefined });
      expect(result).toBe(DEFAULT_PROMPTS_PER_GENERATION);
    });

    test("returns configured value", () => {
      const result = resolvePromptsPerGeneration({ promptsPerGeneration: 10 });
      expect(result).toBe(10);
    });
  });

  describe("resolveMaxPoolSize", () => {
    test("returns default when not configured", () => {
      const result = resolveMaxPoolSize({});
      expect(result).toBe(DEFAULT_MAX_POOL_SIZE);
    });

    test("returns default when undefined", () => {
      const result = resolveMaxPoolSize({ maxPoolSize: undefined });
      expect(result).toBe(DEFAULT_MAX_POOL_SIZE);
    });

    test("returns configured value", () => {
      const result = resolveMaxPoolSize({ maxPoolSize: 100 });
      expect(result).toBe(100);
    });
  });

  describe("resolveQuotesPerWeek", () => {
    test("returns default when not configured", () => {
      const result = resolveQuotesPerWeek({});
      expect(result).toBe(DEFAULT_QUOTES_PER_WEEK);
    });

    test("returns default when undefined", () => {
      const result = resolveQuotesPerWeek({ quotesPerWeek: undefined });
      expect(result).toBe(DEFAULT_QUOTES_PER_WEEK);
    });

    test("returns configured value", () => {
      const result = resolveQuotesPerWeek({ quotesPerWeek: 3 });
      expect(result).toBe(3);
    });
  });

  describe("loadVaultConfig with generation settings", () => {
    test("loads config with promptsPerGeneration", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ promptsPerGeneration: 10 })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.promptsPerGeneration).toBe(10);
    });

    test("loads config with maxPoolSize", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ maxPoolSize: 100 })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.maxPoolSize).toBe(100);
    });

    test("loads config with quotesPerWeek", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ quotesPerWeek: 3 })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.quotesPerWeek).toBe(3);
    });

    test("loads config with all generation settings", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          promptsPerGeneration: 7,
          maxPoolSize: 75,
          quotesPerWeek: 2,
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.promptsPerGeneration).toBe(7);
      expect(config.maxPoolSize).toBe(75);
      expect(config.quotesPerWeek).toBe(2);
    });

    test("ignores non-numeric generation settings", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          promptsPerGeneration: "five",
          maxPoolSize: null,
          quotesPerWeek: [],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.promptsPerGeneration).toBeUndefined();
      expect(config.maxPoolSize).toBeUndefined();
      expect(config.quotesPerWeek).toBeUndefined();
    });

    test("ignores zero or negative generation settings", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          promptsPerGeneration: 0,
          maxPoolSize: -5,
          quotesPerWeek: -1,
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.promptsPerGeneration).toBeUndefined();
      expect(config.maxPoolSize).toBeUndefined();
      expect(config.quotesPerWeek).toBeUndefined();
    });

    test("floors decimal values for generation settings", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          promptsPerGeneration: 5.7,
          maxPoolSize: 50.9,
          quotesPerWeek: 2.3,
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.promptsPerGeneration).toBe(5);
      expect(config.maxPoolSize).toBe(50);
      expect(config.quotesPerWeek).toBe(2);
    });
  });

  describe("loadVaultConfig with slashCommands", () => {
    test("loads config with valid slashCommands array", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit" },
        { name: "/review", description: "Review code", argumentHint: "file" },
      ];
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ slashCommands: commands })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.slashCommands).toEqual(commands);
    });

    test("loads config with slashCommands alongside other fields", async () => {
      const configData = {
        contentRoot: "content",
        slashCommands: [{ name: "/help", description: "Get help" }],
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config.contentRoot).toBe("content");
      expect(config.slashCommands).toEqual([{ name: "/help", description: "Get help" }]);
    });

    test("filters out invalid slashCommand entries", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          slashCommands: [
            { name: "/valid", description: "Valid command" },
            { name: "/missing-desc" }, // Missing description
            { description: "Missing name" }, // Missing name
            null,
            "not an object",
            42,
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.slashCommands).toEqual([{ name: "/valid", description: "Valid command" }]);
    });

    test("returns undefined slashCommands when not an array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ slashCommands: "not an array" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.slashCommands).toBeUndefined();
    });

    test("returns empty array when slashCommands is empty array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ slashCommands: [] })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.slashCommands).toEqual([]);
    });

    test("sanitizes null argumentHint to undefined", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          slashCommands: [
            { name: "/test", description: "Test command", argumentHint: null },
            { name: "/other", description: "Other command", argumentHint: "" },
            { name: "/valid", description: "Valid hint", argumentHint: "file" },
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.slashCommands).toHaveLength(3);
      // null and empty string argumentHint should be omitted
      expect(config.slashCommands?.[0]).toEqual({ name: "/test", description: "Test command" });
      expect(config.slashCommands?.[1]).toEqual({ name: "/other", description: "Other command" });
      // Valid string argumentHint should be preserved
      expect(config.slashCommands?.[2]).toEqual({ name: "/valid", description: "Valid hint", argumentHint: "file" });
    });
  });

  describe("saveSlashCommands", () => {
    test("creates config file with slashCommands when none exists", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit" },
      ];

      await saveSlashCommands(testDir, commands);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.slashCommands).toEqual(commands);
    });

    test("preserves existing config fields when saving slashCommands", async () => {
      // Create existing config
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ contentRoot: "content", inboxPath: "inbox" })
      );

      const commands: SlashCommand[] = [{ name: "/test", description: "Test" }];
      await saveSlashCommands(testDir, commands);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.contentRoot).toBe("content");
      expect(parsed.inboxPath).toBe("inbox");
      expect(parsed.slashCommands).toEqual(commands);
    });

    test("updates existing slashCommands", async () => {
      // Create existing config with slashCommands
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          slashCommands: [{ name: "/old", description: "Old command" }],
        })
      );

      const newCommands: SlashCommand[] = [{ name: "/new", description: "New command" }];
      await saveSlashCommands(testDir, newCommands);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.slashCommands).toEqual(newCommands);
    });

    test("saves empty array when no commands", async () => {
      await saveSlashCommands(testDir, []);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.slashCommands).toEqual([]);
    });

    test("handles invalid existing JSON by starting fresh", async () => {
      // Create invalid JSON
      await writeFile(join(testDir, CONFIG_FILE_NAME), "{ invalid }");

      const commands: SlashCommand[] = [{ name: "/test", description: "Test" }];
      await saveSlashCommands(testDir, commands);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.slashCommands).toEqual(commands);
    });
  });

  describe("slashCommandsEqual", () => {
    test("returns true for two undefined arrays", () => {
      expect(slashCommandsEqual(undefined, undefined)).toBe(true);
    });

    test("returns false when one is undefined", () => {
      const commands: SlashCommand[] = [{ name: "/test", description: "Test" }];
      expect(slashCommandsEqual(commands, undefined)).toBe(false);
      expect(slashCommandsEqual(undefined, commands)).toBe(false);
    });

    test("returns true for two empty arrays", () => {
      expect(slashCommandsEqual([], [])).toBe(true);
    });

    test("returns false for different lengths", () => {
      const a: SlashCommand[] = [{ name: "/a", description: "A" }];
      const b: SlashCommand[] = [
        { name: "/a", description: "A" },
        { name: "/b", description: "B" },
      ];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });

    test("returns true for identical commands", () => {
      const a: SlashCommand[] = [
        { name: "/commit", description: "Create commit", argumentHint: "message" },
        { name: "/review", description: "Review code" },
      ];
      const b: SlashCommand[] = [
        { name: "/commit", description: "Create commit", argumentHint: "message" },
        { name: "/review", description: "Review code" },
      ];
      expect(slashCommandsEqual(a, b)).toBe(true);
    });

    test("returns false when names differ", () => {
      const a: SlashCommand[] = [{ name: "/a", description: "Desc" }];
      const b: SlashCommand[] = [{ name: "/b", description: "Desc" }];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });

    test("returns false when descriptions differ", () => {
      const a: SlashCommand[] = [{ name: "/test", description: "Desc A" }];
      const b: SlashCommand[] = [{ name: "/test", description: "Desc B" }];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });

    test("returns false when argumentHints differ", () => {
      const a: SlashCommand[] = [{ name: "/test", description: "Desc", argumentHint: "a" }];
      const b: SlashCommand[] = [{ name: "/test", description: "Desc", argumentHint: "b" }];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });

    test("returns false when one has argumentHint and other does not", () => {
      const a: SlashCommand[] = [{ name: "/test", description: "Desc", argumentHint: "hint" }];
      const b: SlashCommand[] = [{ name: "/test", description: "Desc" }];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });

    test("returns false when order differs", () => {
      const a: SlashCommand[] = [
        { name: "/a", description: "A" },
        { name: "/b", description: "B" },
      ];
      const b: SlashCommand[] = [
        { name: "/b", description: "B" },
        { name: "/a", description: "A" },
      ];
      expect(slashCommandsEqual(a, b)).toBe(false);
    });
  });

  describe("loadVaultConfig with badges", () => {
    test("loads config with valid badges array", async () => {
      const badges = [
        { text: "Work", color: "blue" as const },
        { text: "Personal", color: "green" as const },
      ];
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ badges })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual(badges);
    });

    test("loads config with all valid badge colors", async () => {
      const badges = [
        { text: "Black", color: "black" as const },
        { text: "Purple", color: "purple" as const },
        { text: "Red", color: "red" as const },
        { text: "Cyan", color: "cyan" as const },
        { text: "Orange", color: "orange" as const },
        { text: "Blue", color: "blue" as const },
        { text: "Green", color: "green" as const },
        { text: "Yellow", color: "yellow" as const },
      ];
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ badges })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual(badges);
    });

    test("filters out badges with invalid color", async () => {
      const badges = [
        { text: "Valid", color: "blue" },
        { text: "Invalid", color: "pink" },
        { text: "Also Valid", color: "red" },
      ];
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ badges })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([
        { text: "Valid", color: "blue" },
        { text: "Also Valid", color: "red" },
      ]);
    });

    test("filters out badges with missing text", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          badges: [
            { text: "Valid", color: "blue" },
            { color: "red" },
            { text: "Also Valid", color: "green" },
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([
        { text: "Valid", color: "blue" },
        { text: "Also Valid", color: "green" },
      ]);
    });

    test("filters out badges with empty text", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          badges: [
            { text: "Valid", color: "blue" },
            { text: "", color: "red" },
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([{ text: "Valid", color: "blue" }]);
    });

    test("filters out badges with missing color", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          badges: [
            { text: "Valid", color: "blue" },
            { text: "No Color" },
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([{ text: "Valid", color: "blue" }]);
    });

    test("filters out non-object badge entries", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          badges: [
            { text: "Valid", color: "blue" },
            null,
            "string",
            42,
            { text: "Also Valid", color: "red" },
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([
        { text: "Valid", color: "blue" },
        { text: "Also Valid", color: "red" },
      ]);
    });

    test("returns undefined badges when not an array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ badges: "not an array" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toBeUndefined();
    });

    test("returns empty array when badges is empty array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ badges: [] })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.badges).toEqual([]);
    });

    test("loads badges alongside other config fields", async () => {
      const configData = {
        title: "My Vault",
        contentRoot: "content",
        badges: [{ text: "Test", color: "purple" }],
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config.title).toBe("My Vault");
      expect(config.contentRoot).toBe("content");
      expect(config.badges).toEqual([{ text: "Test", color: "purple" }]);
    });
  });

  describe("resolveBadges", () => {
    test("returns empty array when badges not configured", () => {
      const result = resolveBadges({});
      expect(result).toEqual([]);
    });

    test("returns empty array when badges is undefined", () => {
      const result = resolveBadges({ badges: undefined });
      expect(result).toEqual([]);
    });

    test("returns configured badges", () => {
      const badges = [
        { text: "Work", color: "blue" as const },
        { text: "Personal", color: "green" as const },
      ];
      const result = resolveBadges({ badges });
      expect(result).toEqual(badges);
    });

    test("returns empty array when configured as empty", () => {
      const result = resolveBadges({ badges: [] });
      expect(result).toEqual([]);
    });
  });

  describe("loadVaultConfig with pinnedAssets", () => {
    test("loads config with valid pinnedAssets array", async () => {
      const pinnedAssets = ["folder1", "folder2/subfolder", "notes/daily.md"];
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ pinnedAssets })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.pinnedAssets).toEqual(pinnedAssets);
    });

    test("loads config with pinnedAssets alongside other fields", async () => {
      const configData = {
        contentRoot: "content",
        pinnedAssets: ["pinned/folder"],
      };
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify(configData)
      );

      const config = await loadVaultConfig(testDir);
      expect(config.contentRoot).toBe("content");
      expect(config.pinnedAssets).toEqual(["pinned/folder"]);
    });

    test("filters out non-string pinnedAssets entries", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          pinnedAssets: [
            "valid/path",
            null,
            42,
            { nested: "object" },
            "another/valid",
            "",
          ],
        })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.pinnedAssets).toEqual(["valid/path", "another/valid"]);
    });

    test("returns undefined pinnedAssets when not an array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ pinnedAssets: "not an array" })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.pinnedAssets).toBeUndefined();
    });

    test("returns empty array when pinnedAssets is empty array", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ pinnedAssets: [] })
      );

      const config = await loadVaultConfig(testDir);
      expect(config.pinnedAssets).toEqual([]);
    });
  });

  describe("resolvePinnedAssets", () => {
    test("returns empty array when pinnedAssets not configured", () => {
      const result = resolvePinnedAssets({});
      expect(result).toEqual([]);
    });

    test("returns empty array when pinnedAssets is undefined", () => {
      const result = resolvePinnedAssets({ pinnedAssets: undefined });
      expect(result).toEqual([]);
    });

    test("returns configured pinnedAssets", () => {
      const pinnedAssets = ["folder1", "folder2/subfolder"];
      const result = resolvePinnedAssets({ pinnedAssets });
      expect(result).toEqual(pinnedAssets);
    });

    test("returns empty array when configured as empty", () => {
      const result = resolvePinnedAssets({ pinnedAssets: [] });
      expect(result).toEqual([]);
    });
  });

  describe("savePinnedAssets", () => {
    test("creates config file with pinnedAssets when none exists", async () => {
      const paths = ["folder1", "folder2/subfolder"];

      await savePinnedAssets(testDir, paths);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.pinnedAssets).toEqual(paths);
    });

    test("preserves existing config fields when saving pinnedAssets", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({ contentRoot: "content", inboxPath: "inbox" })
      );

      const paths = ["pinned/folder"];
      await savePinnedAssets(testDir, paths);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.contentRoot).toBe("content");
      expect(parsed.inboxPath).toBe("inbox");
      expect(parsed.pinnedAssets).toEqual(paths);
    });

    test("updates existing pinnedAssets", async () => {
      await writeFile(
        join(testDir, CONFIG_FILE_NAME),
        JSON.stringify({
          pinnedAssets: ["old/path"],
        })
      );

      const newPaths = ["new/path1", "new/path2"];
      await savePinnedAssets(testDir, newPaths);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.pinnedAssets).toEqual(newPaths);
    });

    test("saves empty array when no paths", async () => {
      await savePinnedAssets(testDir, []);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.pinnedAssets).toEqual([]);
    });

    test("handles invalid existing JSON by starting fresh", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), "{ invalid }");

      const paths = ["folder"];
      await savePinnedAssets(testDir, paths);

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      const parsed = JSON.parse(content) as VaultConfig;
      expect(parsed.pinnedAssets).toEqual(paths);
    });
  });
});
