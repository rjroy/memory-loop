/**
 * Route Index
 *
 * Registers all REST routes under `/api/vaults/:vaultId/*` with vault middleware.
 *
 * Requirements:
 * - REQ-F-3: REST endpoints accept vault ID as path parameter
 * - TD-1: Route structure uses `/api/vaults/:vaultId/[resource]` pattern
 * - TD-3: Vault resolution middleware applied to all routes
 */

import { Hono } from "hono";
import { vaultResolution } from "../middleware/vault-resolution";

// Domain route modules
import { filesRoutes, directoriesRoutes, archiveRoutes } from "./files";
import { captureRoutes } from "./capture";
import { homeRoutes } from "./home";
import { meetingRoutes } from "./meetings";
import { searchRoutes } from "./search";
import { configRoutes } from "./config";
import { memoryRoutes } from "./memory";
import { sessionsRoutes } from "./sessions";

/**
 * Hono router for vault-scoped REST API routes.
 *
 * All routes on this router require a valid :vaultId parameter.
 * The vault resolution middleware validates the vault ID and sets
 * VaultInfo in context for downstream handlers.
 *
 * Usage in server.ts:
 * ```typescript
 * import { vaultRoutes } from "./routes";
 * app.route("/api/vaults/:vaultId", vaultRoutes);
 * ```
 */
const vaultRoutes = new Hono();

// Apply vault resolution middleware to all routes
// This validates :vaultId and sets vault info in context
vaultRoutes.use("/*", vaultResolution());

// File browser routes (TASK-004)
vaultRoutes.route("/files", filesRoutes);
vaultRoutes.route("/directories", directoriesRoutes);
vaultRoutes.route("/archive", archiveRoutes);

// Capture routes (TASK-005)
vaultRoutes.route("/", captureRoutes);

// Home dashboard routes (TASK-006)
vaultRoutes.route("/", homeRoutes);

// Meeting routes (TASK-008)
vaultRoutes.route("/meetings", meetingRoutes);

// Search routes (TASK-010)
vaultRoutes.route("/search", searchRoutes);

// Config routes (TASK-011)
vaultRoutes.route("/", configRoutes);

// Memory routes (TASK-012)
vaultRoutes.route("/memory", memoryRoutes);

// Sessions routes (TASK-012)
vaultRoutes.route("/sessions", sessionsRoutes);

export { vaultRoutes };
