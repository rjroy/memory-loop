/**
 * Config REST Routes
 *
 * REST endpoints for vault configuration:
 * - GET /pinned-assets - Get pinned asset paths (REQ-F-29)
 * - PUT /pinned-assets - Set pinned asset paths (REQ-F-30)
 * - PATCH /config - Update vault config (REQ-F-31)
 * - POST /setup - Setup vault (REQ-F-32)
 *
 * Note: POST /api/vaults (create vault, REQ-F-33) is not vault-scoped
 * and is registered directly in server.ts.
 */

import { Hono } from "hono";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import {
  handleGetPinnedAssets,
  handleSetPinnedAssets,
  handleUpdateVaultConfig,
  handleSetupVault,
  ConfigValidationError,
  VaultNotFoundError,
} from "../handlers/config-handlers";
import { createLogger } from "../logger";

const log = createLogger("ConfigRoutes");

/**
 * Hono router for vault-scoped config routes.
 */
const configRoutes = new Hono();

/**
 * GET /pinned-assets - Get pinned asset paths
 */
configRoutes.get("/pinned-assets", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`GET /pinned-assets for vault ${vault.id}`);

  try {
    const result = await handleGetPinnedAssets(vault.path);
    return c.json(result);
  } catch (error) {
    log.error("Failed to get pinned assets", error);
    const message = error instanceof Error ? error.message : "Failed to get pinned assets";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * PUT /pinned-assets - Set pinned asset paths
 */
configRoutes.put("/pinned-assets", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`PUT /pinned-assets for vault ${vault.id}`);

  let body: { paths?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  if (!body.paths || !Array.isArray(body.paths)) {
    return jsonError(c, 400, "VALIDATION_ERROR", "paths is required and must be an array");
  }

  try {
    const result = await handleSetPinnedAssets(vault.path, body.paths);
    return c.json(result);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return jsonError(c, 400, "VALIDATION_ERROR", error.message);
    }
    log.error("Failed to set pinned assets", error);
    const message = error instanceof Error ? error.message : "Failed to set pinned assets";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * PATCH /config - Update vault configuration
 */
configRoutes.patch("/config", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`PATCH /config for vault ${vault.id}`);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  try {
    const result = await handleUpdateVaultConfig(vault.path, body as Parameters<typeof handleUpdateVaultConfig>[1]);

    if (!result.success) {
      return jsonError(c, 400, "VALIDATION_ERROR", result.error ?? "Failed to update config");
    }

    return c.json({ success: true });
  } catch (error) {
    log.error("Failed to update vault config", error);
    const message = error instanceof Error ? error.message : "Failed to update config";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * POST /setup - Setup vault (create directories, install commands)
 */
configRoutes.post("/setup", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`POST /setup for vault ${vault.id}`);

  try {
    const result = await handleSetupVault(vault.id);
    return c.json(result);
  } catch (error) {
    if (error instanceof VaultNotFoundError) {
      return jsonError(c, 404, "VAULT_NOT_FOUND", error.message);
    }
    if (error instanceof ConfigValidationError) {
      return jsonError(c, 400, "VALIDATION_ERROR", error.message);
    }
    log.error("Failed to setup vault", error);
    const message = error instanceof Error ? error.message : "Failed to setup vault";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

export { configRoutes };
