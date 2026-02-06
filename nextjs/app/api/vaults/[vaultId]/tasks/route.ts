/**
 * Tasks API Route (Vault-Scoped)
 *
 * GET /api/vaults/:vaultId/tasks - Get tasks list
 * PATCH /api/vaults/:vaultId/tasks - Toggle task completion
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultOrError, isErrorResponse, jsonError } from "@/lib/vault-helpers";
import { getAllTasks, toggleTask } from "@/lib/task-manager";
import { loadVaultConfig } from "@/lib/vault-config";

interface RouteParams {
  params: Promise<{ vaultId: string }>;
}

const ToggleTaskSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  lineNumber: z.number().int().positive("lineNumber must be a positive integer"),
  newState: z.string().optional(),
});

/**
 * GET /api/vaults/:vaultId/tasks
 *
 * Returns all tasks from configured directories (inbox, projects, areas).
 * Tasks are sorted by file path then line number.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  try {
    const config = await loadVaultConfig(vault.path);
    const result = await getAllTasks(vault.contentRoot, config);

    return NextResponse.json({
      tasks: result.tasks,
      incomplete: result.incomplete,
      total: result.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get tasks";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}

/**
 * PATCH /api/vaults/:vaultId/tasks
 *
 * Toggles or sets the state of a task checkbox.
 * If newState is provided, sets to that state directly.
 * Otherwise cycles: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { vaultId } = await params;
  const vault = await getVaultOrError(vaultId);
  if (isErrorResponse(vault)) return vault;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const parseResult = ToggleTaskSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues.map((e) => e.message).join(", ");
    return jsonError("VALIDATION_ERROR", errorMessage);
  }

  const { filePath, lineNumber, newState } = parseResult.data;

  try {
    const result = await toggleTask(vault.contentRoot, filePath, lineNumber, newState);

    if (!result.success) {
      // Determine appropriate error code based on error message
      if (result.error?.includes("Path outside") || result.error?.includes("path traversal")) {
        return jsonError("PATH_TRAVERSAL", result.error, 403);
      }
      if (result.error?.includes("not found") || result.error?.includes("File not found")) {
        return jsonError("FILE_NOT_FOUND", result.error, 404);
      }
      return jsonError("VALIDATION_ERROR", result.error ?? "Failed to toggle task");
    }

    return NextResponse.json({
      filePath,
      lineNumber,
      newState: result.newState,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to toggle task";
    return jsonError("INTERNAL_ERROR", message, 500);
  }
}
