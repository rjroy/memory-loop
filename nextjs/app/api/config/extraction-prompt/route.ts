/**
 * Extraction Prompt API
 *
 * GET /api/config/extraction-prompt - Get extraction prompt content and override status
 * PUT /api/config/extraction-prompt - Save extraction prompt (creates user override)
 * DELETE /api/config/extraction-prompt - Reset to default (removes user override)
 */

import { NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  loadExtractionPrompt,
  hasPromptOverride,
  USER_PROMPT_PATH,
} from "@memory-loop/backend/extraction/fact-extractor";

/**
 * GET - Returns extraction prompt content and override status
 */
export async function GET() {
  try {
    const promptInfo = await loadExtractionPrompt();

    return NextResponse.json({
      content: promptInfo.content,
      isOverride: promptInfo.isOverride,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get extraction prompt";
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}

/**
 * PUT - Saves extraction prompt to user override location
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { content: string };

    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "content is required and must be a string" },
        { status: 400 }
      );
    }

    // Ensure directory exists
    await mkdir(dirname(USER_PROMPT_PATH), { recursive: true });

    // Write the prompt
    await writeFile(USER_PROMPT_PATH, body.content, "utf-8");

    // Verify it was written
    const exists = await hasPromptOverride();

    return NextResponse.json({
      success: true,
      isOverride: exists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save extraction prompt";
    return NextResponse.json({
      success: false,
      isOverride: false,
      error: message,
    }, { status: 500 });
  }
}

/**
 * DELETE - Removes user override and returns default prompt
 */
export async function DELETE() {
  try {
    // Check if override exists
    const hasOverride = await hasPromptOverride();

    if (hasOverride) {
      // Delete the user override file
      await unlink(USER_PROMPT_PATH);
    }

    // Load the default prompt to return
    const promptInfo = await loadExtractionPrompt();

    return NextResponse.json({
      success: true,
      content: promptInfo.content,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset extraction prompt";
    return NextResponse.json({
      success: false,
      content: "",
      error: message,
    }, { status: 500 });
  }
}
