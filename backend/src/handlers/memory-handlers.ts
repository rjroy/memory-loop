/**
 * Memory and Extraction Handlers
 *
 * Handles memory file and extraction prompt operations:
 * - get_memory: Read memory.md content
 * - save_memory: Write memory.md content
 * - get_extraction_prompt: Read extraction prompt with override status
 * - save_extraction_prompt: Write extraction prompt (creates user override)
 * - trigger_extraction: Manually trigger extraction run
 *
 * Spec Requirements:
 * - REQ-F-12: View memory.md
 * - REQ-F-13: Edit memory.md
 * - REQ-F-15: View extraction prompt
 * - REQ-F-16: Edit extraction prompt
 */

import { writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { HandlerContext } from "./types.js";
import { wsLog as log } from "../logger.js";
import {
  readMemoryFile,
  writeMemoryFile,
  MEMORY_FILE_PATH,
} from "../extraction/memory-writer.js";
import {
  loadExtractionPrompt,
  hasPromptOverride,
  USER_PROMPT_PATH,
} from "../extraction/fact-extractor.js";
import {
  runExtraction,
  isExtractionRunning,
} from "../extraction/extraction-manager.js";
import { fileExists } from "../vault-manager.js";

// =============================================================================
// Memory File Handlers
// =============================================================================

/**
 * Handles get_memory message.
 * Returns the current memory.md content and metadata.
 */
export async function handleGetMemory(ctx: HandlerContext): Promise<void> {
  log.info("Getting memory file content");

  try {
    const content = await readMemoryFile();
    const exists = await fileExists(MEMORY_FILE_PATH);
    const sizeBytes = exists
      ? (await stat(MEMORY_FILE_PATH)).size
      : 0;

    log.info(`Memory file: exists=${exists}, size=${sizeBytes}`);
    ctx.send({
      type: "memory_content",
      content,
      sizeBytes,
      exists,
    });
  } catch (error) {
    log.error("Failed to get memory", error);
    const message = error instanceof Error ? error.message : "Failed to get memory";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles save_memory message.
 * Writes content to memory.md with size enforcement.
 */
export async function handleSaveMemory(
  ctx: HandlerContext,
  content: string
): Promise<void> {
  log.info(`Saving memory file (${content.length} chars)`);

  try {
    const result = await writeMemoryFile(content);

    if (result.success) {
      log.info(`Memory saved: ${result.sizeBytes} bytes, pruned=${result.wasPruned}`);
      ctx.send({
        type: "memory_saved",
        success: true,
        sizeBytes: result.sizeBytes,
      });
    } else {
      log.error(`Memory save failed: ${result.error}`);
      ctx.send({
        type: "memory_saved",
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    log.error("Failed to save memory", error);
    const message = error instanceof Error ? error.message : "Failed to save memory";
    ctx.send({
      type: "memory_saved",
      success: false,
      error: message,
    });
  }
}

// =============================================================================
// Extraction Prompt Handlers
// =============================================================================

/**
 * Handles get_extraction_prompt message.
 * Returns the extraction prompt content and override status.
 */
export async function handleGetExtractionPrompt(ctx: HandlerContext): Promise<void> {
  log.info("Getting extraction prompt");

  try {
    const promptInfo = await loadExtractionPrompt();

    log.info(`Extraction prompt: isOverride=${promptInfo.isOverride}, path=${promptInfo.path}`);
    ctx.send({
      type: "extraction_prompt_content",
      content: promptInfo.content,
      isOverride: promptInfo.isOverride,
    });
  } catch (error) {
    log.error("Failed to get extraction prompt", error);
    const message = error instanceof Error ? error.message : "Failed to get extraction prompt";
    ctx.sendError("INTERNAL_ERROR", message);
  }
}

/**
 * Handles save_extraction_prompt message.
 * Saves content to user override location at ~/.config/memory-loop/extraction-prompt.md
 */
export async function handleSaveExtractionPrompt(
  ctx: HandlerContext,
  content: string
): Promise<void> {
  log.info(`Saving extraction prompt (${content.length} chars)`);

  try {
    // Ensure directory exists
    await mkdir(dirname(USER_PROMPT_PATH), { recursive: true });

    // Write the prompt
    await writeFile(USER_PROMPT_PATH, content, "utf-8");

    // Verify it was written
    const exists = await hasPromptOverride();

    log.info(`Extraction prompt saved to ${USER_PROMPT_PATH}`);
    ctx.send({
      type: "extraction_prompt_saved",
      success: true,
      isOverride: exists,
    });
  } catch (error) {
    log.error("Failed to save extraction prompt", error);
    const message = error instanceof Error ? error.message : "Failed to save extraction prompt";
    ctx.send({
      type: "extraction_prompt_saved",
      success: false,
      isOverride: false,
      error: message,
    });
  }
}

/**
 * Handles reset_extraction_prompt message.
 * Removes user override and returns the default prompt.
 */
export async function handleResetExtractionPrompt(ctx: HandlerContext): Promise<void> {
  log.info("Resetting extraction prompt to default");

  try {
    // Check if override exists
    const hasOverride = await hasPromptOverride();

    if (hasOverride) {
      // Delete the user override file
      await unlink(USER_PROMPT_PATH);
      log.info(`Deleted user override at ${USER_PROMPT_PATH}`);
    } else {
      log.info("No user override to delete");
    }

    // Load the default prompt to return to client
    const promptInfo = await loadExtractionPrompt();

    ctx.send({
      type: "extraction_prompt_reset",
      success: true,
      content: promptInfo.content,
    });
  } catch (error) {
    log.error("Failed to reset extraction prompt", error);
    const message = error instanceof Error ? error.message : "Failed to reset extraction prompt";
    ctx.send({
      type: "extraction_prompt_reset",
      success: false,
      content: "",
      error: message,
    });
  }
}

// =============================================================================
// Extraction Trigger Handler
// =============================================================================

/**
 * Handles trigger_extraction message.
 * Manually triggers an extraction run for testing/debugging.
 */
export async function handleTriggerExtraction(ctx: HandlerContext): Promise<void> {
  log.info("Triggering manual extraction");

  // Check if extraction is already running
  if (isExtractionRunning()) {
    log.warn("Extraction already in progress");
    ctx.send({
      type: "extraction_status",
      status: "running",
      message: "Extraction already in progress",
    });
    return;
  }

  // Send initial status
  ctx.send({
    type: "extraction_status",
    status: "running",
    message: "Starting extraction...",
  });

  try {
    // Run extraction (non-blocking in terms of the function, but we await it)
    const result = await runExtraction(false);

    if (result.success) {
      log.info(`Manual extraction complete: ${result.transcriptsProcessed} transcripts`);
      ctx.send({
        type: "extraction_status",
        status: "complete",
        message: `Processed ${result.transcriptsProcessed} transcript(s)`,
        transcriptsProcessed: result.transcriptsProcessed,
      });
    } else {
      log.error(`Manual extraction failed: ${result.error}`);
      ctx.send({
        type: "extraction_status",
        status: "error",
        error: result.error,
        message: "Extraction failed",
      });
    }
  } catch (error) {
    log.error("Manual extraction threw", error);
    const message = error instanceof Error ? error.message : "Extraction failed";
    ctx.send({
      type: "extraction_status",
      status: "error",
      error: message,
      message: "Extraction failed unexpectedly",
    });
  }
}
