/**
 * Card Generation Trigger API
 *
 * POST /api/config/card-generator/trigger - Manually trigger card generation
 */

import { NextResponse } from "next/server";
import { ensureSdk } from "@/lib/controller";
import { triggerManualGeneration } from "@/lib/spaced-repetition/card-discovery-scheduler";

/**
 * POST - Triggers manual card generation using remaining weekly budget
 */
export async function POST() {
  ensureSdk();

  try {
    const result = await triggerManualGeneration();

    if (!result.started) {
      return NextResponse.json({
        status: "error",
        error: result.reason,
        message: result.reason ?? "Generation could not start",
      }, { status: 400 });
    }

    if (result.stats) {
      return NextResponse.json({
        status: "complete",
        message: `Processed ${result.stats.filesProcessed} files, created ${result.stats.cardsCreated} cards`,
        filesProcessed: result.stats.filesProcessed,
        cardsCreated: result.stats.cardsCreated,
        bytesProcessed: result.stats.bytesProcessed,
      });
    }

    if (result.reason) {
      return NextResponse.json({
        status: "error",
        error: result.reason,
        message: "Generation failed",
      }, { status: 500 });
    }

    return NextResponse.json({
      status: "complete",
      message: "Generation completed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({
      status: "error",
      error: message,
      message: "Generation failed unexpectedly",
    }, { status: 500 });
  }
}
