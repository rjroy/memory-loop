/**
 * Card Generator Config Tests
 *
 * Tests for card generator configuration persistence.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  loadCardGeneratorConfig,
  saveCardGeneratorConfig,
  loadRequirements,
  saveRequirementsOverride,
  deleteRequirementsOverride,
  hasRequirementsOverride,
  getDefaultRequirements,
  getConfigFilePath,
  getRequirementsFilePath,
  DEFAULT_WEEKLY_BYTE_LIMIT,
  DEFAULT_REQUIREMENTS,
} from "../card-generator-config.js";

describe("card-generator-config", () => {
  // =============================================================================
  // Constants Tests
  // =============================================================================

  describe("constants", () => {
    test("DEFAULT_WEEKLY_BYTE_LIMIT is 500KB", () => {
      expect(DEFAULT_WEEKLY_BYTE_LIMIT).toBe(500 * 1024);
    });

    test("DEFAULT_REQUIREMENTS is a non-empty string", () => {
      expect(typeof DEFAULT_REQUIREMENTS).toBe("string");
      expect(DEFAULT_REQUIREMENTS.length).toBeGreaterThan(0);
    });

    test("DEFAULT_REQUIREMENTS contains key instruction points", () => {
      expect(DEFAULT_REQUIREMENTS).toContain("self-contained");
      expect(DEFAULT_REQUIREMENTS).toContain("unique, unambiguous answer");
    });
  });

  // =============================================================================
  // Path Resolution Tests
  // =============================================================================

  describe("path resolution", () => {
    test("getConfigFilePath returns path under home directory", () => {
      const path = getConfigFilePath();
      expect(path.startsWith(homedir())).toBe(true);
    });

    test("getConfigFilePath returns path with correct structure", () => {
      const path = getConfigFilePath();
      expect(path).toContain(".config/memory-loop");
      expect(path.endsWith("card-generator-config.json")).toBe(true);
    });

    test("getRequirementsFilePath returns path under home directory", () => {
      const path = getRequirementsFilePath();
      expect(path.startsWith(homedir())).toBe(true);
    });

    test("getRequirementsFilePath returns path with correct structure", () => {
      const path = getRequirementsFilePath();
      expect(path).toContain(".config/memory-loop");
      expect(path.endsWith("card-generator-requirements.md")).toBe(true);
    });
  });

  // =============================================================================
  // getDefaultRequirements Tests
  // =============================================================================

  describe("getDefaultRequirements", () => {
    test("returns DEFAULT_REQUIREMENTS constant", () => {
      expect(getDefaultRequirements()).toBe(DEFAULT_REQUIREMENTS);
    });
  });

  // =============================================================================
  // Config File I/O Tests
  // =============================================================================

  describe("loadCardGeneratorConfig and saveCardGeneratorConfig", () => {
    let testDir: string;
    let originalHome: string;

    beforeEach(async () => {
      testDir = join(
        tmpdir(),
        `card-generator-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(testDir, { recursive: true });
      originalHome = process.env.HOME ?? "";
      process.env.HOME = testDir;
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    test("returns default config when file does not exist", async () => {
      const config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
    });

    test("writes and reads config correctly", async () => {
      const config = { weeklyByteLimit: 1000000 };

      await saveCardGeneratorConfig(config);
      const loaded = await loadCardGeneratorConfig();

      expect(loaded.weeklyByteLimit).toBe(1000000);
    });

    test("creates config directory if not exists", async () => {
      const config = { weeklyByteLimit: DEFAULT_WEEKLY_BYTE_LIMIT };
      await saveCardGeneratorConfig(config);

      const configPath = getConfigFilePath();
      const content = await readFile(configPath, "utf-8");
      expect(content).toBeDefined();
    });

    test("overwrites existing config file", async () => {
      await saveCardGeneratorConfig({ weeklyByteLimit: 500000 });
      await saveCardGeneratorConfig({ weeklyByteLimit: 1000000 });

      const loaded = await loadCardGeneratorConfig();
      expect(loaded.weeklyByteLimit).toBe(1000000);
    });

    test("returns default for invalid JSON", async () => {
      const configPath = getConfigFilePath();
      await mkdir(join(testDir, ".config/memory-loop"), { recursive: true });
      await writeFile(configPath, "not valid json {{{", "utf-8");

      const config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
    });

    test("returns default for invalid schema", async () => {
      const configPath = getConfigFilePath();
      await mkdir(join(testDir, ".config/memory-loop"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({ invalid: "schema" }),
        "utf-8"
      );

      const config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
    });

    test("returns default for out-of-range byte limit", async () => {
      const configPath = getConfigFilePath();
      await mkdir(join(testDir, ".config/memory-loop"), { recursive: true });
      // Limit is below minimum (100KB)
      await writeFile(
        configPath,
        JSON.stringify({ weeklyByteLimit: 50000 }),
        "utf-8"
      );

      const config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
    });

    test("writes pretty-formatted JSON", async () => {
      await saveCardGeneratorConfig({ weeklyByteLimit: DEFAULT_WEEKLY_BYTE_LIMIT });

      const configPath = getConfigFilePath();
      const content = await readFile(configPath, "utf-8");

      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });
  });

  // =============================================================================
  // Requirements Override I/O Tests
  // =============================================================================

  describe("requirements override operations", () => {
    let testDir: string;
    let originalHome: string;

    beforeEach(async () => {
      testDir = join(
        tmpdir(),
        `requirements-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(testDir, { recursive: true });
      originalHome = process.env.HOME ?? "";
      process.env.HOME = testDir;
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    describe("hasRequirementsOverride", () => {
      test("returns false when no override exists", async () => {
        const result = await hasRequirementsOverride();
        expect(result).toBe(false);
      });

      test("returns true when override exists", async () => {
        await saveRequirementsOverride("custom requirements");
        const result = await hasRequirementsOverride();
        expect(result).toBe(true);
      });
    });

    describe("loadRequirements", () => {
      test("returns default when no override exists", async () => {
        const info = await loadRequirements();

        expect(info.content).toBe(DEFAULT_REQUIREMENTS);
        expect(info.isOverride).toBe(false);
      });

      test("returns override when it exists", async () => {
        const customContent = "Custom requirements\n- Rule 1\n- Rule 2";
        await saveRequirementsOverride(customContent);

        const info = await loadRequirements();

        expect(info.content).toBe(customContent);
        expect(info.isOverride).toBe(true);
      });
    });

    describe("saveRequirementsOverride", () => {
      test("creates requirements file", async () => {
        const content = "My custom requirements";
        await saveRequirementsOverride(content);

        const path = getRequirementsFilePath();
        const saved = await readFile(path, "utf-8");

        expect(saved).toBe(content);
      });

      test("creates config directory if needed", async () => {
        await saveRequirementsOverride("test content");

        const info = await loadRequirements();
        expect(info.isOverride).toBe(true);
      });

      test("overwrites existing override", async () => {
        await saveRequirementsOverride("first version");
        await saveRequirementsOverride("second version");

        const info = await loadRequirements();
        expect(info.content).toBe("second version");
      });
    });

    describe("deleteRequirementsOverride", () => {
      test("removes override file", async () => {
        await saveRequirementsOverride("to be deleted");
        expect(await hasRequirementsOverride()).toBe(true);

        await deleteRequirementsOverride();
        expect(await hasRequirementsOverride()).toBe(false);
      });

      test("is idempotent when no file exists", async () => {
        // Should not throw
        await deleteRequirementsOverride();
        await deleteRequirementsOverride();

        expect(await hasRequirementsOverride()).toBe(false);
      });

      test("loadRequirements returns default after deletion", async () => {
        await saveRequirementsOverride("custom content");
        await deleteRequirementsOverride();

        const info = await loadRequirements();
        expect(info.content).toBe(DEFAULT_REQUIREMENTS);
        expect(info.isOverride).toBe(false);
      });
    });
  });

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe("integration: config and requirements workflow", () => {
    let testDir: string;
    let originalHome: string;

    beforeEach(async () => {
      testDir = join(
        tmpdir(),
        `config-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(testDir, { recursive: true });
      originalHome = process.env.HOME ?? "";
      process.env.HOME = testDir;
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    test("config and requirements files are independent", async () => {
      // Save config
      await saveCardGeneratorConfig({ weeklyByteLimit: 1000000 });

      // Save requirements
      await saveRequirementsOverride("custom requirements");

      // Both should be retrievable independently
      const config = await loadCardGeneratorConfig();
      const requirements = await loadRequirements();

      expect(config.weeklyByteLimit).toBe(1000000);
      expect(requirements.content).toBe("custom requirements");
      expect(requirements.isOverride).toBe(true);
    });

    test("deleting requirements does not affect config", async () => {
      await saveCardGeneratorConfig({ weeklyByteLimit: 2000000 });
      await saveRequirementsOverride("to delete");

      await deleteRequirementsOverride();

      const config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(2000000);
    });

    test("full workflow: customize, verify, reset", async () => {
      // Start with defaults
      let config = await loadCardGeneratorConfig();
      let requirements = await loadRequirements();

      expect(config.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
      expect(requirements.isOverride).toBe(false);

      // Customize both
      await saveCardGeneratorConfig({ weeklyByteLimit: 5000000 });
      await saveRequirementsOverride("My custom rules");

      config = await loadCardGeneratorConfig();
      requirements = await loadRequirements();

      expect(config.weeklyByteLimit).toBe(5000000);
      expect(requirements.content).toBe("My custom rules");
      expect(requirements.isOverride).toBe(true);

      // Reset requirements to default
      await deleteRequirementsOverride();
      requirements = await loadRequirements();

      expect(requirements.content).toBe(DEFAULT_REQUIREMENTS);
      expect(requirements.isOverride).toBe(false);

      // Config should still be customized
      config = await loadCardGeneratorConfig();
      expect(config.weeklyByteLimit).toBe(5000000);
    });
  });
});
