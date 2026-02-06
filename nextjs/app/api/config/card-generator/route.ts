/**
 * Card Generator Config API
 *
 * GET /api/config/card-generator - Get config with requirements, override status, byte limits
 * PUT /api/config/card-generator - Save config (requirements and/or byte limit)
 */

import { NextResponse } from "next/server";
import {
  saveCardGeneratorConfig,
  loadRequirements,
  saveRequirementsOverride,
} from "@/lib/spaced-repetition/card-generator-config";
import { getWeeklyUsage } from "@/lib/spaced-repetition/card-discovery-scheduler";

/**
 * GET - Returns card generator config with requirements, override status, and byte limits
 */
export async function GET() {
  try {
    const [requirementsInfo, usage] = await Promise.all([
      loadRequirements(),
      getWeeklyUsage(),
    ]);

    return NextResponse.json({
      requirements: requirementsInfo.content,
      isOverride: requirementsInfo.isOverride,
      weeklyByteLimit: usage.byteLimit,
      weeklyBytesUsed: usage.bytesUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get config";
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}

interface CardGeneratorUpdateRequest {
  requirements?: string;
  weeklyByteLimit?: number;
}

/**
 * PUT - Saves card generator config (requirements and/or byte limit)
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as CardGeneratorUpdateRequest;

    // Save requirements if provided
    if (typeof body.requirements === "string") {
      await saveRequirementsOverride(body.requirements);
    }

    // Save byte limit config if provided
    if (typeof body.weeklyByteLimit === "number") {
      await saveCardGeneratorConfig({ weeklyByteLimit: body.weeklyByteLimit });
    }

    // Return updated state
    const [requirementsInfo, usage] = await Promise.all([
      loadRequirements(),
      getWeeklyUsage(),
    ]);

    return NextResponse.json({
      success: true,
      requirements: requirementsInfo.content,
      isOverride: requirementsInfo.isOverride,
      weeklyByteLimit: usage.byteLimit,
      weeklyBytesUsed: usage.bytesUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
