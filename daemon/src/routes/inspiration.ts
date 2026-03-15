/**
 * Inspiration Endpoint
 *
 * GET /inspiration?vaultId=... - Get inspiration data for a vault
 */

import type { Context } from "hono";
import { getCachedVaultById } from "../vault/vault-cache";
import { getInspiration } from "../inspiration-manager";
import { createLogger } from "@memory-loop/shared";

const log = createLogger("routes/inspiration");

export async function inspirationHandler(c: Context): Promise<Response> {
  const vaultId = c.req.query("vaultId");

  if (!vaultId) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "vaultId query parameter is required" } },
      400
    );
  }

  const vault = await getCachedVaultById(vaultId);
  if (!vault) {
    return c.json(
      { error: { code: "VAULT_NOT_FOUND", message: `Vault not found: ${vaultId}` } },
      404
    );
  }

  try {
    const result = await getInspiration(vault);
    return c.json({
      contextual: result.contextual,
      quote: result.quote,
    });
  } catch (error) {
    log.error("Inspiration generation failed", error);
    // Graceful degradation: return fallback
    return c.json({
      contextual: null,
      quote: {
        text: "The only way to do great work is to love what you do.",
        attribution: "Steve Jobs",
      },
    });
  }
}
