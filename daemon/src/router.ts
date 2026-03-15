/**
 * Request router for the daemon API.
 *
 * Registers all routes on a Hono app instance.
 */

import type { Hono } from "hono";
import { healthHandler } from "./routes/health";
import { helpHandler } from "./routes/help";
import {
  listVaultsHandler,
  getVaultHandler,
  createVaultHandler,
  getVaultConfigHandler,
  updateVaultConfigHandler,
  updatePinnedAssetsHandler,
  getSlashCommandsHandler,
  updateSlashCommandsHandler,
  vaultsHelpHandler,
} from "./routes/vaults";

export function registerRoutes(app: Hono, startTime: number): void {
  // Health and help
  app.get("/health", (c) => healthHandler(c, startTime));
  app.get("/help", (c) => helpHandler(c));

  // Vault routes (order matters: /vaults/help before /vaults/:id)
  app.get("/vaults", (c) => listVaultsHandler(c));
  app.post("/vaults", (c) => createVaultHandler(c));
  app.get("/vaults/help", (c) => vaultsHelpHandler(c));
  app.get("/vaults/:id", (c) => getVaultHandler(c));
  app.get("/vaults/:id/config", (c) => getVaultConfigHandler(c));
  app.put("/vaults/:id/config", (c) => updateVaultConfigHandler(c));
  app.put("/vaults/:id/config/pinned-assets", (c) => updatePinnedAssetsHandler(c));
  app.get("/vaults/:id/config/slash-commands", (c) => getSlashCommandsHandler(c));
  app.put("/vaults/:id/config/slash-commands", (c) => updateSlashCommandsHandler(c));
}
