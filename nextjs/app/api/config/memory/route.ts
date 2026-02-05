/**
 * Memory API Route (Global)
 *
 * GET /api/config/memory - Get memory.md content and metadata
 * PUT /api/config/memory - Save memory.md content
 *
 * Memory file is stored at ~/.claude/rules/memory.md and provides
 * context injection for Claude conversations. This is a user-global
 * file, not vault-scoped.
 */

import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import {
  readMemoryFile,
  writeMemoryFile,
  getMemoryFilePath,
} from "@memory-loop/backend/extraction/memory-writer";
import { fileExists } from "@memory-loop/backend/vault-manager";

/**
 * GET /api/config/memory
 *
 * Returns the current memory.md content along with file metadata.
 * If the file doesn't exist, returns empty content with exists: false.
 */
export async function GET() {
  try {
    const content = await readMemoryFile();
    const memoryPath = getMemoryFilePath();
    const exists = await fileExists(memoryPath);
    const sizeBytes = exists ? (await stat(memoryPath)).size : 0;

    return NextResponse.json({
      content,
      sizeBytes,
      exists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get memory";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/config/memory
 *
 * Writes content to memory.md with size enforcement (50KB limit).
 * If the content exceeds the limit, it will be pruned automatically.
 */
export async function PUT(request: Request) {
  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON in request body" } },
      { status: 400 }
    );
  }

  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "content is required and must be a string" } },
      { status: 400 }
    );
  }

  try {
    const result = await writeMemoryFile(body.content);

    if (result.success) {
      return NextResponse.json({
        success: true,
        sizeBytes: result.sizeBytes,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save memory";
    return NextResponse.json({
      success: false,
      error: message,
    });
  }
}
