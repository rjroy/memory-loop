import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@memory-loop/shared";
import { getVaultsDir } from "./vault/vault-manager";

const log = createLogger("GlobalConfig");

export interface ModelEntry {
  provider: string;
  modelId: string;
}

export type ModelRegistry = Record<string, ModelEntry>;

let registry: ModelRegistry = {};

function getConfigFilePath(): string {
  return (
    process.env.MEMORY_LOOP_CONFIG ??
    join(getVaultsDir(), "memory-loop-config.json")
  );
}

function isModelEntry(value: unknown): value is ModelEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.provider === "string" && typeof entry.modelId === "string";
}

function parseRegistry(parsed: unknown): ModelRegistry {
  if (typeof parsed !== "object" || parsed === null || !("models" in parsed)) {
    return {};
  }
  const modelsRaw = (parsed as Record<string, unknown>).models;
  if (typeof modelsRaw !== "object" || modelsRaw === null) {
    return {};
  }

  const result: ModelRegistry = {};
  for (const [name, entry] of Object.entries(modelsRaw)) {
    if (isModelEntry(entry)) {
      result[name] = entry;
    } else {
      log.warn(`Skipping invalid model entry "${name}" in global config`);
    }
  }
  return result;
}

export function getRegistry(): ModelRegistry {
  return registry;
}

export async function loadGlobalConfig(): Promise<void> {
  const path = getConfigFilePath();

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    log.warn(`Global config not found at ${path}, model registry is empty`);
    registry = {};
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn(`Global config at ${path} is not valid JSON, model registry is empty`);
    registry = {};
    return;
  }

  registry = parseRegistry(parsed);
  log.info(`Loaded ${Object.keys(registry).length} model(s) from global config`);
}

export function configureRegistryForTesting(r: ModelRegistry): () => void {
  const prev = registry;
  registry = r;
  return () => {
    registry = prev;
  };
}

export function _resetRegistryForTesting(): void {
  registry = {};
}
