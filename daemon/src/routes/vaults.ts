/**
 * Vault API route handlers.
 *
 * Handles vault discovery, creation, configuration, and slash commands.
 * All operations go through the vault cache.
 */

import type { EditableVaultConfig, SlashCommand } from "@memory-loop/shared";
import { createLogger } from "@memory-loop/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  getVaults,
  getCachedVaultById,
  invalidateCache,
  createVault,
  loadVaultConfig,
  saveVaultConfig,
  savePinnedAssets,
  loadSlashCommands,
  saveSlashCommands,
  VaultCreationError,
} from "../vault";

const log = createLogger("vault-routes");

function jsonError(c: Context, error: string, code: string, status: ContentfulStatusCode, detail?: string): Response {
  return c.json(
    { error, code, ...(detail ? { detail } : {}) },
    status,
  );
}

/**
 * GET /vaults - List all discovered vaults.
 */
export async function listVaultsHandler(c: Context): Promise<Response> {
  const vaults = await getVaults();
  return c.json({ vaults });
}

/**
 * GET /vaults/:id - Get a single vault by ID.
 */
export async function getVaultHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }
  return c.json(vault);
}

/**
 * POST /vaults - Create a new vault.
 */
export async function createVaultHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("title" in body)) {
    return jsonError(c, "Missing required field: title", "INVALID_TITLE", 400);
  }

  const { title } = body as { title: unknown };
  if (typeof title !== "string" || title.trim().length === 0) {
    return jsonError(c, "Title must be a non-empty string", "INVALID_TITLE", 400);
  }

  try {
    const vault = await createVault(title);
    await invalidateCache();
    return c.json(vault, 201);
  } catch (error) {
    if (error instanceof VaultCreationError) {
      return jsonError(c, error.message, "INVALID_TITLE", 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to create vault: ${message}`);
    return jsonError(c, "Internal server error", "INTERNAL_ERROR", 500);
  }
}

/**
 * GET /vaults/:id/config - Get vault configuration.
 */
export async function getVaultConfigHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const config = await loadVaultConfig(vault.path);
  return c.json(config);
}

/**
 * PUT /vaults/:id/config - Update vault configuration.
 */
export async function updateVaultConfigHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const editableConfig = body as EditableVaultConfig;
  const result = await saveVaultConfig(vault.path, editableConfig);

  if (!result.success) {
    return jsonError(c, result.error, "CONFIG_SAVE_FAILED", 500);
  }

  await invalidateCache();
  const updatedConfig = await loadVaultConfig(vault.path);
  return c.json(updatedConfig);
}

/**
 * PUT /vaults/:id/config/pinned-assets - Update pinned assets.
 */
export async function updatePinnedAssetsHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("paths" in body)) {
    return jsonError(c, "Missing required field: paths", "INVALID_REQUEST", 400);
  }

  const { paths } = body as { paths: unknown };
  if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === "string")) {
    return jsonError(c, "paths must be an array of strings", "INVALID_REQUEST", 400);
  }

  await savePinnedAssets(vault.path, paths);
  return c.json({ success: true });
}

/**
 * GET /vaults/:id/config/slash-commands - Get cached slash commands.
 */
export async function getSlashCommandsHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const commands = await loadSlashCommands(vault.path);
  return c.json({ commands: commands ?? null });
}

/**
 * PUT /vaults/:id/config/slash-commands - Save slash commands cache.
 */
export async function updateSlashCommandsHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "Invalid JSON body", "INVALID_REQUEST", 400);
  }

  if (typeof body !== "object" || body === null || !("commands" in body)) {
    return jsonError(c, "Missing required field: commands", "INVALID_REQUEST", 400);
  }

  const { commands } = body as { commands: unknown };
  if (!Array.isArray(commands)) {
    return jsonError(c, "commands must be an array", "INVALID_REQUEST", 400);
  }

  const validCommands: SlashCommand[] = commands
    .filter(
      (cmd): cmd is { name: string; description: string; argumentHint?: string } =>
        typeof cmd === "object" &&
        cmd !== null &&
        typeof (cmd as Record<string, unknown>).name === "string" &&
        typeof (cmd as Record<string, unknown>).description === "string"
    )
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      ...(typeof cmd.argumentHint === "string" && cmd.argumentHint
        ? { argumentHint: cmd.argumentHint }
        : {}),
    }));

  await saveSlashCommands(vault.path, validCommands);
  return c.json({ success: true });
}

/**
 * GET /vaults/help - Vault API discovery.
 */
export function vaultsHelpHandler(c: Context): Response {
  return c.json({
    resource: "vaults",
    endpoints: [
      { path: "/vaults", method: "GET", description: "List all discovered vaults" },
      { path: "/vaults/:id", method: "GET", description: "Get a single vault by ID" },
      { path: "/vaults", method: "POST", description: "Create a new vault (body: { title: string })" },
      { path: "/vaults/:id/config", method: "GET", description: "Get vault configuration" },
      { path: "/vaults/:id/config", method: "PUT", description: "Update vault configuration" },
      { path: "/vaults/:id/config/pinned-assets", method: "PUT", description: "Update pinned assets" },
      { path: "/vaults/:id/config/slash-commands", method: "GET", description: "Get cached slash commands" },
      { path: "/vaults/:id/config/slash-commands", method: "PUT", description: "Save slash commands cache" },
    ],
  });
}
