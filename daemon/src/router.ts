/**
 * Request router for the daemon API.
 *
 * Maps URL paths to route handlers. Bun.serve() calls this for every
 * incoming request. When Hono is added later, this file becomes the
 * Hono app definition.
 */

import { healthHandler } from "./routes/health";
import { helpHandler } from "./routes/help";

export function handleRequest(req: Request, startTime: number): Response {
  const url = new URL(req.url);
  const method = req.method;

  if (method === "GET" && url.pathname === "/health") {
    return healthHandler(startTime);
  }

  if (method === "GET" && url.pathname === "/help") {
    return helpHandler();
  }

  return Response.json(
    { error: "Not found", code: "NOT_FOUND" },
    { status: 404 },
  );
}
