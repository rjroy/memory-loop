/**
 * Vault Resolution Middleware
 *
 * Hono middleware that resolves :vaultId path parameter to VaultInfo.
 * Handles 404 for unknown vaults and validates vault ID format.
 *
 * Requirements:
 * - REQ-F-3: REST endpoints accept vault ID as path parameter
 * - REQ-F-55: Return 404 when vault not found
 * - REQ-NF-6: Validate vault ID to prevent path traversal
 */

import type { Context, MiddlewareHandler } from "hono";
import type { VaultInfo, ErrorCode } from "@memory-loop/shared";
import { getVaultById } from "../vault-manager";

/**
 * Regular expression for valid vault IDs.
 * Allows alphanumeric characters, hyphens, and underscores.
 * Must start with alphanumeric and be 1-100 characters.
 */
const VAULT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

/**
 * Error response format for REST endpoints.
 * Matches WebSocket error message schema (REQ-NF-3).
 */
export interface RestErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/**
 * Type for Hono context with vault info set by middleware.
 */
export interface VaultContext {
  vault: VaultInfo;
}

/**
 * Validates vault ID format before filesystem access.
 * Prevents path traversal and ensures safe filesystem operations.
 *
 * @param vaultId - The vault ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidVaultId(vaultId: string): boolean {
  if (!vaultId || typeof vaultId !== "string") {
    return false;
  }

  // Check for path traversal attempts
  if (vaultId.includes("..") || vaultId.includes("/") || vaultId.includes("\\")) {
    return false;
  }

  // Check pattern match
  return VAULT_ID_PATTERN.test(vaultId);
}

/**
 * Creates a JSON error response with the proper format.
 *
 * @param c - Hono context
 * @param status - HTTP status code
 * @param code - Error code from ErrorCode enum
 * @param message - Human-readable error message
 */
export function jsonError(
  c: Context,
  status: number,
  code: ErrorCode,
  message: string
) {
  const body: RestErrorResponse = {
    error: {
      code,
      message,
    },
  };
  return c.json(body, status as 400 | 404 | 403 | 500);
}

/**
 * Middleware that resolves :vaultId path parameter to VaultInfo.
 *
 * Validates vault ID format and looks up vault via vault-manager.
 * Sets vault info in context for downstream handlers via c.set("vault", vaultInfo).
 *
 * @returns Hono middleware handler
 */
export function vaultResolution(): MiddlewareHandler {
  return async (c, next) => {
    const vaultId = c.req.param("vaultId");

    // Validate vault ID format
    if (!vaultId || !isValidVaultId(vaultId)) {
      return jsonError(
        c,
        400,
        "VALIDATION_ERROR",
        "Invalid vault ID format. Must be alphanumeric with hyphens or underscores."
      );
    }

    // Look up vault
    try {
      const vault = await getVaultById(vaultId);

      if (!vault) {
        return jsonError(
          c,
          404,
          "VAULT_NOT_FOUND",
          `Vault "${vaultId}" not found`
        );
      }

      // Set vault in context for downstream handlers
      c.set("vault", vault);

      await next();
    } catch (error) {
      // VaultsDirError or unexpected filesystem errors
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonError(c, 500, "INTERNAL_ERROR", `Failed to resolve vault: ${message}`);
    }
  };
}

/**
 * Helper to get vault from context.
 * Use this in route handlers after the middleware runs.
 *
 * @param c - Hono context
 * @returns VaultInfo set by the middleware
 */
export function getVaultFromContext(c: Context): VaultInfo {
  const vault = c.get("vault") as VaultInfo | undefined;
  if (!vault) {
    throw new Error("Vault not found in context. Ensure vaultResolution middleware is applied.");
  }
  return vault;
}
