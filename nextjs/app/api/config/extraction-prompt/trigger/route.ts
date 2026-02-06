/**
 * Extraction Trigger API
 *
 * POST /api/config/extraction-prompt/trigger - Manually trigger extraction run
 */

import { NextResponse } from "next/server";
import { ensureSdk } from "@/lib/controller";
import {
  runExtraction,
  isExtractionRunning,
} from "@memory-loop/backend/extraction/extraction-manager";

/**
 * POST - Triggers manual extraction run
 */
export async function POST() {
  ensureSdk();

  // Check if extraction is already running
  if (isExtractionRunning()) {
    return NextResponse.json({
      status: "running",
      message: "Extraction already in progress",
    });
  }

  try {
    // Run extraction
    const result = await runExtraction(false);

    if (result.success) {
      return NextResponse.json({
        status: "complete",
        message: `Processed ${result.transcriptsProcessed} transcript(s)`,
        transcriptsProcessed: result.transcriptsProcessed,
      });
    } else {
      return NextResponse.json({
        status: "error",
        error: result.error,
        message: "Extraction failed",
      }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({
      status: "error",
      error: message,
      message: "Extraction failed unexpectedly",
    }, { status: 500 });
  }
}
