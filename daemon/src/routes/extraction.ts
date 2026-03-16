/**
 * Extraction routes.
 *
 * Daemon endpoints for extraction scheduler status/trigger,
 * memory file CRUD, and extraction prompt management.
 */

import type { Context } from "hono";
import { stat } from "node:fs/promises";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { fileExists } from "@memory-loop/shared/server";
import {
  isSchedulerRunning,
  isExtractionRunning,
  getLastRunResult,
  getNextScheduledRun,
  getCronSchedule,
  runExtraction,
} from "../extraction/extraction-manager";
import {
  readMemoryFile,
  writeMemoryFile,
  getMemoryFilePath,
} from "../extraction/memory-writer";
import {
  loadExtractionPrompt,
  hasPromptOverride,
  USER_PROMPT_PATH,
} from "../extraction/fact-extractor";

// ---------------------------------------------------------------------------
// GET /config/extraction/status
// ---------------------------------------------------------------------------

export function extractionStatusHandler(c: Context): Response {
  const nextRun = getNextScheduledRun();

  return c.json({
    schedulerRunning: isSchedulerRunning(),
    extractionRunning: isExtractionRunning(),
    lastRun: getLastRunResult(),
    nextScheduledRun: nextRun ? nextRun.toISOString() : null,
    schedule: getCronSchedule(),
  });
}

// ---------------------------------------------------------------------------
// POST /config/extraction/trigger
// ---------------------------------------------------------------------------

export async function extractionTriggerHandler(c: Context): Promise<Response> {
  if (isExtractionRunning()) {
    return c.json({
      status: "running",
      message: "Extraction already in progress",
    });
  }

  try {
    const result = await runExtraction(false);

    if (result.success) {
      return c.json({
        status: "complete",
        transcriptsProcessed: result.transcriptsProcessed,
      });
    } else {
      return c.json({
        status: "error",
        error: result.error,
        message: "Extraction failed",
      }, 500);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    return c.json({
      status: "error",
      error: message,
      message: "Extraction failed unexpectedly",
    }, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /config/memory
// ---------------------------------------------------------------------------

export async function memoryGetHandler(c: Context): Promise<Response> {
  try {
    const content = await readMemoryFile();
    const memoryPath = getMemoryFilePath();
    const exists = await fileExists(memoryPath);
    const sizeBytes = exists ? (await stat(memoryPath)).size : 0;

    return c.json({ content, sizeBytes, exists });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get memory";
    return c.json({ error: { code: "INTERNAL_ERROR", message } }, 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /config/memory
// ---------------------------------------------------------------------------

export async function memoryPutHandler(c: Context): Promise<Response> {
  let body: { content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON in request body" } },
      400,
    );
  }

  if (typeof body.content !== "string") {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "content is required and must be a string" } },
      400,
    );
  }

  try {
    const result = await writeMemoryFile(body.content);

    if (result.success) {
      return c.json({ success: true, sizeBytes: result.sizeBytes });
    } else {
      return c.json({ success: false, error: result.error });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save memory";
    return c.json({ success: false, error: message });
  }
}

// ---------------------------------------------------------------------------
// GET /config/extraction-prompt
// ---------------------------------------------------------------------------

export async function extractionPromptGetHandler(c: Context): Promise<Response> {
  try {
    const promptInfo = await loadExtractionPrompt();
    return c.json({
      content: promptInfo.content,
      isOverride: promptInfo.isOverride,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get extraction prompt";
    return c.json({ error: "INTERNAL_ERROR", message }, 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /config/extraction-prompt
// ---------------------------------------------------------------------------

export async function extractionPromptPutHandler(c: Context): Promise<Response> {
  try {
    const body: { content?: unknown } = await c.req.json();

    if (typeof body.content !== "string") {
      return c.json(
        { error: "VALIDATION_ERROR", message: "content is required and must be a string" },
        400,
      );
    }

    await mkdir(dirname(USER_PROMPT_PATH), { recursive: true });
    await writeFile(USER_PROMPT_PATH, body.content, "utf-8");

    const exists = await hasPromptOverride();

    return c.json({ success: true, isOverride: exists });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save extraction prompt";
    return c.json({ success: false, isOverride: false, error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /config/extraction-prompt
// ---------------------------------------------------------------------------

export async function extractionPromptDeleteHandler(c: Context): Promise<Response> {
  try {
    const hasOverride = await hasPromptOverride();

    if (hasOverride) {
      await unlink(USER_PROMPT_PATH);
    }

    const promptInfo = await loadExtractionPrompt();

    return c.json({ success: true, content: promptInfo.content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset extraction prompt";
    return c.json({ success: false, content: "", error: message }, 500);
  }
}
