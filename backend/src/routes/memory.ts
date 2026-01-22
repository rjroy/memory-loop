/**
 * Memory REST Routes
 *
 * REST endpoints for memory file management:
 * - GET /memory - Get memory.md content and metadata (REQ-F-35)
 * - PUT /memory - Save memory.md content (REQ-F-36)
 *
 * Memory file is stored at ~/.claude/rules/memory.md and provides
 * context injection for Claude conversations.
 *
 * Note: Extraction prompt routes are NOT vault-scoped and are
 * registered directly in server.ts under /api/config/extraction-prompt.
 */

import { Hono } from "hono";
import { stat } from "node:fs/promises";
import {
  readMemoryFile,
  writeMemoryFile,
  getMemoryFilePath,
} from "../extraction/memory-writer.js";
import { fileExists } from "../vault-manager.js";
import { serverLog as log } from "../logger.js";

/**
 * Response schema for GET /memory
 */
export interface MemoryContentResponse {
  content: string;
  sizeBytes: number;
  exists: boolean;
}

/**
 * Request schema for PUT /memory
 */
export interface SaveMemoryRequest {
  content: string;
}

/**
 * Response schema for PUT /memory
 */
export interface MemorySavedResponse {
  success: boolean;
  sizeBytes?: number;
  error?: string;
}

/**
 * Hono router for vault-scoped memory routes.
 *
 * Note: These routes are technically vault-scoped in the URL structure
 * but memory.md is a global file. The vault context is available but
 * not used for memory operations.
 */
const memoryRoutes = new Hono();

/**
 * GET /memory - Get memory file content and metadata
 *
 * Returns the current memory.md content along with file metadata.
 * If the file doesn't exist, returns empty content with exists: false.
 *
 * Response: MemoryContentResponse
 */
memoryRoutes.get("/", async (c) => {
  log.info("REST: Getting memory file content");

  try {
    const content = await readMemoryFile();
    const memoryPath = getMemoryFilePath();
    const exists = await fileExists(memoryPath);
    const sizeBytes = exists ? (await stat(memoryPath)).size : 0;

    log.info(`REST: Memory file: exists=${exists}, size=${sizeBytes}`);

    const response: MemoryContentResponse = {
      content,
      sizeBytes,
      exists,
    };

    return c.json(response);
  } catch (error) {
    log.error("REST: Failed to get memory", error);
    const message = error instanceof Error ? error.message : "Failed to get memory";
    throw new Error(message);
  }
});

/**
 * PUT /memory - Save memory file content
 *
 * Writes content to memory.md with size enforcement (50KB limit).
 * If the content exceeds the limit, it will be pruned automatically.
 *
 * Request: SaveMemoryRequest
 * Response: MemorySavedResponse
 */
memoryRoutes.put("/", async (c) => {
  const body = await c.req.json<SaveMemoryRequest>();

  if (typeof body.content !== "string") {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "content is required and must be a string" } }, 400);
  }

  log.info(`REST: Saving memory file (${body.content.length} chars)`);

  try {
    const result = await writeMemoryFile(body.content);

    if (result.success) {
      log.info(`REST: Memory saved: ${result.sizeBytes} bytes, pruned=${result.wasPruned}`);
      const response: MemorySavedResponse = {
        success: true,
        sizeBytes: result.sizeBytes,
      };
      return c.json(response);
    } else {
      log.error(`REST: Memory save failed: ${result.error}`);
      const response: MemorySavedResponse = {
        success: false,
        error: result.error,
      };
      return c.json(response);
    }
  } catch (error) {
    log.error("REST: Failed to save memory", error);
    const message = error instanceof Error ? error.message : "Failed to save memory";
    const response: MemorySavedResponse = {
      success: false,
      error: message,
    };
    return c.json(response);
  }
});

export { memoryRoutes };
