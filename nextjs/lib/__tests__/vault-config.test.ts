/**
 * Vault Configuration Tests
 *
 * Tests for per-vault configuration loading and path resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CONFIG_FILE_NAME,
  SLASH_COMMANDS_FILE,
  DEFAULT_METADATA_PATH,
  DEFAULT_PROJECT_PATH,
  DEFAULT_AREA_PATH,
  DEFAULT_PROMPTS_PER_GENERATION,
  DEFAULT_MAX_POOL_SIZE,
  DEFAULT_QUOTES_PER_WEEK,
  DEFAULT_DISCUSSION_MODEL,
  DEFAULT_CARDS_ENABLED,
  DEFAULT_VI_MODE,
  VALID_DISCUSSION_MODELS,
  loadVaultConfig,
  loadSlashCommands,
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
  resolveDiscussionModel,
  resolveCardsEnabled,
  resolveViMode,
  saveSlashCommands,
  savePinnedAssets,
  saveVaultConfig,
  slashCommandsEqual,
  type VaultConfig,
} from "../vault-config";
import type { SlashCommand, EditableVaultConfig } from "@/lib/schemas";

// Test helpers
async function writeConfig(dir: string, data: unknown): Promise<void> {
  await writeFile(join(dir, CONFIG_FILE_NAME), JSON.stringify(data));
}

async function readConfig(dir: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(dir, CONFIG_FILE_NAME), "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

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

  describe("exported constants", () => {
    test("exports expected default values", () => {
      expect(CONFIG_FILE_NAME).toBe(".memory-loop.json");
      expect(DEFAULT_METADATA_PATH).toBe("06_Metadata/memory-loop");
      expect(DEFAULT_PROJECT_PATH).toBe("01_Projects");
      expect(DEFAULT_AREA_PATH).toBe("02_Areas");
      expect(DEFAULT_PROMPTS_PER_GENERATION).toBe(5);
      expect(DEFAULT_MAX_POOL_SIZE).toBe(50);
      expect(DEFAULT_QUOTES_PER_WEEK).toBe(1);
      expect(DEFAULT_DISCUSSION_MODEL).toBe("opus");
      expect(DEFAULT_CARDS_ENABLED).toBe(true);
      expect(DEFAULT_VI_MODE).toBe(false);
      expect(VALID_DISCUSSION_MODELS).toEqual(["opus", "sonnet", "haiku"]);
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
        projectPath: "custom_projects",
        areaPath: "custom_areas",
      };
      await writeConfig(testDir, configData);

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test.each([
      ["contentRoot", { contentRoot: "content" }],
      ["inboxPath", { inboxPath: "inbox" }],
      ["metadataPath", { metadataPath: "meta" }],
      ["title", { title: "Custom Vault Title" }],
      ["subtitle", { subtitle: "Personal Notes" }],
      ["projectPath", { projectPath: "projects" }],
      ["areaPath", { areaPath: "areas" }],
    ])("loads config with only %s", async (_fieldName, expected) => {
      await writeConfig(testDir, expected);

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(expected);
    });

    test("loads config with title and subtitle", async () => {
      const configData: VaultConfig = { title: "My Vault", subtitle: "Personal Notes" };
      await writeConfig(testDir, configData);

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual(configData);
    });

    test("ignores non-string values for string fields", async () => {
      await writeConfig(testDir, {
        contentRoot: 123,
        inboxPath: null,
        metadataPath: ["array"],
        title: 456,
        subtitle: { obj: true },
        projectPath: 42,
        areaPath: { nested: "object" },
      });

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({});
    });

    test("ignores unknown fields", async () => {
      await writeConfig(testDir, {
        contentRoot: "content",
        unknownField: "value",
        anotherUnknown: 42,
      });

      const config = await loadVaultConfig(testDir);
      expect(config).toEqual({ contentRoot: "content" });
    });

    test.each([
      ["invalid JSON", "{ invalid json }"],
      ["array", '["array"]'],
      ["string", '"string"'],
      ["null", "null"],
      ["empty object", "{}"],
    ])("returns empty object for %s", async (_desc, content) => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), content);

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

    describe("generation settings", () => {
      test("loads numeric generation settings", async () => {
        await writeConfig(testDir, {
          promptsPerGeneration: 7,
          maxPoolSize: 75,
          quotesPerWeek: 2,
        });

        const config = await loadVaultConfig(testDir);
        expect(config.promptsPerGeneration).toBe(7);
        expect(config.maxPoolSize).toBe(75);
        expect(config.quotesPerWeek).toBe(2);
      });

      test("ignores non-numeric generation settings", async () => {
        await writeConfig(testDir, {
          promptsPerGeneration: "five",
          maxPoolSize: null,
          quotesPerWeek: [],
        });

        const config = await loadVaultConfig(testDir);
        expect(config.promptsPerGeneration).toBeUndefined();
        expect(config.maxPoolSize).toBeUndefined();
        expect(config.quotesPerWeek).toBeUndefined();
      });

      test("ignores zero or negative generation settings", async () => {
        await writeConfig(testDir, {
          promptsPerGeneration: 0,
          maxPoolSize: -5,
          quotesPerWeek: -1,
        });

        const config = await loadVaultConfig(testDir);
        expect(config.promptsPerGeneration).toBeUndefined();
        expect(config.maxPoolSize).toBeUndefined();
        expect(config.quotesPerWeek).toBeUndefined();
      });

      test("floors decimal values for generation settings", async () => {
        await writeConfig(testDir, {
          promptsPerGeneration: 5.7,
          maxPoolSize: 50.9,
          quotesPerWeek: 2.3,
        });

        const config = await loadVaultConfig(testDir);
        expect(config.promptsPerGeneration).toBe(5);
        expect(config.maxPoolSize).toBe(50);
        expect(config.quotesPerWeek).toBe(2);
      });
    });

    describe("discussionModel", () => {
      test.each(["opus", "sonnet", "haiku"] as const)(
        "loads valid discussionModel %s",
        async (model) => {
          await writeConfig(testDir, { discussionModel: model });

          const config = await loadVaultConfig(testDir);
          expect(config.discussionModel).toBe(model);
        }
      );

      test("ignores invalid discussionModel value", async () => {
        await writeConfig(testDir, { discussionModel: "invalid-model" });

        const config = await loadVaultConfig(testDir);
        expect(config.discussionModel).toBeUndefined();
      });

      test("ignores non-string discussionModel value", async () => {
        await writeConfig(testDir, { discussionModel: 123 });

        const config = await loadVaultConfig(testDir);
        expect(config.discussionModel).toBeUndefined();
      });
    });

    describe("boolean fields (cardsEnabled, viMode)", () => {
      test.each([
        ["cardsEnabled", true],
        ["cardsEnabled", false],
        ["viMode", true],
        ["viMode", false],
      ])("loads %s when set to %s", async (field, value) => {
        await writeConfig(testDir, { [field]: value });

        const config = await loadVaultConfig(testDir);
        expect(config[field as keyof VaultConfig]).toBe(value);
      });

      test.each([
        ["cardsEnabled", "true"],
        ["cardsEnabled", 1],
        ["viMode", "true"],
        ["viMode", 1],
      ])("ignores non-boolean %s value %s", async (field, value) => {
        await writeConfig(testDir, { [field]: value });

        const config = await loadVaultConfig(testDir);
        expect(config[field as keyof VaultConfig]).toBeUndefined();
      });
    });

    describe("badges", () => {
      test("loads config with valid badges array", async () => {
        const badges = [
          { text: "Work", color: "blue" as const },
          { text: "Personal", color: "green" as const },
        ];
        await writeConfig(testDir, { badges });

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
        await writeConfig(testDir, { badges });

        const config = await loadVaultConfig(testDir);
        expect(config.badges).toEqual(badges);
      });

      test("filters out invalid badges", async () => {
        await writeConfig(testDir, {
          badges: [
            { text: "Valid", color: "blue" },
            { text: "Invalid Color", color: "pink" },
            { color: "red" }, // missing text
            { text: "", color: "green" }, // empty text
            { text: "No Color" }, // missing color
            null,
            "string",
            42,
            { text: "Also Valid", color: "red" },
          ],
        });

        const config = await loadVaultConfig(testDir);
        expect(config.badges).toEqual([
          { text: "Valid", color: "blue" },
          { text: "Also Valid", color: "red" },
        ]);
      });

      test("returns undefined badges when not an array", async () => {
        await writeConfig(testDir, { badges: "not an array" });

        const config = await loadVaultConfig(testDir);
        expect(config.badges).toBeUndefined();
      });

      test("returns empty array when badges is empty array", async () => {
        await writeConfig(testDir, { badges: [] });

        const config = await loadVaultConfig(testDir);
        expect(config.badges).toEqual([]);
      });
    });

    describe("pinnedAssets", () => {
      test("loads config with valid pinnedAssets array", async () => {
        const pinnedAssets = ["folder1", "folder2/subfolder", "notes/daily.md"];
        await writeConfig(testDir, { pinnedAssets });

        const config = await loadVaultConfig(testDir);
        expect(config.pinnedAssets).toEqual(pinnedAssets);
      });

      test("filters out non-string pinnedAssets entries", async () => {
        await writeConfig(testDir, {
          pinnedAssets: ["valid/path", null, 42, { nested: "object" }, "another/valid", ""],
        });

        const config = await loadVaultConfig(testDir);
        expect(config.pinnedAssets).toEqual(["valid/path", "another/valid"]);
      });

      test("returns undefined pinnedAssets when not an array", async () => {
        await writeConfig(testDir, { pinnedAssets: "not an array" });

        const config = await loadVaultConfig(testDir);
        expect(config.pinnedAssets).toBeUndefined();
      });

      test("returns empty array when pinnedAssets is empty array", async () => {
        await writeConfig(testDir, { pinnedAssets: [] });

        const config = await loadVaultConfig(testDir);
        expect(config.pinnedAssets).toEqual([]);
      });
    });
  });

  describe("resolveContentRoot", () => {
    test("returns vault path when no contentRoot configured", () => {
      expect(resolveContentRoot("/vault/path", {})).toBe("/vault/path");
      expect(resolveContentRoot("/vault/path", { contentRoot: undefined })).toBe("/vault/path");
      expect(resolveContentRoot("/vault/path", { contentRoot: "" })).toBe("/vault/path");
    });

    test("joins contentRoot to vault path", () => {
      expect(resolveContentRoot("/vault/path", { contentRoot: "content" })).toBe(
        "/vault/path/content"
      );
      expect(resolveContentRoot("/vault/path", { contentRoot: "src/content" })).toBe(
        "/vault/path/src/content"
      );
    });

    test("rejects path traversal attempts", () => {
      expect(resolveContentRoot("/vault/path", { contentRoot: "../outside" })).toBe("/vault/path");
      expect(resolveContentRoot("/vault/path", { contentRoot: "content/../../outside" })).toBe(
        "/vault/path"
      );
      expect(resolveContentRoot("/vault/path", { contentRoot: "/etc/passwd" })).toBe("/vault/path");
    });

    test("allows paths that contain .. but resolve within vault", () => {
      expect(resolveContentRoot("/vault/path", { contentRoot: "content/../other" })).toBe(
        "/vault/path/other"
      );
    });
  });

  describe("path resolvers", () => {
    test("resolveMetadataPath returns default or configured value", () => {
      expect(resolveMetadataPath({})).toBe(DEFAULT_METADATA_PATH);
      expect(resolveMetadataPath({ metadataPath: undefined })).toBe(DEFAULT_METADATA_PATH);
      expect(resolveMetadataPath({ metadataPath: "meta" })).toBe("meta");
      expect(resolveMetadataPath({ metadataPath: "" })).toBe("");
    });

    test("resolveGoalsPath appends goals.md to metadata path", () => {
      expect(resolveGoalsPath({})).toBe("06_Metadata/memory-loop/goals.md");
      expect(resolveGoalsPath({ metadataPath: "meta" })).toBe("meta/goals.md");
      expect(resolveGoalsPath({ metadataPath: "deep/nested/meta" })).toBe(
        "deep/nested/meta/goals.md"
      );
    });

    test("resolveContextualPromptsPath appends contextual-prompts.md to metadata path", () => {
      expect(resolveContextualPromptsPath({})).toBe(
        "06_Metadata/memory-loop/contextual-prompts.md"
      );
      expect(resolveContextualPromptsPath({ metadataPath: "meta" })).toBe(
        "meta/contextual-prompts.md"
      );
    });

    test("resolveGeneralInspirationPath appends general-inspiration.md to metadata path", () => {
      expect(resolveGeneralInspirationPath({})).toBe(
        "06_Metadata/memory-loop/general-inspiration.md"
      );
      expect(resolveGeneralInspirationPath({ metadataPath: "meta" })).toBe(
        "meta/general-inspiration.md"
      );
    });

    test("resolveProjectPath returns default or configured value", () => {
      expect(resolveProjectPath({})).toBe(DEFAULT_PROJECT_PATH);
      expect(resolveProjectPath({ projectPath: undefined })).toBe(DEFAULT_PROJECT_PATH);
      expect(resolveProjectPath({ projectPath: "custom_projects" })).toBe("custom_projects");
      expect(resolveProjectPath({ projectPath: "" })).toBe("");
      expect(resolveProjectPath({ projectPath: "work/projects" })).toBe("work/projects");
    });

    test("resolveAreaPath returns default or configured value", () => {
      expect(resolveAreaPath({})).toBe(DEFAULT_AREA_PATH);
      expect(resolveAreaPath({ areaPath: undefined })).toBe(DEFAULT_AREA_PATH);
      expect(resolveAreaPath({ areaPath: "custom_areas" })).toBe("custom_areas");
      expect(resolveAreaPath({ areaPath: "" })).toBe("");
      expect(resolveAreaPath({ areaPath: "life/areas" })).toBe("life/areas");
    });
  });

  describe("numeric resolvers", () => {
    test("resolvePromptsPerGeneration returns default or configured value", () => {
      expect(resolvePromptsPerGeneration({})).toBe(DEFAULT_PROMPTS_PER_GENERATION);
      expect(resolvePromptsPerGeneration({ promptsPerGeneration: undefined })).toBe(
        DEFAULT_PROMPTS_PER_GENERATION
      );
      expect(resolvePromptsPerGeneration({ promptsPerGeneration: 10 })).toBe(10);
    });

    test("resolveMaxPoolSize returns default or configured value", () => {
      expect(resolveMaxPoolSize({})).toBe(DEFAULT_MAX_POOL_SIZE);
      expect(resolveMaxPoolSize({ maxPoolSize: undefined })).toBe(DEFAULT_MAX_POOL_SIZE);
      expect(resolveMaxPoolSize({ maxPoolSize: 100 })).toBe(100);
    });

    test("resolveQuotesPerWeek returns default or configured value", () => {
      expect(resolveQuotesPerWeek({})).toBe(DEFAULT_QUOTES_PER_WEEK);
      expect(resolveQuotesPerWeek({ quotesPerWeek: undefined })).toBe(DEFAULT_QUOTES_PER_WEEK);
      expect(resolveQuotesPerWeek({ quotesPerWeek: 3 })).toBe(3);
    });
  });

  describe("resolveDiscussionModel", () => {
    test("returns default when not configured", () => {
      expect(resolveDiscussionModel({})).toBe(DEFAULT_DISCUSSION_MODEL);
      expect(resolveDiscussionModel({ discussionModel: undefined })).toBe(DEFAULT_DISCUSSION_MODEL);
    });

    test.each(["opus", "sonnet", "haiku"] as const)("returns configured model %s", (model) => {
      expect(resolveDiscussionModel({ discussionModel: model })).toBe(model);
    });
  });

  describe("boolean resolvers", () => {
    test("resolveCardsEnabled returns default or configured value", () => {
      expect(resolveCardsEnabled({})).toBe(true);
      expect(resolveCardsEnabled({ cardsEnabled: undefined })).toBe(true);
      expect(resolveCardsEnabled({ cardsEnabled: true })).toBe(true);
      expect(resolveCardsEnabled({ cardsEnabled: false })).toBe(false);
    });

    test("resolveViMode returns default or configured value", () => {
      expect(resolveViMode({})).toBe(false);
      expect(resolveViMode({ viMode: undefined })).toBe(false);
      expect(resolveViMode({ viMode: true })).toBe(true);
      expect(resolveViMode({ viMode: false })).toBe(false);
    });
  });

  describe("resolveBadges", () => {
    test("returns empty array when not configured", () => {
      expect(resolveBadges({})).toEqual([]);
      expect(resolveBadges({ badges: undefined })).toEqual([]);
      expect(resolveBadges({ badges: [] })).toEqual([]);
    });

    test("returns configured badges", () => {
      const badges = [
        { text: "Work", color: "blue" as const },
        { text: "Personal", color: "green" as const },
      ];
      expect(resolveBadges({ badges })).toEqual(badges);
    });
  });

  describe("resolvePinnedAssets", () => {
    test("returns empty array when not configured", () => {
      expect(resolvePinnedAssets({})).toEqual([]);
      expect(resolvePinnedAssets({ pinnedAssets: undefined })).toEqual([]);
      expect(resolvePinnedAssets({ pinnedAssets: [] })).toEqual([]);
    });

    test("returns configured pinnedAssets", () => {
      const pinnedAssets = ["folder1", "folder2/subfolder"];
      expect(resolvePinnedAssets({ pinnedAssets })).toEqual(pinnedAssets);
    });
  });

  describe("loadSlashCommands", () => {
    test("returns undefined when cache file does not exist", async () => {
      const commands = await loadSlashCommands(testDir);
      expect(commands).toBeUndefined();
    });

    test("loads valid slash commands array", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit" },
        { name: "/review", description: "Review code", argumentHint: "file" },
      ];
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(join(testDir, SLASH_COMMANDS_FILE), JSON.stringify(commands));

      const result = await loadSlashCommands(testDir);
      expect(result).toEqual(commands);
    });

    test("filters out invalid slash command entries", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(
        join(testDir, SLASH_COMMANDS_FILE),
        JSON.stringify([
          { name: "/valid", description: "Valid command" },
          { name: "/missing-desc" },
          { description: "Missing name" },
          null,
          "not an object",
          42,
        ])
      );

      const result = await loadSlashCommands(testDir);
      expect(result).toEqual([{ name: "/valid", description: "Valid command" }]);
    });

    test("returns undefined when cache is not an array", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(join(testDir, SLASH_COMMANDS_FILE), JSON.stringify({ slashCommands: [] }));

      const result = await loadSlashCommands(testDir);
      expect(result).toBeUndefined();
    });

    test("returns empty array when cache is empty array", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(join(testDir, SLASH_COMMANDS_FILE), JSON.stringify([]));

      const result = await loadSlashCommands(testDir);
      expect(result).toEqual([]);
    });

    test("sanitizes null argumentHint to undefined", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(
        join(testDir, SLASH_COMMANDS_FILE),
        JSON.stringify([
          { name: "/test", description: "Test command", argumentHint: null },
          { name: "/other", description: "Other command", argumentHint: "" },
          { name: "/valid", description: "Valid hint", argumentHint: "file" },
        ])
      );

      const result = await loadSlashCommands(testDir);
      expect(result).toHaveLength(3);
      expect(result?.[0]).toEqual({ name: "/test", description: "Test command" });
      expect(result?.[1]).toEqual({ name: "/other", description: "Other command" });
      expect(result?.[2]).toEqual({ name: "/valid", description: "Valid hint", argumentHint: "file" });
    });

    test("returns undefined when cache file is invalid JSON", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(join(testDir, SLASH_COMMANDS_FILE), "{ invalid }");

      const result = await loadSlashCommands(testDir);
      expect(result).toBeUndefined();
    });
  });

  describe("saveSlashCommands", () => {
    test("creates cache file and directory when none exists", async () => {
      const commands: SlashCommand[] = [{ name: "/commit", description: "Create a commit" }];

      await saveSlashCommands(testDir, commands);

      const content = await readFile(join(testDir, SLASH_COMMANDS_FILE), "utf-8");
      const parsed = JSON.parse(content) as SlashCommand[];
      expect(parsed).toEqual(commands);
    });

    test("updates existing cache file", async () => {
      await mkdir(join(testDir, ".memory-loop"), { recursive: true });
      await writeFile(
        join(testDir, SLASH_COMMANDS_FILE),
        JSON.stringify([{ name: "/old", description: "Old command" }])
      );

      const newCommands: SlashCommand[] = [{ name: "/new", description: "New command" }];
      await saveSlashCommands(testDir, newCommands);

      const content = await readFile(join(testDir, SLASH_COMMANDS_FILE), "utf-8");
      const parsed = JSON.parse(content) as SlashCommand[];
      expect(parsed).toEqual(newCommands);
    });

    test("saves empty array when no commands", async () => {
      await saveSlashCommands(testDir, []);

      const content = await readFile(join(testDir, SLASH_COMMANDS_FILE), "utf-8");
      const parsed = JSON.parse(content) as SlashCommand[];
      expect(parsed).toEqual([]);
    });

    test("does not affect main config file", async () => {
      await writeConfig(testDir, { contentRoot: "content" });

      const commands: SlashCommand[] = [{ name: "/test", description: "Test" }];
      await saveSlashCommands(testDir, commands);

      const mainParsed = await readConfig(testDir);
      expect(mainParsed).toEqual({ contentRoot: "content" });

      const cacheContent = await readFile(join(testDir, SLASH_COMMANDS_FILE), "utf-8");
      const cacheParsed = JSON.parse(cacheContent) as SlashCommand[];
      expect(cacheParsed).toEqual(commands);
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

    test("returns false when command properties differ", () => {
      // Different names
      expect(
        slashCommandsEqual(
          [{ name: "/a", description: "Desc" }],
          [{ name: "/b", description: "Desc" }]
        )
      ).toBe(false);

      // Different descriptions
      expect(
        slashCommandsEqual(
          [{ name: "/test", description: "Desc A" }],
          [{ name: "/test", description: "Desc B" }]
        )
      ).toBe(false);

      // Different argumentHints
      expect(
        slashCommandsEqual(
          [{ name: "/test", description: "Desc", argumentHint: "a" }],
          [{ name: "/test", description: "Desc", argumentHint: "b" }]
        )
      ).toBe(false);

      // One has argumentHint, other does not
      expect(
        slashCommandsEqual(
          [{ name: "/test", description: "Desc", argumentHint: "hint" }],
          [{ name: "/test", description: "Desc" }]
        )
      ).toBe(false);
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

  describe("savePinnedAssets", () => {
    test("creates config file with pinnedAssets when none exists", async () => {
      const paths = ["folder1", "folder2/subfolder"];

      await savePinnedAssets(testDir, paths);

      const parsed = await readConfig(testDir);
      expect(parsed.pinnedAssets).toEqual(paths);
    });

    test("preserves existing config fields when saving pinnedAssets", async () => {
      await writeConfig(testDir, { contentRoot: "content", inboxPath: "inbox" });

      const paths = ["pinned/folder"];
      await savePinnedAssets(testDir, paths);

      const parsed = await readConfig(testDir);
      expect(parsed.contentRoot).toBe("content");
      expect(parsed.inboxPath).toBe("inbox");
      expect(parsed.pinnedAssets).toEqual(paths);
    });

    test("updates existing pinnedAssets", async () => {
      await writeConfig(testDir, { pinnedAssets: ["old/path"] });

      const newPaths = ["new/path1", "new/path2"];
      await savePinnedAssets(testDir, newPaths);

      const parsed = await readConfig(testDir);
      expect(parsed.pinnedAssets).toEqual(newPaths);
    });

    test("saves empty array when no paths", async () => {
      await savePinnedAssets(testDir, []);

      const parsed = await readConfig(testDir);
      expect(parsed.pinnedAssets).toEqual([]);
    });

    test("handles invalid existing JSON by starting fresh", async () => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), "{ invalid }");

      const paths = ["folder"];
      await savePinnedAssets(testDir, paths);

      const parsed = await readConfig(testDir);
      expect(parsed.pinnedAssets).toEqual(paths);
    });
  });

  describe("saveVaultConfig", () => {
    test("preserves non-editable fields", async () => {
      const existingConfig = {
        contentRoot: "content",
        inboxPath: "inbox",
        metadataPath: "meta/memory-loop",
        projectPath: "custom_projects",
        areaPath: "custom_areas",
        attachmentPath: "custom_attachments",
        pinnedAssets: ["pinned/folder", "pinned/file.md"],
      };
      await writeConfig(testDir, existingConfig);

      const editableConfig: EditableVaultConfig = {
        title: "New Title",
        discussionModel: "sonnet",
      };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.contentRoot).toBe("content");
      expect(parsed.inboxPath).toBe("inbox");
      expect(parsed.metadataPath).toBe("meta/memory-loop");
      expect(parsed.projectPath).toBe("custom_projects");
      expect(parsed.areaPath).toBe("custom_areas");
      expect(parsed.attachmentPath).toBe("custom_attachments");
      expect(parsed.pinnedAssets).toEqual(["pinned/folder", "pinned/file.md"]);
      expect(parsed.title).toBe("New Title");
      expect(parsed.discussionModel).toBe("sonnet");
    });

    test("creates file when it does not exist and values are non-default", async () => {
      const editableConfig: EditableVaultConfig = {
        title: "My Vault",
        subtitle: "Personal Notes",
      };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.title).toBe("My Vault");
      expect(parsed.subtitle).toBe("Personal Notes");
    });

    test("does NOT create file if all values are defaults", async () => {
      const result = await saveVaultConfig(testDir, {});

      expect(result).toEqual({ success: true });

      const configPath = join(testDir, CONFIG_FILE_NAME);
      let fileExists = true;
      try {
        await readFile(configPath, "utf-8");
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    test("does NOT create file if only empty badges array provided", async () => {
      const result = await saveVaultConfig(testDir, { badges: [] });

      expect(result).toEqual({ success: true });

      const configPath = join(testDir, CONFIG_FILE_NAME);
      let fileExists = true;
      try {
        await readFile(configPath, "utf-8");
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    test("merges only editable fields over existing config", async () => {
      await writeConfig(testDir, {
        title: "Old Title",
        subtitle: "Old Subtitle",
        contentRoot: "content",
        discussionModel: "opus",
        promptsPerGeneration: 5,
      });

      const editableConfig: EditableVaultConfig = {
        title: "New Title",
        badges: [{ text: "Work", color: "blue" }],
      };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.title).toBe("New Title");
      expect(parsed.badges).toEqual([{ text: "Work", color: "blue" }]);
      expect(parsed.subtitle).toBe("Old Subtitle");
      expect(parsed.discussionModel).toBe("opus");
      expect(parsed.promptsPerGeneration).toBe(5);
      expect(parsed.contentRoot).toBe("content");
    });

    test("returns success false with error on write failure", async () => {
      const configPath = join(testDir, CONFIG_FILE_NAME);
      await mkdir(configPath, { recursive: true });

      const editableConfig: EditableVaultConfig = { title: "Test Vault" };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe("string");
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    test.each([
      ["malformed JSON", "{ invalid json }"],
      ["array", '["array", "data"]'],
      ["null", "null"],
    ])("handles %s existing content by starting fresh", async (_desc, content) => {
      await writeFile(join(testDir, CONFIG_FILE_NAME), content);

      const editableConfig: EditableVaultConfig = { title: "Fresh Start" };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.title).toBe("Fresh Start");
    });

    test("saves all editable fields correctly", async () => {
      const editableConfig: EditableVaultConfig = {
        title: "Complete Vault",
        subtitle: "All Fields",
        discussionModel: "sonnet",
        promptsPerGeneration: 10,
        maxPoolSize: 100,
        quotesPerWeek: 3,
        recentCaptures: 10,
        recentDiscussions: 8,
        badges: [
          { text: "Work", color: "blue" },
          { text: "Personal", color: "green" },
        ],
      };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.title).toBe("Complete Vault");
      expect(parsed.subtitle).toBe("All Fields");
      expect(parsed.discussionModel).toBe("sonnet");
      expect(parsed.promptsPerGeneration).toBe(10);
      expect(parsed.maxPoolSize).toBe(100);
      expect(parsed.quotesPerWeek).toBe(3);
      expect(parsed.recentCaptures).toBe(10);
      expect(parsed.recentDiscussions).toBe(8);
      expect(parsed.badges).toEqual([
        { text: "Work", color: "blue" },
        { text: "Personal", color: "green" },
      ]);
    });

    test("updates existing file when file exists even with all defaults", async () => {
      await writeConfig(testDir, { contentRoot: "content", title: "Old Title" });

      const result = await saveVaultConfig(testDir, {});

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.contentRoot).toBe("content");
      expect(parsed.title).toBe("Old Title");
    });

    test("preserves unknown fields in existing config", async () => {
      await writeConfig(testDir, {
        customField: "custom value",
        anotherUnknown: 42,
        title: "Old Title",
      });

      const editableConfig: EditableVaultConfig = { title: "New Title" };
      const result = await saveVaultConfig(testDir, editableConfig);

      expect(result).toEqual({ success: true });

      const parsed = await readConfig(testDir);
      expect(parsed.title).toBe("New Title");
      expect(parsed.customField).toBe("custom value");
      expect(parsed.anotherUnknown).toBe(42);
    });

    test("writes pretty-printed JSON with trailing newline", async () => {
      await saveVaultConfig(testDir, { title: "Test" });

      const content = await readFile(join(testDir, CONFIG_FILE_NAME), "utf-8");
      expect(content).toContain("\n");
      expect(content.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(content) as unknown).not.toThrow();
    });

    describe("cardsEnabled and viMode persistence", () => {
      test.each([
        ["cardsEnabled", false],
        ["viMode", true],
      ])("saves %s field correctly", async (field, value) => {
        const editableConfig: EditableVaultConfig = { title: "Test", [field]: value };
        const result = await saveVaultConfig(testDir, editableConfig);

        expect(result).toEqual({ success: true });

        const parsed = await readConfig(testDir);
        expect(parsed.title).toBe("Test");
        expect(parsed[field]).toBe(value);
      });

      test.each([
        ["cardsEnabled", false],
        ["viMode", true],
      ])("preserves %s when updating other fields", async (field, value) => {
        await writeConfig(testDir, { [field]: value });

        const result = await saveVaultConfig(testDir, { title: "New Title" });

        expect(result).toEqual({ success: true });

        const parsed = await readConfig(testDir);
        expect(parsed.title).toBe("New Title");
        expect(parsed[field]).toBe(value);
      });

      test.each([
        ["cardsEnabled", false, true],
        ["viMode", true, false],
      ])("updates %s from %s to %s when explicitly set", async (field, initial, updated) => {
        await writeConfig(testDir, { [field]: initial, title: "Vault" });

        const editableConfig: EditableVaultConfig = { [field]: updated };
        const result = await saveVaultConfig(testDir, editableConfig);

        expect(result).toEqual({ success: true });

        const parsed = await readConfig(testDir);
        expect(parsed[field]).toBe(updated);
        expect(parsed.title).toBe("Vault");
      });
    });
  });
});
