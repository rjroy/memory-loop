/**
 * Home Dashboard Routes
 *
 * REST endpoints for home dashboard data:
 * - GET /goals - Get vault goals (REQ-F-19)
 * - GET /inspiration - Get inspiration data (REQ-F-20)
 * - GET /tasks - Get tasks list (REQ-F-21)
 * - PATCH /tasks - Toggle task completion (REQ-F-22)
 *
 * All routes are under /api/vaults/:vaultId/ (vault middleware applied).
 */

import { Hono } from "hono";
import type { InspirationItem } from "@memory-loop/shared";
import { getVaultFromContext, jsonError } from "../middleware/vault-resolution";
import { getVaultGoals } from "../vault-manager";
import { getInspiration } from "../inspiration-manager";
import { getAllTasks, toggleTask } from "../task-manager";
import { loadVaultConfig } from "../vault-config";
import { createLogger } from "../logger";

const log = createLogger("HomeRoutes");

/**
 * Response type for GET /goals endpoint
 */
interface GoalsResponse {
  content: string | null;
}

/**
 * Response type for GET /inspiration endpoint
 */
interface InspirationResponse {
  contextual: InspirationItem | null;
  quote: InspirationItem;
}

/**
 * Response type for GET /tasks endpoint
 */
interface TasksResponse {
  tasks: Array<{
    text: string;
    state: string;
    filePath: string;
    lineNumber: number;
    fileMtime: number;
    category: "inbox" | "projects" | "areas";
  }>;
  incomplete: number;
  total: number;
}

/**
 * Request body for PATCH /tasks endpoint
 */
interface ToggleTaskRequest {
  filePath: string;
  lineNumber: number;
  newState?: string;
}

/**
 * Response type for PATCH /tasks endpoint
 */
interface TaskToggledResponse {
  filePath: string;
  lineNumber: number;
  newState: string;
}

/**
 * Home dashboard routes.
 */
const homeRoutes = new Hono();

/**
 * GET /goals
 *
 * Returns the vault's goals content from goals.md.
 * Returns null content if no goals file exists.
 */
homeRoutes.get("/goals", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Getting goals for vault: ${vault.id}`);

  try {
    const content = await getVaultGoals(vault);
    log.info(`Goals content: ${content ? `${content.length} chars` : "null"}`);

    const response: GoalsResponse = { content };
    return c.json(response);
  } catch (error) {
    log.error("Failed to get goals", error);
    const message = error instanceof Error ? error.message : "Failed to get goals";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * GET /inspiration
 *
 * Returns contextual prompt and inspirational quote.
 * Triggers generation if needed (daily for prompts, weekly for quotes).
 * Errors are logged but don't fail the request (graceful degradation).
 */
homeRoutes.get("/inspiration", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Getting inspiration for vault: ${vault.id}`);

  try {
    const result = await getInspiration(vault);
    log.info(
      `Inspiration fetched: contextual=${result.contextual !== null}, quote="${result.quote.text.slice(0, 30)}..."`
    );

    const response: InspirationResponse = {
      contextual: result.contextual,
      quote: result.quote,
    };
    return c.json(response);
  } catch (error) {
    // Log errors but don't fail the request per REQ-NF-3 (graceful degradation)
    // However, for REST API consistency, we should return something
    log.error("Failed to get inspiration (continuing silently)", error);

    // Return fallback response rather than error
    const response: InspirationResponse = {
      contextual: null,
      quote: {
        text: "The only way to do great work is to love what you do.",
        attribution: "Steve Jobs",
      },
    };
    return c.json(response);
  }
});

/**
 * GET /tasks
 *
 * Returns all tasks from configured directories (inbox, projects, areas).
 * Tasks are sorted by file path then line number.
 */
homeRoutes.get("/tasks", async (c) => {
  const vault = getVaultFromContext(c);
  log.info(`Getting tasks for vault: ${vault.id}`);

  try {
    const config = await loadVaultConfig(vault.path);
    const result = await getAllTasks(vault.contentRoot, config);
    log.info(`Found ${result.total} tasks (${result.incomplete} incomplete)`);

    const response: TasksResponse = {
      tasks: result.tasks,
      incomplete: result.incomplete,
      total: result.total,
    };
    return c.json(response);
  } catch (error) {
    log.error("Failed to get tasks", error);
    const message = error instanceof Error ? error.message : "Failed to get tasks";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

/**
 * PATCH /tasks
 *
 * Toggles or sets the state of a task checkbox.
 * If newState is provided, sets to that state directly.
 * Otherwise cycles: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 */
homeRoutes.patch("/tasks", async (c) => {
  const vault = getVaultFromContext(c);

  // Parse request body
  let body: ToggleTaskRequest;
  try {
    body = await c.req.json<ToggleTaskRequest>();
  } catch {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid JSON body");
  }

  // Validate required fields
  if (!body.filePath || typeof body.filePath !== "string") {
    return jsonError(c, 400, "VALIDATION_ERROR", "filePath is required and must be a string");
  }
  if (!body.lineNumber || typeof body.lineNumber !== "number" || body.lineNumber < 1) {
    return jsonError(c, 400, "VALIDATION_ERROR", "lineNumber is required and must be a positive integer");
  }
  if (body.newState !== undefined && typeof body.newState !== "string") {
    return jsonError(c, 400, "VALIDATION_ERROR", "newState must be a string if provided");
  }

  log.info(`Toggling task: ${body.filePath}:${body.lineNumber}${body.newState ? ` -> '${body.newState}'` : ""}`);

  try {
    const result = await toggleTask(
      vault.contentRoot,
      body.filePath,
      body.lineNumber,
      body.newState
    );

    if (!result.success) {
      log.warn(`Task toggle failed: ${result.error}`);

      // Determine appropriate error code based on error message
      if (result.error?.includes("Path outside") || result.error?.includes("path traversal")) {
        return jsonError(c, 403, "PATH_TRAVERSAL", result.error);
      }
      if (result.error?.includes("not found") || result.error?.includes("File not found")) {
        return jsonError(c, 404, "FILE_NOT_FOUND", result.error);
      }
      return jsonError(c, 400, "VALIDATION_ERROR", result.error ?? "Failed to toggle task");
    }

    log.info(`Task toggled: ${body.filePath}:${body.lineNumber} -> '${result.newState}'`);

    const response: TaskToggledResponse = {
      filePath: body.filePath,
      lineNumber: body.lineNumber,
      newState: result.newState!,
    };
    return c.json(response);
  } catch (error) {
    log.error("Failed to toggle task", error);
    const message = error instanceof Error ? error.message : "Failed to toggle task";
    return jsonError(c, 500, "INTERNAL_ERROR", message);
  }
});

export { homeRoutes };
