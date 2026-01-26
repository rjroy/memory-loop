/**
 * Card Generator Handlers
 *
 * Handles card generator operations over WebSocket:
 * - get_card_generator_config: Read config with requirements, override status, byte limits
 * - save_card_generator_requirements: Write requirements override
 * - save_card_generator_config: Update byte limit config
 * - reset_card_generator_requirements: Remove requirements override
 * - trigger_card_generation: Manually trigger card generation
 * - get_card_generation_status: Query current generation status
 */

import type { HandlerContext } from "./types.js";
import { wsLog as log } from "../logger.js";
import {
  saveCardGeneratorConfig,
  loadRequirements,
  saveRequirementsOverride,
  deleteRequirementsOverride,
  getDefaultRequirements,
} from "../spaced-repetition/card-generator-config.js";
import {
  triggerManualGeneration,
  isGenerationRunning,
  getWeeklyUsage,
} from "../spaced-repetition/card-discovery-scheduler.js";

// =============================================================================
// Config Handlers
// =============================================================================

/**
 * Handles get_card_generator_config message.
 * Returns config with requirements, override status, and byte limit info.
 */
export async function handleGetCardGeneratorConfig(ctx: HandlerContext): Promise<void> {
  log.info("Getting card generator config");

  try {
    const [requirementsInfo, usage] = await Promise.all([
      loadRequirements(),
      getWeeklyUsage(),
    ]);

    log.info(`Card generator config loaded: isOverride=${requirementsInfo.isOverride}, byteLimit=${usage.byteLimit}, bytesUsed=${usage.bytesUsed}`);
    ctx.send({
      type: "card_generator_config_content",
      requirements: requirementsInfo.content,
      isOverride: requirementsInfo.isOverride,
      weeklyByteLimit: usage.byteLimit,
      weeklyBytesUsed: usage.bytesUsed,
    });
  } catch (error) {
    log.error("Failed to get card generator config", error);
    const message = error instanceof Error ? error.message : "Failed to get config";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles save_card_generator_requirements message.
 * Saves requirements to user override location.
 */
export async function handleSaveCardGeneratorRequirements(
  ctx: HandlerContext,
  content: string
): Promise<void> {
  log.info(`Saving card generator requirements (${content.length} chars)`);

  try {
    await saveRequirementsOverride(content);

    log.info("Card generator requirements saved");
    ctx.send({
      type: "card_generator_requirements_saved",
      success: true,
      isOverride: true,
    });
  } catch (error) {
    log.error("Failed to save card generator requirements", error);
    const message = error instanceof Error ? error.message : "Failed to save requirements";
    ctx.send({
      type: "card_generator_requirements_saved",
      success: false,
      isOverride: false,
      error: message,
    });
  }
}

/**
 * Handles save_card_generator_config message.
 * Updates the byte limit configuration.
 */
export async function handleSaveCardGeneratorConfig(
  ctx: HandlerContext,
  weeklyByteLimit: number
): Promise<void> {
  log.info(`Saving card generator config (weeklyByteLimit=${weeklyByteLimit})`);

  try {
    await saveCardGeneratorConfig({ weeklyByteLimit });

    log.info("Card generator config saved");
    ctx.send({
      type: "card_generator_config_saved",
      success: true,
    });
  } catch (error) {
    log.error("Failed to save card generator config", error);
    const message = error instanceof Error ? error.message : "Failed to save config";
    ctx.send({
      type: "card_generator_config_saved",
      success: false,
      error: message,
    });
  }
}

/**
 * Handles reset_card_generator_requirements message.
 * Removes user override and returns the default requirements.
 */
export async function handleResetCardGeneratorRequirements(ctx: HandlerContext): Promise<void> {
  log.info("Resetting card generator requirements to default");

  try {
    await deleteRequirementsOverride();
    const defaultContent = getDefaultRequirements();

    log.info("Card generator requirements reset to default");
    ctx.send({
      type: "card_generator_requirements_reset",
      success: true,
      content: defaultContent,
    });
  } catch (error) {
    log.error("Failed to reset card generator requirements", error);
    const message = error instanceof Error ? error.message : "Failed to reset requirements";
    ctx.send({
      type: "card_generator_requirements_reset",
      success: false,
      content: "",
      error: message,
    });
  }
}

// =============================================================================
// Generation Trigger Handler
// =============================================================================

/**
 * Handles trigger_card_generation message.
 * Manually triggers card generation using remaining weekly budget.
 */
export async function handleTriggerCardGeneration(ctx: HandlerContext): Promise<void> {
  log.info("Triggering manual card generation");

  // Send initial status
  ctx.send({
    type: "card_generation_status",
    status: "running",
    message: "Starting card generation...",
  });

  try {
    const result = await triggerManualGeneration();

    if (!result.started) {
      log.warn(`Card generation not started: ${result.reason}`);
      ctx.send({
        type: "card_generation_status",
        status: "error",
        error: result.reason,
        message: result.reason ?? "Generation could not start",
      });
      return;
    }

    if (result.stats) {
      log.info(`Manual card generation complete: ${result.stats.filesProcessed} files, ${result.stats.cardsCreated} cards`);
      ctx.send({
        type: "card_generation_status",
        status: "complete",
        message: `Processed ${result.stats.filesProcessed} files, created ${result.stats.cardsCreated} cards`,
        filesProcessed: result.stats.filesProcessed,
        cardsCreated: result.stats.cardsCreated,
        bytesProcessed: result.stats.bytesProcessed,
      });
    } else if (result.reason) {
      log.error(`Manual card generation failed: ${result.reason}`);
      ctx.send({
        type: "card_generation_status",
        status: "error",
        error: result.reason,
        message: "Generation failed",
      });
    } else {
      log.info("Manual card generation completed");
      ctx.send({
        type: "card_generation_status",
        status: "complete",
        message: "Generation completed",
      });
    }
  } catch (error) {
    log.error("Manual card generation threw", error);
    const message = error instanceof Error ? error.message : "Generation failed";
    ctx.send({
      type: "card_generation_status",
      status: "error",
      error: message,
      message: "Generation failed unexpectedly",
    });
  }
}

/**
 * Handles get_card_generation_status message.
 * Returns current generation status.
 */
export function handleGetCardGenerationStatus(ctx: HandlerContext): void {
  log.debug("Getting card generation status");

  try {
    const running = isGenerationRunning();

    ctx.send({
      type: "card_generation_status",
      status: running ? "running" : "idle",
      message: running ? "Generation in progress" : "No generation running",
    });
  } catch (error) {
    log.error("Failed to get card generation status", error);
    const message = error instanceof Error ? error.message : "Failed to get status";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}
