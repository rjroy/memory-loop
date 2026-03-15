/**
 * Help / discovery root endpoint.
 *
 * Returns a structured description of available daemon API endpoints.
 * Each migration stage adds entries as new endpoints are created.
 */

import type { Context } from "hono";

export interface HelpResponse {
  name: string;
  version: string;
  description: string;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
  }>;
}

export function helpHandler(c: Context): Response {
  const body: HelpResponse = {
    name: "memory-loop",
    version: "0.0.0",
    description: "Memory Loop daemon API",
    endpoints: [
      {
        path: "/health",
        method: "GET",
        description: "Daemon health and status",
      },
      {
        path: "/help",
        method: "GET",
        description: "API discovery root",
      },
      {
        path: "/vaults",
        method: "GET",
        description: "List all discovered vaults",
      },
      {
        path: "/vaults",
        method: "POST",
        description: "Create a new vault",
      },
      {
        path: "/vaults/:id",
        method: "GET",
        description: "Get a single vault by ID",
      },
      {
        path: "/vaults/:id/config",
        method: "GET",
        description: "Get vault configuration",
      },
      {
        path: "/vaults/:id/config",
        method: "PUT",
        description: "Update vault configuration",
      },
      {
        path: "/vaults/:id/config/pinned-assets",
        method: "PUT",
        description: "Update pinned assets",
      },
      {
        path: "/vaults/:id/config/slash-commands",
        method: "GET",
        description: "Get cached slash commands",
      },
      {
        path: "/vaults/:id/config/slash-commands",
        method: "PUT",
        description: "Save slash commands cache",
      },
      {
        path: "/vaults/help",
        method: "GET",
        description: "Vault API discovery",
      },
    ],
  };

  return c.json(body);
}
