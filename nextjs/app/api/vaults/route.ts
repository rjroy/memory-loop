/**
 * Vaults API Routes
 *
 * GET /api/vaults - List all discovered vaults
 * POST /api/vaults - Create a new vault
 */

import { NextResponse } from "next/server";
import { discoverVaults, createVault } from "@/lib/daemon/vaults";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("api/vaults");

/**
 * GET /api/vaults
 *
 * Lists all discovered vaults from VAULTS_DIR.
 */
export async function GET() {
  try {
    const vaults = await discoverVaults();
    return NextResponse.json({ vaults });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to discover vaults";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/vaults
 *
 * Creates a new vault with the given title.
 * Request body: { title: string }
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    // Validate request body
    const title =
      typeof body === "object" && body !== null && "title" in body
        ? (body as { title: unknown }).title
        : undefined;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Title is required" } },
        { status: 400 }
      );
    }

    const vault = await createVault(title);
    log.info(`Created vault: ${vault.id}`);
    return NextResponse.json({ vault }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create vault";
    log.error("Failed to create vault", error);
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 }
    );
  }
}
