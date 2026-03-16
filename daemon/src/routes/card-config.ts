/**
 * Card generator config routes.
 *
 * Daemon endpoints for card generator configuration,
 * status, trigger, and requirements management.
 */

import type { Context } from "hono";
import {
  saveCardGeneratorConfig,
  loadRequirements,
  saveRequirementsOverride,
  deleteRequirementsOverride,
  getDefaultRequirements,
} from "../spaced-repetition/card-generator-config";
import {
  isGenerationRunning,
  getWeeklyUsage,
  triggerManualGeneration,
} from "../spaced-repetition/card-discovery-scheduler";

// ---------------------------------------------------------------------------
// GET /config/card-generator
// ---------------------------------------------------------------------------

export async function cardGeneratorConfigGetHandler(c: Context): Promise<Response> {
  try {
    const [requirementsInfo, usage] = await Promise.all([
      loadRequirements(),
      getWeeklyUsage(),
    ]);

    return c.json({
      requirements: requirementsInfo.content,
      isOverride: requirementsInfo.isOverride,
      weeklyByteLimit: usage.byteLimit,
      weeklyBytesUsed: usage.bytesUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get config";
    return c.json({ error: "INTERNAL_ERROR", message }, 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /config/card-generator
// ---------------------------------------------------------------------------

export async function cardGeneratorConfigPutHandler(c: Context): Promise<Response> {
  try {
    const body: { requirements?: unknown; weeklyByteLimit?: unknown } = await c.req.json();

    if (typeof body.requirements === "string") {
      await saveRequirementsOverride(body.requirements);
    }

    if (typeof body.weeklyByteLimit === "number") {
      await saveCardGeneratorConfig({ weeklyByteLimit: body.weeklyByteLimit });
    }

    const [requirementsInfo, usage] = await Promise.all([
      loadRequirements(),
      getWeeklyUsage(),
    ]);

    return c.json({
      success: true,
      requirements: requirementsInfo.content,
      isOverride: requirementsInfo.isOverride,
      weeklyByteLimit: usage.byteLimit,
      weeklyBytesUsed: usage.bytesUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return c.json({ success: false, error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /config/card-generator/requirements
// ---------------------------------------------------------------------------

export async function cardGeneratorRequirementsDeleteHandler(c: Context): Promise<Response> {
  try {
    await deleteRequirementsOverride();
    const defaultContent = getDefaultRequirements();

    return c.json({ success: true, content: defaultContent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset requirements";
    return c.json({ success: false, content: "", error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /config/card-generator/status
// ---------------------------------------------------------------------------

export function cardGeneratorStatusHandler(c: Context): Response {
  try {
    const running = isGenerationRunning();

    return c.json({
      status: running ? "running" : "idle",
      message: running ? "Generation in progress" : "No generation running",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get status";
    return c.json({ error: "INTERNAL_ERROR", message }, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /config/card-generator/trigger
// ---------------------------------------------------------------------------

export async function cardGeneratorTriggerHandler(c: Context): Promise<Response> {
  try {
    const result = await triggerManualGeneration();

    if (!result.started) {
      return c.json({
        status: "error",
        error: result.reason,
        message: result.reason ?? "Generation could not start",
      }, 400);
    }

    if (result.stats) {
      return c.json({
        status: "complete",
        message: `Processed ${result.stats.filesProcessed} files, created ${result.stats.cardsCreated} cards`,
        filesProcessed: result.stats.filesProcessed,
        cardsCreated: result.stats.cardsCreated,
        bytesProcessed: result.stats.bytesProcessed,
      });
    }

    if (result.reason) {
      return c.json({
        status: "error",
        error: result.reason,
        message: "Generation failed",
      }, 500);
    }

    return c.json({
      status: "complete",
      message: "Generation completed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return c.json({
      status: "error",
      error: message,
      message: "Generation failed unexpectedly",
    }, 500);
  }
}
