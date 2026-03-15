/**
 * Task API route handlers.
 *
 * Handles task listing and toggling across vault directories.
 */

import { createLogger } from "@memory-loop/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCachedVaultById, loadVaultConfig } from "../vault";
import { getAllTasks, toggleTask } from "../files/task-manager";

const log = createLogger("task-routes");

function jsonError(
  c: Context,
  error: string,
  code: string,
  status: ContentfulStatusCode,
  detail?: string,
): Response {
  return c.json({ error, code, ...(detail ? { detail } : {}) }, status);
}

/**
 * GET /vaults/:id/tasks - List all tasks from configured directories.
 */
export async function listTasksHandler(c: Context): Promise<Response> {
  const vaultId = c.req.param("id") ?? "";
  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return jsonError(c, "Vault not found", "VAULT_NOT_FOUND", 404);
  }

  const config = await loadVaultConfig(vault.path);
  const result = await getAllTasks(vault.contentRoot, config);
  return c.json(result);
}

/**
 * PATCH /vaults/:id/tasks - Toggle a task's state.
 */
export async function toggleTaskHandler(c: Context): Promise<Response> {
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

  if (typeof body !== "object" || body === null) {
    return jsonError(c, "Request body must be an object", "INVALID_REQUEST", 400);
  }

  const { filePath, lineNumber, newState } = body as {
    filePath?: string;
    lineNumber?: number;
    newState?: string;
  };

  if (typeof filePath !== "string" || typeof lineNumber !== "number") {
    return jsonError(
      c,
      "Missing required fields: filePath (string), lineNumber (number)",
      "INVALID_REQUEST",
      400,
    );
  }

  const result = await toggleTask(vault.contentRoot, filePath, lineNumber, newState);
  if (!result.success) {
    return jsonError(c, result.error ?? "Toggle failed", "TOGGLE_FAILED", 400);
  }

  return c.json(result);
}
