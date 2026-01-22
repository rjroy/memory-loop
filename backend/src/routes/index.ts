/**
 * Route Index
 *
 * Registers all REST routes under `/api/vaults/:vaultId/*` with vault middleware.
 * Domain routes will be added by subsequent tasks (files, capture, home, etc.).
 *
 * Requirements:
 * - REQ-F-3: REST endpoints accept vault ID as path parameter
 * - TD-1: Route structure uses `/api/vaults/:vaultId/[resource]` pattern
 * - TD-3: Vault resolution middleware applied to all routes
 */

import { Hono } from "hono";
import { vaultResolution } from "../middleware/vault-resolution";

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

// Domain routes will be added here by subsequent tasks:
// vaultRoutes.route("/files", filesRoutes);       // TASK-004
// vaultRoutes.route("/directories", dirRoutes);   // TASK-004
// vaultRoutes.route("/capture", captureRoutes);   // TASK-005
// vaultRoutes.route("/goals", homeRoutes);        // TASK-006
// vaultRoutes.route("/tasks", tasksRoutes);       // TASK-007
// vaultRoutes.route("/search", searchRoutes);     // TASK-008
// vaultRoutes.route("/config", configRoutes);     // TASK-009
// vaultRoutes.route("/meetings", meetingRoutes);  // TASK-010
// vaultRoutes.route("/memory", memoryRoutes);     // TASK-011
// vaultRoutes.route("/sessions", sessionsRoutes); // TASK-012

export { vaultRoutes };
