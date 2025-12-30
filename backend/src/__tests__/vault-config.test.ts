/**
 * Vault Configuration Tests
 *
 * Tests for per-vault configuration loading and path resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CONFIG_FILE_NAME,
  DEFAULT_METADATA_PATH,
  loadVaultConfig,
  resolveContentRoot,
  resolveMetadataPath,
  resolveGoalsPath,
  resolveContextualPromptsPath,
  resolveGeneralInspirationPath,
  type VaultConfig,
} from "../vault-config";

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
});
