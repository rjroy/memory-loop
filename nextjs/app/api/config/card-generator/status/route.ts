/**
 * Card Generation Status API
 *
 * GET /api/config/card-generator/status - Get current generation status
 */

import { NextResponse } from "next/server";
import { isGenerationRunning } from "@memory-loop/backend/spaced-repetition/card-discovery-scheduler";

/**
 * GET - Returns current generation status
 */
export async function GET() {
  try {
    const running = isGenerationRunning();

    return NextResponse.json({
      status: running ? "running" : "idle",
      message: running ? "Generation in progress" : "No generation running",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get status";
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
