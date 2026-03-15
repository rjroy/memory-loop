/**
 * Help / discovery root endpoint.
 *
 * Returns a structured description of available daemon API endpoints.
 * Each migration stage adds entries as new endpoints are created.
 */

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

export function helpHandler(): Response {
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
    ],
  };

  return Response.json(body);
}
