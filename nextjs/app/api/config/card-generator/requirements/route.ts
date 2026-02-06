/**
 * Card Generator Requirements Reset API
 *
 * DELETE /api/config/card-generator/requirements - Reset requirements to default
 */

import { NextResponse } from "next/server";
import {
  deleteRequirementsOverride,
  getDefaultRequirements,
} from "@/lib/spaced-repetition/card-generator-config";

/**
 * DELETE - Removes user override and returns default requirements
 */
export async function DELETE() {
  try {
    await deleteRequirementsOverride();
    const defaultContent = getDefaultRequirements();

    return NextResponse.json({
      success: true,
      content: defaultContent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset requirements";
    return NextResponse.json({
      success: false,
      content: "",
      error: message,
    }, { status: 500 });
  }
}
