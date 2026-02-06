/**
 * Vaults API Routes
 *
 * GET /api/vaults - List all discovered vaults
 * POST /api/vaults - Create a new vault
 */

import { NextResponse } from "next/server";
import {
  discoverVaults,
  VaultsDirError,
  createVault,
  VaultCreationError,
} from "@memory-loop/backend/vault-manager";

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
    if (error instanceof VaultsDirError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
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
    console.log(`[api/vaults] Created vault: ${vault.id}`);
    return NextResponse.json({ vault }, { status: 201 });
  } catch (error) {
    if (error instanceof VaultCreationError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: error.message } },
        { status: 400 }
      );
    }
    console.error("[api/vaults] Failed to create vault:", error);
    throw error;
  }
}
