/**
 * Vault Setup Endpoint
 *
 * POST /config/setup - Run vault setup (install commands, create dirs, update CLAUDE.md)
 *
 * Request body:
 * - vaultId: string (required)
 */

import type { Context } from "hono";
import { z } from "zod";
import { getCachedVaultById } from "../vault/vault-cache";
import { runVaultSetup } from "../vault-setup";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("routes/setup");

const SetupRequestSchema = z.object({
  vaultId: z.string().min(1, "vaultId is required"),
});

export async function setupHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      400
    );
  }

  const result = SetupRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: result.error.issues[0]?.message ?? "Invalid request" } },
      400
    );
  }

  const { vaultId } = result.data;

  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return c.json(
      { error: { code: "VAULT_NOT_FOUND", message: `Vault not found: ${vaultId}` } },
      404
    );
  }

  if (!vault.hasClaudeMd) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: `Vault "${vault.name}" is missing CLAUDE.md at root` } },
      400
    );
  }

  try {
    const setupResult = await runVaultSetup(vaultId);
    return c.json(setupResult);
  } catch (error) {
    log.error("Vault setup failed", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Failed to setup vault" } },
      500
    );
  }
}
