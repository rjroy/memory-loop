import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadGlobalConfig,
  getRegistry,
  _resetRegistryForTesting,
} from "../global-config";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "global-config-test-"));
  process.env.MEMORY_LOOP_CONFIG = join(tempDir, "config.json");
});

afterEach(async () => {
  delete process.env.MEMORY_LOOP_CONFIG;
  _resetRegistryForTesting();
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadGlobalConfig", () => {
  test("file not found → registry is empty, no throw", async () => {
    process.env.MEMORY_LOOP_CONFIG = join(tempDir, "nonexistent.json");

    await loadGlobalConfig();

    expect(getRegistry()).toEqual({});
  });

  test("malformed JSON → registry is empty, no throw", async () => {
    await writeFile(join(tempDir, "config.json"), "{ this is not json }", "utf-8");

    await loadGlobalConfig();

    expect(getRegistry()).toEqual({});
  });

  test("valid file with 3 entries → all 3 are loaded with correct shape", async () => {
    const config = {
      models: {
        fast: { provider: "anthropic", modelId: "claude-haiku-3" },
        smart: { provider: "anthropic", modelId: "claude-sonnet-4" },
        local: { provider: "ollama", modelId: "llama3.2" },
      },
    };
    await writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf-8");

    await loadGlobalConfig();

    const reg = getRegistry();
    expect(Object.keys(reg)).toHaveLength(3);
    expect(reg["fast"]).toEqual({ provider: "anthropic", modelId: "claude-haiku-3" });
    expect(reg["smart"]).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4" });
    expect(reg["local"]).toEqual({ provider: "ollama", modelId: "llama3.2" });
  });

  test("one malformed entry (missing modelId) + one valid → valid retained, malformed skipped", async () => {
    const config = {
      models: {
        broken: { provider: "anthropic" },
        good: { provider: "anthropic", modelId: "claude-sonnet-4" },
      },
    };
    await writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf-8");

    await loadGlobalConfig();

    const reg = getRegistry();
    expect(Object.keys(reg)).toHaveLength(1);
    expect(reg["good"]).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4" });
    expect(reg["broken"]).toBeUndefined();
  });

  test("empty models object → registry is empty", async () => {
    const config = { models: {} };
    await writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf-8");

    await loadGlobalConfig();

    expect(getRegistry()).toEqual({});
  });
});
